import { useCallback, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoSyncMetadataV4 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { isStoredDayMemo, readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords } from '../utils/dayMemoSyncPull'
import type { RemoteDayMemoRecord } from '../utils/dayMemoSyncPull'
import { isDayMemoSyncMetadataV4, loadDayMemoSyncMetadataAny } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import { DAY_MEMO_NORMAL_DIFFERENCE_CLASSIFICATIONS, classifyDayMemoNormalDifference, type DayMemoNormalDifferenceClassification } from './useDayMemoNormalDifferenceRecoveryPlan'

export type DayMemoNormalDifferenceCheckpointSafety =
  | 'normal_difference_checkpoint_ready' | 'normal_difference_checkpoint_no_candidates'
  | 'normal_difference_checkpoint_unresolved_ready'
  | 'normal_difference_checkpoint_cursor_not_advanced' | 'normal_difference_checkpoint_cursor_invalid'
  | 'normal_difference_checkpoint_unresolved_not_reconstructable' | 'normal_difference_checkpoint_validator_failed'
  | 'normal_difference_checkpoint_pending_remaining' | 'normal_difference_checkpoint_intent_remaining'
  | 'normal_difference_checkpoint_push_blocked' | 'normal_difference_checkpoint_workspace_mismatch'
  | 'normal_difference_checkpoint_remote_incomplete' | 'normal_difference_checkpoint_revision_mismatch'
  | 'normal_difference_checkpoint_state_changed' | 'normal_difference_checkpoint_unsupported'
  | 'normal_difference_checkpoint_state_unknown'

export interface DayMemoNormalDifferenceCheckpointResult {
  metadataCursor: number | null
  fullPullMaxSequence: number | null
  cursorDifference: number | null
  remoteCount: number
  localCount: number
  baselineCount: number
  exactBaselineCandidateCount: number
  unresolvedCount: number
  unresolvedCounts: Record<DayMemoNormalDifferenceClassification, number>
  unresolvedDates: string[]
  candidateBaselineCount: number
  candidateBaselineStatus: 'recovery_required' | null
  candidateBaselineConfirmedAtNull: boolean
  candidateCursor: number | null
  metadataValidatorPassed: boolean
  unresolvedReconstructable: boolean
  reclassifiedCounts: Record<DayMemoNormalDifferenceClassification, number>
  normalSyncReady: false
  oneByOneRecoveryPossible: boolean
  safety: DayMemoNormalDifferenceCheckpointSafety
  persistentStateChanged: false
  rpcSent: false
  checkedAt: string
  nextAction: string
}

interface Input { dayMemos: DayMemo[]; isConfigured: boolean; isSignedIn: boolean; connection: SyncConnection | null }

export interface DayMemoNormalDifferenceCheckpointSnapshot {
  result: DayMemoNormalDifferenceCheckpointResult
  metadataRaw: string
  localStorageSerialized: string
  workspaceId: string
  remoteRecords: RemoteDayMemoRecord[]
  candidateMetadata: DayMemoSyncMetadataV4
  unresolvedClassifications: Record<string, DayMemoNormalDifferenceClassification>
}

const UNRESOLVED: DayMemoNormalDifferenceClassification[] = [
  'exact_body_timestamp_mismatch', 'body_mismatch', 'local_only', 'remote_only_active', 'remote_only_tombstone',
]

function emptyCounts(): Record<DayMemoNormalDifferenceClassification, number> {
  return Object.fromEntries(DAY_MEMO_NORMAL_DIFFERENCE_CLASSIFICATIONS.map((value) => [value, 0])) as Record<DayMemoNormalDifferenceClassification, number>
}

function connectionIsEligible(connection: SyncConnection | null): connection is SyncConnection & { workspaceId: string } {
  return Boolean(connection && isUuid(connection.workspaceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}

function localSignature(memos: DayMemo[]): string {
  return JSON.stringify(memos.map((memo) => [memo.date, memo.updatedAt, memo.content]).sort(([left], [right]) => left.localeCompare(right)))
}

function nextAction(safety: DayMemoNormalDifferenceCheckpointSafety): string {
  if (safety === 'normal_difference_checkpoint_ready') return '次Phaseでcheckpointを明示保存し、その後も未解決差異を1件ずつ確認してください。'
  if (safety === 'normal_difference_checkpoint_unresolved_ready') return '新しいcheckpoint保存は不要です。未解決差異を後続Phaseで1件ずつ確認してください。'
  if (safety === 'normal_difference_checkpoint_no_candidates') return '完全一致のbaseline候補がありません。差異を種類別に確認してください。'
  return '永続状態を変更せず、安全条件を最初から確認してください。'
}

export function useDayMemoNormalDifferenceRecoveryCheckpointCheck({ dayMemos, isConfigured, isSignedIn, connection }: Input) {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<DayMemoNormalDifferenceCheckpointResult | null>(null)
  const runIdRef = useRef(0)
  const snapshotRef = useRef<DayMemoNormalDifferenceCheckpointSnapshot | null>(null)
  const signature = useMemo(() => localSignature(dayMemos), [dayMemos])
  const eligible = Boolean(isConfigured && isSignedIn && supabaseClient && connectionIsEligible(connection))

  const finish = useCallback((safety: DayMemoNormalDifferenceCheckpointSafety, values: Partial<DayMemoNormalDifferenceCheckpointResult> = {}) => {
    setResult({ metadataCursor: null, fullPullMaxSequence: null, cursorDifference: null, remoteCount: 0,
      localCount: dayMemos.length, baselineCount: 0, exactBaselineCandidateCount: 0, unresolvedCount: 0,
      unresolvedCounts: emptyCounts(), unresolvedDates: [], candidateBaselineCount: 0, candidateBaselineStatus: null,
      candidateBaselineConfirmedAtNull: false, candidateCursor: null, metadataValidatorPassed: false,
      unresolvedReconstructable: false, reclassifiedCounts: emptyCounts(), normalSyncReady: false,
      oneByOneRecoveryPossible: false, persistentStateChanged: false, rpcSent: false,
      checkedAt: new Date().toISOString(), ...values, safety, nextAction: nextAction(safety) })
  }, [dayMemos.length])

  const discard = useCallback(() => { runIdRef.current += 1; snapshotRef.current = null; setResult(null); setChecking(false) }, [])

  const check = useCallback(async () => {
    if (!eligible || !supabaseClient || !connectionIsEligible(connection) || checking) return
    const runId = ++runIdRef.current
    snapshotRef.current = null; setChecking(true); setResult(null)
    try {
      const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
      const stored = readDayMemoStorageSnapshot(window.localStorage)
      if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV4(loaded.metadata) || stored.status !== 'ready') {
        finish('normal_difference_checkpoint_state_unknown'); return
      }
      const metadata = loaded.metadata
      const common = { metadataCursor: metadata.lastPulledChangeSequence, localCount: stored.memos.length,
        baselineCount: Object.keys(metadata.baselines).length }
      if (metadata.workspaceId !== connection.workspaceId) { finish('normal_difference_checkpoint_workspace_mismatch', common); return }
      if (localSignature(stored.memos) !== signature || !stored.memos.every(isStoredDayMemo)) {
        finish('normal_difference_checkpoint_state_changed', common); return
      }
      if (metadata.pendingOperation) { finish('normal_difference_checkpoint_pending_remaining', common); return }
      if (Object.keys(metadata.localDeleteIntents).length) { finish('normal_difference_checkpoint_intent_remaining', common); return }
      if (metadata.pushBlock) { finish('normal_difference_checkpoint_push_blocked', common); return }
      if (!['mismatch', 'recovery_required'].includes(metadata.baselineStatus)) {
        finish('normal_difference_checkpoint_unsupported', common); return
      }
      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, connection.workspaceId, () => runIdRef.current === runId).catch(() => null)
      if (!pulled || pulled.status !== 'complete') { finish('normal_difference_checkpoint_remote_incomplete', common); return }
      const after = loadDayMemoSyncMetadataAny(window.localStorage)
      const afterStored = readDayMemoStorageSnapshot(window.localStorage)
      if (runIdRef.current !== runId || after.status !== 'ready' || after.raw !== loaded.raw
        || afterStored.status !== 'ready' || afterStored.serialized !== stored.serialized || localSignature(dayMemos) !== signature) {
        finish('normal_difference_checkpoint_state_changed', common); return
      }
      const remoteCommon = { ...common, remoteCount: pulled.records.length, fullPullMaxSequence: pulled.maxChangeSequence,
        cursorDifference: pulled.maxChangeSequence - metadata.lastPulledChangeSequence }
      const remoteByDate = new Map(pulled.records.map((record) => [record.entityId, record]))
      if (remoteByDate.size !== pulled.records.length || !Number.isSafeInteger(pulled.maxChangeSequence)
        || pulled.maxChangeSequence < metadata.lastPulledChangeSequence) {
        finish('normal_difference_checkpoint_cursor_invalid', remoteCommon); return
      }
      const localByDate = new Map(stored.memos.map((memo) => [memo.date, memo]))
      const dates = [...new Set([...localByDate.keys(), ...remoteByDate.keys(), ...Object.keys(metadata.baselines)])].sort()
      const original = new Map(dates.map((date) => [date, classifyDayMemoNormalDifference(
        localByDate.get(date) ?? null, remoteByDate.get(date) ?? null, metadata.baselines[date] ?? null)]))
      const exactDates = dates.filter((date) => original.get(date) === 'exact_match_baseline_missing')
      const unresolvedDates = dates.filter((date) => UNRESOLVED.includes(original.get(date)!))
      const unresolvedCounts = emptyCounts()
      for (const date of unresolvedDates) unresolvedCounts[original.get(date)!] += 1
      const currentCounts = emptyCounts()
      for (const classification of original.values()) currentCounts[classification] += 1
      if (dates.some((date) => ['revision_lineage_mismatch', 'active_tombstone_mismatch', 'unknown'].includes(original.get(date)!))) {
        finish('normal_difference_checkpoint_revision_mismatch', { ...remoteCommon, exactBaselineCandidateCount: exactDates.length,
          unresolvedCount: unresolvedDates.length, unresolvedCounts, unresolvedDates, reclassifiedCounts: currentCounts }); return
      }
      if (pulled.maxChangeSequence === metadata.lastPulledChangeSequence) {
        const savedCheckpointIsReconstructable = metadata.baselineStatus === 'recovery_required'
          && exactDates.length === 0 && unresolvedDates.length > 0
          && currentCounts.exact_match_baseline_confirmed === Object.keys(metadata.baselines).length
        finish(savedCheckpointIsReconstructable
          ? 'normal_difference_checkpoint_unresolved_ready'
          : 'normal_difference_checkpoint_cursor_not_advanced', {
          ...remoteCommon, exactBaselineCandidateCount: exactDates.length,
          unresolvedCount: unresolvedDates.length, unresolvedCounts, unresolvedDates,
          metadataValidatorPassed: true, unresolvedReconstructable: savedCheckpointIsReconstructable,
          reclassifiedCounts: currentCounts, oneByOneRecoveryPossible: savedCheckpointIsReconstructable,
        }); return
      }
      if (!exactDates.length) {
        finish('normal_difference_checkpoint_no_candidates', { ...remoteCommon, unresolvedCount: unresolvedDates.length,
          unresolvedCounts, unresolvedDates, metadataValidatorPassed: true, reclassifiedCounts: currentCounts }); return
      }
      const baselines: DayMemoSyncMetadataV4['baselines'] = { ...metadata.baselines }
      for (const date of exactDates) {
        const local = localByDate.get(date); const remote = remoteByDate.get(date)
        if (!local || !remote || remote.deletedAt !== null || !remote.payload) {
          finish('normal_difference_checkpoint_unsupported', remoteCommon); return
        }
        baselines[date] = { date, remoteRevision: remote.revision, remoteChangeSequence: remote.changeSequence,
          remoteUpdatedAt: remote.payload.updatedAt, baselineLocalUpdatedAt: local.updatedAt, deletedAt: null }
      }
      const candidate: DayMemoSyncMetadataV4 = { ...metadata, baselines, lastPulledChangeSequence: pulled.maxChangeSequence,
        baselineStatus: 'recovery_required', baselineConfirmedAt: null }
      const candidateCommon = { ...remoteCommon, exactBaselineCandidateCount: exactDates.length,
        unresolvedCount: unresolvedDates.length, unresolvedCounts, unresolvedDates,
        candidateBaselineCount: Object.keys(baselines).length, candidateBaselineStatus: 'recovery_required' as const,
        candidateBaselineConfirmedAtNull: true, candidateCursor: pulled.maxChangeSequence }
      if (!isDayMemoSyncMetadataV4(candidate)) {
        finish('normal_difference_checkpoint_validator_failed', candidateCommon); return
      }
      const reclassifiedCounts = emptyCounts()
      const reconstructed = new Map(dates.map((date) => {
        const value = classifyDayMemoNormalDifference(localByDate.get(date) ?? null, remoteByDate.get(date) ?? null, baselines[date] ?? null)
        reclassifiedCounts[value] += 1
        return [date, value]
      }))
      const unresolvedReconstructable = exactDates.every((date) => reconstructed.get(date) === 'exact_match_baseline_confirmed')
        && unresolvedDates.every((date) => reconstructed.get(date) === original.get(date) && !baselines[date])
      const safety = unresolvedReconstructable ? 'normal_difference_checkpoint_ready' : 'normal_difference_checkpoint_unresolved_not_reconstructable'
      const values = {
        ...candidateCommon, metadataValidatorPassed: true, unresolvedReconstructable, reclassifiedCounts,
        oneByOneRecoveryPossible: unresolvedReconstructable && unresolvedDates.length > 0,
      }
      finish(safety, values)
      if (safety === 'normal_difference_checkpoint_ready') {
        const readyResult: DayMemoNormalDifferenceCheckpointResult = {
          ...values,
          normalSyncReady: false,
          persistentStateChanged: false,
          rpcSent: false,
          checkedAt: new Date().toISOString(),
          safety,
          nextAction: nextAction(safety),
        }
        snapshotRef.current = { result: readyResult, metadataRaw: loaded.raw,
          localStorageSerialized: stored.serialized, workspaceId: connection.workspaceId,
          remoteRecords: pulled.records.map((record) => ({ ...record, payload: record.payload ? { ...record.payload } : null })),
          candidateMetadata: candidate,
          unresolvedClassifications: Object.fromEntries(unresolvedDates.map((date) => [date, original.get(date)!])) }
        setResult(readyResult)
      }
    } finally { if (runIdRef.current === runId) setChecking(false) }
  }, [checking, connection, dayMemos, eligible, finish, signature])

  const getReadySnapshot = useCallback(() => snapshotRef.current, [])
  const consumeReadySnapshot = useCallback(() => { snapshotRef.current = null }, [])
  return { eligible, checking, result, check, discard, getReadySnapshot, consumeReadySnapshot }
}
