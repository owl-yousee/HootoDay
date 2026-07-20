import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoRemoteBaselineV3, DayMemoSyncMetadataV3 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords } from '../utils/dayMemoSyncPull'
import { loadDayMemoSyncMetadataAny } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'

export type DayMemoResurrectionClassification =
  | 'resurrection_candidate'
  | 'resurrection_conflict'
  | 'resurrection_unknown'

export interface DayMemoResurrectionPreviewItem {
  date: string
  classification: DayMemoResurrectionClassification
  tombstoneRevision: number
  tombstoneChangeSequence: number
  deletedAt: string
}

export interface DayMemoResurrectionPreviewSummary {
  candidateCount: number
  resurrectionCandidateCount: number
  resurrectionConflictCount: number
  resurrectionUnknownCount: number
}

export interface DayMemoResurrectionUploadSnapshot {
  workspaceId: string
  metadataRaw: string
  localStorageSerialized: string
  localMemos: DayMemo[]
  baselineConfirmedAt: string
  lastPulledChangeSequence: number
  baseline: DayMemoRemoteBaselineV3
  memo: DayMemo
}

export type DayMemoResurrectionPreviewState =
  | 'unavailable'
  | 'idle'
  | 'checking'
  | 'preview_ready'
  | 'no_candidates'
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

function summarize(items: DayMemoResurrectionPreviewItem[]): DayMemoResurrectionPreviewSummary {
  const count = (classification: DayMemoResurrectionClassification) => items
    .filter((item) => item.classification === classification).length
  return {
    candidateCount: items.length,
    resurrectionCandidateCount: count('resurrection_candidate'),
    resurrectionConflictCount: count('resurrection_conflict'),
    resurrectionUnknownCount: count('resurrection_unknown'),
  }
}

