import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoPendingOperationV3, DayMemoSyncMetadataV3 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords, type RemoteDayMemoRecord } from '../utils/dayMemoSyncPull'
import { loadDayMemoSyncMetadataAny } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'

export type DayMemoConflictClassification =
  | 'local_update_remote_deleted'
  | 'local_delete_remote_updated'
  | 'resurrection_remote_updated'
  | 'resurrection_newer_tombstone'
  | 'local_create_remote_changed'
  | 'remote_state_unknown'
  | 'pending_metadata_mismatch'

export type DayMemoConflictLocalOperation = 'update' | 'delete' | 'resurrection' | 'create' | 'unknown'
export type DayMemoConflictRemoteState = 'active' | 'deleted' | 'unknown'
export type DayMemoConflictPreviewState = 'unavailable' | 'idle' | 'checking' | 'checked' | 'error'

export interface DayMemoConflictPreviewItem {
  date: string
  classification: DayMemoConflictClassification
  localOperation: DayMemoConflictLocalOperation
  baseRevision: number
  remoteRevision: number | null
  baseChangeSequence: number
  remoteChangeSequence: number | null
  remoteState: DayMemoConflictRemoteState
  pendingStatus: DayMemoPendingOperationV3['status'] | 'intent_recorded'
  checkedAt: string
}

interface UseDayMemoConflictPreviewInput {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
}

