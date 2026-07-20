import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoRemoteBaselineV3 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords } from '../utils/dayMemoSyncPull'
import { loadDayMemoSyncMetadataAny } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'

export type DayMemoTombstoneClassification =
  | 'remote_deleted_local_active'
  | 'remote_deleted_local_modified'
  | 'remote_deleted_local_missing'
  | 'remote_deleted_unknown'

export interface DayMemoTombstonePreviewItem {
  date: string
  classification: DayMemoTombstoneClassification
  remoteRevision: number
  remoteChangeSequence: number
  deletedAt: string
}

export interface DayMemoTombstonePreviewSummary {
  tombstoneCount: number
  remoteDeletedLocalActiveCount: number
  remoteDeletedLocalModifiedCount: number
  remoteDeletedLocalMissingCount: number
  remoteDeletedUnknownCount: number
}

export interface DayMemoTombstoneApplySnapshot {
  workspaceId: string
  metadataRaw: string
  localStorageSerialized: string
  localMemos: DayMemo[]
  date: string
  baseline: DayMemoRemoteBaselineV3
  remoteRevision: number
  remoteChangeSequence: number
  remoteUpdatedAt: string
  deletedAt: string
}

export type DayMemoTombstonePreviewState =
  | 'unavailable'
  | 'idle'
  | 'checking'
  | 'preview_ready'
  | 'no_tombstones'
  | 'blocked'
  | 'error'

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
}

function localSignature(memos: DayMemo[]): string {
  return JSON.stringify(memos
    .map((memo) => [memo.date, memo.updatedAt, memo.content])
    .sort(([left], [right]) => left.localeCompare(right)))
}

