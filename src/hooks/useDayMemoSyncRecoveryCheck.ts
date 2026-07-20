import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoNormalUpsertPendingOperationV5, DayMemoPendingOperationV2, DayMemoPendingOperationV5, DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords, type RemoteDayMemoRecord } from '../utils/dayMemoSyncPull'
import { loadDayMemoSyncMetadataAny } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'

export type DayMemoSyncRecoveryClassification =
  | 'remote_applied'
  | 'remote_not_applied'
  | 'conflict_detected'
  | 'unknown'

export type DayMemoSyncRecoveryCheckState = 'unavailable' | 'idle' | 'checking' | 'checked' | 'error'

export type DayMemoSyncRecoveryCheckResult =
  | { date: string; classification: 'remote_applied'; remoteRevision: number; remoteChangeSequence: number }
  | { date: string; classification: Exclude<DayMemoSyncRecoveryClassification, 'remote_applied'> }

export interface DayMemoRemoteAppliedRecoverySnapshot {
  workspaceId: string
  date: string
  remoteRevision: number
  remoteChangeSequence: number
  remotePayload: DayMemo
  deletedAt: null
  conflict: false
  pendingOperation: DayMemoPendingOperationV2
  metadataRaw: string
  localMemo: DayMemo
  localStorageSerialized: string
  previousChangeSequence: number
  checkedAt: string
}

export interface DayMemoConflictSummary {
  status: 'conflict' | 'conflict_detected'
  date: string
  localRevision: number
  remoteRevision: number | null
  localChangeSequence: number
  remoteChangeSequence: number | null
  recordedAt: string
}

interface UseDayMemoSyncRecoveryCheckInput {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
}

function localSignature(memos: DayMemo[]): string {
  return JSON.stringify(memos.map((memo) => [memo.date, memo.updatedAt, memo.content]).sort(([left], [right]) => left.localeCompare(right)))
}

