import { useCallback, useRef, useState } from 'react'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoPendingOperationV5, DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { supabaseClient } from '../lib/supabaseClient'
import { isStoredDayMemo, readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords, type RemoteDayMemoRecord } from '../utils/dayMemoSyncPull'
import { isDayMemoSyncMetadataV5, loadDayMemoSyncMetadataAny } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import type { DayMemoNormalDeleteLocalPersistenceResult } from './useDayMemoLocalOperationPreparation'

export type DayMemoLocalOperationRemoteCheckKind = 'upsert' | 'delete'

export type DayMemoLocalOperationRemoteCheckClassification =
  | 'local_operation_remote_check_ready'
  | 'local_operation_remote_check_sendable'
  | 'local_operation_remote_check_pending_missing'
  | 'local_operation_remote_check_pending_invalid'
  | 'local_operation_remote_check_intent_missing'
  | 'local_operation_remote_check_operation_mismatch'
  | 'local_operation_remote_check_target_mismatch'
  | 'local_operation_remote_check_workspace_mismatch'
  | 'local_operation_remote_check_push_blocked'
  | 'local_operation_remote_check_cursor_invalid'
  | 'local_operation_remote_check_baseline_mismatch'
  | 'local_operation_remote_check_local_state_mismatch'
  | 'local_operation_remote_check_remote_changed'
  | 'local_operation_remote_check_already_applied'
  | 'local_operation_remote_check_duplicate_uncertain'
  | 'local_operation_remote_check_response_invalid'
  | 'local_operation_remote_check_fetch_failed'
  | 'local_operation_remote_check_verification_stale'
  | 'local_operation_remote_check_prerequisite_missing'
  | 'local_operation_remote_check_local_preparation_missing'
  | 'local_operation_remote_check_unsupported'
  | 'local_operation_remote_check_state_unknown'

export interface DayMemoLocalOperationRemoteCheckResult {
  date: string | null
  operationKind: DayMemoLocalOperationRemoteCheckKind | null
  classification: DayMemoLocalOperationRemoteCheckClassification
  sendable: boolean
  remoteState: 'active' | 'tombstone' | 'missing' | 'unknown'
  baselineRevision: number | null
  remoteRevision: number | null
  baselineChangeSequence: number | null
  remoteChangeSequence: number | null
  remoteUnchanged: boolean
  operationMatch: 'unavailable' | 'matched' | 'not_matched'
  alreadyApplied: boolean
  checkedAt: string
  nextAction: string
}

export interface DayMemoLocalOperationRemoteReadySnapshot {
  result: DayMemoLocalOperationRemoteCheckResult
  metadataRaw: string
  localStorageSerialized: string
  workspaceId: string
  pendingOperation: DayMemoPendingOperationV5
  remoteRecord: RemoteDayMemoRecord
}

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  normalDeleteLocalPersistenceResult?: DayMemoNormalDeleteLocalPersistenceResult | null
}

function connectionIsEligible(connection: SyncConnection | null): connection is SyncConnection & { workspaceId: string } {
  return Boolean(connection
    && isUuid(connection.workspaceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}

function inspectPreparedKind(connection: SyncConnection | null): DayMemoLocalOperationRemoteCheckKind | null {
  if (!connectionIsEligible(connection)) return null
  const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
  if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata)
    || loaded.metadata.workspaceId !== connection.workspaceId
    || loaded.metadata.pendingOperation?.status !== 'prepared') return null
  return loaded.metadata.pendingOperation.kind
}

function remoteState(record: RemoteDayMemoRecord | undefined): DayMemoLocalOperationRemoteCheckResult['remoteState'] {
  if (!record) return 'missing'
  return record.deletedAt === null ? 'active' : 'tombstone'
}

function recordMatchesBaseline(record: RemoteDayMemoRecord, baseline: DayMemoSyncMetadataV5['baselines'][string]): boolean {
  if (record.entityId !== baseline.date
    || record.revision !== baseline.remoteRevision
    || record.changeSequence !== baseline.remoteChangeSequence
    || record.deletedAt !== baseline.deletedAt) return false
  return baseline.deletedAt === null
    ? record.payload !== null && record.payload.updatedAt === baseline.remoteUpdatedAt
    : record.payload === null && record.serverUpdatedAt === baseline.remoteUpdatedAt
      && baseline.baselineLocalUpdatedAt === null
}

