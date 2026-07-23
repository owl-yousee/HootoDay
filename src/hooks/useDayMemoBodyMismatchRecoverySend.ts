import { useCallback, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { isStoredDayMemo, readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { isDayMemoSyncMetadataV5, loadDayMemoSyncMetadataAny, replaceDayMemoSyncMetadataV2 } from '../utils/dayMemoSyncStorage'
import { isAppliedDayMemoSyncResult, isConflictDayMemoSyncResult, normalizeDayMemoSyncResult } from '../utils/dayMemoSyncUpsertResult'
import { isUuid } from '../utils/syncConnectionStorage'
import { activeBaselineMatchesRemoteIdentity, classifyDayMemoNormalDifference } from './useDayMemoNormalDifferenceRecoveryPlan'
import type { DayMemoBodyMismatchRecoveryPreflightSnapshot } from './useDayMemoBodyMismatchRecoveryPreflight'

export type DayMemoBodyMismatchRecoverySendSafety =
  | 'normal_body_mismatch_recovery_sent' | 'normal_body_mismatch_recovery_send_snapshot_missing'
  | 'normal_body_mismatch_recovery_send_snapshot_stale' | 'normal_body_mismatch_recovery_send_snapshot_consumed'
  | 'normal_body_mismatch_recovery_send_pending_missing' | 'normal_body_mismatch_recovery_send_wrong_mode'
  | 'normal_body_mismatch_recovery_send_pending_invalid' | 'normal_body_mismatch_recovery_send_pending_changed'
  | 'normal_body_mismatch_recovery_send_workspace_mismatch' | 'normal_body_mismatch_recovery_send_metadata_invalid'
  | 'normal_body_mismatch_recovery_send_checkpoint_unavailable' | 'normal_body_mismatch_recovery_send_target_unavailable'
  | 'normal_body_mismatch_recovery_send_local_missing' | 'normal_body_mismatch_recovery_send_local_changed'
  | 'normal_body_mismatch_recovery_send_push_blocked' | 'normal_body_mismatch_recovery_send_intent_exists'
  | 'normal_body_mismatch_recovery_send_auth_unavailable' | 'normal_body_mismatch_recovery_send_configuration_unavailable'
  | 'normal_body_mismatch_recovery_send_already_running' | 'normal_body_mismatch_recovery_send_cancelled'
  | 'normal_body_mismatch_recovery_send_rpc_failed' | 'normal_body_mismatch_recovery_send_rpc_conflict'
  | 'normal_body_mismatch_recovery_send_rpc_stale_base' | 'normal_body_mismatch_recovery_send_rpc_no_row'
  | 'normal_body_mismatch_recovery_send_rpc_malformed' | 'normal_body_mismatch_recovery_send_rpc_mismatch'
  | 'normal_body_mismatch_recovery_send_metadata_save_failed' | 'normal_body_mismatch_recovery_send_readback_failed'
  | 'normal_body_mismatch_recovery_send_rollback_failed' | 'normal_body_mismatch_recovery_send_post_state_uncertain'
  | 'normal_body_mismatch_recovery_send_unknown'

export interface DayMemoBodyMismatchRecoverySendResult {
  date: string | null
  safety: DayMemoBodyMismatchRecoverySendSafety
  succeeded: boolean
  operationMode: 'body_mismatch_recovery' | 'local_only_recovery' | null
  snapshotVerified: boolean
  pendingVerified: boolean
  localFresh: boolean
  checkpointVerified: boolean
  rpcCalled: boolean
  rpcValidated: boolean
  remoteUpdated: boolean
  metadataSaved: boolean
  readBackSucceeded: boolean
  rollbackAttempted: boolean
  rollbackSucceeded: boolean
  pendingStatus: 'sending' | 'response_unknown' | 'conflict' | 'recovery_required' | null
  dayMemoChanged: false
  baselineChanged: false
  cursorChanged: false
  baselineStatus: 'recovery_required' | null
  snapshotConsumed: boolean
  automaticRetry: false
  checkedAt: string
  nextAction: string
}

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  getReadySnapshot: () => DayMemoBodyMismatchRecoveryPreflightSnapshot | null
  consumeReadySnapshot: () => void
  adoptVerifiedMetadata: (metadata: DayMemoSyncMetadataV5) => void
}

function connectionIsEligible(connection: SyncConnection | null): connection is SyncConnection & { workspaceId: string; deviceId: string } {
  return Boolean(connection && isUuid(connection.workspaceId) && typeof connection.deviceId === 'string'
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right) }
function token(snapshot: DayMemoBodyMismatchRecoveryPreflightSnapshot | null): string | null {
  return snapshot ? JSON.stringify([snapshot.metadataRaw, snapshot.result.checkedAt, snapshot.localFingerprint, snapshot.remoteFingerprint]) : null
}
function nextAction(safety: DayMemoBodyMismatchRecoverySendSafety): string {
  if (safety === 'normal_body_mismatch_recovery_sent') return '送信は完了しましたが、復旧はまだ確定していません。次Phaseでremoteと未解決差異を再確認してください。'
  if (safety === 'normal_body_mismatch_recovery_send_cancelled') return '送信をキャンセルしました。永続変更とRPC送信はありません。'
  if (safety.includes('rpc_') || safety.includes('post_state') || safety.includes('metadata_save') || safety.includes('readback') || safety.includes('rollback')) return '同じsnapshotでは再送しません。remoteのread-only確認と復旧確認が必要です。'
  return '送信していません。送信前remote確認からやり直してください。'
}

export function useDayMemoBodyMismatchRecoverySend({ dayMemos, isConfigured, isSignedIn, connection, getReadySnapshot, consumeReadySnapshot, adoptVerifiedMetadata }: Input) {
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<DayMemoBodyMismatchRecoverySendResult | null>(null)
  const resultRef = useRef<DayMemoBodyMismatchRecoverySendResult | null>(null)
  const inFlightRef = useRef(false)
  const attemptedRef = useRef<string | null>(null)
  const current = getReadySnapshot()
  const currentToken = token(current)
  const eligible = Boolean(isConfigured && isSignedIn && supabaseClient && connectionIsEligible(connection) && current)
  const canSend = Boolean(eligible && !sending && currentToken && attemptedRef.current !== currentToken)

  const finish = useCallback((safety: DayMemoBodyMismatchRecoverySendSafety, values: Partial<DayMemoBodyMismatchRecoverySendResult> = {}) => {
    const next: DayMemoBodyMismatchRecoverySendResult = { date: null, safety, succeeded: false, operationMode: null, snapshotVerified: false,
      pendingVerified: false, localFresh: false, checkpointVerified: false, rpcCalled: false,
      rpcValidated: false, remoteUpdated: false, metadataSaved: false, readBackSucceeded: false,
      rollbackAttempted: false, rollbackSucceeded: false, pendingStatus: null, dayMemoChanged: false,
      baselineChanged: false, cursorChanged: false, baselineStatus: null, snapshotConsumed: false,
      automaticRetry: false, checkedAt: new Date().toISOString(), nextAction: nextAction(safety), ...values }
    resultRef.current = next
    setResult(next)
    return next
  }, [])

  const persistStatus = useCallback((expectedRaw: string, metadata: DayMemoSyncMetadataV5,
    status: 'response_unknown' | 'conflict' | 'recovery_required') => {
    if (!metadata.pendingOperation || metadata.pendingOperation.kind !== 'upsert'
      || metadata.pendingOperation.operationMode === 'normal') return false
    const next: DayMemoSyncMetadataV5 = { ...metadata, pendingOperation: { ...metadata.pendingOperation, status } }
    if (!isDayMemoSyncMetadataV5(next)) return false
    const saved = replaceDayMemoSyncMetadataV2(window.localStorage, next, expectedRaw)
    if (saved !== 'saved') return false
    const readBack = loadDayMemoSyncMetadataAny(window.localStorage)
    return readBack.status === 'ready' && isDayMemoSyncMetadataV5(readBack.metadata) && readBack.raw === JSON.stringify(next)
  }, [])

  const send = useCallback(async (options: { skipConfirmation?: boolean } = {}) => {
    if (inFlightRef.current) { finish('normal_body_mismatch_recovery_send_already_running'); return }
    if (!isConfigured) { finish('normal_body_mismatch_recovery_send_configuration_unavailable'); return }
    if (!isSignedIn || !supabaseClient) { finish('normal_body_mismatch_recovery_send_auth_unavailable'); return }
    if (!connectionIsEligible(connection)) { finish('normal_body_mismatch_recovery_send_workspace_mismatch'); return }
    const snapshot = getReadySnapshot()
    const snapshotToken = token(snapshot)
    if (!snapshot || !snapshotToken) { finish('normal_body_mismatch_recovery_send_snapshot_missing'); return }
    if (attemptedRef.current === snapshotToken) { finish('normal_body_mismatch_recovery_send_snapshot_consumed'); return }
    const accepted = options.skipConfirmation || window.confirm(`${snapshot.result.date} の確認済みlocalを同期先へ送信します。既存operation IDを使用し、Supabaseへ実際に1回送信します。自動retryは行わず、baseline・cursor・checkpointは変更しません。送信後は次Phaseでremoteを再確認します。送信しますか？`)
    if (!accepted) { finish('normal_body_mismatch_recovery_send_cancelled', { date: snapshot.result.date }); return }
    inFlightRef.current = true; setSending(true); setResult(null)
    try {
      const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
      const stored = readDayMemoStorageSnapshot(window.localStorage)
      const base = { date: snapshot.result.date, operationMode: snapshot.pendingOperation.operationMode,
        snapshotVerified: true, baselineStatus: 'recovery_required' as const }
      if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata) || stored.status !== 'ready') {
        finish('normal_body_mismatch_recovery_send_metadata_invalid', base); return
      }
      const metadata = loaded.metadata
      const pending = metadata.pendingOperation
      if (loaded.raw !== snapshot.metadataRaw || stored.serialized !== snapshot.localStorageSerialized
        || !same(dayMemos, stored.memos)) { finish('normal_body_mismatch_recovery_send_snapshot_stale', base); return }
      if (metadata.workspaceId !== connection.workspaceId || snapshot.workspaceId !== connection.workspaceId) {
        finish('normal_body_mismatch_recovery_send_workspace_mismatch', base); return
      }
      if (metadata.pushBlock) { finish('normal_body_mismatch_recovery_send_push_blocked', base); return }
      if (!pending) { finish('normal_body_mismatch_recovery_send_pending_missing', base); return }
      if (pending.kind !== 'upsert' || (pending.operationMode !== 'body_mismatch_recovery'
        && pending.operationMode !== 'local_only_recovery')) {
        finish('normal_body_mismatch_recovery_send_wrong_mode', base); return
      }
      if (pending.status !== 'prepared' || !same(pending, snapshot.pendingOperation)) {
        finish('normal_body_mismatch_recovery_send_pending_changed', base); return
      }
      const targetBaseline = metadata.baselines[pending.date] ?? null
      const targetBaselineValid = pending.operationMode === 'local_only_recovery'
        ? targetBaseline === null
        : targetBaseline === null || activeBaselineMatchesRemoteIdentity(targetBaseline,
          pending.baseRevision, pending.baseChangeSequence, pending.baseRemoteUpdatedAt)
      if (metadata.baselineStatus !== 'recovery_required' || metadata.baselineConfirmedAt !== null
        || !targetBaselineValid || metadata.lastPulledChangeSequence < pending.baseChangeSequence) {
        finish('normal_body_mismatch_recovery_send_checkpoint_unavailable', base); return
      }
      if (metadata.localDeleteIntents[pending.date] || Object.keys(metadata.localDeleteIntents).length) {
        finish('normal_body_mismatch_recovery_send_intent_exists', base); return
      }
      const targets = stored.memos.filter((memo) => memo.date === pending.date)
      const memo = targets[0]
      if (targets.length !== 1 || !memo || !isStoredDayMemo(memo)) {
        finish('normal_body_mismatch_recovery_send_local_missing', base); return
      }
      const expectedClassification = pending.operationMode === 'body_mismatch_recovery' ? 'body_mismatch' : 'local_only'
      if (memo.updatedAt !== pending.preparedLocalUpdatedAt || JSON.stringify(memo) !== snapshot.localFingerprint
        || (pending.operationMode === 'body_mismatch_recovery' && snapshot.remoteRecord?.payload === null)
        || classifyDayMemoNormalDifference(memo, snapshot.remoteRecord, targetBaseline) !== expectedClassification) {
        finish('normal_body_mismatch_recovery_send_local_changed', base); return
      }
      if ((pending.operationMode === 'body_mismatch_recovery' && (!snapshot.remoteRecord
        || snapshot.remoteRecord.revision !== pending.baseRevision
        || snapshot.remoteRecord.changeSequence !== pending.baseChangeSequence
        || snapshot.remoteRecord.payload?.updatedAt !== pending.baseRemoteUpdatedAt
        || snapshot.remoteRecord.deletedAt !== null || JSON.stringify(snapshot.remoteRecord) !== snapshot.remoteFingerprint))
        || (pending.operationMode === 'local_only_recovery' && (snapshot.remoteRecord !== null
          || pending.baseRevision !== 0 || pending.baseChangeSequence !== 0 || pending.baseRemoteState !== 'missing'))) {
        finish('normal_body_mismatch_recovery_send_snapshot_stale', base); return
      }
      const sendingMetadata: DayMemoSyncMetadataV5 = { ...metadata, pendingOperation: { ...pending, status: 'sending' } }
      if (!isDayMemoSyncMetadataV5(sendingMetadata)) { finish('normal_body_mismatch_recovery_send_pending_invalid', base); return }
      const sendingSave = replaceDayMemoSyncMetadataV2(window.localStorage, sendingMetadata, loaded.raw)
      if (sendingSave !== 'saved') {
        finish(sendingSave === 'rollback_failed' ? 'normal_body_mismatch_recovery_send_rollback_failed'
          : 'normal_body_mismatch_recovery_send_metadata_save_failed', { ...base, rollbackAttempted: true,
          rollbackSucceeded: sendingSave !== 'rollback_failed' }); return
      }
      const sendingRaw = JSON.stringify(sendingMetadata)
      attemptedRef.current = snapshotToken
      consumeReadySnapshot()
      let responseData: unknown
      try {
        const response = await supabaseClient.rpc('hooto_day_upsert_sync_record', {
          target_workspace_id: connection.workspaceId, target_entity_type: 'day_memo', target_entity_id: memo.date,
          target_payload: { date: memo.date, content: memo.content, updatedAt: memo.updatedAt }, target_schema_version: 1,
          base_revision: pending.baseRevision, operation_id: pending.operationId,
          client_updated_at: memo.updatedAt, source_device_id: connection.deviceId,
        })
        if (response.error) throw new Error('rpc_result_unknown')
        responseData = response.data
      } catch {
        const persisted = persistStatus(sendingRaw, sendingMetadata, 'response_unknown')
        finish('normal_body_mismatch_recovery_send_rpc_failed', { ...base, pendingVerified: true, localFresh: true,
          checkpointVerified: true, rpcCalled: true, pendingStatus: persisted ? 'response_unknown' : 'sending', snapshotConsumed: true }); return
      }
      const normalized = normalizeDayMemoSyncResult(responseData)
      if (isConflictDayMemoSyncResult(normalized, connection.workspaceId, pending.date)) {
        const persisted = persistStatus(sendingRaw, sendingMetadata, 'conflict')
        finish('normal_body_mismatch_recovery_send_rpc_conflict', { ...base, pendingVerified: true, localFresh: true,
          checkpointVerified: true, rpcCalled: true, rpcValidated: true, pendingStatus: persisted ? 'conflict' : 'sending', snapshotConsumed: true }); return
      }
      if (!isAppliedDayMemoSyncResult(normalized, connection.workspaceId, memo, pending.baseRevision, metadata.lastPulledChangeSequence)) {
        const persisted = persistStatus(sendingRaw, sendingMetadata, 'response_unknown')
        finish(normalized === null ? 'normal_body_mismatch_recovery_send_rpc_no_row' : 'normal_body_mismatch_recovery_send_rpc_malformed', {
          ...base, pendingVerified: true, localFresh: true, checkpointVerified: true, rpcCalled: true,
          pendingStatus: persisted ? 'response_unknown' : 'sending', snapshotConsumed: true }); return
      }
      const recoveryMetadata: DayMemoSyncMetadataV5 = {
        ...sendingMetadata, pendingOperation: { ...sendingMetadata.pendingOperation!, status: 'recovery_required' },
      }
      if (!isDayMemoSyncMetadataV5(recoveryMetadata)) {
        finish('normal_body_mismatch_recovery_send_post_state_uncertain', { ...base, rpcCalled: true, rpcValidated: true,
          remoteUpdated: true, pendingStatus: 'sending', snapshotConsumed: true }); return
      }
      const saved = replaceDayMemoSyncMetadataV2(window.localStorage, recoveryMetadata, sendingRaw)
      const expectedRaw = JSON.stringify(recoveryMetadata)
      const readBack = loadDayMemoSyncMetadataAny(window.localStorage)
      if (saved !== 'saved' || readBack.status !== 'ready' || !isDayMemoSyncMetadataV5(readBack.metadata) || readBack.raw !== expectedRaw) {
        const persisted = readBack.status === 'ready' && isDayMemoSyncMetadataV5(readBack.metadata)
          ? persistStatus(readBack.raw, readBack.metadata, 'recovery_required') : false
        finish('normal_body_mismatch_recovery_send_post_state_uncertain', { ...base, pendingVerified: true, localFresh: true,
          checkpointVerified: true, rpcCalled: true, rpcValidated: true, remoteUpdated: true,
          metadataSaved: persisted, readBackSucceeded: persisted, pendingStatus: persisted ? 'recovery_required' : 'sending',
          snapshotConsumed: true, rollbackAttempted: saved !== 'saved', rollbackSucceeded: false }); return
      }
      adoptVerifiedMetadata(readBack.metadata)
      finish('normal_body_mismatch_recovery_sent', { ...base, succeeded: true, pendingVerified: true, localFresh: true,
        checkpointVerified: true, rpcCalled: true, rpcValidated: true, remoteUpdated: true, metadataSaved: true,
        readBackSucceeded: true, pendingStatus: 'recovery_required', snapshotConsumed: true })
    } finally { inFlightRef.current = false; setSending(false) }
  }, [adoptVerifiedMetadata, connection, consumeReadySnapshot, dayMemos, finish, getReadySnapshot, isConfigured, isSignedIn, persistStatus])

  const discard = useCallback(() => { resultRef.current = null; setResult(null) }, [])
  const getLatestResult = useCallback(() => resultRef.current, [])
  return { eligible, canSend, sending, result, send, discard, getLatestResult }
}