function connectionIsEligible(connection: SyncConnection | null): boolean {
  return Boolean(connection
    && isUuid(connection.workspaceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}

function isCheckablePending(pending: DayMemoPendingOperationV5 | null): pending is DayMemoNormalUpsertPendingOperationV5 {
  return Boolean(pending?.kind === 'upsert' && pending.operationMode === 'normal' && (
    pending.status === 'conflict'
    || pending.status === 'response_unknown'
    || pending.status === 'recovery_required'
    || pending.status === 'sending'
  ))
}

function targetRemote(records: RemoteDayMemoRecord[], date: string): RemoteDayMemoRecord | null {
  const matches = records.filter((record) => record.entityId === date)
  return matches.length === 1 ? matches[0] : null
}

function requestPayloadMatches(remote: RemoteDayMemoRecord, memo: DayMemo): boolean {
  return remote.deletedAt === null
    && remote.payload !== null
    && remote.payload.date === memo.date
    && remote.payload.updatedAt === memo.updatedAt
    && remote.payload.content === memo.content
}

function classifyRemote(
  metadata: DayMemoSyncMetadataV5,
  pending: DayMemoPendingOperationV2,
  memo: DayMemo,
  records: RemoteDayMemoRecord[],
): DayMemoSyncRecoveryClassification {
  const remote = targetRemote(records, pending.date)
  const baseline = metadata.baselines[pending.date]

  if (remote
    && remote.revision === pending.baseRevision + 1
    && remote.changeSequence > (baseline?.remoteChangeSequence ?? metadata.lastPulledChangeSequence)
    && requestPayloadMatches(remote, memo)) {
    return 'remote_applied'
  }
  if (pending.baseRevision === 0 && baseline === undefined && remote === null) {
    return 'remote_not_applied'
  }
  if (pending.baseRevision > 0
    && baseline
    && baseline.remoteRevision === pending.baseRevision
    && remote
    && remote.deletedAt === null
    && remote.payload !== null
    && remote.revision === baseline.remoteRevision
    && remote.changeSequence === baseline.remoteChangeSequence
    && remote.payload.updatedAt === baseline.remoteUpdatedAt) {
    return 'remote_not_applied'
  }
  return 'conflict_detected'
}

export function useDayMemoSyncRecoveryCheck({
  dayMemos,
  isConfigured,
  isSignedIn,
  connection,
}: UseDayMemoSyncRecoveryCheckInput) {
  const [state, setState] = useState<DayMemoSyncRecoveryCheckState>('unavailable')
  const [result, setResult] = useState<DayMemoSyncRecoveryCheckResult | null>(null)
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const [conflictSummary, setConflictSummary] = useState<DayMemoConflictSummary | null>(null)
  const appliedSnapshotRef = useRef<DayMemoRemoteAppliedRecoverySnapshot | null>(null)
  const generation = useRef(0)
  const currentLocalSignature = useMemo(() => localSignature(dayMemos), [dayMemos])
  const latestLocalSignature = useRef(currentLocalSignature)
  latestLocalSignature.current = currentLocalSignature
  const eligible = Boolean(isConfigured && isSignedIn && supabaseClient && connectionIsEligible(connection))

  const reset = useCallback(() => {
    generation.current += 1
    appliedSnapshotRef.current = null
    setResult(null)
    setSafeErrorMessage(null)
    if (!eligible || !connection?.workspaceId) {
      setConflictSummary(null)
      setState('unavailable')
      return
    }
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    if (loaded.status === 'ready'
      && loaded.metadata.version === 5
      && loaded.metadata.workspaceId === connection.workspaceId
      && isCheckablePending(loaded.metadata.pendingOperation)) {
      const pending = loaded.metadata.pendingOperation
      setConflictSummary(pending.status === 'conflict' ? {
        status: 'conflict',
        date: pending.date,
        localRevision: pending.baseRevision,
        remoteRevision: null,
        localChangeSequence: loaded.metadata.baselines[pending.date]?.remoteChangeSequence
          ?? loaded.metadata.lastPulledChangeSequence,
        remoteChangeSequence: null,
        recordedAt: pending.preparedAt,
      } : null)
      setState('idle')
      return
    }
    setConflictSummary(null)
    setState('unavailable')
  }, [connection?.workspaceId, eligible])

  useEffect(() => {
    reset()
  }, [currentLocalSignature, reset])

  const checkRemote = useCallback(async () => {
    if (!eligible || !connection?.workspaceId || !supabaseClient || state !== 'idle') return
    setState('checking')
    appliedSnapshotRef.current = null
    setResult(null)
    setSafeErrorMessage(null)
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    if (loaded.status !== 'ready'
      || loaded.metadata.version !== 5
      || loaded.metadata.workspaceId !== connection.workspaceId
      || !isCheckablePending(loaded.metadata.pendingOperation)) {
      setState('error')
      setSafeErrorMessage('同期設定を安全に確認できません。')
      return
    }
    const pending = loaded.metadata.pendingOperation
    const stored = readDayMemoStorageSnapshot(window.localStorage)
    const localMatchesReact = stored.status === 'ready' && localSignature(stored.memos) === currentLocalSignature
    const targetMemos = stored.status === 'ready' ? stored.memos.filter((memo) => memo.date === pending.date) : []
    if (!localMatchesReact || targetMemos.length !== 1 || targetMemos[0].updatedAt !== pending.preparedLocalUpdatedAt) {
      setState('checked')
      setResult({ date: pending.date, classification: 'unknown' })
      return
    }
    const requestGeneration = ++generation.current
    const pulled = await pullAllDayMemoSyncRecords(
      supabaseClient,
      connection.workspaceId,
      () => generation.current === requestGeneration && latestLocalSignature.current === currentLocalSignature,
    ).catch(() => null)
    if (!pulled || pulled.status !== 'complete') {
      setState('checked')
      setResult({ date: pending.date, classification: 'unknown' })
      return
    }
    const afterPull = loadDayMemoSyncMetadataAny(window.localStorage)
    const afterStored = readDayMemoStorageSnapshot(window.localStorage)
    if (afterPull.status !== 'ready'
      || afterPull.metadata.version !== 5
      || afterPull.raw !== loaded.raw
      || afterStored.status !== 'ready'
      || localSignature(afterStored.memos) !== currentLocalSignature) {
      setState('checked')
      setResult({ date: pending.date, classification: 'unknown' })
      return
    }
    const classification = classifyRemote(afterPull.metadata, pending, targetMemos[0], pulled.records)
    const remote = targetRemote(pulled.records, pending.date)
    if (classification === 'conflict_detected') {
      setConflictSummary({
        status: 'conflict_detected',
        date: pending.date,
        localRevision: pending.baseRevision,
        remoteRevision: remote?.revision ?? null,
        localChangeSequence: afterPull.metadata.baselines[pending.date]?.remoteChangeSequence
          ?? afterPull.metadata.lastPulledChangeSequence,
        remoteChangeSequence: remote?.changeSequence ?? null,
        recordedAt: new Date().toISOString(),
      })
    }
    if (classification === 'remote_applied') {
      if (!remote?.payload || remote.deletedAt !== null) {
        setResult({ date: pending.date, classification: 'unknown' })
        setState('checked')
        return
      }
      const previousChangeSequence = afterPull.metadata.baselines[pending.date]?.remoteChangeSequence
        ?? afterPull.metadata.lastPulledChangeSequence
      appliedSnapshotRef.current = {
        workspaceId: connection.workspaceId,
        date: pending.date,
        remoteRevision: remote.revision,
        remoteChangeSequence: remote.changeSequence,
        remotePayload: { ...remote.payload },
        deletedAt: null,
        conflict: false,
        pendingOperation: { ...pending },
        metadataRaw: afterPull.raw,
        localMemo: { ...targetMemos[0] },
        localStorageSerialized: afterStored.serialized,
        previousChangeSequence,
        checkedAt: new Date().toISOString(),
      }
      setResult({
        date: pending.date,
        classification,
        remoteRevision: remote.revision,
        remoteChangeSequence: remote.changeSequence,
      })
      setState('checked')
      return
    }
    setResult({ date: pending.date, classification })
    setState('checked')
  }, [connection?.workspaceId, currentLocalSignature, eligible, state])

  const getRemoteAppliedSnapshot = useCallback((): DayMemoRemoteAppliedRecoverySnapshot | null => {
    const snapshot = appliedSnapshotRef.current
    return snapshot ? {
      ...snapshot,
      remotePayload: { ...snapshot.remotePayload },
      pendingOperation: { ...snapshot.pendingOperation },
      localMemo: { ...snapshot.localMemo },
    } : null
  }, [])

  return { eligible, state, result, conflictSummary, safeErrorMessage, checkRemote, discardResult: reset, getRemoteAppliedSnapshot }
}