interface LocalEvidence {
  date: string
  operation: DayMemoConflictLocalOperation
  baseRevision: number
  baseChangeSequence: number
  pendingStatus: DayMemoConflictPreviewItem['pendingStatus']
  coherent: boolean
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

function findRemote(records: RemoteDayMemoRecord[], date: string): RemoteDayMemoRecord | null {
  const matches = records.filter((record) => record.entityId === date)
  return matches.length === 1 ? matches[0] : null
}

function deleteIntentEvidence(metadata: DayMemoSyncMetadataV3, memos: DayMemo[], date: string): LocalEvidence {
  const intent = metadata.localDeleteIntents[date]
  const baseline = metadata.baselines[date]
  return {
    date,
    operation: 'delete',
    baseRevision: intent.baselineRevision,
    baseChangeSequence: intent.baselineChangeSequence,
    pendingStatus: 'intent_recorded',
    coherent: Boolean(baseline
      && baseline.deletedAt === null
      && baseline.remoteRevision === intent.baselineRevision
      && baseline.remoteChangeSequence === intent.baselineChangeSequence
      && !memos.some((memo) => memo.date === date)),
  }
}

function inspectLocalEvidence(metadata: DayMemoSyncMetadataV3, memos: DayMemo[]): LocalEvidence[] {
  const pending = metadata.pendingOperation
  if (pending) {
    const baseline = metadata.baselines[pending.date]
    const memo = memos.find((item) => item.date === pending.date)
    if (pending.kind === 'delete') {
      const intent = metadata.localDeleteIntents[pending.date]
      const current: LocalEvidence = {
        date: pending.date,
        operation: 'delete',
        baseRevision: pending.baseRevision,
        baseChangeSequence: baseline?.remoteChangeSequence ?? 0,
        pendingStatus: pending.status,
        coherent: Boolean(baseline
          && baseline.deletedAt === null
          && baseline.remoteRevision === pending.baseRevision
          && intent
          && intent.baselineRevision === pending.baseRevision
          && intent.baselineChangeSequence === baseline.remoteChangeSequence
          && !memo),
      }
      const additional = Object.values(metadata.localDeleteIntents)
        .filter((intent) => intent.status === 'conflict' && intent.date !== pending.date)
        .map((intent) => deleteIntentEvidence(metadata, memos, intent.date))
      return [current, ...additional]
    }
    const localMatchesPending = Boolean(memo && memo.updatedAt === pending.preparedLocalUpdatedAt)
    if (!baseline && pending.baseRevision === 0) {
      return [{ date: pending.date, operation: 'create', baseRevision: 0, baseChangeSequence: 0, pendingStatus: pending.status, coherent: localMatchesPending }]
    }
    if (baseline?.remoteRevision !== pending.baseRevision) {
      return [{ date: pending.date, operation: 'unknown', baseRevision: pending.baseRevision, baseChangeSequence: baseline?.remoteChangeSequence ?? 0, pendingStatus: pending.status, coherent: false }]
    }
    return [{
      date: pending.date,
      operation: baseline.deletedAt === null ? 'update' : 'resurrection',
      baseRevision: pending.baseRevision,
      baseChangeSequence: baseline.remoteChangeSequence,
      pendingStatus: pending.status,
      coherent: localMatchesPending,
    }]
  }

  const conflictIntents = Object.values(metadata.localDeleteIntents).filter((intent) => intent.status === 'conflict')
  return conflictIntents.map((intent) => deleteIntentEvidence(metadata, memos, intent.date))
}

function unknownItem(evidence: LocalEvidence, checkedAt: string): DayMemoConflictPreviewItem {
  return {
    date: evidence.date,
    classification: 'remote_state_unknown',
    localOperation: evidence.operation,
    baseRevision: evidence.baseRevision,
    remoteRevision: null,
    baseChangeSequence: evidence.baseChangeSequence,
    remoteChangeSequence: null,
    remoteState: 'unknown',
    pendingStatus: evidence.pendingStatus,
    checkedAt,
  }
}

function classify(evidence: LocalEvidence, remote: RemoteDayMemoRecord | null): DayMemoConflictClassification {
  if (!evidence.coherent) return 'pending_metadata_mismatch'
  if (!remote || remote.revision <= evidence.baseRevision || remote.changeSequence <= evidence.baseChangeSequence) {
    return 'remote_state_unknown'
  }
  if (evidence.operation === 'delete') {
    return remote.deletedAt === null ? 'local_delete_remote_updated' : 'remote_state_unknown'
  }
  if (evidence.operation === 'update') {
    return remote.deletedAt !== null ? 'local_update_remote_deleted' : 'remote_state_unknown'
  }
  if (evidence.operation === 'resurrection') {
    return remote.deletedAt === null ? 'resurrection_remote_updated' : 'resurrection_newer_tombstone'
  }
  if (evidence.operation === 'create') return 'local_create_remote_changed'
  return 'pending_metadata_mismatch'
}

export function useDayMemoConflictPreview({ dayMemos, isConfigured, isSignedIn, connection }: UseDayMemoConflictPreviewInput) {
  const [state, setState] = useState<DayMemoConflictPreviewState>('unavailable')
  const [items, setItems] = useState<DayMemoConflictPreviewItem[]>([])
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const generation = useRef(0)
  const signature = useMemo(() => localSignature(dayMemos), [dayMemos])
  const latestSignature = useRef(signature)
  latestSignature.current = signature
  const connectionEligible = Boolean(isConfigured && isSignedIn && supabaseClient && connectionIsEligible(connection))

  const reset = useCallback(() => {
    generation.current += 1
    setItems([])
    setSafeErrorMessage(null)
    if (!connectionEligible || !connection?.workspaceId) {
      setState('unavailable')
      return
    }
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    if (loaded.status !== 'ready' || loaded.metadata.version !== 3 || loaded.metadata.workspaceId !== connection.workspaceId) {
      setState('unavailable')
      return
    }
    const hasConflictPending = loaded.metadata.pendingOperation?.status === 'conflict'
    const hasConflictIntent = Object.values(loaded.metadata.localDeleteIntents).some((intent) => intent.status === 'conflict')
    setState(hasConflictPending || hasConflictIntent ? 'idle' : 'unavailable')
  }, [connection?.workspaceId, connectionEligible])

  useEffect(() => { reset() }, [reset, signature])

  const checkConflicts = useCallback(async () => {
    if (!connectionEligible || !connection?.workspaceId || !supabaseClient || state !== 'idle') return
    setState('checking')
    setItems([])
    setSafeErrorMessage(null)
    const before = loadDayMemoSyncMetadataAny(window.localStorage)
    const stored = readDayMemoStorageSnapshot(window.localStorage)
    if (before.status !== 'ready' || before.metadata.version !== 3 || before.metadata.workspaceId !== connection.workspaceId
      || stored.status !== 'ready' || localSignature(stored.memos) !== signature) {
      setState('error')
      setSafeErrorMessage('競合状態を安全に確認できませんでした。')
      return
    }
    const evidences = inspectLocalEvidence(before.metadata, stored.memos)
    if (evidences.length === 0) {
      setState('error')
      setSafeErrorMessage('確認できる競合状態がありません。')
      return
    }
    const requestGeneration = ++generation.current
    const pulled = await pullAllDayMemoSyncRecords(
      supabaseClient,
      connection.workspaceId,
      () => generation.current === requestGeneration && latestSignature.current === signature,
    ).catch(() => null)
    const checkedAt = new Date().toISOString()
    if (!pulled || pulled.status !== 'complete') {
      setItems(evidences.map((evidence) => unknownItem(evidence, checkedAt)))
      setState('checked')
      return
    }
    const after = loadDayMemoSyncMetadataAny(window.localStorage)
    const afterStored = readDayMemoStorageSnapshot(window.localStorage)
    if (after.status !== 'ready' || after.metadata.version !== 3 || after.raw !== before.raw
      || afterStored.status !== 'ready' || afterStored.serialized !== stored.serialized
      || latestSignature.current !== signature) {
      setItems(evidences.map((evidence) => unknownItem(evidence, checkedAt)))
      setState('checked')
      return
    }
    setItems(evidences.map((evidence) => {
      const remote = findRemote(pulled.records, evidence.date)
      return {
        date: evidence.date,
        classification: classify(evidence, remote),
        localOperation: evidence.operation,
        baseRevision: evidence.baseRevision,
        remoteRevision: remote?.revision ?? null,
        baseChangeSequence: evidence.baseChangeSequence,
        remoteChangeSequence: remote?.changeSequence ?? null,
        remoteState: remote ? (remote.deletedAt === null ? 'active' : 'deleted') : 'unknown',
        pendingStatus: evidence.pendingStatus,
        checkedAt,
      }
    }))
    setState('checked')
  }, [connection?.workspaceId, connectionEligible, signature, state])

  return {
    eligible: state !== 'unavailable',
    state,
    items,
    conflictCount: items.length,
    safeErrorMessage,
    checkConflicts,
    discardPreview: reset,
  }
}