function connectionIsEligible(connection: SyncConnection | null): boolean {
  return Boolean(connection
    && isUuid(connection.workspaceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}

function summarize(items: DayMemoTombstonePreviewItem[]): DayMemoTombstonePreviewSummary {
  const count = (classification: DayMemoTombstoneClassification) => items
    .filter((item) => item.classification === classification).length
  return {
    tombstoneCount: items.length,
    remoteDeletedLocalActiveCount: count('remote_deleted_local_active'),
    remoteDeletedLocalModifiedCount: count('remote_deleted_local_modified'),
    remoteDeletedLocalMissingCount: count('remote_deleted_local_missing'),
    remoteDeletedUnknownCount: count('remote_deleted_unknown'),
  }
}

export function useDayMemoTombstonePreview({ dayMemos, isConfigured, isSignedIn, connection }: Input) {
  const [state, setState] = useState<DayMemoTombstonePreviewState>('unavailable')
  const [items, setItems] = useState<DayMemoTombstonePreviewItem[]>([])
  const [summary, setSummary] = useState<DayMemoTombstonePreviewSummary | null>(null)
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const runIdRef = useRef(0)
  const applySnapshotRef = useRef<DayMemoTombstoneApplySnapshot | null>(null)
  const currentLocalSignature = useMemo(() => localSignature(dayMemos), [dayMemos])
  const eligible = Boolean(isConfigured && isSignedIn && supabaseClient && connectionIsEligible(connection))

  const discardPreview = useCallback(() => {
    runIdRef.current += 1
    applySnapshotRef.current = null
    setItems([])
    setSummary(null)
    setSafeErrorMessage(null)
    setState(eligible ? 'idle' : 'unavailable')
  }, [eligible])

  useEffect(() => {
    runIdRef.current += 1
    applySnapshotRef.current = null
    setItems([])
    setSummary(null)
    setSafeErrorMessage(null)
    if (!eligible || !connection?.workspaceId) {
      setState('unavailable')
      return
    }
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    if (loaded.status !== 'ready'
      || loaded.metadata.version !== 3
      || loaded.metadata.workspaceId !== connection.workspaceId
      || loaded.metadata.baselineStatus !== 'confirmed'
      || loaded.metadata.baselineConfirmedAt === null
      || loaded.metadata.pendingOperation !== null
      || loaded.metadata.pushBlock !== null) {
      setState('blocked')
      return
    }
    setState('idle')
  }, [connection?.workspaceId, currentLocalSignature, eligible])

  const previewTombstones = useCallback(async () => {
    if (!eligible || !connection?.workspaceId || !supabaseClient || state === 'checking') return
    const runId = runIdRef.current + 1
    runIdRef.current = runId
    setState('checking')
    applySnapshotRef.current = null
    setItems([])
    setSummary(null)
    setSafeErrorMessage(null)

    const before = loadDayMemoSyncMetadataAny(window.localStorage)
    const storedBefore = readDayMemoStorageSnapshot(window.localStorage)
    if (before.status !== 'ready'
      || before.metadata.version !== 3
      || before.metadata.workspaceId !== connection.workspaceId
      || before.metadata.baselineStatus !== 'confirmed'
      || before.metadata.baselineConfirmedAt === null
      || before.metadata.pendingOperation !== null
      || before.metadata.pushBlock !== null
      || storedBefore.status !== 'ready'
      || localSignature(storedBefore.memos) !== currentLocalSignature) {
      setState('blocked')
      setSafeErrorMessage('同期状態またはこの端末のDayMemoを安全に確認できませんでした。')
      return
    }

    const pull = await pullAllDayMemoSyncRecords(
      supabaseClient,
      connection.workspaceId,
      () => runIdRef.current === runId,
    ).catch(() => null)
    if (runIdRef.current !== runId) return
    if (!pull || pull.status !== 'complete') {
      setState('error')
      setSafeErrorMessage('同期先の削除状態を完全に確認できませんでした。部分的な結果は使用しません。')
      return
    }

    const after = loadDayMemoSyncMetadataAny(window.localStorage)
    const storedAfter = readDayMemoStorageSnapshot(window.localStorage)
    if (after.status !== 'ready'
      || after.metadata.version !== 3
      || after.raw !== before.raw
      || storedAfter.status !== 'ready'
      || storedAfter.serialized !== storedBefore.serialized
      || localSignature(storedAfter.memos) !== currentLocalSignature) {
      setState('error')
      setSafeErrorMessage('確認中に端末の状態が変化したため、確認結果を破棄しました。')
      return
    }

    const metadata = after.metadata
    const localByDate = new Map(storedAfter.memos.map((memo) => [memo.date, memo]))
    const tombstones = pull.records.filter((record) => record.deletedAt !== null)
    const classified = tombstones.map((remote): DayMemoTombstonePreviewItem => {
      const local = localByDate.get(remote.entityId)
      const baseline = metadata.baselines[remote.entityId]
      let classification: DayMemoTombstoneClassification = 'remote_deleted_unknown'
      if (!local) {
        classification = 'remote_deleted_local_missing'
      } else if (baseline
        && baseline.deletedAt === null
        && baseline.baselineLocalUpdatedAt !== null
        && remote.revision === baseline.remoteRevision + 1
        && remote.changeSequence > baseline.remoteChangeSequence) {
        classification = local.updatedAt === baseline.baselineLocalUpdatedAt
          ? 'remote_deleted_local_active'
          : 'remote_deleted_local_modified'
      }
      return {
        date: remote.entityId,
        classification,
        remoteRevision: remote.revision,
        remoteChangeSequence: remote.changeSequence,
        deletedAt: remote.deletedAt!,
      }
    }).sort((left, right) => left.date.localeCompare(right.date))

    setItems(classified)
    setSummary(summarize(classified))
    if (classified.length === 1 && classified[0].classification === 'remote_deleted_local_active') {
      const remote = tombstones[0]
      const baseline = metadata.baselines[remote.entityId]
      applySnapshotRef.current = {
        workspaceId: metadata.workspaceId,
        metadataRaw: after.raw,
        localStorageSerialized: storedAfter.serialized,
        localMemos: storedAfter.memos.map((memo) => ({ ...memo })),
        date: remote.entityId,
        baseline: { ...baseline },
        remoteRevision: remote.revision,
        remoteChangeSequence: remote.changeSequence,
        remoteUpdatedAt: remote.serverUpdatedAt,
        deletedAt: remote.deletedAt!,
      }
    }
    setState(classified.length === 0 ? 'no_tombstones' : 'preview_ready')
  }, [connection?.workspaceId, currentLocalSignature, eligible, state])

  const getSingleActiveSnapshot = useCallback((): DayMemoTombstoneApplySnapshot | null => {
    const snapshot = applySnapshotRef.current
    if (state !== 'preview_ready'
      || summary?.tombstoneCount !== 1
      || summary.remoteDeletedLocalActiveCount !== 1
      || summary.remoteDeletedLocalModifiedCount !== 0
      || summary.remoteDeletedLocalMissingCount !== 0
      || summary.remoteDeletedUnknownCount !== 0
      || !snapshot) return null
    return {
      ...snapshot,
      localMemos: snapshot.localMemos.map((memo) => ({ ...memo })),
      baseline: { ...snapshot.baseline },
    }
  }, [state, summary])

  return {
    eligible,
    state,
    items,
    summary,
    safeErrorMessage,
    previewTombstones,
    discardPreview,
    getSingleActiveSnapshot,
  }
}
