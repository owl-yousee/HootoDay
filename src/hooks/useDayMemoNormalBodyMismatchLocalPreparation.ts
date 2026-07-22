import { useCallback, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoBodyMismatchRecoveryPendingOperationV5, DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { isStoredDayMemo, readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords } from '../utils/dayMemoSyncPull'
import { isDayMemoSyncMetadataV5, loadDayMemoSyncMetadataAny, replaceDayMemoSyncMetadataV2 } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import { createUuidV4 } from '../utils/uuid'
import { classifyDayMemoNormalDifference, remoteRecordMatchesConfirmedBaseline } from './useDayMemoNormalDifferenceRecoveryPlan'
import type { DayMemoNormalDifferenceCheckpointResult } from './useDayMemoNormalDifferenceRecoveryCheckpointCheck'
import type { DayMemoNormalBodyMismatchCandidateSnapshot } from './useDayMemoNormalBodyMismatchCandidate'

export type DayMemoNormalBodyMismatchLocalPreparationSafety =
  | 'normal_body_mismatch_local_prepare_ready' | 'normal_body_mismatch_local_prepared'
  | 'normal_body_mismatch_local_candidate_missing' | 'normal_body_mismatch_local_candidate_stale'
  | 'normal_body_mismatch_local_target_mismatch' | 'normal_body_mismatch_local_local_invalid'
  | 'normal_body_mismatch_local_remote_invalid' | 'normal_body_mismatch_local_remote_changed'
  | 'normal_body_mismatch_local_cursor_invalid' | 'normal_body_mismatch_local_workspace_mismatch'
  | 'normal_body_mismatch_local_pending_exists' | 'normal_body_mismatch_local_intent_exists'
  | 'normal_body_mismatch_local_push_blocked' | 'normal_body_mismatch_local_baseline_unexpected'
  | 'normal_body_mismatch_local_metadata_invalid' | 'normal_body_mismatch_local_persistence_failed'
  | 'normal_body_mismatch_local_rollback_succeeded' | 'normal_body_mismatch_local_rollback_failed'
  | 'normal_body_mismatch_local_prerequisite_missing' | 'normal_body_mismatch_local_unsupported'
  | 'normal_body_mismatch_local_state_unknown'

export interface DayMemoNormalBodyMismatchLocalPreparationResult {
  date: string | null
  candidate: 'local'
  succeeded: boolean
  safety: DayMemoNormalBodyMismatchLocalPreparationSafety
  candidateFresh: boolean
  remoteRechecked: boolean
  operationIdGenerated: boolean
  pendingCreated: boolean
  operationMode: 'body_mismatch_recovery' | null
  dayMemoChanged: false
  baselineChanged: false
  cursorChanged: false
  baselineStatus: 'recovery_required' | null
  normalSyncReady: false
  metadataSaved: boolean
  readBackSucceeded: boolean
  validatorPassed: boolean
  rollbackAttempted: boolean
  rollbackSucceeded: boolean
  rpcSent: false
  checkedAt: string
  nextAction: string
}

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  reactMetadata: DayMemoSyncMetadataV5 | null
  checkpointResult: DayMemoNormalDifferenceCheckpointResult | null
  getCandidateSnapshot: () => DayMemoNormalBodyMismatchCandidateSnapshot | null
  consumeCandidateSnapshot: () => void
  adoptVerifiedMetadata: (metadata: DayMemoSyncMetadataV5) => void
}

function connectionIsEligible(connection: SyncConnection | null): connection is SyncConnection & { workspaceId: string } {
  return Boolean(connection && isUuid(connection.workspaceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}

function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right) }

function nextAction(safety: DayMemoNormalBodyMismatchLocalPreparationSafety): string {
  if (safety === 'normal_body_mismatch_local_prepared') return '送信はまだ行っていません。後続Phaseで送信前の同期先確認を行ってください。'
  if (safety === 'normal_body_mismatch_local_rollback_succeeded') return '元の同期情報へ戻しました。自動再試行せず、候補確認からやり直してください。'
  if (safety === 'normal_body_mismatch_local_rollback_failed') return '同期情報を安全に復元できません。操作を止めて状態を確認してください。'
  return '準備していません。復旧checkpointと本文相違候補をもう一度確認してください。'
}