function allRemoteRecordsMatchBaselines(metadata: DayMemoSyncMetadataV5, records: RemoteDayMemoRecord[]): boolean {
  const dates = Object.keys(metadata.baselines)
  if (dates.length !== records.length) return false
  const byDate = new Map(records.map((record) => [record.entityId, record]))
  return dates.every((date) => {
    const record = byDate.get(date)
    return Boolean(record && recordMatchesBaseline(record, metadata.baselines[date]))
  })
}

function allOutsideLocalStateMatches(
  metadata: DayMemoSyncMetadataV5,
  memos: DayMemo[],
  targetDate: string,
): boolean {
  const byDate = new Map(memos.map((memo) => [memo.date, memo]))
  return Object.values(metadata.baselines).every((baseline) => {
    if (baseline.date === targetDate) return true
    const memo = byDate.get(baseline.date)
    return baseline.deletedAt === null
      ? Boolean(memo && memo.updatedAt === baseline.baselineLocalUpdatedAt)
      : memo === undefined && baseline.baselineLocalUpdatedAt === null
  }) && memos.every((memo) => memo.date === targetDate || metadata.baselines[memo.date]?.deletedAt === null)
}

function message(classification: DayMemoLocalOperationRemoteCheckClassification): string {
  if (classification === 'local_operation_remote_check_sendable') return '同期先は準備時のbaselineから変化していません。後続Phaseで送信直前に再確認してください。'
  if (classification === 'local_operation_remote_check_duplicate_uncertain') return '同期先は進行していますが、この取得結果では同じoperationの適用済みか証明できません。再送せず復旧確認へ進んでください。'
  if (classification === 'local_operation_remote_check_already_applied') return '同じoperationが同期先へ反映済みと確認されました。再送せず復旧確認へ進んでください。'
  if (classification === 'local_operation_remote_check_fetch_failed') return '同期先を確認できませんでした。自動再試行せず、状態を確認してください。'
  if (classification === 'local_operation_remote_check_verification_stale') return '確認中に端末状態が変化しました。結果を送信判断に利用できません。'
  return '送信条件を安全に確認できませんでした。永続状態は変更していません。'
}

