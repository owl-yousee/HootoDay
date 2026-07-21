import { useCallback, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { isStoredDayMemo, readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords } from '../utils/dayMemoSyncPull'
import { isDayMemoSyncMetadataV5, loadDayMemoSyncMetadataAny } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import { classifyDayMemoNormalDifference, type DayMemoNormalDifferenceClassification } from './useDayMemoNormalDifferenceRecoveryPlan'

export type DayMemoSavedRecoveryStateSafety =
  | 'normal_difference_checkpoint_saved_state_ready'
  | 'normal_difference_checkpoint_saved_state_prerequisite_missing'
  | 'normal_difference_checkpoint_saved_state_metadata_invalid'
  | 'normal_difference_checkpoint_saved_state_pending_remaining'
  | 'normal_difference_checkpoint_saved_state_workspace_mismatch'
  | 'normal_difference_checkpoint_saved_state_pull_failed'
  | 'normal_difference_checkpoint_saved_state_pull_malformed'
  | 'normal_difference_checkpoint_saved_state_cursor_mismatch'
  | 'normal_difference_checkpoint_saved_state_baseline_mismatch'
  | 'normal_difference_checkpoint_saved_state_target_mismatch'
  | 'normal_difference_checkpoint_saved_state_unresolved_rebuild_failed'
  | 'normal_difference_checkpoint_saved_state_push_blocked'
  | 'normal_difference_checkpoint_saved_state_intent_conflict'
  | 'normal_difference_checkpoint_saved_state_state_changed'
  | 'normal_difference_checkpoint_saved_state_unknown'

export interface DayMemoSavedRecoveryStateResult {
  safety: DayMemoSavedRecoveryStateSafety
  metadataVersion: number | null
  metadataValid: boolean
  workspaceBound: boolean
  pendingAbsent: boolean
  cursor: number | null
  fullPullMaxSequence: number | null
  cursorMatched: boolean
  baselineCount: number
  baselineStatus: 'recovery_required' | null
  baselineConfirmedAtNull: boolean
  targetDate: string
  targetBaselineVerified: boolean
  targetLocalRemoteMatched: boolean
  targetResolved: boolean
  unresolvedCount: number
  unresolvedClassifications: Record<string, DayMemoNormalDifferenceClassification>
  normalSyncReady: false
  oneByOneRecoveryPossible: boolean
  nextRecommendedDate: string | null
  nextRecommendedClassification: DayMemoNormalDifferenceClassification | null
  persistentStateChanged: false
  rpcSent: false
  fullPullCount: 0 | 1
  automaticRetry: false
  checkedAt: string
  nextAction: string
}

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  reactMetadata: DayMemoSyncMetadataV5 | null
  targetDate: string
}

const RECOVERABLE = new Set<DayMemoNormalDifferenceClassification>([
  'exact_body_timestamp_mismatch', 'body_mismatch', 'local_only', 'remote_only_active', 'remote_only_tombstone',
])

function connectionEligible(connection: SyncConnection | null): connection is SyncConnection & { workspaceId: string } {
  return Boolean(connection && isUuid(connection.workspaceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}

function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right) }

function nextAction(safety: DayMemoSavedRecoveryStateSafety, nextDate: string | null): string {
  if (safety === 'normal_difference_checkpoint_saved_state_ready') {
    return nextDate ? `${nextDate}の差異を既存の1件ずつの復旧経路で確認してください。`
      : '未解決差異はありません。通常同期readyへの最終確認へ進めます。'
  }
  return '永続状態を変更せず、表示された安全停止理由を確認してください。'
}

