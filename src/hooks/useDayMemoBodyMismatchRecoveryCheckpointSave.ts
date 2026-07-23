import { useCallback, useRef, useState } from 'react'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoBodyMismatchRecoveryPendingOperationV5, DayMemoLocalOnlyRecoveryPendingOperationV5, DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { isStoredDayMemo, readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { canonicalDayMemoPayloadFingerprint } from '../utils/dayMemoSyncOperationResult'
import { DAY_MEMO_SYNC_STORAGE_KEY, isDayMemoSyncMetadataV5, loadDayMemoSyncMetadataAny, replaceDayMemoSyncMetadataV2 } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import type { DayMemoNormalDifferenceClassification } from './useDayMemoNormalDifferenceRecoveryPlan'
import type { DayMemoBodyMismatchRecoveryPostSendSnapshot, DayMemoBodyMismatchRecoveryPostSendSnapshotAvailability } from './useDayMemoBodyMismatchRecoveryPostSendVerification'
import {
  fingerprintDayMemoBaselines,
  fingerprintDayMemoRecoveryCheckpoint,
  fingerprintDayMemoRecoveryPending,
} from './useDayMemoSavedOperationResultRead'

export type DayMemoBodyMismatchRecoveryCheckpointSaveSafety =
  | 'normal_body_mismatch_recovery_checkpoint_saved'
  | 'normal_body_mismatch_recovery_checkpoint_candidate_missing'
  | 'normal_body_mismatch_recovery_checkpoint_candidate_stale'
  | 'normal_body_mismatch_recovery_checkpoint_candidate_consumed'
  | 'normal_body_mismatch_recovery_checkpoint_candidate_token_mismatch'
  | 'normal_body_mismatch_recovery_checkpoint_configuration_unavailable'
  | 'normal_body_mismatch_recovery_checkpoint_authentication_unavailable'
  | 'normal_body_mismatch_recovery_checkpoint_workspace_mismatch'
  | 'normal_body_mismatch_recovery_checkpoint_metadata_changed'
  | 'normal_body_mismatch_recovery_checkpoint_pending_changed'
  | 'normal_body_mismatch_recovery_checkpoint_checkpoint_changed'
  | 'normal_body_mismatch_recovery_checkpoint_baseline_changed'
  | 'normal_body_mismatch_recovery_checkpoint_cursor_changed'
  | 'normal_body_mismatch_recovery_checkpoint_local_changed'
  | 'normal_body_mismatch_recovery_checkpoint_push_blocked'
  | 'normal_body_mismatch_recovery_checkpoint_intent_exists'
  | 'normal_body_mismatch_recovery_checkpoint_candidate_invalid'
  | 'normal_body_mismatch_recovery_checkpoint_compare_write_conflict'
  | 'normal_body_mismatch_recovery_checkpoint_save_failed'
  | 'normal_body_mismatch_recovery_checkpoint_readback_failed'
  | 'normal_body_mismatch_recovery_checkpoint_readback_mismatch'
  | 'normal_body_mismatch_recovery_checkpoint_rollback_succeeded'
  | 'normal_body_mismatch_recovery_checkpoint_rollback_failed'
  | 'normal_body_mismatch_recovery_checkpoint_post_save_uncertain'
  | 'normal_body_mismatch_recovery_checkpoint_save_already_running'
  | 'normal_body_mismatch_recovery_checkpoint_cancelled'
  | 'normal_body_mismatch_recovery_checkpoint_unknown'

export interface DayMemoBodyMismatchRecoveryCheckpointSaveResult {
  safety: DayMemoBodyMismatchRecoveryCheckpointSaveSafety
  succeeded: boolean
  date: string | null
  operationMode: 'body_mismatch_recovery' | 'local_only_recovery' | null
  verificationSnapshotVerified: boolean
  candidateMetadataVerified: boolean
  sourceMetadataVerified: boolean
  beforeBaselineCount: number
  afterBaselineCount: number
  beforeCursor: number | null
  afterCursor: number | null
  baselineStatus: 'recovery_required' | 'confirmed' | null
  baselineConfirmedAt: string | null
  pendingCleared: boolean
  metadataSave: 'none' | 'succeeded' | 'failed'
  readBack: 'none' | 'succeeded' | 'failed' | 'mismatch'
  rollback: 'not_run' | 'succeeded' | 'failed'
  dayMemoChanged: false
  supabaseSent: false
  fullPullCount: 0
  automaticRetry: false
  unresolvedCount: number
  unresolvedClassifications: Record<string, DayMemoNormalDifferenceClassification>
  normalSyncReady: boolean
  verificationSnapshotDiscarded: boolean
  checkedAt: string
  nextAction: string
}

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  authUserId: string | null
  connection: SyncConnection | null
  reactMetadata: DayMemoSyncMetadataV5 | null
  getReadySnapshot: () => DayMemoBodyMismatchRecoveryPostSendSnapshot | null
  consumeReadySnapshot: (snapshotToken: string) => boolean
  inspectSnapshotAvailability: () => DayMemoBodyMismatchRecoveryPostSendSnapshotAvailability
  discardVerificationResult: () => void
  adoptVerifiedMetadata: (metadata: DayMemoSyncMetadataV5) => void
}

