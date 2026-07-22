import { useCallback, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoRemoteBaselineV3, DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { isStoredDayMemo, readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords, type RemoteDayMemoRecord } from '../utils/dayMemoSyncPull'
import { isDayMemoSyncMetadataV5, loadDayMemoSyncMetadataAny, replaceDayMemoSyncMetadataV2 } from '../utils/dayMemoSyncStorage'
import {
  isAppliedDayMemoDeleteSyncResult,
  isAppliedDayMemoSyncResult,
  isConflictDayMemoSyncResult,
  normalizeDayMemoSyncResult,
  type DayMemoSyncResultRecord,
} from '../utils/dayMemoSyncUpsertResult'
import { isUuid } from '../utils/syncConnectionStorage'
import type {
  DayMemoLocalOperationRemoteCheckKind,
  DayMemoLocalOperationRemoteReadySnapshot,
} from './useDayMemoLocalOperationRemoteCheck'
import type { DayMemoNormalDeleteLocalPersistenceResult } from './useDayMemoLocalOperationPreparation'

export type DayMemoLocalOperationSendClassification =
  | 'local_operation_send_ready'
  | 'local_operation_send_in_progress'
  | 'local_operation_send_succeeded'
  | 'local_operation_send_remote_succeeded_cleanup_pending'
  | 'local_operation_send_snapshot_missing'
  | 'local_operation_send_snapshot_stale'
  | 'local_operation_send_pending_missing'
  | 'local_operation_send_pending_invalid'
  | 'local_operation_send_intent_missing'
  | 'local_operation_send_operation_mismatch'
  | 'local_operation_send_target_mismatch'
  | 'local_operation_send_workspace_mismatch'
  | 'local_operation_send_push_blocked'
  | 'local_operation_send_cursor_invalid'
  | 'local_operation_send_baseline_mismatch'
  | 'local_operation_send_local_state_mismatch'
  | 'local_operation_send_remote_changed'
  | 'local_operation_send_duplicate_uncertain'
  | 'local_operation_send_prerequisite_missing'
  | 'local_operation_send_rpc_failed'
  | 'local_operation_send_response_invalid'
  | 'local_operation_send_remote_succeeded_local_update_failed'
  | 'local_operation_send_persistence_failed_before_rpc'
  | 'local_operation_send_unsupported'
  | 'local_operation_send_state_unknown'

export interface DayMemoLocalOperationSendResult {
  date: string | null
  operationKind: DayMemoLocalOperationRemoteCheckKind | null
  classification: DayMemoLocalOperationSendClassification
  succeeded: boolean
  snapshotFresh: boolean
  remoteRechecked: boolean
  rpcCalled: boolean
  rpcResultValidated: boolean
  remoteSucceeded: boolean
  baselineUpdated: boolean
  cursorUpdated: boolean
  pendingCleared: boolean
  intentCleared: boolean
  cleanupPending: boolean
  recoveryRequired: boolean
  checkedAt: string
  nextAction: string
}

export interface DayMemoNormalDeleteRemoteResultSnapshot {
  date: string
  workspaceId: string
  operationId: string
  sendingMetadataRaw: string
  appliedResult: DayMemoSyncResultRecord
  checkedAt: string
}

export type DayMemoNormalDeleteCleanupCandidateClassification =
  | 'normal_delete_cleanup_candidate_ready'
  | 'normal_delete_cleanup_candidate_snapshot_missing'
  | 'normal_delete_cleanup_candidate_metadata_invalid'
  | 'normal_delete_cleanup_candidate_operation_mismatch'
  | 'normal_delete_cleanup_candidate_remote_result_invalid'
  | 'normal_delete_cleanup_candidate_cursor_invalid'

export interface DayMemoNormalDeleteCleanupCandidateResult {
  date: string | null
  classification: DayMemoNormalDeleteCleanupCandidateClassification
  ready: boolean
  operationIdsMatch: boolean
  remoteRevision: number | null
  remoteChangeSequence: number | null
  timestampValid: boolean
  currentCursor: number | null
  candidateCursor: number | null
  metadataChanged: false
  checkedAt: string
}

export interface DayMemoNormalDeleteCleanupCandidateSnapshot {
  result: DayMemoNormalDeleteCleanupCandidateResult
  workspaceId: string
  operationId: string
  metadataRaw: string
  previousBaseline: DayMemoRemoteBaselineV3
  tombstoneBaseline: DayMemoRemoteBaselineV3
  currentCursor: number
  candidateCursor: number
  appliedResult: DayMemoSyncResultRecord
}

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  getReadySnapshot: () => DayMemoLocalOperationRemoteReadySnapshot | null
  normalDeleteLocalPersistenceResult?: DayMemoNormalDeleteLocalPersistenceResult | null
}

