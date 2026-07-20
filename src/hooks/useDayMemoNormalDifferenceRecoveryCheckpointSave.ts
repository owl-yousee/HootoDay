import { useCallback, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords } from '../utils/dayMemoSyncPull'
import { isDayMemoSyncMetadataV5, loadDayMemoSyncMetadataAny, replaceDayMemoSyncMetadataV2 } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import { classifyDayMemoNormalDifference, type DayMemoNormalDifferenceClassification } from './useDayMemoNormalDifferenceRecoveryPlan'
import type { DayMemoNormalDifferenceCheckpointSnapshot } from './useDayMemoNormalDifferenceRecoveryCheckpointCheck'

export type DayMemoNormalDifferenceCheckpointSaveSafety =
  | 'normal_difference_checkpoint_save_ready' | 'normal_difference_checkpoint_saved'
  | 'normal_difference_checkpoint_result_missing' | 'normal_difference_checkpoint_verification_stale'
  | 'normal_difference_checkpoint_state_changed' | 'normal_difference_checkpoint_cursor_invalid'
  | 'normal_difference_checkpoint_candidates_changed' | 'normal_difference_checkpoint_unresolved_changed'
  | 'normal_difference_checkpoint_pending_remaining' | 'normal_difference_checkpoint_intent_remaining'
  | 'normal_difference_checkpoint_push_blocked' | 'normal_difference_checkpoint_workspace_mismatch'
  | 'normal_difference_checkpoint_metadata_invalid' | 'normal_difference_checkpoint_remote_incomplete'
  | 'normal_difference_checkpoint_validator_failed' | 'normal_difference_checkpoint_persistence_failed'
  | 'normal_difference_checkpoint_rollback_succeeded' | 'normal_difference_checkpoint_rollback_failed'
  | 'normal_difference_checkpoint_unsupported' | 'normal_difference_checkpoint_state_unknown'

export interface DayMemoNormalDifferenceCheckpointSaveResult {
  succeeded: boolean
  safety: DayMemoNormalDifferenceCheckpointSaveSafety
  beforeCursor: number | null
  fullPullMaxSequence: number | null
  afterCursor: number | null
  beforeBaselineCount: number
  afterBaselineCount: number
  addedBaselineCount: number
  baselineStatus: 'recovery_required' | null
  baselineConfirmedAtNull: boolean
  unresolvedCount: number
  unresolvedCounts: Partial<Record<DayMemoNormalDifferenceClassification, number>>
  unresolvedReconstructable: boolean
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
  getReadySnapshot: () => DayMemoNormalDifferenceCheckpointSnapshot | null
  consumeReadySnapshot: () => void
  adoptVerifiedMetadata: (metadata: DayMemoSyncMetadataV5) => void
}

