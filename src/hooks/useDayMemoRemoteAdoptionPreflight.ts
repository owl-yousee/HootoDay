import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoSyncMetadataV3 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { isStoredDayMemo, readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords, type RemoteDayMemoRecord } from '../utils/dayMemoSyncPull'
import { loadDayMemoSyncMetadataAny } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import type { DayMemoConflictAdoptionSnapshot, DayMemoConflictPreviewItem } from './useDayMemoConflictPreview'

export type DayMemoRemoteAdoptionPreflightClassification =
  | 'ready_remote_active'
  | 'ready_remote_tombstone'
  | 'blocked_snapshot_changed'
  | 'blocked_remote_changed'
  | 'blocked_other_mismatch'
  | 'blocked_invalid_remote'
  | 'blocked_unknown'

export type DayMemoRemoteAdoptionPreflightState = 'unavailable' | 'selected' | 'checking' | 'checked' | 'error'

export interface DayMemoRemoteAdoptionPreflightResult {
  date: string
  conflictClassification: DayMemoConflictPreviewItem['classification']
  localOperation: DayMemoConflictPreviewItem['localOperation']
  remoteState: 'active' | 'deleted'
  baseRevision: number
  remoteRevision: number
  baselineChangeSequence: number
  remoteChangeSequence: number
  classification: DayMemoRemoteAdoptionPreflightClassification
  checkedAt: string
  otherMismatchCount: number
  localEffect: 'replace' | 'add' | 'delete' | 'metadata_only'
}

export interface DayMemoRemoteActiveAdoptionSnapshot {
  result: DayMemoRemoteAdoptionPreflightResult & { classification: 'ready_remote_active'; remoteState: 'active'; localEffect: 'replace' | 'add' }
  conflictSnapshot: DayMemoConflictAdoptionSnapshot
  completedLocalCandidate: DayMemo[]
}

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  conflictItems: DayMemoConflictPreviewItem[]
  getAdoptionSnapshot: (date: string) => DayMemoConflictAdoptionSnapshot | null
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