function connectionEligible(connection: SyncConnection | null): connection is SyncConnection & { workspaceId: string } {
  return Boolean(connection && isUuid(connection.workspaceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}
function validRecoveryPending(value: unknown): value is DayMemoBodyMismatchRecoveryPendingOperationV5 | DayMemoLocalOnlyRecoveryPendingOperationV5 {
  if (!value || typeof value !== 'object') return false
  const pending = value as Partial<DayMemoBodyMismatchRecoveryPendingOperationV5 | DayMemoLocalOnlyRecoveryPendingOperationV5>
  const baseValid = pending.operationMode === 'body_mismatch_recovery'
    ? Number(pending.baseRevision) >= 1 && Number(pending.baseChangeSequence) >= 1
      && pending.baseRemoteState === 'active' && typeof pending.baseRemoteUpdatedAt === 'string'
    : pending.operationMode === 'local_only_recovery' && pending.baseRevision === 0 && pending.baseChangeSequence === 0
      && pending.baseRemoteState === 'missing' && pending.baseRemoteUpdatedAt === null
  return pending.kind === 'upsert' && baseValid
    && pending.status === 'recovery_required' && typeof pending.date === 'string'
    && isUuid(pending.operationId ?? '') && Number.isSafeInteger(pending.baseRevision)
    && Number.isSafeInteger(pending.baseChangeSequence)
    && typeof pending.preparedLocalUpdatedAt === 'string' && !Number.isNaN(Date.parse(pending.preparedLocalUpdatedAt))
}
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right) }
function rollbackCandidate(candidateRaw: string, original: DayMemoSyncMetadataV5): 'succeeded' | 'failed' | 'not_safe' {
  try {
    if (window.localStorage.getItem(DAY_MEMO_SYNC_STORAGE_KEY) !== candidateRaw) return 'not_safe'
  } catch { return 'failed' }
  return replaceDayMemoSyncMetadataV2(window.localStorage, original, candidateRaw) === 'saved' ? 'succeeded' : 'failed'
}
function nextAction(safety: DayMemoBodyMismatchRecoveryCheckpointSaveSafety): string {
  if (safety === 'normal_body_mismatch_recovery_checkpoint_saved') {
    return '復旧結果をbaseline・cursorへ保存し、対象pendingをクリアしました。recovery_requiredを維持し、残る差異を1件ずつ確認してください。'
  }
  if (safety === 'normal_body_mismatch_recovery_checkpoint_cancelled') return '保存をキャンセルしました。永続変更はありません。'
  if (safety === 'normal_body_mismatch_recovery_checkpoint_rollback_succeeded') {
    return '保存前metadataへのrollbackを確認しました。自動再試行せず、B-3f5e4d0aから再確認してください。'
  }
  if (safety === 'normal_body_mismatch_recovery_checkpoint_rollback_failed'
    || safety === 'normal_body_mismatch_recovery_checkpoint_post_save_uncertain') {
    return 'metadata状態を証明できません。新しい同期操作を行わず、保存状態を確認してください。'
  }
  return 'metadataを保存していません。B-3f5e4d0aからread-only確認をやり直してください。'
}