export function useDayMemoNormalBodyMismatchLocalPreparation({ dayMemos, isConfigured, isSignedIn, connection,
  reactMetadata, checkpointResult, getCandidateSnapshot, consumeCandidateSnapshot, adoptVerifiedMetadata }: Input) {
  const [preparing, setPreparing] = useState(false)
  const [result, setResult] = useState<DayMemoNormalBodyMismatchLocalPreparationResult | null>(null)
  const inFlightRef = useRef(false)
  const snapshot = getCandidateSnapshot()
  const eligible = Boolean(isConfigured && isSignedIn && supabaseClient && connectionIsEligible(connection)
    && snapshot?.candidate === 'local' && checkpointResult?.safety === 'normal_difference_checkpoint_unresolved_ready')

  const finish = useCallback((safety: DayMemoNormalBodyMismatchLocalPreparationSafety,
    values: Partial<DayMemoNormalBodyMismatchLocalPreparationResult> = {}) => {
    setResult({ date: null, candidate: 'local', succeeded: false, safety, candidateFresh: false, remoteRechecked: false,
      operationIdGenerated: false, pendingCreated: false, operationMode: null, dayMemoChanged: false,
      baselineChanged: false, cursorChanged: false, baselineStatus: null, normalSyncReady: false,
      metadataSaved: false, readBackSucceeded: false, validatorPassed: false, rollbackAttempted: false,
      rollbackSucceeded: false, rpcSent: false, checkedAt: new Date().toISOString(), nextAction: nextAction(safety), ...values })
  }, [])

  const prepare = useCallback(async () => {
    if (inFlightRef.current || !eligible || !supabaseClient || !connectionIsEligible(connection)) return
    const candidate = getCandidateSnapshot()
    if (!candidate || candidate.candidate !== 'local') { finish('normal_body_mismatch_local_candidate_missing'); return }
    const accepted = window.confirm(`${candidate.date} のlocal候補を同期先へ上書きする準備をします。新しいoperation IDとrecovery upsert pendingを作成しますが、この時点ではSupabaseへ送信せず、DayMemo・baseline・cursorは変更しません。baselineStatusはrecovery_requiredのままです。準備しますか？`)
    if (!accepted) return
    inFlightRef.current = true; setPreparing(true); setResult(null)
    try {
      const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
      const stored = readDayMemoStorageSnapshot(window.localStorage)
      const base = { date: candidate.date, candidateFresh: true, baselineStatus: 'recovery_required' as const }
      if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata) || stored.status !== 'ready' || !reactMetadata) {
        finish('normal_body_mismatch_local_metadata_invalid', base); return
      }
      const metadata = loaded.metadata
      if (loaded.raw !== candidate.metadataRaw || !same(reactMetadata, metadata)
        || stored.serialized !== candidate.localStorageSerialized || !same(dayMemos, stored.memos)) {
        finish('normal_body_mismatch_local_candidate_stale', base); return
      }
      if (metadata.workspaceId !== connection.workspaceId || candidate.workspaceId !== connection.workspaceId) {
        finish('normal_body_mismatch_local_workspace_mismatch', base); return
      }
      if (metadata.baselineStatus !== 'recovery_required' || metadata.baselineConfirmedAt !== null
        || checkpointResult?.safety !== 'normal_difference_checkpoint_unresolved_ready'
        || checkpointResult.normalSyncReady !== false || checkpointResult.unresolvedClassifications[candidate.date] !== 'body_mismatch') {
        finish('normal_body_mismatch_local_prerequisite_missing', base); return
      }
      if (metadata.pendingOperation) { finish('normal_body_mismatch_local_pending_exists', base); return }
      if (Object.keys(metadata.localDeleteIntents).length) { finish('normal_body_mismatch_local_intent_exists', base); return }
      if (metadata.pushBlock) { finish('normal_body_mismatch_local_push_blocked', base); return }
      const local = stored.memos.find((memo) => memo.date === candidate.date)
      if (!local || !isStoredDayMemo(local) || !same(local, candidate.localMemo)) {
        finish('normal_body_mismatch_local_local_invalid', base); return
      }
      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, connection.workspaceId).catch(() => null)
      if (!pulled || pulled.status !== 'complete') { finish('normal_body_mismatch_local_remote_invalid', base); return }
      const afterMetadata = loadDayMemoSyncMetadataAny(window.localStorage)
      const afterStored = readDayMemoStorageSnapshot(window.localStorage)
      if (afterMetadata.status !== 'ready' || afterMetadata.raw !== loaded.raw || afterStored.status !== 'ready'
        || afterStored.serialized !== stored.serialized || !same(dayMemos, stored.memos)) {
        finish('normal_body_mismatch_local_candidate_stale', base); return
      }
      if (pulled.maxChangeSequence !== metadata.lastPulledChangeSequence || candidate.cursor !== metadata.lastPulledChangeSequence) {
        finish('normal_body_mismatch_local_cursor_invalid', { ...base, remoteRechecked: true }); return
      }
      const remoteByDate = new Map(pulled.records.map((record) => [record.entityId, record]))
      if (remoteByDate.size !== pulled.records.length) { finish('normal_body_mismatch_local_remote_invalid', base); return }
      const remote = remoteByDate.get(candidate.date)
      if (!remote || remote.deletedAt !== null || !remote.payload || remote.payload.date !== candidate.date) {
        finish('normal_body_mismatch_local_remote_changed', { ...base, remoteRechecked: true }); return
      }
      if (!same(remote, candidate.remoteRecord)) {
        finish('normal_body_mismatch_local_remote_changed', { ...base, remoteRechecked: true }); return
      }
      const targetBaseline = metadata.baselines[candidate.date] ?? null
      if (targetBaseline && !remoteRecordMatchesConfirmedBaseline(remote, targetBaseline)) {
        finish('normal_body_mismatch_local_baseline_unexpected', base); return
      }
      const localByDate = new Map(stored.memos.map((memo) => [memo.date, memo]))
      const dates = [...new Set([...localByDate.keys(), ...remoteByDate.keys(), ...Object.keys(metadata.baselines)])].sort()
      const classifications = Object.fromEntries(dates.map((date) => [date, classifyDayMemoNormalDifference(
        localByDate.get(date) ?? null, remoteByDate.get(date) ?? null, metadata.baselines[date] ?? null)]))
      if (classifications[candidate.date] !== 'body_mismatch' || !same(classifications, candidate.classifications)
        || !same(checkpointResult.unresolvedClassifications, Object.fromEntries(checkpointResult.unresolvedDates.map((date) => [date, classifications[date]])))
        || Object.values(classifications).some((value) => value === 'revision_lineage_mismatch' || value === 'active_tombstone_mismatch' || value === 'unknown')) {
        finish('normal_body_mismatch_local_remote_changed', { ...base, remoteRechecked: true }); return
      }
      const operationId = createUuidV4()
      if (!operationId) { finish('normal_body_mismatch_local_unsupported', { ...base, remoteRechecked: true }); return }
      const preparedAt = new Date().toISOString()
      const pending: DayMemoBodyMismatchRecoveryPendingOperationV5 = { kind: 'upsert', operationMode: 'body_mismatch_recovery',
        status: 'prepared', operationId, date: candidate.date, baseRevision: remote.revision,
        baseChangeSequence: remote.changeSequence, baseRemoteUpdatedAt: remote.payload.updatedAt,
        baseRemoteState: 'active', preparedLocalUpdatedAt: local.updatedAt, preparedAt }
      const next: DayMemoSyncMetadataV5 = { ...metadata, pendingOperation: pending }
      if (!isDayMemoSyncMetadataV5(next) || !same(next.baselines, metadata.baselines)
        || next.lastPulledChangeSequence !== metadata.lastPulledChangeSequence || next.baselineStatus !== 'recovery_required'
        || next.baselineConfirmedAt !== null || !same(next.localDeleteIntents, metadata.localDeleteIntents)
        || !same(next.pushBlock, metadata.pushBlock)) {
        finish('normal_body_mismatch_local_metadata_invalid', { ...base, remoteRechecked: true, operationIdGenerated: true }); return
      }
      const expectedRaw = JSON.stringify(next)
      const saved = replaceDayMemoSyncMetadataV2(window.localStorage, next, loaded.raw)
      if (saved !== 'saved') {
        consumeCandidateSnapshot()
        finish(saved === 'rollback_failed' ? 'normal_body_mismatch_local_rollback_failed'
          : saved === 'write_failed' || saved === 'readback_failed' ? 'normal_body_mismatch_local_rollback_succeeded'
            : 'normal_body_mismatch_local_persistence_failed', { ...base, remoteRechecked: true,
          operationIdGenerated: true, validatorPassed: true,
          rollbackAttempted: ['rollback_failed', 'write_failed', 'readback_failed'].includes(saved),
          rollbackSucceeded: saved === 'write_failed' || saved === 'readback_failed' })
        return
      }
      const readBack = loadDayMemoSyncMetadataAny(window.localStorage)
      if (readBack.status !== 'ready' || !isDayMemoSyncMetadataV5(readBack.metadata) || readBack.raw !== expectedRaw) {
        const rollback = replaceDayMemoSyncMetadataV2(window.localStorage, metadata, expectedRaw)
        consumeCandidateSnapshot()
        finish(rollback === 'saved' ? 'normal_body_mismatch_local_rollback_succeeded' : 'normal_body_mismatch_local_rollback_failed', {
          ...base, remoteRechecked: true, operationIdGenerated: true, validatorPassed: true,
          metadataSaved: rollback !== 'saved', rollbackAttempted: true, rollbackSucceeded: rollback === 'saved' })
        return
      }
      adoptVerifiedMetadata(readBack.metadata)
      consumeCandidateSnapshot()
      finish('normal_body_mismatch_local_prepared', { ...base, succeeded: true, remoteRechecked: true,
        operationIdGenerated: true, pendingCreated: true, operationMode: 'body_mismatch_recovery',
        metadataSaved: true, readBackSucceeded: true, validatorPassed: true })
    } finally { inFlightRef.current = false; setPreparing(false) }
  }, [adoptVerifiedMetadata, checkpointResult, connection, consumeCandidateSnapshot, dayMemos, eligible, finish, getCandidateSnapshot, reactMetadata])

  const discard = useCallback(() => setResult(null), [])
  return { eligible, preparing, result, prepare, discard }
}