export function useDayMemoLocalOperationRemoteCheck({
  dayMemos,
  isConfigured,
  isSignedIn,
  connection,
  normalDeleteLocalPersistenceResult,
}: Input) {
  const [state, setState] = useState<'idle' | 'checking'>('idle')
  const [result, setResult] = useState<DayMemoLocalOperationRemoteCheckResult | null>(null)
  const readySnapshotRef = useRef<DayMemoLocalOperationRemoteReadySnapshot | null>(null)
  const runIdRef = useRef(0)
  const preparedKind = inspectPreparedKind(connection)
  const eligible = Boolean(isConfigured && isSignedIn && supabaseClient && preparedKind)

  const finish = useCallback((
    classification: DayMemoLocalOperationRemoteCheckClassification,
    values: Partial<Omit<DayMemoLocalOperationRemoteCheckResult, 'classification' | 'checkedAt' | 'nextAction'>> = {},
  ) => {
    const next: DayMemoLocalOperationRemoteCheckResult = {
      date: null,
      operationKind: null,
      sendable: false,
      remoteState: 'unknown',
      baselineRevision: null,
      remoteRevision: null,
      baselineChangeSequence: null,
      remoteChangeSequence: null,
      remoteUnchanged: false,
      operationMatch: 'unavailable',
      alreadyApplied: false,
      ...values,
      classification,
      checkedAt: new Date().toISOString(),
      nextAction: message(classification),
    }
    setResult(next)
    setState('idle')
    readySnapshotRef.current = null
    return next
  }, [])

  const checkRemote = useCallback(async (requestedKind: DayMemoLocalOperationRemoteCheckKind) => {
    if (state === 'checking') return
    const runId = runIdRef.current + 1
    runIdRef.current = runId
    setState('checking')
    setResult(null)
    readySnapshotRef.current = null

    if (!isConfigured || !isSignedIn || !supabaseClient || !connectionIsEligible(connection)) {
      finish('local_operation_remote_check_prerequisite_missing')
      return
    }
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const stored = readDayMemoStorageSnapshot(window.localStorage)
    if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata) || stored.status !== 'ready') {
      finish('local_operation_remote_check_state_unknown')
      return
    }
    const metadata = loaded.metadata
    const pending = metadata.pendingOperation
    if (metadata.workspaceId !== connection.workspaceId) {
      finish('local_operation_remote_check_workspace_mismatch')
      return
    }
    if (metadata.pushBlock !== null) {
      finish('local_operation_remote_check_push_blocked')
      return
    }
    if (metadata.baselineStatus !== 'confirmed') {
      finish('local_operation_remote_check_baseline_mismatch')
      return
    }
    if (!pending) {
      finish('local_operation_remote_check_pending_missing')
      return
    }
    if (pending.status !== 'prepared' || pending.kind !== requestedKind
      || (pending.kind === 'upsert' && pending.operationMode !== 'normal')) {
      finish('local_operation_remote_check_pending_invalid', { date: pending.date, operationKind: pending.kind })
      return
    }
    const baseline = metadata.baselines[pending.date]
    if (!baseline || pending.baseRevision !== baseline.remoteRevision) {
      finish('local_operation_remote_check_baseline_mismatch', { date: pending.date, operationKind: pending.kind })
      return
    }
    if (metadata.lastPulledChangeSequence < baseline.remoteChangeSequence) {
      finish('local_operation_remote_check_cursor_invalid', { date: pending.date, operationKind: pending.kind })
      return
    }
    const targetMemos = stored.memos.filter((memo) => memo.date === pending.date)
    if (pending.kind === 'upsert') {
      if (targetMemos.length !== 1 || !isStoredDayMemo(targetMemos[0])
        || targetMemos[0].updatedAt !== pending.preparedLocalUpdatedAt
        || Object.keys(metadata.localDeleteIntents).length !== 0) {
        finish('local_operation_remote_check_local_state_mismatch', { date: pending.date, operationKind: pending.kind })
        return
      }
    } else {
      const intent = metadata.localDeleteIntents[pending.date]
      if (!intent) {
        finish('local_operation_remote_check_intent_missing', { date: pending.date, operationKind: pending.kind })
        return
      }
      if (intent.operationId !== pending.operationId) {
        finish('local_operation_remote_check_operation_mismatch', { date: pending.date, operationKind: pending.kind })
        return
      }
      if (intent.date !== pending.date || intent.baselineRevision !== baseline.remoteRevision
        || intent.baselineChangeSequence !== baseline.remoteChangeSequence || baseline.deletedAt !== null
        || targetMemos.length !== 0 || Object.keys(metadata.localDeleteIntents).length !== 1) {
        finish('local_operation_remote_check_local_state_mismatch', { date: pending.date, operationKind: pending.kind })
        return
      }
    }
    if (!allOutsideLocalStateMatches(metadata, stored.memos, pending.date)) {
      finish('local_operation_remote_check_local_state_mismatch', { date: pending.date, operationKind: pending.kind })
      return
    }

    const pulled = await pullAllDayMemoSyncRecords(supabaseClient, connection.workspaceId, () => runIdRef.current === runId)
    if (runIdRef.current !== runId) return
    if (pulled.status !== 'complete') {
      finish(pulled.status === 'validation_error' || pulled.status === 'limit_reached'
        ? 'local_operation_remote_check_response_invalid'
        : 'local_operation_remote_check_fetch_failed', { date: pending.date, operationKind: pending.kind })
      return
    }
    const currentLoaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const currentStored = readDayMemoStorageSnapshot(window.localStorage)
    if (currentLoaded.status !== 'ready' || currentLoaded.raw !== loaded.raw
      || currentStored.status !== 'ready' || currentStored.serialized !== stored.serialized
      || connection.workspaceId !== metadata.workspaceId
      || JSON.stringify(dayMemos) !== JSON.stringify(stored.memos)) {
      finish('local_operation_remote_check_verification_stale', { date: pending.date, operationKind: pending.kind })
      return
    }
    const targetRecords = pulled.records.filter((record) => record.entityId === pending.date)
    const target = targetRecords[0]
    const common = {
      date: pending.date,
      operationKind: pending.kind,
      remoteState: remoteState(target),
      baselineRevision: baseline.remoteRevision,
      remoteRevision: target?.revision ?? null,
      baselineChangeSequence: baseline.remoteChangeSequence,
      remoteChangeSequence: target?.changeSequence ?? null,
    }
    if (targetRecords.length !== 1) {
      finish(targetRecords.length === 0
        ? 'local_operation_remote_check_remote_changed'
        : 'local_operation_remote_check_response_invalid', common)
      return
    }
    const remoteUnchanged = recordMatchesBaseline(target, baseline)
    if (!remoteUnchanged || !allRemoteRecordsMatchBaselines(metadata, pulled.records)
      || pulled.maxChangeSequence !== metadata.lastPulledChangeSequence) {
      finish(target.revision > baseline.remoteRevision
        ? 'local_operation_remote_check_duplicate_uncertain'
        : 'local_operation_remote_check_remote_changed', { ...common, remoteUnchanged })
      return
    }
    const next = finish('local_operation_remote_check_sendable', {
      ...common,
      sendable: true,
      remoteUnchanged: true,
      operationMatch: 'unavailable',
    })
    readySnapshotRef.current = {
      result: { ...next },
      metadataRaw: loaded.raw,
      localStorageSerialized: stored.serialized,
      workspaceId: connection.workspaceId,
      pendingOperation: { ...pending },
      remoteRecord: { ...target, payload: target.payload ? { ...target.payload } : null },
    }
  }, [connection, dayMemos, finish, isConfigured, isSignedIn, state])

  const checkPreparedNormalDelete = useCallback(async (): Promise<void> => {
    const localResult = normalDeleteLocalPersistenceResult
    if (!localResult?.succeeded || !localResult.targetDeleted || !localResult.readBackVerified
      || !localResult.reactStateUpdated || !localResult.operationIdsMatch
      || !localResult.outsideMemosUnchanged || localResult.recoveryRequired) {
      finish('local_operation_remote_check_local_preparation_missing', {
        date: localResult?.date ?? null,
        operationKind: 'delete',
      })
      return
    }
    if (!isConfigured || !isSignedIn || !supabaseClient || !connectionIsEligible(connection)) {
      finish('local_operation_remote_check_prerequisite_missing', {
        date: localResult.date,
        operationKind: 'delete',
      })
      return
    }
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const pending = loaded.status === 'ready' && isDayMemoSyncMetadataV5(loaded.metadata)
      ? loaded.metadata.pendingOperation : null
    const intent = loaded.status === 'ready' && isDayMemoSyncMetadataV5(loaded.metadata)
      ? loaded.metadata.localDeleteIntents[localResult.date] : undefined
    if (pending?.kind !== 'delete' || pending.date !== localResult.date
      || intent?.date !== localResult.date || pending.operationId !== intent.operationId) {
      finish('local_operation_remote_check_local_preparation_missing', {
        date: localResult.date,
        operationKind: 'delete',
      })
      return
    }
    await checkRemote('delete')
  }, [checkRemote, connection, finish, isConfigured, isSignedIn, normalDeleteLocalPersistenceResult])

  const discard = useCallback(() => {
    runIdRef.current += 1
    setState('idle')
    setResult(null)
    readySnapshotRef.current = null
  }, [])

  const getReadySnapshot = useCallback((): DayMemoLocalOperationRemoteReadySnapshot | null => {
    const snapshot = readySnapshotRef.current
    if (!snapshot || !connectionIsEligible(connection) || connection.workspaceId !== snapshot.workspaceId) return null
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const stored = readDayMemoStorageSnapshot(window.localStorage)
    if (loaded.status !== 'ready' || loaded.raw !== snapshot.metadataRaw
      || stored.status !== 'ready' || stored.serialized !== snapshot.localStorageSerialized) return null
    return {
      ...snapshot,
      result: { ...snapshot.result },
      pendingOperation: { ...snapshot.pendingOperation },
      remoteRecord: { ...snapshot.remoteRecord, payload: snapshot.remoteRecord.payload ? { ...snapshot.remoteRecord.payload } : null },
    }
  }, [connection])

  return {
    eligible,
    preparedKind,
    state,
    result,
    checkRemote,
    checkPreparedNormalDelete,
    discard,
    getReadySnapshot,
  }
}
