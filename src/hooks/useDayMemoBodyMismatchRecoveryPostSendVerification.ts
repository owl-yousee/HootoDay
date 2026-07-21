import { useCallback, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoBodyMismatchRecoveryPendingOperationV5, DayMemoLocalOnlyRecoveryPendingOperationV5, DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { isStoredDayMemo, readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { canonicalDayMemoPayloadFingerprint } from '../utils/dayMemoSyncOperationResult'
import { pullAllDayMemoSyncRecords, type RemoteDayMemoRecord } from '../utils/dayMemoSyncPull'
import { isDayMemoSyncMetadataV5, loadDayMemoSyncMetadataAny } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import {
  classifyDayMemoNormalDifference,
  type DayMemoNormalDifferenceClassification,
} from './useDayMemoNormalDifferenceRecoveryPlan'
import {
  fingerprintDayMemoBaselines,
  fingerprintDayMemoRecoveryCheckpoint,
  fingerprintDayMemoRecoveryPending,
  type DayMemoSavedOperationResultSnapshot,
} from './useDayMemoSavedOperationResultRead'

export type DayMemoBodyMismatchRecoveryPostSendSafety =
  | 'normal_body_mismatch_recovery_post_send_ready'
  | 'normal_body_mismatch_recovery_post_send_no_operation_result_snapshot'
  | 'normal_body_mismatch_recovery_post_send_snapshot_stale'
  | 'normal_body_mismatch_recovery_post_send_snapshot_consumed'
  | 'normal_body_mismatch_recovery_post_send_snapshot_token_mismatch'
  | 'normal_body_mismatch_recovery_post_send_configuration_unavailable'
  | 'normal_body_mismatch_recovery_post_send_authentication_unavailable'
  | 'normal_body_mismatch_recovery_post_send_workspace_mismatch'
  | 'normal_body_mismatch_recovery_post_send_metadata_invalid'
  | 'normal_body_mismatch_recovery_post_send_pending_missing'
  | 'normal_body_mismatch_recovery_post_send_wrong_operation_mode'
  | 'normal_body_mismatch_recovery_post_send_wrong_pending_status'
  | 'normal_body_mismatch_recovery_post_send_pending_invalid'
  | 'normal_body_mismatch_recovery_post_send_checkpoint_missing'
  | 'normal_body_mismatch_recovery_post_send_checkpoint_invalid'
  | 'normal_body_mismatch_recovery_post_send_checkpoint_fingerprint_mismatch'
  | 'normal_body_mismatch_recovery_post_send_baseline_unavailable'
  | 'normal_body_mismatch_recovery_post_send_local_missing'
  | 'normal_body_mismatch_recovery_post_send_local_changed'
  | 'normal_body_mismatch_recovery_post_send_push_blocked'
  | 'normal_body_mismatch_recovery_post_send_intent_exists'
  | 'normal_body_mismatch_recovery_post_send_cancelled'
  | 'normal_body_mismatch_recovery_post_send_pull_already_running'
  | 'normal_body_mismatch_recovery_post_send_pull_failed'
  | 'normal_body_mismatch_recovery_post_send_pull_malformed'
  | 'normal_body_mismatch_recovery_post_send_sequence_invalid'
  | 'normal_body_mismatch_recovery_post_send_pending_changed_during_pull'
  | 'normal_body_mismatch_recovery_post_send_metadata_changed_during_pull'
  | 'normal_body_mismatch_recovery_post_send_checkpoint_changed_during_pull'
  | 'normal_body_mismatch_recovery_post_send_baseline_changed_during_pull'
  | 'normal_body_mismatch_recovery_post_send_cursor_changed_during_pull'
  | 'normal_body_mismatch_recovery_post_send_state_changed'
  | 'normal_body_mismatch_recovery_post_send_remote_missing'
  | 'normal_body_mismatch_recovery_post_send_remote_tombstone'
  | 'normal_body_mismatch_recovery_post_send_remote_revision_mismatch'
  | 'normal_body_mismatch_recovery_post_send_remote_sequence_mismatch'
  | 'normal_body_mismatch_recovery_post_send_remote_updated_at_mismatch'
  | 'normal_body_mismatch_recovery_post_send_remote_payload_mismatch'
  | 'normal_body_mismatch_recovery_post_send_target_classification_unexpected'
  | 'normal_body_mismatch_recovery_post_send_rebuild_failed'
  | 'normal_body_mismatch_recovery_post_send_baseline_candidate_invalid'
  | 'normal_body_mismatch_recovery_post_send_cursor_candidate_invalid'
  | 'normal_body_mismatch_recovery_post_send_unknown'

export interface DayMemoBodyMismatchRecoveryPostSendResult {
  safety: DayMemoBodyMismatchRecoveryPostSendSafety
  date: string | null
  operationMode: 'body_mismatch_recovery' | 'local_only_recovery' | null
  pendingStatus: 'recovery_required' | null
  operationResultSnapshotVerified: boolean
  operationResultSnapshotState: 'missing' | 'stale' | 'consumed' | 'verified'
  metadataState: 'unconfirmed' | 'changed' | 'verified'
  pendingState: 'unconfirmed' | 'changed' | 'verified'
  checkpointState: 'unconfirmed' | 'missing' | 'invalid' | 'changed' | 'verified'
  localFresh: boolean
  remoteActive: boolean
  revisionMatched: boolean
  changeSequenceMatched: boolean
  remoteUpdatedAtMatched: boolean
  payloadMatched: boolean
  targetResolved: boolean
  fullPullMaxSequence: number | null
  currentCursor: number | null
  candidateCursor: number | null
  currentBaselineCount: number
  candidateBaselineCount: number
  unresolvedCount: number
  unresolvedClassifications: Record<string, DayMemoNormalDifferenceClassification>
  candidateBaselineStatus: 'recovery_required' | null
  candidateBaselineConfirmedAt: null
  candidateNormalSyncReady: false
  pendingLifecycleCandidate: 'clear_after_atomic_save' | null
  snapshotCreated: boolean
  fullPullCount: 0 | 1
  persistentStateChanged: false
  rpcSent: false
  checkedAt: string
  nextAction: string
}

export interface DayMemoBodyMismatchRecoveryPostSendSnapshot {
  date: string
  operationMode: 'body_mismatch_recovery' | 'local_only_recovery'
  operationId: string
  pendingFingerprint: string
  pendingStatus: 'recovery_required'
  metadataRaw: string
  sourceMetadataFingerprint: string
  workspaceId: string
  authUserId: string
  sourceCheckpointFingerprint: string
  sourceBaselineFingerprint: string
  sourceBaselineCount: number
  sourceCursor: number
  localStorageSerialized: string
  localFingerprint: string
  operationResultSnapshotToken: string
  operationResultRequestFingerprint: string
  operationResultPayloadFingerprint: string
  postSendRevision: number
  postSendChangeSequence: number
  postSendServerUpdatedAt: string
  currentRemoteFingerprint: string
  currentRemoteRevision: number
  currentRemoteChangeSequence: number
  currentRemoteUpdatedAt: string
  fullPullFingerprint: string
  fullPullMaxSequence: number
  unresolvedClassifications: Record<string, DayMemoNormalDifferenceClassification>
  candidateMetadata: DayMemoSyncMetadataV5
  candidateMetadataFingerprint: string
  candidateBaselineFingerprint: string
  candidateCursor: number
  candidateBaselineStatus: 'recovery_required'
  candidateBaselineConfirmedAt: null
  candidateNormalSyncReady: false
  pendingLifecycleCandidate: 'clear_after_atomic_save'
  checkedAt: string
  runId: number
  snapshotToken: string
}

export type DayMemoBodyMismatchRecoveryPostSendSnapshotAvailability =
  | 'none'
  | 'ready'
  | 'stale_metadata'
  | 'stale_pending'
  | 'stale_checkpoint'
  | 'stale_baseline'
  | 'stale_cursor'
  | 'stale_local'
  | 'stale_workspace'
  | 'stale_authentication'
  | 'stale_token'
  | 'consumed'
  | 'candidate_invalid'
  | 'blocked'
  | 'unknown'

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  authUserId: string | null
  connection: SyncConnection | null
  getOperationResultSnapshot: () => DayMemoSavedOperationResultSnapshot | null
  consumeOperationResultSnapshot: (snapshotToken: string) => boolean
  getOperationResultSnapshotToken: () => string | null
  inspectOperationResultSnapshotAvailability: () => 'missing' | 'consumed' | 'stale' | 'ready'
}

function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right) }
function canonicalFingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalFingerprint).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalFingerprint(child)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}
function connectionEligible(connection: SyncConnection | null): connection is SyncConnection & { workspaceId: string } {
  return Boolean(connection && isUuid(connection.workspaceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}
function validPending(value: unknown): value is DayMemoBodyMismatchRecoveryPendingOperationV5 | DayMemoLocalOnlyRecoveryPendingOperationV5 {
  if (!value || typeof value !== 'object') return false
  const pending = value as Partial<DayMemoBodyMismatchRecoveryPendingOperationV5 | DayMemoLocalOnlyRecoveryPendingOperationV5>
  const baseValid = pending.operationMode === 'body_mismatch_recovery'
    ? Number(pending.baseRevision) >= 1 && Number(pending.baseChangeSequence) >= 1
      && pending.baseRemoteState === 'active' && typeof pending.baseRemoteUpdatedAt === 'string'
    : pending.operationMode === 'local_only_recovery' && pending.baseRevision === 0
      && pending.baseChangeSequence === 0 && pending.baseRemoteState === 'missing' && pending.baseRemoteUpdatedAt === null
  return pending.kind === 'upsert' && baseValid
    && pending.status === 'recovery_required' && typeof pending.date === 'string' && isUuid(pending.operationId ?? '')
    && Number.isSafeInteger(pending.baseRevision) && Number.isSafeInteger(pending.baseChangeSequence)
    && typeof pending.preparedLocalUpdatedAt === 'string' && !Number.isNaN(Date.parse(pending.preparedLocalUpdatedAt))
}
function remoteFingerprint(record: RemoteDayMemoRecord): string {
  return JSON.stringify({ entityId: record.entityId, revision: record.revision, changeSequence: record.changeSequence,
    serverUpdatedAt: record.serverUpdatedAt, deletedAt: record.deletedAt, payload: record.payload })
}
function nextAction(safety: DayMemoBodyMismatchRecoveryPostSendSafety): string {
  if (safety === 'normal_body_mismatch_recovery_post_send_ready') {
    return '保存済みoperation結果とcurrent remoteの一致、未解決差異、baseline・cursor候補を確認しました。永続保存は次Phaseで行います。'
  }
  if (['normal_body_mismatch_recovery_post_send_no_operation_result_snapshot',
    'normal_body_mismatch_recovery_post_send_snapshot_stale',
    'normal_body_mismatch_recovery_post_send_snapshot_consumed',
    'normal_body_mismatch_recovery_post_send_snapshot_token_mismatch'].includes(safety)) {
    return 'operation結果snapshotが利用できません。永続状態を確認後、B-3f5e4d0aのread-only取得を明示的にやり直してください。'
  }
  if (['normal_body_mismatch_recovery_post_send_checkpoint_missing',
    'normal_body_mismatch_recovery_post_send_checkpoint_invalid',
    'normal_body_mismatch_recovery_post_send_checkpoint_fingerprint_mismatch'].includes(safety)) {
    return '永続metadataのrecovery checkpointを一致確認できません。再取得を繰り返さず、checkpoint状態を確認してください。'
  }
  return '永続状態を変更せず停止しました。表示された前提状態を安全に確認してください。'
}

export function useDayMemoBodyMismatchRecoveryPostSendVerification(input: Input) {
  const { dayMemos, isConfigured, isSignedIn, authUserId, connection,
    getOperationResultSnapshot, consumeOperationResultSnapshot, getOperationResultSnapshotToken,
    inspectOperationResultSnapshotAvailability } = input
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<DayMemoBodyMismatchRecoveryPostSendResult | null>(null)
  const snapshotRef = useRef<DayMemoBodyMismatchRecoveryPostSendSnapshot | null>(null)
  const consumedSnapshotTokenRef = useRef<string | null>(null)
  const inFlightRef = useRef(false)
  const runIdRef = useRef(0)
  const latestRef = useRef({ dayMemos, isConfigured, isSignedIn, authUserId, connection })
  latestRef.current = { dayMemos, isConfigured, isSignedIn, authUserId, connection }
  const eligible = Boolean(isConfigured && isSignedIn && isUuid(authUserId) && connectionEligible(connection)
    && getOperationResultSnapshot())

  const finish = useCallback((safety: DayMemoBodyMismatchRecoveryPostSendSafety,
    values: Partial<DayMemoBodyMismatchRecoveryPostSendResult> = {}) => {
    const next: DayMemoBodyMismatchRecoveryPostSendResult = {
      safety, date: null, operationMode: null, pendingStatus: null, operationResultSnapshotVerified: false,
      operationResultSnapshotState: 'missing', metadataState: 'unconfirmed', pendingState: 'unconfirmed',
      checkpointState: 'unconfirmed',
      localFresh: false, remoteActive: false, revisionMatched: false, changeSequenceMatched: false,
      remoteUpdatedAtMatched: false, payloadMatched: false, targetResolved: false,
      fullPullMaxSequence: null, currentCursor: null, candidateCursor: null, currentBaselineCount: 0,
      candidateBaselineCount: 0, unresolvedCount: 0, unresolvedClassifications: {},
      candidateBaselineStatus: null, candidateBaselineConfirmedAt: null, candidateNormalSyncReady: false,
      pendingLifecycleCandidate: null, snapshotCreated: false, fullPullCount: 0,
      persistentStateChanged: false, rpcSent: false, checkedAt: new Date().toISOString(),
      nextAction: nextAction(safety), ...values,
    }
    setResult(next)
    if (!next.snapshotCreated) { snapshotRef.current = null; consumedSnapshotTokenRef.current = null }
    return next
  }, [])

  const check = useCallback(async () => {
    if (inFlightRef.current || checking) { finish('normal_body_mismatch_recovery_post_send_pull_already_running'); return }
    const operationSnapshot = getOperationResultSnapshot()
    if (!operationSnapshot) {
      const availability = inspectOperationResultSnapshotAvailability()
      if (availability === 'consumed') {
        finish('normal_body_mismatch_recovery_post_send_snapshot_consumed', { operationResultSnapshotState: 'consumed' })
      } else if (availability === 'stale') {
        finish('normal_body_mismatch_recovery_post_send_snapshot_stale', { operationResultSnapshotState: 'stale' })
      } else finish('normal_body_mismatch_recovery_post_send_no_operation_result_snapshot')
      return
    }
    if (!['body_mismatch_recovery', 'local_only_recovery'].includes(operationSnapshot.operationMode)
      || operationSnapshot.resultStatus !== 'applied' || operationSnapshot.conflict
      || operationSnapshot.postSendState !== 'active' || operationSnapshot.resultDeletedAt !== null
      || !isUuid(operationSnapshot.operationId) || !Number.isSafeInteger(operationSnapshot.postSendRevision)
      || operationSnapshot.postSendRevision < 1 || !Number.isSafeInteger(operationSnapshot.postSendChangeSequence)
      || operationSnapshot.postSendChangeSequence < 1
      || Number.isNaN(Date.parse(operationSnapshot.postSendServerUpdatedAt))
      || Number.isNaN(Date.parse(operationSnapshot.operationCreatedAt))
      || !operationSnapshot.requestFingerprint || !operationSnapshot.resultPayloadFingerprint
      || !operationSnapshot.snapshotToken || operationSnapshot.runId < 1) {
      finish('normal_body_mismatch_recovery_post_send_snapshot_stale', { operationResultSnapshotState: 'stale' }); return
    }
    if (!isConfigured || !supabaseClient) {
      finish('normal_body_mismatch_recovery_post_send_configuration_unavailable'); return
    }
    if (!isSignedIn || !isUuid(authUserId)) {
      finish('normal_body_mismatch_recovery_post_send_authentication_unavailable'); return
    }
    if (!connectionEligible(connection) || connection.workspaceId !== operationSnapshot.workspaceId
      || operationSnapshot.authUserId !== authUserId) {
      finish('normal_body_mismatch_recovery_post_send_workspace_mismatch'); return
    }
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const stored = readDayMemoStorageSnapshot(window.localStorage)
    if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata)) {
      finish('normal_body_mismatch_recovery_post_send_metadata_invalid', { metadataState: 'changed' }); return
    }
    const metadata = loaded.metadata
    const pending = metadata.pendingOperation
    if (!pending) { finish('normal_body_mismatch_recovery_post_send_pending_missing', { pendingState: 'changed' }); return }
    if (pending.kind !== 'upsert' || !['body_mismatch_recovery', 'local_only_recovery'].includes(pending.operationMode)) {
      finish('normal_body_mismatch_recovery_post_send_wrong_operation_mode', { pendingState: 'changed' }); return
    }
    if (pending.status !== 'recovery_required') {
      finish('normal_body_mismatch_recovery_post_send_wrong_pending_status', { pendingState: 'changed' }); return
    }
    if (!validPending(pending) || fingerprintDayMemoRecoveryPending(pending) !== operationSnapshot.pendingFingerprint
      || pending.operationId !== operationSnapshot.operationId || pending.date !== operationSnapshot.date
      || pending.operationMode !== operationSnapshot.operationMode) {
      finish('normal_body_mismatch_recovery_post_send_pending_invalid', { pendingState: 'changed' }); return
    }
    const common = { date: pending.date, operationMode: pending.operationMode,
      pendingStatus: 'recovery_required' as const, currentCursor: metadata.lastPulledChangeSequence,
      currentBaselineCount: Object.keys(metadata.baselines).length }
    if (loaded.raw !== operationSnapshot.metadataRaw || metadata.workspaceId !== connection.workspaceId) {
      finish('normal_body_mismatch_recovery_post_send_snapshot_stale', { ...common,
        operationResultSnapshotState: 'stale', metadataState: 'changed', pendingState: 'verified' }); return
    }
    if (metadata.pushBlock) { finish('normal_body_mismatch_recovery_post_send_push_blocked', common); return }
    if (Object.keys(metadata.localDeleteIntents).length) { finish('normal_body_mismatch_recovery_post_send_intent_exists', common); return }
    if (metadata.baselineStatus !== 'recovery_required' || metadata.baselineConfirmedAt !== null
      || !Number.isSafeInteger(metadata.lastPulledChangeSequence) || metadata.lastPulledChangeSequence < 0) {
      finish('normal_body_mismatch_recovery_post_send_checkpoint_invalid', { ...common,
        operationResultSnapshotState: 'verified', metadataState: 'verified', pendingState: 'verified', checkpointState: 'invalid' }); return
    }
    if (!Object.keys(metadata.baselines).length) {
      finish('normal_body_mismatch_recovery_post_send_checkpoint_missing', { ...common,
        operationResultSnapshotState: 'verified', metadataState: 'verified', pendingState: 'verified', checkpointState: 'missing' }); return
    }
    if (fingerprintDayMemoRecoveryCheckpoint(metadata) !== operationSnapshot.checkpointFingerprint) {
      finish('normal_body_mismatch_recovery_post_send_checkpoint_fingerprint_mismatch', { ...common,
        operationResultSnapshotState: 'verified', metadataState: 'verified', pendingState: 'verified', checkpointState: 'changed' }); return
    }
    if (stored.status !== 'ready' || stored.serialized !== operationSnapshot.localStorageSerialized
      || !same(stored.memos, dayMemos) || !stored.memos.every(isStoredDayMemo)) {
      finish('normal_body_mismatch_recovery_post_send_local_changed', common); return
    }
    const targets = stored.memos.filter((memo) => memo.date === pending.date)
    if (targets.length !== 1) { finish('normal_body_mismatch_recovery_post_send_local_missing', common); return }
    const local = targets[0]
    const localFingerprint = canonicalDayMemoPayloadFingerprint(local)
    if (local.updatedAt !== pending.preparedLocalUpdatedAt || localFingerprint !== operationSnapshot.localFingerprint
      || localFingerprint !== operationSnapshot.resultPayloadFingerprint) {
      finish('normal_body_mismatch_recovery_post_send_local_changed', common); return
    }
    const confirmed = window.confirm([
      `対象日：${pending.date}`,
      '取得済みoperation結果とcurrent remoteを完全full pullで照合します。',
      '全未解決差異とbaseline・cursor候補を再構築します。',
      'metadata、pending、baseline、cursorは保存しません。自動再試行はありません。',
      '実行しますか？',
    ].join('\n'))
    if (!confirmed) { finish('normal_body_mismatch_recovery_post_send_cancelled', common); return }
    if (!consumeOperationResultSnapshot(operationSnapshot.snapshotToken)) {
      const currentToken = getOperationResultSnapshotToken()
      finish(currentToken && currentToken !== operationSnapshot.snapshotToken
        ? 'normal_body_mismatch_recovery_post_send_snapshot_token_mismatch'
        : 'normal_body_mismatch_recovery_post_send_snapshot_consumed', { ...common,
        operationResultSnapshotState: currentToken ? 'stale' : 'consumed', metadataState: 'verified',
        pendingState: 'verified', checkpointState: 'verified' }); return
    }
    const runId = ++runIdRef.current
    inFlightRef.current = true; setChecking(true); setResult(null); snapshotRef.current = null
    consumedSnapshotTokenRef.current = null
    try {
      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, connection.workspaceId,
        () => runIdRef.current === runId).catch(() => null)
      if (!pulled || pulled.status !== 'complete') {
        const safety = pulled?.status === 'validation_error' || pulled?.status === 'limit_reached'
          ? 'normal_body_mismatch_recovery_post_send_pull_malformed'
          : 'normal_body_mismatch_recovery_post_send_pull_failed'
        finish(safety, { ...common, fullPullCount: 1 }); return
      }
      if (!Number.isSafeInteger(pulled.maxChangeSequence)
        || pulled.maxChangeSequence < metadata.lastPulledChangeSequence
        || pulled.maxChangeSequence < operationSnapshot.postSendChangeSequence) {
        finish('normal_body_mismatch_recovery_post_send_sequence_invalid', { ...common,
          fullPullCount: 1, fullPullMaxSequence: pulled.maxChangeSequence }); return
      }
      const latest = latestRef.current
      const afterLoaded = loadDayMemoSyncMetadataAny(window.localStorage)
      const afterStored = readDayMemoStorageSnapshot(window.localStorage)
      if (runIdRef.current !== runId || !latest.isConfigured || !latest.isSignedIn
        || latest.authUserId !== authUserId || !connectionEligible(latest.connection)
        || latest.connection.workspaceId !== connection.workspaceId || afterLoaded.status !== 'ready'
        || !isDayMemoSyncMetadataV5(afterLoaded.metadata) || afterStored.status !== 'ready') {
        finish('normal_body_mismatch_recovery_post_send_state_changed', { ...common, fullPullCount: 1 }); return
      }
      if (!validPending(afterLoaded.metadata.pendingOperation)
        || fingerprintDayMemoRecoveryPending(afterLoaded.metadata.pendingOperation) !== fingerprintDayMemoRecoveryPending(pending)) {
        finish('normal_body_mismatch_recovery_post_send_pending_changed_during_pull', { ...common, fullPullCount: 1 }); return
      }
      if (fingerprintDayMemoBaselines(afterLoaded.metadata) !== fingerprintDayMemoBaselines(metadata)) {
        finish('normal_body_mismatch_recovery_post_send_baseline_changed_during_pull', { ...common, fullPullCount: 1 }); return
      }
      if (afterLoaded.metadata.lastPulledChangeSequence !== metadata.lastPulledChangeSequence) {
        finish('normal_body_mismatch_recovery_post_send_cursor_changed_during_pull', { ...common, fullPullCount: 1 }); return
      }
      if (fingerprintDayMemoRecoveryCheckpoint(afterLoaded.metadata) !== fingerprintDayMemoRecoveryCheckpoint(metadata)) {
        finish('normal_body_mismatch_recovery_post_send_checkpoint_changed_during_pull', { ...common, fullPullCount: 1 }); return
      }
      if (afterLoaded.raw !== loaded.raw) {
        finish('normal_body_mismatch_recovery_post_send_metadata_changed_during_pull', { ...common, fullPullCount: 1 }); return
      }
      if (afterStored.serialized !== stored.serialized || !same(latest.dayMemos, afterStored.memos)) {
        finish('normal_body_mismatch_recovery_post_send_local_changed', { ...common, fullPullCount: 1 }); return
      }
      const remoteByDate = new Map(pulled.records.map((record) => [record.entityId, record]))
      if (remoteByDate.size !== pulled.records.length) {
        finish('normal_body_mismatch_recovery_post_send_pull_malformed', { ...common, fullPullCount: 1 }); return
      }
      const remote = remoteByDate.get(pending.date)
      if (!remote) { finish('normal_body_mismatch_recovery_post_send_remote_missing', { ...common, fullPullCount: 1 }); return }
      if (remote.deletedAt !== null || !remote.payload) {
        finish('normal_body_mismatch_recovery_post_send_remote_tombstone', { ...common, fullPullCount: 1 }); return
      }
      if (remote.revision !== operationSnapshot.postSendRevision) {
        finish('normal_body_mismatch_recovery_post_send_remote_revision_mismatch', { ...common, fullPullCount: 1 }); return
      }
      if (remote.changeSequence !== operationSnapshot.postSendChangeSequence) {
        finish('normal_body_mismatch_recovery_post_send_remote_sequence_mismatch', { ...common, fullPullCount: 1 }); return
      }
      if (remote.serverUpdatedAt !== operationSnapshot.postSendServerUpdatedAt) {
        finish('normal_body_mismatch_recovery_post_send_remote_updated_at_mismatch', { ...common, fullPullCount: 1 }); return
      }
      const currentRemotePayloadFingerprint = canonicalDayMemoPayloadFingerprint(remote.payload)
      if (currentRemotePayloadFingerprint !== operationSnapshot.resultPayloadFingerprint
        || currentRemotePayloadFingerprint !== localFingerprint) {
        finish('normal_body_mismatch_recovery_post_send_remote_payload_mismatch', { ...common, fullPullCount: 1 }); return
      }
      const localByDate = new Map(afterStored.memos.map((memo) => [memo.date, memo]))
      const targetClassification = classifyDayMemoNormalDifference(local, remote, metadata.baselines[pending.date] ?? null)
      if (targetClassification !== 'exact_match_baseline_missing') {
        finish('normal_body_mismatch_recovery_post_send_target_classification_unexpected', { ...common, fullPullCount: 1 }); return
      }
      const dates = [...new Set([...localByDate.keys(), ...remoteByDate.keys(), ...Object.keys(metadata.baselines)])].sort()
      const classifications = new Map(dates.map((date) => [date, classifyDayMemoNormalDifference(
        localByDate.get(date) ?? null, remoteByDate.get(date) ?? null, metadata.baselines[date] ?? null)]))
      const invalid = [...classifications.values()].some((value) =>
        ['active_tombstone_mismatch', 'revision_lineage_mismatch', 'unknown'].includes(value))
      if (invalid) { finish('normal_body_mismatch_recovery_post_send_rebuild_failed', { ...common, fullPullCount: 1 }); return }
      const baselines: DayMemoSyncMetadataV5['baselines'] = { ...metadata.baselines,
        [pending.date]: { date: pending.date, remoteRevision: remote.revision,
          remoteChangeSequence: remote.changeSequence, remoteUpdatedAt: remote.payload.updatedAt,
          baselineLocalUpdatedAt: local.updatedAt, deletedAt: null } }
      const candidateMetadata: DayMemoSyncMetadataV5 = { ...metadata, baselines,
        lastPulledChangeSequence: pulled.maxChangeSequence, baselineStatus: 'recovery_required',
        baselineConfirmedAt: null, pendingOperation: null }
      if (!isDayMemoSyncMetadataV5(candidateMetadata)) {
        finish('normal_body_mismatch_recovery_post_send_baseline_candidate_invalid', { ...common, fullPullCount: 1 }); return
      }
      const reconstructed = new Map(dates.map((date) => [date, classifyDayMemoNormalDifference(
        localByDate.get(date) ?? null, remoteByDate.get(date) ?? null, baselines[date] ?? null)]))
      if (reconstructed.get(pending.date) !== 'exact_match_baseline_confirmed') {
        finish('normal_body_mismatch_recovery_post_send_baseline_candidate_invalid', { ...common, fullPullCount: 1 }); return
      }
      const unresolvedClassifications = Object.fromEntries([...reconstructed.entries()].filter(([, value]) =>
        value !== 'exact_match_baseline_confirmed'))
      if (pulled.maxChangeSequence < metadata.lastPulledChangeSequence) {
        finish('normal_body_mismatch_recovery_post_send_cursor_candidate_invalid', { ...common, fullPullCount: 1 }); return
      }
      const checkedAt = new Date().toISOString()
      const values = { ...common, operationResultSnapshotVerified: true, localFresh: true, remoteActive: true,
        operationResultSnapshotState: 'verified' as const, metadataState: 'verified' as const,
        pendingState: 'verified' as const, checkpointState: 'verified' as const,
        revisionMatched: true, changeSequenceMatched: true, remoteUpdatedAtMatched: true, payloadMatched: true,
        targetResolved: true, fullPullMaxSequence: pulled.maxChangeSequence, candidateCursor: pulled.maxChangeSequence,
        candidateBaselineCount: Object.keys(baselines).length,
        unresolvedCount: Object.keys(unresolvedClassifications).length, unresolvedClassifications,
        candidateBaselineStatus: 'recovery_required' as const, candidateBaselineConfirmedAt: null,
        candidateNormalSyncReady: false as const, pendingLifecycleCandidate: 'clear_after_atomic_save' as const,
        snapshotCreated: true, fullPullCount: 1 as const, checkedAt }
      const ready = finish('normal_body_mismatch_recovery_post_send_ready', values)
      const snapshotToken = `${runId}:${checkedAt}`
      snapshotRef.current = { date: pending.date, operationMode: pending.operationMode,
        operationId: pending.operationId, pendingFingerprint: fingerprintDayMemoRecoveryPending(pending), pendingStatus: 'recovery_required',
        metadataRaw: loaded.raw, sourceMetadataFingerprint: canonicalFingerprint(metadata),
        workspaceId: connection.workspaceId, authUserId,
        sourceCheckpointFingerprint: fingerprintDayMemoRecoveryCheckpoint(metadata),
        sourceBaselineFingerprint: fingerprintDayMemoBaselines(metadata), sourceBaselineCount: Object.keys(metadata.baselines).length,
        sourceCursor: metadata.lastPulledChangeSequence, localStorageSerialized: stored.serialized,
        localFingerprint, operationResultSnapshotToken: operationSnapshot.snapshotToken,
        operationResultRequestFingerprint: operationSnapshot.requestFingerprint,
        operationResultPayloadFingerprint: operationSnapshot.resultPayloadFingerprint,
        postSendRevision: operationSnapshot.postSendRevision,
        postSendChangeSequence: operationSnapshot.postSendChangeSequence,
        postSendServerUpdatedAt: operationSnapshot.postSendServerUpdatedAt,
        currentRemoteFingerprint: remoteFingerprint(remote), currentRemoteRevision: remote.revision,
        currentRemoteChangeSequence: remote.changeSequence, currentRemoteUpdatedAt: remote.serverUpdatedAt,
        fullPullFingerprint: JSON.stringify(pulled.records), fullPullMaxSequence: pulled.maxChangeSequence,
        unresolvedClassifications, candidateMetadata,
        candidateMetadataFingerprint: canonicalFingerprint(candidateMetadata),
        candidateBaselineFingerprint: fingerprintDayMemoBaselines(candidateMetadata), candidateCursor: pulled.maxChangeSequence,
        candidateBaselineStatus: 'recovery_required', candidateBaselineConfirmedAt: null,
        candidateNormalSyncReady: false, pendingLifecycleCandidate: 'clear_after_atomic_save',
        checkedAt: ready.checkedAt, runId, snapshotToken }
    } catch {
      finish('normal_body_mismatch_recovery_post_send_unknown', { ...common, fullPullCount: 1 })
    } finally {
      if (runIdRef.current === runId) setChecking(false)
      inFlightRef.current = false
    }
  }, [authUserId, checking, connection, consumeOperationResultSnapshot, dayMemos, finish,
    getOperationResultSnapshot, getOperationResultSnapshotToken, inspectOperationResultSnapshotAvailability,
    isConfigured, isSignedIn])

  const discard = useCallback(() => {
    runIdRef.current += 1; snapshotRef.current = null; consumedSnapshotTokenRef.current = null
    setResult(null); setChecking(false)
  }, [])
  const inspectSnapshotAvailability = useCallback((): DayMemoBodyMismatchRecoveryPostSendSnapshotAvailability => {
    const current = snapshotRef.current
    if (!current) return 'none'
    if (consumedSnapshotTokenRef.current === current.snapshotToken) return 'consumed'
    if (getOperationResultSnapshotToken() !== current.operationResultSnapshotToken) return 'stale_token'
    const latest = latestRef.current
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const stored = readDayMemoStorageSnapshot(window.localStorage)
    if (!latest.isConfigured || !latest.isSignedIn || latest.authUserId !== current.authUserId) return 'stale_authentication'
    if (!connectionEligible(latest.connection) || latest.connection.workspaceId !== current.workspaceId) return 'stale_workspace'
    if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata)) return 'stale_metadata'
    if (loaded.metadata.workspaceId !== current.workspaceId) return 'stale_workspace'
    if (!validPending(loaded.metadata.pendingOperation)
      || fingerprintDayMemoRecoveryPending(loaded.metadata.pendingOperation) !== current.pendingFingerprint) return 'stale_pending'
    if (fingerprintDayMemoBaselines(loaded.metadata) !== current.sourceBaselineFingerprint
      || Object.keys(loaded.metadata.baselines).length !== current.sourceBaselineCount) return 'stale_baseline'
    if (loaded.metadata.lastPulledChangeSequence !== current.sourceCursor) return 'stale_cursor'
    if (fingerprintDayMemoRecoveryCheckpoint(loaded.metadata) !== current.sourceCheckpointFingerprint) return 'stale_checkpoint'
    if (loaded.raw !== current.metadataRaw
      || canonicalFingerprint(loaded.metadata) !== current.sourceMetadataFingerprint) return 'stale_metadata'
    if (loaded.metadata.pushBlock !== null || Object.keys(loaded.metadata.localDeleteIntents).length > 0) return 'blocked'
    if (stored.status !== 'ready' || stored.serialized !== current.localStorageSerialized
      || !same(latest.dayMemos, stored.memos)) return 'stale_local'
    if (!isDayMemoSyncMetadataV5(current.candidateMetadata)
      || current.candidateMetadata.pendingOperation !== null
      || current.candidateMetadata.lastPulledChangeSequence !== current.candidateCursor
      || fingerprintDayMemoBaselines(current.candidateMetadata) !== current.candidateBaselineFingerprint
      || canonicalFingerprint(current.candidateMetadata) !== current.candidateMetadataFingerprint) return 'candidate_invalid'
    return 'ready'
  }, [getOperationResultSnapshotToken])
  const getReadySnapshot = useCallback(() => {
    const current = snapshotRef.current
    return current && inspectSnapshotAvailability() === 'ready' ? { ...current } : null
  }, [inspectSnapshotAvailability])
  const consumeReadySnapshot = useCallback((snapshotToken: string) => {
    if (snapshotRef.current?.snapshotToken !== snapshotToken || consumedSnapshotTokenRef.current === snapshotToken) return false
    consumedSnapshotTokenRef.current = snapshotToken
    return true
  }, [])
  return { eligible, checking, result, check, discard, getReadySnapshot,
    consumeReadySnapshot, inspectSnapshotAvailability }
}