function connectionIsEligible(connection: SyncConnection | null): connection is SyncConnection & { workspaceId: string } {
  return Boolean(connection && isUuid(connection.workspaceId) && isUuid(connection.deviceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}

function recordEquals(left: RemoteDayMemoRecord, right: RemoteDayMemoRecord): boolean {
  return left.workspaceId === right.workspaceId
    && left.entityId === right.entityId
    && left.revision === right.revision
    && left.changeSequence === right.changeSequence
    && left.serverUpdatedAt === right.serverUpdatedAt
    && left.deletedAt === right.deletedAt
    && JSON.stringify(left.payload) === JSON.stringify(right.payload)
}

function recordsMatchBaselines(metadata: DayMemoSyncMetadataV5, records: RemoteDayMemoRecord[]): boolean {
  if (records.length !== Object.keys(metadata.baselines).length) return false
  const byDate = new Map(records.map((record) => [record.entityId, record]))
  if (byDate.size !== records.length) return false
  return Object.values(metadata.baselines).every((baseline) => {
    const record = byDate.get(baseline.date)
    if (!record || record.revision !== baseline.remoteRevision
      || record.changeSequence !== baseline.remoteChangeSequence
      || record.deletedAt !== baseline.deletedAt) return false
    return baseline.deletedAt === null
      ? record.payload !== null && record.payload.updatedAt === baseline.remoteUpdatedAt
      : record.payload === null && record.serverUpdatedAt === baseline.remoteUpdatedAt
        && baseline.baselineLocalUpdatedAt === null
  })
}

function message(classification: DayMemoLocalOperationSendClassification): string {
  if (classification === 'local_operation_send_succeeded') return '1件の同期が完了し、この端末の同期情報を更新しました。'
  if (classification === 'local_operation_send_remote_succeeded_local_update_failed') return '同期先は更新済みの可能性があります。この端末から再送せず、remote状態を確認してください。'
  if (classification === 'local_operation_send_rpc_failed') return '同期結果を確認できませんでした。再送せず、remote状態を確認してください。'
  if (classification === 'local_operation_send_remote_changed' || classification === 'local_operation_send_duplicate_uncertain') return '送信直前に同期先の変化を確認しました。RPCは送信していません。'
  if (classification === 'local_operation_send_snapshot_stale') return 'remote確認後に端末状態が変化しました。最初から確認し直してください。'
  return '送信を安全に完了できませんでした。自動再試行は行いません。'
}

export function useDayMemoLocalOperationSend({
  dayMemos,
  isConfigured,
  isSignedIn,
  connection,
  getReadySnapshot,
  normalDeleteLocalPersistenceResult,
}: Input) {
  const [result, setResult] = useState<DayMemoLocalOperationSendResult | null>(null)
  const [sending, setSending] = useState(false)
  const [attemptedSnapshotToken, setAttemptedSnapshotToken] = useState<string | null>(null)
  const inFlightRef = useRef(false)
  const attemptedSnapshotTokenRef = useRef<string | null>(null)
  const normalDeleteRemoteResultRef = useRef<DayMemoNormalDeleteRemoteResultSnapshot | null>(null)
  const [normalDeleteCleanupCandidateResult, setNormalDeleteCleanupCandidateResult] = useState<DayMemoNormalDeleteCleanupCandidateResult | null>(null)
  const normalDeleteCleanupCandidateRef = useRef<DayMemoNormalDeleteCleanupCandidateSnapshot | null>(null)
  const eligible = Boolean(isConfigured && isSignedIn && supabaseClient && connectionIsEligible(connection))
  const currentSnapshotToken = getReadySnapshot()?.result.checkedAt ?? null

  const finish = useCallback((
    classification: DayMemoLocalOperationSendClassification,
    values: Partial<Omit<DayMemoLocalOperationSendResult, 'classification' | 'checkedAt' | 'nextAction'>> = {},
  ) => {
    const next: DayMemoLocalOperationSendResult = {
      date: null,
      operationKind: null,
      succeeded: false,
      snapshotFresh: false,
      remoteRechecked: false,
      rpcCalled: false,
      rpcResultValidated: false,
      remoteSucceeded: false,
      baselineUpdated: false,
      cursorUpdated: false,
      pendingCleared: false,
      intentCleared: false,
      cleanupPending: false,
      recoveryRequired: false,
      ...values,
      classification,
      checkedAt: new Date().toISOString(),
      nextAction: message(classification),
    }
    setResult(next)
    return next
  }, [])

  const persistAfterRpcFailure = useCallback((
    metadata: DayMemoSyncMetadataV5,
    expectedRaw: string,
    status: 'response_unknown' | 'conflict',
  ): boolean => {
    if (!metadata.pendingOperation) return false
    const next: DayMemoSyncMetadataV5 = {
      ...metadata,
      pendingOperation: { ...metadata.pendingOperation, status },
    }
    return replaceDayMemoSyncMetadataV2(window.localStorage, next, expectedRaw) === 'saved'
  }, [])

  const persistRecoveryRequired = useCallback((expectedOperationId: string): boolean => {
    const current = loadDayMemoSyncMetadataAny(window.localStorage)
    if (current.status !== 'ready' || !isDayMemoSyncMetadataV5(current.metadata)
      || current.metadata.pendingOperation?.operationId !== expectedOperationId) return false
    const recovery: DayMemoSyncMetadataV5 = {
      ...current.metadata,
      pendingOperation: { ...current.metadata.pendingOperation, status: 'recovery_required' },
    }
    return replaceDayMemoSyncMetadataV2(window.localStorage, recovery, current.raw) === 'saved'
  }, [])

  const sendOperation = useCallback(async (
    requestedKind: DayMemoLocalOperationRemoteCheckKind,
    stopAfterRemoteSuccess: boolean,
  ) => {
    if (inFlightRef.current) return
    if (!window.confirm(requestedKind === 'upsert'
      ? '準備済みの保存操作1件を同期先へ送信します。送信しますか？'
      : '準備済みの削除操作1件を同期先へ送信します。送信しますか？')) return
    inFlightRef.current = true
    setSending(true)
    setResult(null)
    if (stopAfterRemoteSuccess) {
      normalDeleteRemoteResultRef.current = null
      normalDeleteCleanupCandidateRef.current = null
      setNormalDeleteCleanupCandidateResult(null)
    }
    let rpcCalled = false
    try {
      if (!eligible || !supabaseClient || !connectionIsEligible(connection)) {
        finish('local_operation_send_prerequisite_missing')
        return
      }
      const snapshot = getReadySnapshot()
      if (!snapshot || !snapshot.result.sendable || snapshot.result.classification !== 'local_operation_remote_check_sendable') {
        finish('local_operation_send_snapshot_missing')
        return
      }
      if (stopAfterRemoteSuccess && attemptedSnapshotTokenRef.current === snapshot.result.checkedAt) {
        finish('local_operation_send_snapshot_stale', {
          date: snapshot.result.date,
          operationKind: requestedKind,
        })
        return
      }
      setAttemptedSnapshotToken(snapshot.result.checkedAt)
      attemptedSnapshotTokenRef.current = snapshot.result.checkedAt
      const common = { date: snapshot.result.date, operationKind: requestedKind, snapshotFresh: true }
      if (snapshot.result.operationKind !== requestedKind || snapshot.pendingOperation.kind !== requestedKind) {
        finish('local_operation_send_target_mismatch', common)
        return
      }
      const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
      const stored = readDayMemoStorageSnapshot(window.localStorage)
      if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata) || stored.status !== 'ready') {
        finish('local_operation_send_state_unknown', common)
        return
      }
      const metadata = loaded.metadata
      const pending = metadata.pendingOperation
      if (loaded.raw !== snapshot.metadataRaw || stored.serialized !== snapshot.localStorageSerialized) {
        finish('local_operation_send_snapshot_stale', { ...common, snapshotFresh: false })
        return
      }
      if (metadata.workspaceId !== connection.workspaceId || snapshot.workspaceId !== connection.workspaceId) {
        finish('local_operation_send_workspace_mismatch', common)
        return
      }
      if (metadata.pushBlock !== null) {
        finish('local_operation_send_push_blocked', common)
        return
      }
      if (metadata.baselineStatus !== 'confirmed') {
        finish('local_operation_send_baseline_mismatch', common)
        return
      }
      if (!pending) {
        finish('local_operation_send_pending_missing', common)
        return
      }
      if (pending.status !== 'prepared' || pending.kind !== requestedKind
        || (pending.kind === 'upsert' && pending.operationMode !== 'normal')) {
        finish('local_operation_send_pending_invalid', common)
        return
      }
      if (JSON.stringify(pending) !== JSON.stringify(snapshot.pendingOperation)) {
        finish('local_operation_send_operation_mismatch', common)
        return
      }
      const baseline = metadata.baselines[pending.date]
      if (!baseline || baseline.remoteRevision !== pending.baseRevision
        || baseline.remoteRevision !== snapshot.remoteRecord.revision
        || baseline.remoteChangeSequence !== snapshot.remoteRecord.changeSequence) {
        finish('local_operation_send_baseline_mismatch', common)
        return
      }
      if (metadata.lastPulledChangeSequence < baseline.remoteChangeSequence) {
        finish('local_operation_send_cursor_invalid', common)
        return
      }
      const targetMemos = stored.memos.filter((memo) => memo.date === pending.date)
      let memo: DayMemo | null = null
      if (pending.kind === 'upsert') {
        memo = targetMemos[0] ?? null
        if (targetMemos.length !== 1 || !memo || !isStoredDayMemo(memo)
          || memo.updatedAt !== pending.preparedLocalUpdatedAt
          || Object.keys(metadata.localDeleteIntents).length !== 0) {
          finish('local_operation_send_local_state_mismatch', common)
          return
        }
      } else {
        const intent = metadata.localDeleteIntents[pending.date]
        if (!intent) {
          finish('local_operation_send_intent_missing', common)
          return
        }
        if (Object.keys(metadata.localDeleteIntents).length !== 1
          || intent.operationId !== pending.operationId
          || intent.date !== pending.date
          || intent.baselineRevision !== baseline.remoteRevision
          || intent.baselineChangeSequence !== baseline.remoteChangeSequence
          || targetMemos.length !== 0 || baseline.deletedAt !== null) {
          finish('local_operation_send_operation_mismatch', common)
          return
        }
      }

      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, connection.workspaceId)
      if (pulled.status !== 'complete') {
        finish(pulled.status === 'validation_error' || pulled.status === 'limit_reached'
          ? 'local_operation_send_response_invalid'
          : 'local_operation_send_rpc_failed', { ...common, remoteRechecked: false })
        return
      }
      const afterPullMetadata = loadDayMemoSyncMetadataAny(window.localStorage)
      const afterPullLocal = readDayMemoStorageSnapshot(window.localStorage)
      if (afterPullMetadata.status !== 'ready' || afterPullMetadata.raw !== loaded.raw
        || afterPullLocal.status !== 'ready' || afterPullLocal.serialized !== stored.serialized
        || JSON.stringify(dayMemos) !== JSON.stringify(stored.memos)) {
        finish('local_operation_send_snapshot_stale', { ...common, snapshotFresh: false, remoteRechecked: true })
        return
      }
      const targets = pulled.records.filter((record) => record.entityId === pending.date)
      if (targets.length !== 1 || !recordEquals(targets[0], snapshot.remoteRecord)
        || !recordsMatchBaselines(metadata, pulled.records)
        || pulled.maxChangeSequence !== metadata.lastPulledChangeSequence) {
        finish(targets[0]?.revision > baseline.remoteRevision
          ? 'local_operation_send_duplicate_uncertain'
          : 'local_operation_send_remote_changed', { ...common, remoteRechecked: true })
        return
      }

      const sending: DayMemoSyncMetadataV5 = {
        ...metadata,
        pendingOperation: { ...pending, status: 'sending' },
      }
      if (!isDayMemoSyncMetadataV5(sending)) {
        finish('local_operation_send_pending_invalid', { ...common, remoteRechecked: true })
        return
      }
      const sendingSave = replaceDayMemoSyncMetadataV2(window.localStorage, sending, loaded.raw)
      if (sendingSave !== 'saved') {
        finish('local_operation_send_persistence_failed_before_rpc', {
          ...common,
          remoteRechecked: true,
          recoveryRequired: sendingSave === 'rollback_failed',
        })
        return
      }
      const sendingRaw = JSON.stringify(sending)
      rpcCalled = true
      let responseData: unknown
      try {
        const response = pending.kind === 'upsert' && memo
          ? await supabaseClient.rpc('hooto_day_upsert_sync_record', {
            target_workspace_id: connection.workspaceId,
            target_entity_type: 'day_memo',
            target_entity_id: memo.date,
            target_payload: { date: memo.date, content: memo.content, updatedAt: memo.updatedAt },
            target_schema_version: 1,
            base_revision: pending.baseRevision,
            operation_id: pending.operationId,
            client_updated_at: memo.updatedAt,
            source_device_id: connection.deviceId,
          })
          : pending.kind === 'delete'
            ? await supabaseClient.rpc('hooto_day_delete_sync_record', {
              target_workspace_id: connection.workspaceId,
              target_entity_type: 'day_memo',
              target_entity_id: pending.date,
              base_revision: pending.baseRevision,
              operation_id: pending.operationId,
              client_updated_at: pending.clientDeletedAt,
              source_device_id: connection.deviceId,
            })
            : null
        if (!response || response.error) throw new Error('rpc_result_unknown')
        responseData = response.data
      } catch {
        const persisted = persistAfterRpcFailure(sending, sendingRaw, 'response_unknown')
        finish('local_operation_send_rpc_failed', {
          ...common, remoteRechecked: true, rpcCalled, recoveryRequired: !persisted,
        })
        return
      }
      const normalized = normalizeDayMemoSyncResult(responseData)
      if (isConflictDayMemoSyncResult(normalized, connection.workspaceId, pending.date)) {
        const persisted = persistAfterRpcFailure(sending, sendingRaw, 'conflict')
        finish('local_operation_send_remote_changed', {
          ...common, remoteRechecked: true, rpcCalled, rpcResultValidated: true, recoveryRequired: !persisted,
        })
        return
      }
      let appliedResult: DayMemoSyncResultRecord | null = null
      if (pending.kind === 'upsert' && memo
        && isAppliedDayMemoSyncResult(normalized, connection.workspaceId, memo, pending.baseRevision, metadata.lastPulledChangeSequence)) {
        appliedResult = normalized
      } else if (pending.kind === 'delete'
        && isAppliedDayMemoDeleteSyncResult(normalized, connection.workspaceId, pending.date, pending.baseRevision, metadata.lastPulledChangeSequence)) {
        appliedResult = normalized
      }
      if (!appliedResult) {
        const persisted = persistAfterRpcFailure(sending, sendingRaw, 'response_unknown')
        finish('local_operation_send_response_invalid', {
          ...common, remoteRechecked: true, rpcCalled, recoveryRequired: !persisted,
        })
        return
      }

      if (stopAfterRemoteSuccess) {
        if (pending.kind !== 'delete') {
          finish('local_operation_send_unsupported', {
            ...common, remoteRechecked: true, rpcCalled, rpcResultValidated: true,
          })
          return
        }
        const checkedAt = new Date().toISOString()
        normalDeleteRemoteResultRef.current = {
          date: pending.date,
          workspaceId: connection.workspaceId,
          operationId: pending.operationId,
          sendingMetadataRaw: sendingRaw,
          appliedResult: { ...appliedResult },
          checkedAt,
        }
        finish('local_operation_send_remote_succeeded_cleanup_pending', {
          ...common,
          succeeded: false,
          remoteRechecked: true,
          rpcCalled,
          rpcResultValidated: true,
          remoteSucceeded: true,
          cleanupPending: true,
        })
        return
      }

      const now = new Date().toISOString()
      const applied = appliedResult
      const remainingIntents = { ...sending.localDeleteIntents }
      if (pending.kind === 'delete') delete remainingIntents[pending.date]
      const completed: DayMemoSyncMetadataV5 = {
        ...sending,
        baselines: {
          ...sending.baselines,
          [pending.date]: pending.kind === 'upsert' && memo
            ? {
              date: pending.date,
              remoteRevision: applied.revision,
              remoteChangeSequence: applied.change_sequence,
              remoteUpdatedAt: memo.updatedAt,
              baselineLocalUpdatedAt: memo.updatedAt,
              deletedAt: null,
            }
            : {
              date: pending.date,
              remoteRevision: applied.revision,
              remoteChangeSequence: applied.change_sequence,
              remoteUpdatedAt: applied.server_updated_at,
              baselineLocalUpdatedAt: null,
              deletedAt: applied.deleted_at,
            },
        },
        localDeleteIntents: remainingIntents,
        lastPulledChangeSequence: Math.max(sending.lastPulledChangeSequence, applied.change_sequence),
        baselineStatus: 'confirmed',
        baselineConfirmedAt: now,
        pendingOperation: null,
        lastSuccessfulSyncAt: now,
      }
      if (!isDayMemoSyncMetadataV5(completed)
        || replaceDayMemoSyncMetadataV2(window.localStorage, completed, sendingRaw) !== 'saved') {
        const recoveryPersisted = persistRecoveryRequired(pending.operationId)
        finish('local_operation_send_remote_succeeded_local_update_failed', {
          ...common,
          remoteRechecked: true,
          rpcCalled,
          rpcResultValidated: true,
          remoteSucceeded: true,
          recoveryRequired: true,
          baselineUpdated: false,
          cursorUpdated: false,
          pendingCleared: false,
          intentCleared: false,
        })
        void recoveryPersisted
        return
      }
      finish('local_operation_send_succeeded', {
        ...common,
        succeeded: true,
        remoteRechecked: true,
        rpcCalled,
        rpcResultValidated: true,
        remoteSucceeded: true,
        baselineUpdated: true,
        cursorUpdated: true,
        pendingCleared: true,
        intentCleared: pending.kind === 'delete',
      })
    } finally {
      inFlightRef.current = false
      setSending(false)
    }
  }, [connection, dayMemos, eligible, finish, getReadySnapshot, persistAfterRpcFailure, persistRecoveryRequired])

  const send = useCallback(async (requestedKind: DayMemoLocalOperationRemoteCheckKind): Promise<void> => {
    await sendOperation(requestedKind, false)
  }, [sendOperation])

  const sendPreparedNormalDelete = useCallback(async (): Promise<void> => {
    const localResult = normalDeleteLocalPersistenceResult
    const snapshot = getReadySnapshot()
    if (!localResult?.succeeded || !localResult.operationIdsMatch || localResult.recoveryRequired
      || !snapshot || snapshot.result.operationKind !== 'delete'
      || snapshot.result.date !== localResult.date || snapshot.pendingOperation.kind !== 'delete') {
      finish('local_operation_send_prerequisite_missing', {
        date: localResult?.date ?? snapshot?.result.date ?? null,
        operationKind: 'delete',
      })
      return
    }
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const intent = loaded.status === 'ready' && isDayMemoSyncMetadataV5(loaded.metadata)
      ? loaded.metadata.localDeleteIntents[localResult.date] : undefined
    if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata)
      || loaded.metadata.pendingOperation?.kind !== 'delete'
      || loaded.metadata.pendingOperation.operationId !== snapshot.pendingOperation.operationId
      || intent?.operationId !== snapshot.pendingOperation.operationId) {
      finish('local_operation_send_operation_mismatch', {
        date: localResult.date,
        operationKind: 'delete',
      })
      return
    }
    await sendOperation('delete', true)
  }, [finish, getReadySnapshot, normalDeleteLocalPersistenceResult, sendOperation])

  const getNormalDeleteRemoteResultSnapshot = useCallback((): DayMemoNormalDeleteRemoteResultSnapshot | null => {
    const snapshot = normalDeleteRemoteResultRef.current
    if (!snapshot || !connectionIsEligible(connection) || connection.workspaceId !== snapshot.workspaceId) return null
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata)
      || loaded.raw !== snapshot.sendingMetadataRaw
      || loaded.metadata.pendingOperation?.kind !== 'delete'
      || loaded.metadata.pendingOperation.operationId !== snapshot.operationId
      || loaded.metadata.localDeleteIntents[snapshot.date]?.operationId !== snapshot.operationId) return null
    return { ...snapshot, appliedResult: { ...snapshot.appliedResult } }
  }, [connection])

  const prepareNormalDeleteCleanupCandidate = useCallback((): boolean => {
    const checkedAt = new Date().toISOString()
    const finish = (
      classification: DayMemoNormalDeleteCleanupCandidateClassification,
      values: Partial<Omit<DayMemoNormalDeleteCleanupCandidateResult,
        'classification' | 'ready' | 'metadataChanged' | 'checkedAt'>> = {},
    ): boolean => {
      const next: DayMemoNormalDeleteCleanupCandidateResult = {
        date: null,
        classification,
        ready: classification === 'normal_delete_cleanup_candidate_ready',
        operationIdsMatch: false,
        remoteRevision: null,
        remoteChangeSequence: null,
        timestampValid: false,
        currentCursor: null,
        candidateCursor: null,
        metadataChanged: false,
        checkedAt,
        ...values,
      }
      if (!next.ready) normalDeleteCleanupCandidateRef.current = null
      setNormalDeleteCleanupCandidateResult(next)
      return next.ready
    }
    const remoteSnapshot = normalDeleteRemoteResultRef.current
    if (!remoteSnapshot || result?.classification !== 'local_operation_send_remote_succeeded_cleanup_pending'
      || !result.remoteSucceeded || !result.rpcResultValidated || !result.cleanupPending
      || result.date !== remoteSnapshot.date) {
      return finish('normal_delete_cleanup_candidate_snapshot_missing')
    }
    if (!connectionIsEligible(connection) || connection.workspaceId !== remoteSnapshot.workspaceId) {
      return finish('normal_delete_cleanup_candidate_metadata_invalid', { date: remoteSnapshot.date })
    }
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata)
      || loaded.raw !== remoteSnapshot.sendingMetadataRaw) {
      return finish('normal_delete_cleanup_candidate_metadata_invalid', { date: remoteSnapshot.date })
    }
    const metadata = loaded.metadata
    const pending = metadata.pendingOperation
    const intent = metadata.localDeleteIntents[remoteSnapshot.date]
    const operationIdsMatch = pending?.kind === 'delete'
      && pending.status === 'sending'
      && pending.operationId === remoteSnapshot.operationId
      && intent?.operationId === remoteSnapshot.operationId
      && pending.operationId === intent.operationId
    if (!operationIdsMatch || pending.date !== remoteSnapshot.date || intent.date !== remoteSnapshot.date) {
      return finish('normal_delete_cleanup_candidate_operation_mismatch', {
        date: remoteSnapshot.date,
        operationIdsMatch,
      })
    }
    const baseline = metadata.baselines[remoteSnapshot.date]
    if (!baseline || baseline.deletedAt !== null || baseline.remoteRevision !== pending.baseRevision
      || baseline.remoteRevision !== intent.baselineRevision
      || baseline.remoteChangeSequence !== intent.baselineChangeSequence) {
      return finish('normal_delete_cleanup_candidate_metadata_invalid', {
        date: remoteSnapshot.date,
        operationIdsMatch: true,
      })
    }
    const applied = remoteSnapshot.appliedResult
    const appliedValid = isAppliedDayMemoDeleteSyncResult(
      applied,
      connection.workspaceId,
      remoteSnapshot.date,
      pending.baseRevision,
      metadata.lastPulledChangeSequence,
    )
    if (!appliedValid || applied.deleted_at === null) {
      return finish('normal_delete_cleanup_candidate_remote_result_invalid', {
        date: remoteSnapshot.date,
        operationIdsMatch: true,
      })
    }
    const timestampValid = !Number.isNaN(Date.parse(applied.server_updated_at))
      && !Number.isNaN(Date.parse(applied.deleted_at))
    const candidateCursor = applied.change_sequence
    if (!timestampValid || !Number.isSafeInteger(candidateCursor)
      || metadata.lastPulledChangeSequence < baseline.remoteChangeSequence
      || candidateCursor <= metadata.lastPulledChangeSequence) {
      return finish('normal_delete_cleanup_candidate_cursor_invalid', {
        date: remoteSnapshot.date,
        operationIdsMatch: true,
        remoteRevision: applied.revision,
        remoteChangeSequence: applied.change_sequence,
        timestampValid,
        currentCursor: metadata.lastPulledChangeSequence,
        candidateCursor,
      })
    }
    const tombstoneBaseline: DayMemoRemoteBaselineV3 = {
      date: remoteSnapshot.date,
      remoteRevision: applied.revision,
      remoteChangeSequence: applied.change_sequence,
      remoteUpdatedAt: applied.server_updated_at,
      baselineLocalUpdatedAt: null,
      deletedAt: applied.deleted_at,
    }
    const nextResult: DayMemoNormalDeleteCleanupCandidateResult = {
      date: remoteSnapshot.date,
      classification: 'normal_delete_cleanup_candidate_ready',
      ready: true,
      operationIdsMatch: true,
      remoteRevision: applied.revision,
      remoteChangeSequence: applied.change_sequence,
      timestampValid: true,
      currentCursor: metadata.lastPulledChangeSequence,
      candidateCursor,
      metadataChanged: false,
      checkedAt,
    }
    normalDeleteCleanupCandidateRef.current = {
      result: { ...nextResult },
      workspaceId: connection.workspaceId,
      operationId: remoteSnapshot.operationId,
      metadataRaw: loaded.raw,
      previousBaseline: { ...baseline },
      tombstoneBaseline,
      currentCursor: metadata.lastPulledChangeSequence,
      candidateCursor,
      appliedResult: { ...applied },
    }
    setNormalDeleteCleanupCandidateResult(nextResult)
    return true
  }, [connection, result])

  const getNormalDeleteCleanupCandidateSnapshot = useCallback((): DayMemoNormalDeleteCleanupCandidateSnapshot | null => {
    const snapshot = normalDeleteCleanupCandidateRef.current
    if (!snapshot || !connectionIsEligible(connection) || connection.workspaceId !== snapshot.workspaceId) return null
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata)
      || loaded.raw !== snapshot.metadataRaw
      || loaded.metadata.pendingOperation?.kind !== 'delete'
      || loaded.metadata.pendingOperation.operationId !== snapshot.operationId
      || loaded.metadata.localDeleteIntents[snapshot.result.date ?? '']?.operationId !== snapshot.operationId) return null
    return {
      ...snapshot,
      result: { ...snapshot.result },
      previousBaseline: { ...snapshot.previousBaseline },
      tombstoneBaseline: { ...snapshot.tombstoneBaseline },
      appliedResult: { ...snapshot.appliedResult },
    }
  }, [connection])

  const discard = useCallback(() => {
    setResult(null)
    normalDeleteRemoteResultRef.current = null
    normalDeleteCleanupCandidateRef.current = null
    setNormalDeleteCleanupCandidateResult(null)
  }, [])

  return {
    eligible,
    sending,
    canSend: Boolean(eligible && !sending && currentSnapshotToken && currentSnapshotToken !== attemptedSnapshotToken),
    result,
    send,
    sendPreparedNormalDelete,
    getNormalDeleteRemoteResultSnapshot,
    normalDeleteCleanupCandidateResult,
    prepareNormalDeleteCleanupCandidate,
    getNormalDeleteCleanupCandidateSnapshot,
    discard,
  }
}
