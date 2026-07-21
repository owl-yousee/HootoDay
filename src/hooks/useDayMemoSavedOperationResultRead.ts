import { useCallback, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoBodyMismatchRecoveryPendingOperationV5, DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { isStoredDayMemo, readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import {
  canonicalDayMemoPayloadFingerprint,
  normalizeDayMemoSyncOperationResult,
  operationResultMatchesAppliedDayMemo,
} from '../utils/dayMemoSyncOperationResult'
import { isDayMemoSyncMetadataV5, loadDayMemoSyncMetadataAny } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'

export type DayMemoSavedOperationResultReadSafety =
  | 'normal_body_mismatch_recovery_operation_result_read_ready'
  | 'normal_body_mismatch_recovery_operation_result_configuration_unavailable'
  | 'normal_body_mismatch_recovery_operation_result_authentication_unavailable'
  | 'normal_body_mismatch_recovery_operation_result_workspace_mismatch'
  | 'normal_body_mismatch_recovery_operation_result_metadata_invalid'
  | 'normal_body_mismatch_recovery_operation_result_pending_missing'
  | 'normal_body_mismatch_recovery_operation_result_wrong_mode'
  | 'normal_body_mismatch_recovery_operation_result_wrong_status'
  | 'normal_body_mismatch_recovery_operation_result_pending_invalid'
  | 'normal_body_mismatch_recovery_operation_result_operation_id_unavailable'
  | 'normal_body_mismatch_recovery_operation_result_checkpoint_unavailable'
  | 'normal_body_mismatch_recovery_operation_result_local_missing'
  | 'normal_body_mismatch_recovery_operation_result_local_changed'
  | 'normal_body_mismatch_recovery_operation_result_push_blocked'
  | 'normal_body_mismatch_recovery_operation_result_intent_exists'
  | 'normal_body_mismatch_recovery_operation_result_cancelled'
  | 'normal_body_mismatch_recovery_operation_result_already_running'
  | 'normal_body_mismatch_recovery_operation_result_rpc_failed'
  | 'normal_body_mismatch_recovery_operation_result_not_found'
  | 'normal_body_mismatch_recovery_operation_result_malformed'
  | 'normal_body_mismatch_recovery_operation_result_workspace_result_mismatch'
  | 'normal_body_mismatch_recovery_operation_result_entity_mismatch'
  | 'normal_body_mismatch_recovery_operation_result_kind_mismatch'
  | 'normal_body_mismatch_recovery_operation_result_base_revision_mismatch'
  | 'normal_body_mismatch_recovery_operation_result_status_unexpected'
  | 'normal_body_mismatch_recovery_operation_result_conflict'
  | 'normal_body_mismatch_recovery_operation_result_revision_invalid'
  | 'normal_body_mismatch_recovery_operation_result_sequence_invalid'
  | 'normal_body_mismatch_recovery_operation_result_updated_at_invalid'
  | 'normal_body_mismatch_recovery_operation_result_deleted_state_unexpected'
  | 'normal_body_mismatch_recovery_operation_result_payload_invalid'
  | 'normal_body_mismatch_recovery_operation_result_payload_mismatch'
  | 'normal_body_mismatch_recovery_operation_result_state_changed'
  | 'normal_body_mismatch_recovery_operation_result_stale'
  | 'normal_body_mismatch_recovery_operation_result_unknown'

export interface DayMemoSavedOperationResultReadResult {
  safety: DayMemoSavedOperationResultReadSafety
  date: string | null
  operationMode: 'body_mismatch_recovery' | null
  pendingStatus: 'recovery_required' | null
  operationVerified: boolean
  localFresh: boolean
  historyRecovered: boolean
  resultStatus: 'applied' | null
  baseRevisionVerified: boolean
  postSendRevisionVerified: boolean
  postSendChangeSequenceVerified: boolean
  postSendUpdatedAtVerified: boolean
  activeStateVerified: boolean
  deletedAtAbsent: boolean
  payloadVerified: boolean
  snapshotCreated: boolean
  rpcCalled: boolean
  persistentStateChanged: false
  remoteChanged: false
  checkedAt: string
  nextAction: string
}

export interface DayMemoSavedOperationResultSnapshot {
  date: string
  operationMode: 'body_mismatch_recovery'
  operationId: string
  pendingFingerprint: string
  metadataRaw: string
  workspaceId: string
  authUserId: string
  checkpointFingerprint: string
  localStorageSerialized: string
  localFingerprint: string
  requestFingerprint: string
  resultStatus: 'applied'
  postSendRevision: number
  postSendChangeSequence: number
  postSendServerUpdatedAt: string
  postSendState: 'active'
  resultDeletedAt: null
  resultPayloadFingerprint: string
  operationCreatedAt: string
  conflict: false
  checkedAt: string
  runId: number
  snapshotToken: string
}

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  authUserId: string | null
  connection: SyncConnection | null
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function connectionIsEligible(connection: SyncConnection | null): connection is SyncConnection & { workspaceId: string } {
  return Boolean(connection && isUuid(connection.workspaceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}

function isRecoveryRequiredPending(value: unknown): value is DayMemoBodyMismatchRecoveryPendingOperationV5 {
  if (!value || typeof value !== 'object') return false
  const pending = value as Partial<DayMemoBodyMismatchRecoveryPendingOperationV5>
  return pending.kind === 'upsert' && pending.operationMode === 'body_mismatch_recovery'
    && pending.status === 'recovery_required' && typeof pending.date === 'string'
    && isUuid(pending.operationId ?? '') && Number.isSafeInteger(pending.baseRevision)
    && Number(pending.baseRevision) >= 1 && Number.isSafeInteger(pending.baseChangeSequence)
    && Number(pending.baseChangeSequence) >= 1 && pending.baseRemoteState === 'active'
    && typeof pending.baseRemoteUpdatedAt === 'string' && !Number.isNaN(Date.parse(pending.baseRemoteUpdatedAt))
    && typeof pending.preparedLocalUpdatedAt === 'string' && !Number.isNaN(Date.parse(pending.preparedLocalUpdatedAt))
}

function checkpointFingerprint(metadata: DayMemoSyncMetadataV5): string {
  return JSON.stringify({ version: metadata.version, workspaceId: metadata.workspaceId,
    baselines: metadata.baselines, cursor: metadata.lastPulledChangeSequence,
    baselineStatus: metadata.baselineStatus, baselineConfirmedAt: metadata.baselineConfirmedAt })
}

function checkpointIsValid(metadata: DayMemoSyncMetadataV5, pending: DayMemoBodyMismatchRecoveryPendingOperationV5): boolean {
  return metadata.baselineStatus === 'recovery_required' && metadata.baselineConfirmedAt === null
    && metadata.lastPulledChangeSequence >= pending.baseChangeSequence
    && Object.keys(metadata.baselines).length > 0 && metadata.baselines[pending.date] === undefined
}

function nextAction(safety: DayMemoSavedOperationResultReadSafety): string {
  if (safety === 'normal_body_mismatch_recovery_operation_result_read_ready') {
    return '保存済みoperation結果を取得しました。次Phaseでfull pull結果と照合します。'
  }
  if (safety === 'normal_body_mismatch_recovery_operation_result_not_found') {
    return '保存済みoperation履歴を確認できませんでした。再送せず、安全確認を停止しました。'
  }
  if (safety === 'normal_body_mismatch_recovery_operation_result_cancelled') {
    return '取得をキャンセルしました。RPCと永続変更はありません。'
  }
  return '保存済みoperation結果を安全に確認できなかったため停止しました。自動再試行は行いません。'
}

function inspectEligiblePending(connection: SyncConnection | null): DayMemoBodyMismatchRecoveryPendingOperationV5 | null {
  if (!connectionIsEligible(connection)) return null
  const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
  if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata)
    || loaded.metadata.workspaceId !== connection.workspaceId
    || !isRecoveryRequiredPending(loaded.metadata.pendingOperation)
    || !checkpointIsValid(loaded.metadata, loaded.metadata.pendingOperation)
    || loaded.metadata.pushBlock !== null
    || loaded.metadata.localDeleteIntents[loaded.metadata.pendingOperation.date]) return null
  return loaded.metadata.pendingOperation
}

export function useDayMemoSavedOperationResultRead({ dayMemos, isConfigured, isSignedIn, authUserId, connection }: Input) {
  const [reading, setReading] = useState(false)
  const [result, setResult] = useState<DayMemoSavedOperationResultReadResult | null>(null)
  const snapshotRef = useRef<DayMemoSavedOperationResultSnapshot | null>(null)
  const consumedSnapshotTokenRef = useRef<string | null>(null)
  const inFlightRef = useRef(false)
  const runIdRef = useRef(0)
  const latestRef = useRef({ dayMemos, isConfigured, isSignedIn, authUserId, connection })
  latestRef.current = { dayMemos, isConfigured, isSignedIn, authUserId, connection }
  const eligible = Boolean(isConfigured && isSignedIn && isUuid(authUserId) && supabaseClient && inspectEligiblePending(connection))

  const finish = useCallback((safety: DayMemoSavedOperationResultReadSafety,
    values: Partial<DayMemoSavedOperationResultReadResult> = {}) => {
    const next: DayMemoSavedOperationResultReadResult = {
      safety, date: null, operationMode: null, pendingStatus: null, operationVerified: false,
      localFresh: false, historyRecovered: false, resultStatus: null, baseRevisionVerified: false,
      postSendRevisionVerified: false, postSendChangeSequenceVerified: false,
      postSendUpdatedAtVerified: false, activeStateVerified: false, deletedAtAbsent: false,
      payloadVerified: false, snapshotCreated: false, rpcCalled: false,
      persistentStateChanged: false, remoteChanged: false, checkedAt: new Date().toISOString(),
      nextAction: nextAction(safety), ...values,
    }
    setResult(next)
    if (!next.snapshotCreated) { snapshotRef.current = null; consumedSnapshotTokenRef.current = null }
    return next
  }, [])

  const read = useCallback(async () => {
    if (inFlightRef.current || reading) return
    const runId = ++runIdRef.current
    inFlightRef.current = true
    setReading(true); setResult(null); snapshotRef.current = null; consumedSnapshotTokenRef.current = null
    try {
      if (!isConfigured || !supabaseClient) {
        finish('normal_body_mismatch_recovery_operation_result_configuration_unavailable'); return
      }
      if (!isSignedIn || !isUuid(authUserId)) {
        finish('normal_body_mismatch_recovery_operation_result_authentication_unavailable'); return
      }
      if (!connectionIsEligible(connection)) {
        finish('normal_body_mismatch_recovery_operation_result_workspace_mismatch'); return
      }
      const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
      const stored = readDayMemoStorageSnapshot(window.localStorage)
      if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata)) {
        finish('normal_body_mismatch_recovery_operation_result_metadata_invalid'); return
      }
      if (stored.status !== 'ready') {
        finish('normal_body_mismatch_recovery_operation_result_local_changed'); return
      }
      const metadata = loaded.metadata
      if (metadata.workspaceId !== connection.workspaceId) {
        finish('normal_body_mismatch_recovery_operation_result_workspace_mismatch'); return
      }
      if (metadata.pushBlock) { finish('normal_body_mismatch_recovery_operation_result_push_blocked'); return }
      const pending = metadata.pendingOperation
      if (!pending) { finish('normal_body_mismatch_recovery_operation_result_pending_missing'); return }
      if (pending.kind !== 'upsert' || pending.operationMode !== 'body_mismatch_recovery') {
        finish('normal_body_mismatch_recovery_operation_result_wrong_mode'); return
      }
      if (pending.status !== 'recovery_required') {
        finish('normal_body_mismatch_recovery_operation_result_wrong_status'); return
      }
      if (!isUuid(pending.operationId)) {
        finish('normal_body_mismatch_recovery_operation_result_operation_id_unavailable'); return
      }
      if (!isRecoveryRequiredPending(pending)) {
        finish('normal_body_mismatch_recovery_operation_result_pending_invalid'); return
      }
      const base = { date: pending.date, operationMode: 'body_mismatch_recovery' as const,
        pendingStatus: 'recovery_required' as const, operationVerified: true }
      if (!checkpointIsValid(metadata, pending)) {
        finish('normal_body_mismatch_recovery_operation_result_checkpoint_unavailable', base); return
      }
      if (metadata.localDeleteIntents[pending.date] || Object.keys(metadata.localDeleteIntents).length > 0) {
        finish('normal_body_mismatch_recovery_operation_result_intent_exists', base); return
      }
      if (!same(dayMemos, stored.memos)) {
        finish('normal_body_mismatch_recovery_operation_result_local_changed', base); return
      }
      const targets = stored.memos.filter((memo) => memo.date === pending.date)
      if (targets.length !== 1 || !isStoredDayMemo(targets[0])) {
        finish('normal_body_mismatch_recovery_operation_result_local_missing', base); return
      }
      const memo = targets[0]
      if (memo.updatedAt !== pending.preparedLocalUpdatedAt) {
        finish('normal_body_mismatch_recovery_operation_result_local_changed', base); return
      }
      const localFingerprint = canonicalDayMemoPayloadFingerprint(memo)
      const persistentCheckpointFingerprint = checkpointFingerprint(metadata)
      const pendingFingerprint = JSON.stringify(pending)
      const accepted = window.confirm([
        `対象日：${pending.date}`,
        '既存operation IDを使用して、保存済みoperation履歴だけを読み取ります。',
        'remote更新、operation作成、revision／sequence採番は行いません。',
        'metadata、pending、baseline、cursorは変更しません。',
        '自動再試行は行いません。実行しますか？',
      ].join('\n'))
      if (!accepted) {
        finish('normal_body_mismatch_recovery_operation_result_cancelled', base); return
      }

      let responseData: unknown
      try {
        const response = await supabaseClient.rpc('hooto_day_get_sync_operation_result', {
          target_operation_id: pending.operationId,
          target_workspace_id: connection.workspaceId,
          target_entity_type: 'day_memo',
          target_entity_id: pending.date,
          target_operation_kind: 'upsert',
        })
        if (response.error) throw new Error('operation_result_read_failed')
        responseData = response.data
      } catch {
        finish('normal_body_mismatch_recovery_operation_result_rpc_failed', { ...base, localFresh: true, rpcCalled: true }); return
      }
      if (runIdRef.current !== runId) return

      const latest = latestRef.current
      const afterLoaded = loadDayMemoSyncMetadataAny(window.localStorage)
      const afterStored = readDayMemoStorageSnapshot(window.localStorage)
      if (!latest.isConfigured || !latest.isSignedIn || latest.authUserId !== authUserId
        || !connectionIsEligible(latest.connection)
        || latest.connection.workspaceId !== connection.workspaceId
        || afterLoaded.status !== 'ready' || !isDayMemoSyncMetadataV5(afterLoaded.metadata)
        || afterLoaded.raw !== loaded.raw || afterStored.status !== 'ready'
        || afterStored.serialized !== stored.serialized || !same(latest.dayMemos, afterStored.memos)
        || JSON.stringify(afterLoaded.metadata.pendingOperation) !== pendingFingerprint
        || checkpointFingerprint(afterLoaded.metadata) !== persistentCheckpointFingerprint) {
        finish('normal_body_mismatch_recovery_operation_result_state_changed', { ...base, rpcCalled: true }); return
      }
      const afterTarget = afterStored.memos.filter((item) => item.date === pending.date)
      if (afterTarget.length !== 1 || !isStoredDayMemo(afterTarget[0])
        || canonicalDayMemoPayloadFingerprint(afterTarget[0]) !== localFingerprint) {
        finish('normal_body_mismatch_recovery_operation_result_local_changed', { ...base, rpcCalled: true }); return
      }

      const normalized = normalizeDayMemoSyncOperationResult(responseData)
      if (!normalized) {
        finish('normal_body_mismatch_recovery_operation_result_malformed', { ...base, localFresh: true, rpcCalled: true }); return
      }
      if (!normalized.found) {
        finish('normal_body_mismatch_recovery_operation_result_not_found', { ...base, localFresh: true, rpcCalled: true }); return
      }
      if (normalized.workspaceId !== connection.workspaceId) {
        finish('normal_body_mismatch_recovery_operation_result_workspace_result_mismatch', { ...base, rpcCalled: true }); return
      }
      if (normalized.entityType !== 'day_memo' || normalized.entityId !== pending.date) {
        finish('normal_body_mismatch_recovery_operation_result_entity_mismatch', { ...base, rpcCalled: true }); return
      }
      if (normalized.operationKind !== 'upsert') {
        finish('normal_body_mismatch_recovery_operation_result_kind_mismatch', { ...base, rpcCalled: true }); return
      }
      if (normalized.requestBaseRevision !== pending.baseRevision) {
        finish('normal_body_mismatch_recovery_operation_result_base_revision_mismatch', { ...base, rpcCalled: true }); return
      }
      if (normalized.resultStatus === 'conflict' || normalized.conflict) {
        finish('normal_body_mismatch_recovery_operation_result_conflict', { ...base, rpcCalled: true }); return
      }
      if (normalized.resultStatus !== 'applied') {
        finish('normal_body_mismatch_recovery_operation_result_status_unexpected', { ...base, rpcCalled: true }); return
      }
      if (normalized.resultRevision !== pending.baseRevision + 1) {
        finish('normal_body_mismatch_recovery_operation_result_revision_invalid', { ...base, rpcCalled: true }); return
      }
      if (normalized.resultChangeSequence <= pending.baseChangeSequence) {
        finish('normal_body_mismatch_recovery_operation_result_sequence_invalid', { ...base, rpcCalled: true }); return
      }
      if (normalized.resultServerUpdatedAt === null) {
        finish('normal_body_mismatch_recovery_operation_result_updated_at_invalid', { ...base, rpcCalled: true }); return
      }
      if (normalized.resultDeletedAt !== null) {
        finish('normal_body_mismatch_recovery_operation_result_deleted_state_unexpected', { ...base, rpcCalled: true }); return
      }
      if (!normalized.resultPayload || typeof normalized.resultPayload !== 'object') {
        finish('normal_body_mismatch_recovery_operation_result_payload_invalid', { ...base, rpcCalled: true }); return
      }
      const resultPayloadFingerprint = canonicalDayMemoPayloadFingerprint(normalized.resultPayload as DayMemo)
      if (resultPayloadFingerprint !== localFingerprint) {
        finish('normal_body_mismatch_recovery_operation_result_payload_mismatch', { ...base, rpcCalled: true }); return
      }
      if (!operationResultMatchesAppliedDayMemo(normalized, connection.workspaceId, memo,
        pending.baseRevision, pending.baseChangeSequence)) {
        finish('normal_body_mismatch_recovery_operation_result_payload_mismatch', { ...base, rpcCalled: true }); return
      }

      const checkedAt = new Date().toISOString()
      const next = finish('normal_body_mismatch_recovery_operation_result_read_ready', {
        ...base, localFresh: true, historyRecovered: true, resultStatus: 'applied',
        baseRevisionVerified: true, postSendRevisionVerified: true,
        postSendChangeSequenceVerified: true, postSendUpdatedAtVerified: true,
        activeStateVerified: true, deletedAtAbsent: true, payloadVerified: true,
        snapshotCreated: true, rpcCalled: true, checkedAt,
      })
      const snapshotToken = `${runId}:${checkedAt}`
      snapshotRef.current = {
        date: pending.date, operationMode: 'body_mismatch_recovery', operationId: pending.operationId,
        pendingFingerprint, metadataRaw: loaded.raw, workspaceId: connection.workspaceId,
        authUserId,
        checkpointFingerprint: persistentCheckpointFingerprint, localStorageSerialized: stored.serialized,
        localFingerprint, requestFingerprint: normalized.requestFingerprint, resultStatus: 'applied',
        postSendRevision: normalized.resultRevision, postSendChangeSequence: normalized.resultChangeSequence,
        postSendServerUpdatedAt: normalized.resultServerUpdatedAt, postSendState: 'active',
        resultDeletedAt: null, resultPayloadFingerprint, operationCreatedAt: normalized.operationCreatedAt,
        conflict: false, checkedAt: next.checkedAt, runId, snapshotToken,
      }
    } catch {
      finish('normal_body_mismatch_recovery_operation_result_unknown')
    } finally {
      if (runIdRef.current === runId) setReading(false)
      inFlightRef.current = false
    }
  }, [authUserId, connection, dayMemos, finish, isConfigured, isSignedIn, reading])

  const discard = useCallback(() => {
    runIdRef.current += 1
    snapshotRef.current = null
    consumedSnapshotTokenRef.current = null
    setResult(null)
    setReading(false)
  }, [])

  const getReadySnapshot = useCallback(() => {
    const current = snapshotRef.current
    const latest = latestRef.current
    if (!current || consumedSnapshotTokenRef.current === current.snapshotToken
      || !latest.isConfigured || !latest.isSignedIn || latest.authUserId !== current.authUserId
      || !connectionIsEligible(latest.connection)
      || latest.connection.workspaceId !== current.workspaceId) return null
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const stored = readDayMemoStorageSnapshot(window.localStorage)
    if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata)
      || loaded.raw !== current.metadataRaw || stored.status !== 'ready'
      || stored.serialized !== current.localStorageSerialized || !same(latest.dayMemos, stored.memos)
      || JSON.stringify(loaded.metadata.pendingOperation) !== current.pendingFingerprint
      || checkpointFingerprint(loaded.metadata) !== current.checkpointFingerprint
      || loaded.metadata.pushBlock !== null || loaded.metadata.localDeleteIntents[current.date]) return null
    const targets = stored.memos.filter((memo) => memo.date === current.date)
    if (targets.length !== 1 || !isStoredDayMemo(targets[0])
      || canonicalDayMemoPayloadFingerprint(targets[0]) !== current.localFingerprint) return null
    return { ...current }
  }, [])

  const consumeReadySnapshot = useCallback((snapshotToken: string) => {
    if (snapshotRef.current?.snapshotToken !== snapshotToken || consumedSnapshotTokenRef.current === snapshotToken) return false
    consumedSnapshotTokenRef.current = snapshotToken
    return true
  }, [])

  const getCurrentSnapshotToken = useCallback(() => snapshotRef.current?.snapshotToken ?? null, [])

  return { eligible, reading, result, read, discard, getReadySnapshot, consumeReadySnapshot, getCurrentSnapshotToken }
}