function connectionIsEligible(connection: SyncConnection | null): connection is SyncConnection & { workspaceId: string } {
  return Boolean(connection && isUuid(connection.workspaceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}

function recordsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function nextAction(safety: DayMemoNormalDifferenceCheckpointSaveSafety): string {
  if (safety === 'normal_difference_checkpoint_saved') return 'checkpointを保存しました。通常同期は再開せず、未解決差異を後続Phaseで1件ずつ確認してください。'
  if (safety === 'normal_difference_checkpoint_rollback_succeeded') return '保存前metadataへ戻しました。自動再試行せず、checkpoint条件を最初から確認してください。'
  if (safety === 'normal_difference_checkpoint_rollback_failed') return 'metadata状態を証明できません。操作せず同期状態を確認してください。'
  return '保存していません。checkpointのread-only確認からやり直してください。'
}

export function useDayMemoNormalDifferenceRecoveryCheckpointSave({ dayMemos, isConfigured, isSignedIn, connection, reactMetadata, getReadySnapshot, consumeReadySnapshot, adoptVerifiedMetadata }: Input) {
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<DayMemoNormalDifferenceCheckpointSaveResult | null>(null)
  const inFlightRef = useRef(false)
  const snapshot = getReadySnapshot()
  const eligible = Boolean(isConfigured && isSignedIn && supabaseClient && connectionIsEligible(connection))
  const canSave = Boolean(eligible && !saving && snapshot?.result.safety === 'normal_difference_checkpoint_ready'
    && snapshot.result.unresolvedReconstructable && snapshot.result.candidateBaselineStatus === 'recovery_required'
    && snapshot.result.candidateBaselineConfirmedAtNull && snapshot.result.exactBaselineCandidateCount > 0)

  const finish = useCallback((safety: DayMemoNormalDifferenceCheckpointSaveSafety, values: Partial<DayMemoNormalDifferenceCheckpointSaveResult> = {}) => {
    setResult({ succeeded: false, beforeCursor: null, fullPullMaxSequence: null, afterCursor: null,
      beforeBaselineCount: 0, afterBaselineCount: 0, addedBaselineCount: 0, baselineStatus: null,
      baselineConfirmedAtNull: false, unresolvedCount: 0, unresolvedCounts: {}, unresolvedReconstructable: false,
      normalSyncReady: false, metadataSaved: false, readBackSucceeded: false, validatorPassed: false,
      rollbackAttempted: false, rollbackSucceeded: false, rpcSent: false, checkedAt: new Date().toISOString(),
      ...values, safety, nextAction: nextAction(safety) })
  }, [])

  const save = useCallback(async () => {
    if (inFlightRef.current || !canSave || !supabaseClient || !connectionIsEligible(connection)) return
    const ready = getReadySnapshot()
    if (!ready || ready.result.safety !== 'normal_difference_checkpoint_ready') {
      finish('normal_difference_checkpoint_result_missing'); return
    }
    const accepted = window.confirm(`完全一致baseline候補${ready.result.exactBaselineCandidateCount}件を保存し、cursorを${ready.result.metadataCursor}から${ready.result.candidateCursor}へ更新します。未解決差異${ready.result.unresolvedCount}件はrecovery_requiredのまま残り、通常同期readyにはなりません。Supabase送信は行いません。保存しますか？`)
    if (!accepted) return
    inFlightRef.current = true; setSaving(true); setResult(null)
    try {
      const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
      const stored = readDayMemoStorageSnapshot(window.localStorage)
      const base = { beforeCursor: ready.result.metadataCursor, fullPullMaxSequence: ready.result.fullPullMaxSequence,
        afterCursor: ready.result.candidateCursor, beforeBaselineCount: ready.result.baselineCount,
        afterBaselineCount: ready.result.candidateBaselineCount,
        addedBaselineCount: ready.result.exactBaselineCandidateCount, baselineStatus: 'recovery_required' as const,
        baselineConfirmedAtNull: true, unresolvedCount: ready.result.unresolvedCount,
        unresolvedCounts: ready.result.unresolvedCounts, unresolvedReconstructable: ready.result.unresolvedReconstructable }
      if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata) || stored.status !== 'ready') {
        finish('normal_difference_checkpoint_metadata_invalid', base); return
      }
      const metadata = loaded.metadata
      if (!reactMetadata || JSON.stringify(reactMetadata) !== loaded.raw) {
        finish('normal_difference_checkpoint_state_changed', base); return
      }
      if (loaded.raw !== ready.metadataRaw || stored.serialized !== ready.localStorageSerialized
        || JSON.stringify(stored.memos) !== JSON.stringify(dayMemos)) {
        finish('normal_difference_checkpoint_verification_stale', base); return
      }
      if (metadata.workspaceId !== connection.workspaceId || ready.workspaceId !== connection.workspaceId) {
        finish('normal_difference_checkpoint_workspace_mismatch', base); return
      }
      if (metadata.pendingOperation) { finish('normal_difference_checkpoint_pending_remaining', base); return }
      if (Object.keys(metadata.localDeleteIntents).length) { finish('normal_difference_checkpoint_intent_remaining', base); return }
      if (metadata.pushBlock) { finish('normal_difference_checkpoint_push_blocked', base); return }
      if (metadata.lastPulledChangeSequence !== ready.result.metadataCursor) {
        finish('normal_difference_checkpoint_cursor_invalid', base); return
      }
      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, connection.workspaceId)
      if (pulled.status !== 'complete') { finish('normal_difference_checkpoint_remote_incomplete', base); return }
      const afterPullMetadata = loadDayMemoSyncMetadataAny(window.localStorage)
      const afterPullLocal = readDayMemoStorageSnapshot(window.localStorage)
      if (afterPullMetadata.status !== 'ready' || afterPullMetadata.raw !== loaded.raw
        || afterPullLocal.status !== 'ready' || afterPullLocal.serialized !== stored.serialized
        || JSON.stringify(dayMemos) !== JSON.stringify(stored.memos)) {
        finish('normal_difference_checkpoint_state_changed', base); return
      }
      if (pulled.maxChangeSequence !== ready.result.fullPullMaxSequence || !recordsEqual(pulled.records, ready.remoteRecords)) {
        const changedLocalByDate = new Map(stored.memos.map((memo) => [memo.date, memo]))
        const changedRemoteByDate = new Map(pulled.records.map((record) => [record.entityId, record]))
        const changedDates = [...new Set([...changedLocalByDate.keys(), ...changedRemoteByDate.keys(), ...Object.keys(metadata.baselines)])]
        const changedClassifications = new Map(changedDates.map((date) => [date, classifyDayMemoNormalDifference(
          changedLocalByDate.get(date) ?? null, changedRemoteByDate.get(date) ?? null, metadata.baselines[date] ?? null)]))
        const expectedCandidateDates = Object.keys(ready.candidateMetadata.baselines).filter((date) => !metadata.baselines[date]).sort()
        const actualCandidateDates = changedDates.filter((date) => changedClassifications.get(date) === 'exact_match_baseline_missing').sort()
        const actualUnresolved = Object.fromEntries(changedDates.filter((date) => {
          const classification = changedClassifications.get(date)
          return classification !== 'exact_match_baseline_confirmed' && classification !== 'exact_match_baseline_missing'
        }).map((date) => [date, changedClassifications.get(date)]))
        const safety = JSON.stringify(actualCandidateDates) !== JSON.stringify(expectedCandidateDates)
          ? 'normal_difference_checkpoint_candidates_changed'
          : JSON.stringify(actualUnresolved) !== JSON.stringify(ready.unresolvedClassifications)
            ? 'normal_difference_checkpoint_unresolved_changed'
            : 'normal_difference_checkpoint_verification_stale'
        finish(safety, base); return
      }
      const candidate = ready.candidateMetadata
      if (candidate.lastPulledChangeSequence !== pulled.maxChangeSequence || candidate.baselineStatus !== 'recovery_required'
        || candidate.baselineConfirmedAt !== null || candidate.pendingOperation !== metadata.pendingOperation
        || JSON.stringify(candidate.localDeleteIntents) !== JSON.stringify(metadata.localDeleteIntents)
        || JSON.stringify(candidate.pushBlock) !== JSON.stringify(metadata.pushBlock)
        || !isDayMemoSyncMetadataV5(candidate)) {
        finish('normal_difference_checkpoint_validator_failed', base); return
      }
      const localByDate = new Map(stored.memos.map((memo) => [memo.date, memo]))
      const remoteByDate = new Map(pulled.records.map((record) => [record.entityId, record]))
      const dates = [...new Set([...localByDate.keys(), ...remoteByDate.keys(), ...Object.keys(candidate.baselines)])]
      const reconstructed = dates.map((date) => ({ date, classification: classifyDayMemoNormalDifference(
        localByDate.get(date) ?? null, remoteByDate.get(date) ?? null, candidate.baselines[date] ?? null) }))
      const unresolvedStillMatch = ready.result.unresolvedDates.every((date) => {
        const item = reconstructed.find((value) => value.date === date)
        return item?.classification === ready.unresolvedClassifications[date] && !candidate.baselines[date]
      })
      if (!unresolvedStillMatch || reconstructed.filter((item) => item.classification !== 'exact_match_baseline_confirmed').length !== ready.result.unresolvedCount) {
        finish('normal_difference_checkpoint_unresolved_changed', base); return
      }
      const saveResult = replaceDayMemoSyncMetadataV2(window.localStorage, candidate, loaded.raw)
      if (saveResult !== 'saved') {
        finish(saveResult === 'rollback_failed' ? 'normal_difference_checkpoint_rollback_failed'
          : saveResult === 'write_failed' || saveResult === 'readback_failed'
            ? 'normal_difference_checkpoint_rollback_succeeded' : 'normal_difference_checkpoint_persistence_failed', {
          ...base, rollbackAttempted: saveResult === 'rollback_failed' || saveResult === 'write_failed' || saveResult === 'readback_failed',
          rollbackSucceeded: saveResult === 'write_failed' || saveResult === 'readback_failed',
        }); return
      }
      const readBack = loadDayMemoSyncMetadataAny(window.localStorage)
      const expectedRaw = JSON.stringify(candidate)
      if (readBack.status !== 'ready' || !isDayMemoSyncMetadataV5(readBack.metadata) || readBack.raw !== expectedRaw) {
        const rollback = replaceDayMemoSyncMetadataV2(window.localStorage, metadata, expectedRaw)
        finish(rollback === 'saved' ? 'normal_difference_checkpoint_rollback_succeeded' : 'normal_difference_checkpoint_rollback_failed', {
          ...base, metadataSaved: rollback !== 'saved', rollbackAttempted: true, rollbackSucceeded: rollback === 'saved',
        }); return
      }
      adoptVerifiedMetadata(readBack.metadata)
      consumeReadySnapshot()
      finish('normal_difference_checkpoint_saved', { ...base, succeeded: true, metadataSaved: true,
        readBackSucceeded: true, validatorPassed: true, unresolvedReconstructable: true })
    } finally { inFlightRef.current = false; setSaving(false) }
  }, [adoptVerifiedMetadata, canSave, connection, consumeReadySnapshot, dayMemos, finish, getReadySnapshot, reactMetadata])

  const discard = useCallback(() => setResult(null), [])
  return { eligible, canSave, saving, result, save, discard }
}