export function useDayMemoBodyMismatchRecoveryCheckpointSave(input: Input) {
  const { dayMemos, isConfigured, isSignedIn, authUserId, connection, reactMetadata,
    getReadySnapshot, consumeReadySnapshot, inspectSnapshotAvailability,
    discardVerificationResult, adoptVerifiedMetadata } = input
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<DayMemoBodyMismatchRecoveryCheckpointSaveResult | null>(null)
  const resultRef = useRef<DayMemoBodyMismatchRecoveryCheckpointSaveResult | null>(null)
  const inFlightRef = useRef(false)
  const runIdRef = useRef(0)
  const snapshot = getReadySnapshot()
  const candidateAvailability = inspectSnapshotAvailability()
  const canSave = Boolean(isConfigured && isSignedIn && isUuid(authUserId) && connectionEligible(connection)
    && snapshot && snapshot.pendingLifecycleCandidate === 'clear_after_atomic_save'
    && isDayMemoSyncMetadataV5(snapshot.candidateMetadata) && !saving)

  const finish = useCallback((safety: DayMemoBodyMismatchRecoveryCheckpointSaveSafety,
    values: Partial<DayMemoBodyMismatchRecoveryCheckpointSaveResult> = {}) => {
    const next: DayMemoBodyMismatchRecoveryCheckpointSaveResult = { safety, succeeded: false, date: null, operationMode: null,
      verificationSnapshotVerified: false, candidateMetadataVerified: false, sourceMetadataVerified: false,
      beforeBaselineCount: 0, afterBaselineCount: 0, beforeCursor: null, afterCursor: null,
      baselineStatus: null, baselineConfirmedAt: null, pendingCleared: false,
      metadataSave: 'none', readBack: 'none', rollback: 'not_run', dayMemoChanged: false,
      supabaseSent: false, fullPullCount: 0, automaticRetry: false, unresolvedCount: 0,
      unresolvedClassifications: {}, normalSyncReady: false, verificationSnapshotDiscarded: false,
      checkedAt: new Date().toISOString(), nextAction: nextAction(safety), ...values }
    resultRef.current = next
    setResult(next)
    return next
  }, [])

  const save = useCallback((options: { skipConfirmation?: boolean } = {}) => {
    if (inFlightRef.current || saving) {
      finish('normal_body_mismatch_recovery_checkpoint_save_already_running'); return
    }
    const ready = getReadySnapshot()
    if (!ready) {
      const availability = inspectSnapshotAvailability()
      finish(availability === 'consumed' ? 'normal_body_mismatch_recovery_checkpoint_candidate_consumed'
        : availability === 'none' ? 'normal_body_mismatch_recovery_checkpoint_candidate_missing'
          : availability === 'candidate_invalid' ? 'normal_body_mismatch_recovery_checkpoint_candidate_invalid'
            : 'normal_body_mismatch_recovery_checkpoint_candidate_stale'); return
    }
    const base = { date: ready.date, operationMode: ready.operationMode,
      beforeBaselineCount: ready.sourceBaselineCount,
      afterBaselineCount: Object.keys(ready.candidateMetadata.baselines).length,
      beforeCursor: ready.sourceCursor, afterCursor: ready.candidateCursor,
      baselineStatus: ready.candidateBaselineStatus, baselineConfirmedAt: ready.candidateBaselineConfirmedAt,
      unresolvedCount: Object.keys(ready.unresolvedClassifications).length,
      unresolvedClassifications: ready.unresolvedClassifications }
    if (!isConfigured) { finish('normal_body_mismatch_recovery_checkpoint_configuration_unavailable', base); return }
    if (!isSignedIn || !isUuid(authUserId) || ready.authUserId !== authUserId) {
      finish('normal_body_mismatch_recovery_checkpoint_authentication_unavailable', base); return
    }
    if (!connectionEligible(connection) || connection.workspaceId !== ready.workspaceId) {
      finish('normal_body_mismatch_recovery_checkpoint_workspace_mismatch', base); return
    }
    if (ready.pendingLifecycleCandidate !== 'clear_after_atomic_save'
      || ready.candidateMetadata.pendingOperation !== null
      || ready.candidateMetadata.baselineStatus !== ready.candidateBaselineStatus
      || ready.candidateMetadata.baselineConfirmedAt !== ready.candidateBaselineConfirmedAt
      || ready.candidateMetadata.lastPulledChangeSequence !== ready.candidateCursor
      || fingerprintDayMemoBaselines(ready.candidateMetadata) !== ready.candidateBaselineFingerprint
      || !isDayMemoSyncMetadataV5(ready.candidateMetadata)) {
      finish('normal_body_mismatch_recovery_checkpoint_candidate_invalid', base); return
    }
    const accepted = options.skipConfirmation || window.confirm([
      `対象日：${ready.date}`,
      `baseline候補：${ready.sourceBaselineCount}件から${Object.keys(ready.candidateMetadata.baselines).length}件へ更新`,
      `cursor：${ready.sourceCursor}から${ready.candidateCursor}へ更新`,
      '対象のrecovery pendingを同じmetadata更新でクリアします。',
      `未解決差異${Object.keys(ready.unresolvedClassifications).length}件、baselineStatusは${ready.candidateBaselineStatus}として保存します。`,
      'Supabase送信とfull pullは行わず、metadataだけを原子的に保存します。自動再試行はありません。',
      '保存しますか？',
    ].join('\n'))
    if (!accepted) { finish('normal_body_mismatch_recovery_checkpoint_cancelled', base); return }

    const runId = ++runIdRef.current
    inFlightRef.current = true; setSaving(true); setResult(null)
    let snapshotConsumed = false
    try {
      const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
      const stored = readDayMemoStorageSnapshot(window.localStorage)
      if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata)) {
        finish('normal_body_mismatch_recovery_checkpoint_metadata_changed', base); return
      }
      const metadata = loaded.metadata
      if (!reactMetadata || !same(reactMetadata, metadata) || loaded.raw !== ready.metadataRaw) {
        finish('normal_body_mismatch_recovery_checkpoint_metadata_changed', base); return
      }
      if (metadata.workspaceId !== ready.workspaceId || metadata.workspaceId !== connection.workspaceId) {
        finish('normal_body_mismatch_recovery_checkpoint_workspace_mismatch', base); return
      }
      if (!validRecoveryPending(metadata.pendingOperation)
        || fingerprintDayMemoRecoveryPending(metadata.pendingOperation) !== ready.pendingFingerprint
        || metadata.pendingOperation.operationId !== ready.operationId
        || metadata.pendingOperation.date !== ready.date) {
        finish('normal_body_mismatch_recovery_checkpoint_pending_changed', base); return
      }
      if (fingerprintDayMemoRecoveryCheckpoint(metadata) !== ready.sourceCheckpointFingerprint) {
        finish('normal_body_mismatch_recovery_checkpoint_checkpoint_changed', base); return
      }
      if (fingerprintDayMemoBaselines(metadata) !== ready.sourceBaselineFingerprint
        || Object.keys(metadata.baselines).length !== ready.sourceBaselineCount) {
        finish('normal_body_mismatch_recovery_checkpoint_baseline_changed', base); return
      }
      if (metadata.lastPulledChangeSequence !== ready.sourceCursor) {
        finish('normal_body_mismatch_recovery_checkpoint_cursor_changed', base); return
      }
      if (metadata.pushBlock) { finish('normal_body_mismatch_recovery_checkpoint_push_blocked', base); return }
      if (Object.keys(metadata.localDeleteIntents).length) {
        finish('normal_body_mismatch_recovery_checkpoint_intent_exists', base); return
      }
      if (stored.status !== 'ready' || stored.serialized !== ready.localStorageSerialized
        || !same(stored.memos, dayMemos) || !stored.memos.every(isStoredDayMemo)) {
        finish('normal_body_mismatch_recovery_checkpoint_local_changed', base); return
      }
      const targets = stored.memos.filter((memo) => memo.date === ready.date)
      if (targets.length !== 1 || canonicalDayMemoPayloadFingerprint(targets[0]) !== ready.localFingerprint) {
        finish('normal_body_mismatch_recovery_checkpoint_local_changed', base); return
      }
      const candidate = ready.candidateMetadata
      const expectedCandidate: DayMemoSyncMetadataV5 = { ...metadata, baselines: candidate.baselines,
        lastPulledChangeSequence: ready.candidateCursor, baselineStatus: ready.candidateBaselineStatus,
        baselineConfirmedAt: ready.candidateBaselineConfirmedAt, pendingOperation: null }
      if (!isDayMemoSyncMetadataV5(candidate) || candidate.workspaceId !== metadata.workspaceId
        || candidate.pendingOperation !== null || candidate.pushBlock !== metadata.pushBlock
        || !same(candidate.localDeleteIntents, metadata.localDeleteIntents)
        || candidate.baselineStatus !== ready.candidateBaselineStatus
        || candidate.baselineConfirmedAt !== ready.candidateBaselineConfirmedAt
        || candidate.lastPulledChangeSequence !== ready.candidateCursor
        || fingerprintDayMemoBaselines(candidate) !== ready.candidateBaselineFingerprint
        || !same(candidate, expectedCandidate)) {
        finish('normal_body_mismatch_recovery_checkpoint_candidate_invalid', base); return
      }
      if (!consumeReadySnapshot(ready.snapshotToken)) {
        finish('normal_body_mismatch_recovery_checkpoint_candidate_token_mismatch', base); return
      }
      snapshotConsumed = true
      const saveResult = replaceDayMemoSyncMetadataV2(window.localStorage, candidate, loaded.raw)
      if (saveResult !== 'saved') {
        const rollbackAttempted = saveResult === 'write_failed' || saveResult === 'readback_failed' || saveResult === 'rollback_failed'
        finish(saveResult === 'stale' ? 'normal_body_mismatch_recovery_checkpoint_compare_write_conflict'
          : saveResult === 'rollback_failed' ? 'normal_body_mismatch_recovery_checkpoint_rollback_failed'
            : rollbackAttempted ? 'normal_body_mismatch_recovery_checkpoint_rollback_succeeded'
              : 'normal_body_mismatch_recovery_checkpoint_save_failed', {
          ...base, metadataSave: 'failed', readBack: saveResult === 'readback_failed' ? 'failed' : 'none',
          rollback: saveResult === 'rollback_failed' ? 'failed' : rollbackAttempted ? 'succeeded' : 'not_run',
          verificationSnapshotDiscarded: true,
        }); return
      }
      if (runIdRef.current !== runId) {
        finish('normal_body_mismatch_recovery_checkpoint_post_save_uncertain', { ...base,
          metadataSave: 'succeeded', verificationSnapshotDiscarded: true }); return
      }
      const readBack = loadDayMemoSyncMetadataAny(window.localStorage)
      const expectedRaw = JSON.stringify(candidate)
      if (readBack.status !== 'ready' || !isDayMemoSyncMetadataV5(readBack.metadata)) {
        const rollback = rollbackCandidate(expectedRaw, metadata)
        finish(rollback === 'succeeded' ? 'normal_body_mismatch_recovery_checkpoint_rollback_succeeded'
          : rollback === 'failed' ? 'normal_body_mismatch_recovery_checkpoint_rollback_failed'
            : 'normal_body_mismatch_recovery_checkpoint_post_save_uncertain', { ...base,
          metadataSave: rollback === 'succeeded' ? 'failed' : 'succeeded', readBack: 'failed',
          rollback: rollback === 'succeeded' ? 'succeeded' : rollback === 'failed' ? 'failed' : 'not_run',
          verificationSnapshotDiscarded: true }); return
      }
      if (readBack.raw !== expectedRaw || !same(readBack.metadata, candidate)
        || fingerprintDayMemoBaselines(readBack.metadata) !== ready.candidateBaselineFingerprint
        || readBack.metadata.lastPulledChangeSequence !== ready.candidateCursor
        || readBack.metadata.baselineStatus !== ready.candidateBaselineStatus
        || readBack.metadata.baselineConfirmedAt !== ready.candidateBaselineConfirmedAt
        || readBack.metadata.pendingOperation !== null) {
        const rollback = rollbackCandidate(expectedRaw, metadata)
        finish(rollback === 'succeeded' ? 'normal_body_mismatch_recovery_checkpoint_rollback_succeeded'
          : rollback === 'failed' ? 'normal_body_mismatch_recovery_checkpoint_rollback_failed'
            : 'normal_body_mismatch_recovery_checkpoint_post_save_uncertain', { ...base,
          metadataSave: rollback === 'succeeded' ? 'failed' : 'succeeded', readBack: 'mismatch',
          rollback: rollback === 'succeeded' ? 'succeeded' : rollback === 'failed' ? 'failed' : 'not_run',
          verificationSnapshotDiscarded: true }); return
      }
      adoptVerifiedMetadata(readBack.metadata)
      discardVerificationResult()
      finish('normal_body_mismatch_recovery_checkpoint_saved', { ...base, succeeded: true,
        verificationSnapshotVerified: true, candidateMetadataVerified: true, sourceMetadataVerified: true,
        pendingCleared: true, metadataSave: 'succeeded', readBack: 'succeeded', rollback: 'not_run',
        normalSyncReady: ready.candidateNormalSyncReady,
        verificationSnapshotDiscarded: true })
    } catch {
      finish('normal_body_mismatch_recovery_checkpoint_unknown', { ...base,
        verificationSnapshotDiscarded: snapshotConsumed })
    } finally {
      inFlightRef.current = false
      if (runIdRef.current === runId) setSaving(false)
    }
  }, [adoptVerifiedMetadata, authUserId, connection, consumeReadySnapshot, dayMemos,
    discardVerificationResult, finish, getReadySnapshot, inspectSnapshotAvailability,
    isConfigured, isSignedIn, reactMetadata, saving])

  const discard = useCallback(() => { resultRef.current = null; setResult(null) }, [])
  const getLatestResult = useCallback(() => resultRef.current, [])
  return { canSave, candidateAvailability, saving, result, save, discard, getLatestResult }
}