export function useDayMemoResurrectionPreview({ dayMemos, isConfigured, isSignedIn, connection }: Input) {
  const [state, setState] = useState<DayMemoResurrectionPreviewState>('unavailable')
  const [items, setItems] = useState<DayMemoResurrectionPreviewItem[]>([])
  const [summary, setSummary] = useState<DayMemoResurrectionPreviewSummary | null>(null)
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const runIdRef = useRef(0)
  const uploadSnapshotRef = useRef<DayMemoResurrectionUploadSnapshot | null>(null)
  const currentLocalSignature = useMemo(() => localSignature(dayMemos), [dayMemos])
  const eligible = Boolean(isConfigured && isSignedIn && supabaseClient && connectionIsEligible(connection))

  const discardPreview = useCallback(() => {
    runIdRef.current += 1
    uploadSnapshotRef.current = null
    setItems([])
    setSummary(null)
    setSafeErrorMessage(null)
    setState(eligible ? 'idle' : 'unavailable')
  }, [eligible])

  useEffect(() => {
    runIdRef.current += 1
    uploadSnapshotRef.current = null
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

  const previewResurrectionCandidates = useCallback(async () => {
    if (!eligible || !connection?.workspaceId || !supabaseClient || state === 'checking') return
    const runId = runIdRef.current + 1
    runIdRef.current = runId
    setState('checking')
    uploadSnapshotRef.current = null
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
      setSafeErrorMessage('復活候補を確認する前提となる同期状態を安全に確認できませんでした。')
      return
    }

    const localByDate = new Map(storedBefore.memos.map((memo) => [memo.date, memo]))
    const candidateDates = Object.values(before.metadata.baselines)
      .filter((baseline) => baseline.deletedAt !== null
        && baseline.baselineLocalUpdatedAt === null
        && localByDate.has(baseline.date))
      .map((baseline) => baseline.date)
      .sort((left, right) => left.localeCompare(right))

    if (candidateDates.length === 0) {
      setSummary(summarize([]))
      setState('no_candidates')
      return
    }

    const unknownItems = candidateDates.map((date): DayMemoResurrectionPreviewItem => {
      const baseline = before.metadata.version === 3 ? before.metadata.baselines[date] : null
      return {
        date,
        classification: 'resurrection_unknown',
        tombstoneRevision: baseline?.remoteRevision ?? 0,
        tombstoneChangeSequence: baseline?.remoteChangeSequence ?? 0,
        deletedAt: baseline?.deletedAt ?? '',
      }
    })

    const pull = await pullAllDayMemoSyncRecords(
      supabaseClient,
      connection.workspaceId,
      () => runIdRef.current === runId,
    ).catch(() => null)
    if (runIdRef.current !== runId) return
    if (!pull || pull.status !== 'complete') {
      setItems(unknownItems)
      setSummary(summarize(unknownItems))
      setState('error')
      setSafeErrorMessage('同期先の状態を完全に確認できませんでした。部分的な結果は使用していません。')
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
      setItems(unknownItems)
      setSummary(summarize(unknownItems))
      setState('error')
      setSafeErrorMessage('確認中にこの端末の状態が変わったため、確認結果を破棄しました。')
      return
    }

    const metadata = after.metadata as DayMemoSyncMetadataV3
    const remoteByDate = new Map(pull.records.map((record) => [record.entityId, record]))
    const classified = candidateDates.map((date): DayMemoResurrectionPreviewItem => {
      const baseline = metadata.baselines[date]
      const remote = remoteByDate.get(date)
      const hasDeleteIntent = Boolean(metadata.localDeleteIntents[date])
      let classification: DayMemoResurrectionClassification = 'resurrection_unknown'
      if (baseline && baseline.deletedAt !== null && baseline.baselineLocalUpdatedAt === null && remote) {
        const sameTombstone = remote.payload === null
          && remote.deletedAt === baseline.deletedAt
          && remote.revision === baseline.remoteRevision
          && remote.changeSequence === baseline.remoteChangeSequence
        classification = !hasDeleteIntent && sameTombstone
          ? 'resurrection_candidate'
          : 'resurrection_conflict'
      } else if (baseline && baseline.deletedAt !== null && baseline.baselineLocalUpdatedAt === null) {
        classification = 'resurrection_conflict'
      }
      return {
        date,
        classification,
        tombstoneRevision: baseline.remoteRevision,
        tombstoneChangeSequence: baseline.remoteChangeSequence,
        deletedAt: baseline.deletedAt!,
      }
    })

    setItems(classified)
    setSummary(summarize(classified))
    if (classified.length === 1 && classified[0].classification === 'resurrection_candidate') {
      const date = classified[0].date
      const baseline = metadata.baselines[date]
      const memo = storedAfter.memos.find((candidate) => candidate.date === date)
      if (baseline && memo && metadata.baselineConfirmedAt) {
        uploadSnapshotRef.current = {
          workspaceId: metadata.workspaceId,
          metadataRaw: after.raw,
          localStorageSerialized: storedAfter.serialized,
          localMemos: storedAfter.memos.map((candidate) => ({ ...candidate })),
          baselineConfirmedAt: metadata.baselineConfirmedAt,
          lastPulledChangeSequence: metadata.lastPulledChangeSequence,
          baseline: { ...baseline },
          memo: { ...memo },
        }
      }
    }
    setState('preview_ready')
  }, [connection?.workspaceId, currentLocalSignature, eligible, state])

  const getSingleCandidateSnapshot = useCallback((): DayMemoResurrectionUploadSnapshot | null => {
    const snapshot = uploadSnapshotRef.current
    if (state !== 'preview_ready'
      || summary?.candidateCount !== 1
      || summary.resurrectionCandidateCount !== 1
      || summary.resurrectionConflictCount !== 0
      || summary.resurrectionUnknownCount !== 0
      || !snapshot) return null
    return {
      ...snapshot,
      localMemos: snapshot.localMemos.map((memo) => ({ ...memo })),
      baseline: { ...snapshot.baseline },
      memo: { ...snapshot.memo },
    }
  }, [state, summary])

  return {
    eligible,
    state,
    items,
    summary,
    safeErrorMessage,
    previewResurrectionCandidates,
    discardPreview,
    getSingleCandidateSnapshot,
  }
}