export function useDayMemoSavedRecoveryStateCheck(input: Input) {
  const { dayMemos, isConfigured, isSignedIn, connection, reactMetadata, targetDate } = input
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<DayMemoSavedRecoveryStateResult | null>(null)
  const runIdRef = useRef(0)
  const inFlightRef = useRef(false)
  const latestRef = useRef({ dayMemos, isConfigured, isSignedIn, connection, reactMetadata })
  latestRef.current = { dayMemos, isConfigured, isSignedIn, connection, reactMetadata }
  const eligible = Boolean(isConfigured && isSignedIn && supabaseClient && connectionEligible(connection))

  const finish = useCallback((safety: DayMemoSavedRecoveryStateSafety,
    values: Partial<DayMemoSavedRecoveryStateResult> = {}) => {
    const nextDate = values.nextRecommendedDate ?? null
    setResult({ safety, metadataVersion: null, metadataValid: false, workspaceBound: false,
      pendingAbsent: false, cursor: null, fullPullMaxSequence: null, cursorMatched: false,
      baselineCount: 0, baselineStatus: null, baselineConfirmedAtNull: false,
      targetDate, targetBaselineVerified: false, targetLocalRemoteMatched: false, targetResolved: false,
      unresolvedCount: 0, unresolvedClassifications: {}, normalSyncReady: false,
      oneByOneRecoveryPossible: false, nextRecommendedDate: null, nextRecommendedClassification: null,
      persistentStateChanged: false, rpcSent: false, fullPullCount: 0, automaticRetry: false,
      checkedAt: new Date().toISOString(), ...values, nextAction: nextAction(safety, nextDate) })
  }, [targetDate])

  const check = useCallback(async () => {
    if (inFlightRef.current || checking) return
    if (!eligible || !supabaseClient || !connectionEligible(connection)) {
      finish('normal_difference_checkpoint_saved_state_prerequisite_missing'); return
    }
    const runId = ++runIdRef.current
    inFlightRef.current = true
    setChecking(true)
    setResult(null)
    try {
      const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
      const stored = readDayMemoStorageSnapshot(window.localStorage)
      if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata)
        || stored.status !== 'ready' || !stored.memos.every(isStoredDayMemo)) {
        finish('normal_difference_checkpoint_saved_state_metadata_invalid'); return
      }
      const metadata = loaded.metadata
      const common = { metadataVersion: 5, metadataValid: true,
        workspaceBound: metadata.workspaceId === connection.workspaceId,
        pendingAbsent: metadata.pendingOperation === null, cursor: metadata.lastPulledChangeSequence,
        baselineCount: Object.keys(metadata.baselines).length,
        baselineStatus: metadata.baselineStatus === 'recovery_required' ? 'recovery_required' as const : null,
        baselineConfirmedAtNull: metadata.baselineConfirmedAt === null }
      if (metadata.workspaceId !== connection.workspaceId) {
        finish('normal_difference_checkpoint_saved_state_workspace_mismatch', common); return
      }
      if (!reactMetadata || !same(reactMetadata, metadata) || !same(dayMemos, stored.memos)) {
        finish('normal_difference_checkpoint_saved_state_state_changed', common); return
      }
      if (metadata.pendingOperation !== null) {
        finish('normal_difference_checkpoint_saved_state_pending_remaining', common); return
      }
      if (metadata.pushBlock !== null) {
        finish('normal_difference_checkpoint_saved_state_push_blocked', common); return
      }
      if (Object.keys(metadata.localDeleteIntents).length > 0) {
        finish('normal_difference_checkpoint_saved_state_intent_conflict', common); return
      }
      if (metadata.baselineStatus !== 'recovery_required' || metadata.baselineConfirmedAt !== null
        || !Number.isSafeInteger(metadata.lastPulledChangeSequence) || metadata.lastPulledChangeSequence < 0
        || Object.keys(metadata.baselines).length === 0) {
        finish('normal_difference_checkpoint_saved_state_metadata_invalid', common); return
      }
      const targetLocals = stored.memos.filter((memo) => memo.date === targetDate)
      if (targetLocals.length !== 1 || !metadata.baselines[targetDate]) {
        finish('normal_difference_checkpoint_saved_state_target_mismatch', common); return
      }

      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, connection.workspaceId,
        () => runIdRef.current === runId).catch(() => null)
      if (!pulled) {
        finish('normal_difference_checkpoint_saved_state_pull_failed', { ...common, fullPullCount: 1 }); return
      }
      if (pulled.status !== 'complete') {
        finish(pulled.status === 'validation_error' || pulled.status === 'limit_reached'
          ? 'normal_difference_checkpoint_saved_state_pull_malformed'
          : 'normal_difference_checkpoint_saved_state_pull_failed', { ...common, fullPullCount: 1 }); return
      }

      const latest = latestRef.current
      const after = loadDayMemoSyncMetadataAny(window.localStorage)
      const afterStored = readDayMemoStorageSnapshot(window.localStorage)
      if (runIdRef.current !== runId || !latest.isConfigured || !latest.isSignedIn
        || !connectionEligible(latest.connection) || latest.connection.workspaceId !== connection.workspaceId
        || after.status !== 'ready' || after.raw !== loaded.raw || afterStored.status !== 'ready'
        || afterStored.serialized !== stored.serialized || !latest.reactMetadata
        || !same(latest.reactMetadata, metadata) || !same(latest.dayMemos, stored.memos)) {
        finish('normal_difference_checkpoint_saved_state_state_changed', { ...common, fullPullCount: 1 }); return
      }

      const remoteByDate = new Map(pulled.records.map((record) => [record.entityId, record]))
      const remoteCommon = { ...common, fullPullCount: 1 as const,
        fullPullMaxSequence: pulled.maxChangeSequence,
        cursorMatched: pulled.maxChangeSequence === metadata.lastPulledChangeSequence }
      if (remoteByDate.size !== pulled.records.length || !Number.isSafeInteger(pulled.maxChangeSequence)) {
        finish('normal_difference_checkpoint_saved_state_pull_malformed', remoteCommon); return
      }
      if (pulled.maxChangeSequence !== metadata.lastPulledChangeSequence) {
        finish('normal_difference_checkpoint_saved_state_cursor_mismatch', remoteCommon); return
      }

      const localByDate = new Map(stored.memos.map((memo) => [memo.date, memo]))
      const targetLocal = targetLocals[0]
      const targetRemote = remoteByDate.get(targetDate) ?? null
      const targetBaseline = metadata.baselines[targetDate]
      const targetClassification = classifyDayMemoNormalDifference(targetLocal, targetRemote, targetBaseline)
      if (!targetRemote || targetRemote.deletedAt !== null || !targetRemote.payload
        || targetBaseline.deletedAt !== null
        || targetBaseline.remoteRevision !== targetRemote.revision
        || targetBaseline.remoteChangeSequence !== targetRemote.changeSequence
        || targetBaseline.remoteUpdatedAt !== targetRemote.payload.updatedAt
        || targetBaseline.baselineLocalUpdatedAt !== targetLocal.updatedAt) {
        finish('normal_difference_checkpoint_saved_state_baseline_mismatch', remoteCommon); return
      }
      if (targetClassification !== 'exact_match_baseline_confirmed') {
        finish('normal_difference_checkpoint_saved_state_target_mismatch', remoteCommon); return
      }

      const dates = [...new Set([...localByDate.keys(), ...remoteByDate.keys(), ...Object.keys(metadata.baselines)])].sort()
      const classifications = Object.fromEntries(dates.map((date) => [date, classifyDayMemoNormalDifference(
        localByDate.get(date) ?? null, remoteByDate.get(date) ?? null, metadata.baselines[date] ?? null,
      )])) as Record<string, DayMemoNormalDifferenceClassification>
      if (classifications[targetDate] !== 'exact_match_baseline_confirmed') {
        finish('normal_difference_checkpoint_saved_state_target_mismatch', remoteCommon); return
      }
      const unresolvedClassifications = Object.fromEntries(Object.entries(classifications)
        .filter(([, classification]) => classification !== 'exact_match_baseline_confirmed'))
      const unresolvedEntries = Object.entries(unresolvedClassifications)
      if (unresolvedEntries.some(([, classification]) => !RECOVERABLE.has(classification))) {
        finish('normal_difference_checkpoint_saved_state_unresolved_rebuild_failed', {
          ...remoteCommon, targetBaselineVerified: true, targetLocalRemoteMatched: true,
          targetResolved: true, unresolvedCount: unresolvedEntries.length, unresolvedClassifications,
        }); return
      }
      const next = unresolvedEntries.find(([, classification]) => classification === 'body_mismatch')
        ?? unresolvedEntries[0] ?? null
      finish('normal_difference_checkpoint_saved_state_ready', {
        ...remoteCommon, targetBaselineVerified: true, targetLocalRemoteMatched: true,
        targetResolved: true, unresolvedCount: unresolvedEntries.length, unresolvedClassifications,
        oneByOneRecoveryPossible: unresolvedEntries.length > 0,
        nextRecommendedDate: next?.[0] ?? null, nextRecommendedClassification: next?.[1] ?? null,
      })
    } catch {
      finish('normal_difference_checkpoint_saved_state_unknown')
    } finally {
      inFlightRef.current = false
      if (runIdRef.current === runId) setChecking(false)
    }
  }, [checking, connection, dayMemos, eligible, finish, reactMetadata, targetDate])

  const discard = useCallback(() => {
    runIdRef.current += 1
    setResult(null)
    setChecking(false)
  }, [])

  return { eligible, checking, result, check, discard }
}