function safeItem(item: DayMemoConflictPreviewItem): boolean {
  return item.classification !== 'remote_state_unknown'
    && item.classification !== 'pending_metadata_mismatch'
    && item.remoteState !== 'unknown'
    && item.remoteRevision !== null
    && item.remoteChangeSequence !== null
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function countRemoteAdoptionMismatches(
  metadata: DayMemoSyncMetadataV3,
  localMemos: DayMemo[],
  records: RemoteDayMemoRecord[],
  targetDate: string,
): number {
  const localByDate = new Map(localMemos.map((memo) => [memo.date, memo]))
  const remoteByDate = new Map(records.map((record) => [record.entityId, record]))
  const dates = new Set([...Object.keys(metadata.baselines), ...localByDate.keys(), ...remoteByDate.keys()])
  let mismatches = 0
  for (const date of dates) {
    if (date === targetDate) continue
    const baseline = metadata.baselines[date]
    const local = localByDate.get(date)
    const remote = remoteByDate.get(date)
    if (!baseline || !remote
      || baseline.remoteRevision !== remote.revision
      || baseline.remoteChangeSequence !== remote.changeSequence
      || baseline.deletedAt !== remote.deletedAt) {
      mismatches += 1
      continue
    }
    if (remote.deletedAt === null) {
      if (!local || !remote.payload
        || baseline.baselineLocalUpdatedAt !== local.updatedAt
        || baseline.remoteUpdatedAt !== remote.payload.updatedAt
        || remote.payload.date !== local.date
        || remote.payload.updatedAt !== local.updatedAt
        || remote.payload.content !== local.content) mismatches += 1
    } else if (local || remote.payload !== null || baseline.baselineLocalUpdatedAt !== null
      || baseline.remoteUpdatedAt !== remote.serverUpdatedAt) {
      mismatches += 1
    }
  }
  return mismatches
}

function blockedResult(
  snapshot: DayMemoConflictAdoptionSnapshot,
  classification: DayMemoRemoteAdoptionPreflightClassification,
  checkedAt: string,
  mismatches = 0,
): DayMemoRemoteAdoptionPreflightResult {
  const localExists = snapshot.localMemos.some((memo) => memo.date === snapshot.item.date)
  return {
    date: snapshot.item.date,
    conflictClassification: snapshot.item.classification,
    localOperation: snapshot.item.localOperation,
    remoteState: snapshot.item.remoteState === 'deleted' ? 'deleted' : 'active',
    baseRevision: snapshot.item.baseRevision,
    remoteRevision: snapshot.item.remoteRevision ?? 0,
    baselineChangeSequence: snapshot.item.baseChangeSequence,
    remoteChangeSequence: snapshot.item.remoteChangeSequence ?? 0,
    classification,
    checkedAt,
    otherMismatchCount: mismatches,
    localEffect: snapshot.item.remoteState === 'deleted' ? (localExists ? 'delete' : 'metadata_only') : (localExists ? 'replace' : 'add'),
  }
}

export function useDayMemoRemoteAdoptionPreflight({ dayMemos, isConfigured, isSignedIn, connection, conflictItems, getAdoptionSnapshot }: Input) {
  const [state, setState] = useState<DayMemoRemoteAdoptionPreflightState>('unavailable')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [result, setResult] = useState<DayMemoRemoteAdoptionPreflightResult | null>(null)
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const selectedSnapshotRef = useRef<DayMemoConflictAdoptionSnapshot | null>(null)
  const completedLocalCandidateRef = useRef<DayMemo[] | null>(null)
  const readyActiveSnapshotRef = useRef<DayMemoRemoteActiveAdoptionSnapshot | null>(null)
  const generation = useRef(0)
  const signature = useMemo(() => localSignature(dayMemos), [dayMemos])
  const latestSignature = useRef(signature)
  latestSignature.current = signature
  const eligibleConnection = Boolean(isConfigured && isSignedIn && supabaseClient && connectionIsEligible(connection))
  const itemsSignature = useMemo(() => JSON.stringify(conflictItems), [conflictItems])
  const currentMetadata = connection?.workspaceId ? loadDayMemoSyncMetadataAny(window.localStorage) : null
  const metadataEligible = Boolean(currentMetadata?.status === 'ready'
    && currentMetadata.metadata.version === 3
    && currentMetadata.metadata.workspaceId === connection?.workspaceId
    && currentMetadata.metadata.baselineStatus === 'confirmed'
    && currentMetadata.metadata.pushBlock === null)

  const discard = useCallback(() => {
    generation.current += 1
    selectedSnapshotRef.current = null
    completedLocalCandidateRef.current = null
    readyActiveSnapshotRef.current = null
    setSelectedDate(null)
    setResult(null)
    setSafeErrorMessage(null)
    setState(eligibleConnection && conflictItems.some(safeItem) ? 'unavailable' : 'unavailable')
  }, [conflictItems, eligibleConnection])

  useEffect(() => { discard() }, [discard, itemsSignature, signature])

  const selectCandidate = useCallback((date: string) => {
    if (!eligibleConnection || !metadataEligible) return
    const item = conflictItems.find((candidate) => candidate.date === date)
    const snapshot = item && safeItem(item) ? getAdoptionSnapshot(date) : null
    if (!item || !snapshot || snapshot.item.date !== item.date || !sameJson(snapshot.item, item)) {
      discard()
      setSafeErrorMessage('remote採用候補のsnapshotを安全に確認できませんでした。')
      return
    }
    generation.current += 1
    selectedSnapshotRef.current = snapshot
    completedLocalCandidateRef.current = null
    readyActiveSnapshotRef.current = null
    setSelectedDate(date)
    setResult(null)
    setSafeErrorMessage(null)
    setState('selected')
  }, [conflictItems, discard, eligibleConnection, getAdoptionSnapshot, metadataEligible])

  const runPreflight = useCallback(async () => {
    const snapshot = selectedSnapshotRef.current
    if (!snapshot || !eligibleConnection || !connection?.workspaceId || !supabaseClient || state !== 'selected') return
    setState('checking')
    setResult(null)
    setSafeErrorMessage(null)
    completedLocalCandidateRef.current = null
    readyActiveSnapshotRef.current = null
    const before = loadDayMemoSyncMetadataAny(window.localStorage)
    const stored = readDayMemoStorageSnapshot(window.localStorage)
    const checkedAt = new Date().toISOString()
    if (before.status !== 'ready' || before.metadata.version !== 3
      || before.metadata.workspaceId !== connection.workspaceId || snapshot.workspaceId !== connection.workspaceId
      || before.metadata.baselineStatus !== 'confirmed' || before.metadata.pushBlock !== null
      || before.raw !== snapshot.metadataRaw || stored.status !== 'ready'
      || stored.serialized !== snapshot.localStorageSerialized || localSignature(stored.memos) !== signature
      || !sameJson(before.metadata.pendingOperation, snapshot.pendingOperation)
      || !sameJson(before.metadata.localDeleteIntents, snapshot.localDeleteIntents)
      || !sameJson(before.metadata.baselines[snapshot.item.date] ?? null, snapshot.baseline)) {
      setResult(blockedResult(snapshot, 'blocked_snapshot_changed', checkedAt))
      setState('checked')
      return
    }
    const requestGeneration = ++generation.current
    const pulled = await pullAllDayMemoSyncRecords(
      supabaseClient,
      connection.workspaceId,
      () => generation.current === requestGeneration && latestSignature.current === signature,
    ).catch(() => null)
    if (!pulled || pulled.status !== 'complete') {
      setResult(blockedResult(snapshot, pulled?.status === 'validation_error' ? 'blocked_invalid_remote' : 'blocked_unknown', checkedAt))
      setState('checked')
      return
    }
    const after = loadDayMemoSyncMetadataAny(window.localStorage)
    const afterStored = readDayMemoStorageSnapshot(window.localStorage)
    if (after.status !== 'ready' || after.metadata.version !== 3 || after.raw !== snapshot.metadataRaw
      || afterStored.status !== 'ready' || afterStored.serialized !== snapshot.localStorageSerialized
      || latestSignature.current !== signature) {
      setResult(blockedResult(snapshot, 'blocked_snapshot_changed', checkedAt))
      setState('checked')
      return
    }
    const targetRecords = pulled.records.filter((record) => record.entityId === snapshot.item.date)
    const remote = targetRecords.length === 1 ? targetRecords[0] : null
    if (!remote) {
      setResult(blockedResult(snapshot, 'blocked_invalid_remote', checkedAt))
      setState('checked')
      return
    }
    const expectedDeleted = snapshot.item.remoteState === 'deleted'
    if (remote.revision !== snapshot.item.remoteRevision
      || remote.changeSequence !== snapshot.item.remoteChangeSequence
      || (remote.deletedAt !== null) !== expectedDeleted
      || remote.revision !== snapshot.remoteRecord.revision
      || remote.changeSequence !== snapshot.remoteRecord.changeSequence
      || remote.deletedAt !== snapshot.remoteRecord.deletedAt
      || !sameJson(remote, snapshot.remoteRecord)) {
      setResult(blockedResult(snapshot, 'blocked_remote_changed', checkedAt))
      setState('checked')
      return
    }
    const mismatches = countRemoteAdoptionMismatches(after.metadata, afterStored.memos, pulled.records, snapshot.item.date)
      + Object.values(after.metadata.localDeleteIntents).filter((intent) => intent.date !== snapshot.item.date).length
      + (after.metadata.pendingOperation && after.metadata.pendingOperation.date !== snapshot.item.date ? 1 : 0)
    if (mismatches > 0) {
      setResult(blockedResult(snapshot, 'blocked_other_mismatch', checkedAt, mismatches))
      setState('checked')
      return
    }
    const targetLocal = afterStored.memos.filter((memo) => memo.date === snapshot.item.date)
    let localCandidate: DayMemo[]
    let classification: DayMemoRemoteAdoptionPreflightClassification
    if (remote.deletedAt === null) {
      if (!remote.payload || !isStoredDayMemo(remote.payload) || remote.payload.date !== snapshot.item.date || targetLocal.length > 1) {
        setResult(blockedResult(snapshot, 'blocked_invalid_remote', checkedAt))
        setState('checked')
        return
      }
      localCandidate = [...afterStored.memos.filter((memo) => memo.date !== snapshot.item.date), { ...remote.payload }]
      classification = 'ready_remote_active'
    } else {
      if (remote.payload !== null || targetLocal.length > 1) {
        setResult(blockedResult(snapshot, 'blocked_invalid_remote', checkedAt))
        setState('checked')
        return
      }
      localCandidate = afterStored.memos.filter((memo) => memo.date !== snapshot.item.date).map((memo) => ({ ...memo }))
      classification = 'ready_remote_tombstone'
    }
    localCandidate.sort((left, right) => left.date.localeCompare(right.date))
    if (!localCandidate.every(isStoredDayMemo) || new Set(localCandidate.map((memo) => memo.date)).size !== localCandidate.length) {
      setResult(blockedResult(snapshot, 'blocked_invalid_remote', checkedAt))
      setState('checked')
      return
    }
    completedLocalCandidateRef.current = localCandidate
    const nextResult: DayMemoRemoteAdoptionPreflightResult = {
      ...blockedResult(snapshot, classification, checkedAt),
      remoteRevision: remote.revision,
      remoteChangeSequence: remote.changeSequence,
      remoteState: remote.deletedAt === null ? 'active' : 'deleted',
    }
    if (classification === 'ready_remote_active' && nextResult.remoteState === 'active'
      && (nextResult.localEffect === 'replace' || nextResult.localEffect === 'add')) {
      readyActiveSnapshotRef.current = {
        result: {
          ...nextResult,
          classification: 'ready_remote_active',
          remoteState: 'active',
          localEffect: nextResult.localEffect,
        },
        conflictSnapshot: {
          ...snapshot,
          item: { ...snapshot.item },
          localMemos: snapshot.localMemos.map((memo) => ({ ...memo })),
          pendingOperation: snapshot.pendingOperation ? { ...snapshot.pendingOperation } : null,
          localDeleteIntents: Object.fromEntries(Object.entries(snapshot.localDeleteIntents).map(([date, intent]) => [date, { ...intent }])),
          baseline: snapshot.baseline ? { ...snapshot.baseline } : null,
          remoteRecord: { ...remote, payload: remote.payload ? { ...remote.payload } : null },
        },
        completedLocalCandidate: localCandidate.map((memo) => ({ ...memo })),
      }
    }
    setResult(nextResult)
    setState('checked')
  }, [connection?.workspaceId, eligibleConnection, signature, state])

  const getReadyActiveSnapshot = useCallback((): DayMemoRemoteActiveAdoptionSnapshot | null => {
    const snapshot = readyActiveSnapshotRef.current
    return snapshot ? {
      result: { ...snapshot.result },
      conflictSnapshot: {
        ...snapshot.conflictSnapshot,
        item: { ...snapshot.conflictSnapshot.item },
        localMemos: snapshot.conflictSnapshot.localMemos.map((memo) => ({ ...memo })),
        pendingOperation: snapshot.conflictSnapshot.pendingOperation ? { ...snapshot.conflictSnapshot.pendingOperation } : null,
        localDeleteIntents: Object.fromEntries(Object.entries(snapshot.conflictSnapshot.localDeleteIntents).map(([date, intent]) => [date, { ...intent }])),
        baseline: snapshot.conflictSnapshot.baseline ? { ...snapshot.conflictSnapshot.baseline } : null,
        remoteRecord: {
          ...snapshot.conflictSnapshot.remoteRecord,
          payload: snapshot.conflictSnapshot.remoteRecord.payload ? { ...snapshot.conflictSnapshot.remoteRecord.payload } : null,
        },
      },
      completedLocalCandidate: snapshot.completedLocalCandidate.map((memo) => ({ ...memo })),
    } : null
  }, [])

  return {
    eligible: eligibleConnection && metadataEligible && conflictItems.some(safeItem),
    state,
    selectedDate,
    result,
    safeErrorMessage,
    selectCandidate,
    runPreflight,
    discard,
    getReadyActiveSnapshot,
  }
}
