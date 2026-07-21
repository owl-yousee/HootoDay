import { useCallback, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { isStoredDayMemo, readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords } from '../utils/dayMemoSyncPull'
import type { RemoteDayMemoRecord } from '../utils/dayMemoSyncPull'
import { isDayMemoSyncMetadataV5, loadDayMemoSyncMetadataAny } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import { DAY_MEMO_NORMAL_DIFFERENCE_CLASSIFICATIONS, classifyDayMemoNormalDifference, type DayMemoNormalDifferenceClassification } from './useDayMemoNormalDifferenceRecoveryPlan'

export type DayMemoNormalDifferenceCheckpointSafety =
  | 'normal_difference_checkpoint_ready' | 'normal_difference_checkpoint_no_candidates'
  | 'normal_difference_checkpoint_unresolved_ready'
  | 'normal_difference_status_only_checkpoint_ready'
  | 'normal_difference_status_only_checkpoint_bridge_changed'
  | 'normal_difference_status_only_checkpoint_baseline_change_required'
  | 'normal_difference_bridge_checkpoint_save_preparation_ready'
  | 'normal_difference_bridge_checkpoint_save_preparation_snapshot_missing'
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
  bodyMismatchDates: string[]
  unresolvedClassifications: Record<string, DayMemoNormalDifferenceClassification>
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
  diagnosticStopStage: 'prerequisite_check' | 'full_pull' | 'snapshot_revalidation'
    | 'cursor_validation' | 'difference_classification' | 'validator_validation' | 'complete' | null
  remoteUniqueDateCount: number | null
  sequenceValidationPassed: boolean | null
  differenceClassificationReached: boolean
}

interface Input { dayMemos: DayMemo[]; isConfigured: boolean; isSignedIn: boolean; connection: SyncConnection | null }

export interface DayMemoStatusOnlyCheckpointBridgeDifference {
  date: string
  classification: string
}

export interface DayMemoNormalDifferenceCheckpointSnapshot {
  result: DayMemoNormalDifferenceCheckpointResult
  metadataRaw: string
  localStorageSerialized: string
  workspaceId: string
  remoteRecords: RemoteDayMemoRecord[]
  candidateMetadata: DayMemoSyncMetadataV5
  unresolvedClassifications: Record<string, DayMemoNormalDifferenceClassification>
  sourceBaselineStatus: 'confirmed' | 'mismatch' | 'recovery_required'
}

interface DayMemoBridgeNormalCheckpointSnapshot {
  result: DayMemoNormalDifferenceCheckpointResult
  metadataRaw: string
  localStorageSerialized: string
  workspaceId: string
  bridgeDifferences: DayMemoStatusOnlyCheckpointBridgeDifference[]
  remoteRecords: RemoteDayMemoRecord[]
  candidateMetadata: DayMemoSyncMetadataV5
}

export interface DayMemoBridgeNormalSaveSelection {
  checkpointMethod: 'normal checkpoint'
  candidateMetadata: DayMemoSyncMetadataV5
  currentCursor: number
  candidateCursor: number
  baselineAdditionCount: number
  unresolvedCount: number
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

function normalizedDifferences(differences: DayMemoStatusOnlyCheckpointBridgeDifference[]): string {
  return JSON.stringify([...differences].sort((left, right) => left.date.localeCompare(right.date)
    || left.classification.localeCompare(right.classification)))
}

function nextAction(safety: DayMemoNormalDifferenceCheckpointSafety): string {
  if (safety === 'normal_difference_checkpoint_ready') return '次Phaseでcheckpointを明示保存し、その後も未解決差異を1件ずつ確認してください。'
  if (safety === 'normal_difference_checkpoint_unresolved_ready') return '新しいcheckpoint保存は不要です。未解決差異を後続Phaseで1件ずつ確認してください。'
  if (safety === 'normal_difference_status_only_checkpoint_ready') return '状態遷移だけのcheckpointを明示保存する次Phaseへ進めます。'
  if (safety === 'normal_difference_bridge_checkpoint_save_preparation_ready') return 'checkpointの明示保存待ちです。'
  if (safety === 'normal_difference_checkpoint_no_candidates') return '完全一致のbaseline候補がありません。差異を種類別に確認してください。'
  return '永続状態を変更せず、安全条件を最初から確認してください。'
}

export function useDayMemoNormalDifferenceRecoveryCheckpointCheck({ dayMemos, isConfigured, isSignedIn, connection }: Input) {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<DayMemoNormalDifferenceCheckpointResult | null>(null)
  const [savePreparationChecking, setSavePreparationChecking] = useState(false)
  const [savePreparationResult, setSavePreparationResult] = useState<DayMemoNormalDifferenceCheckpointResult | null>(null)
  const [readySnapshotRevision, setReadySnapshotRevision] = useState(0)
  const runIdRef = useRef(0)
  const snapshotRef = useRef<DayMemoNormalDifferenceCheckpointSnapshot | null>(null)
  const bridgeNormalSnapshotRef = useRef<DayMemoBridgeNormalCheckpointSnapshot | null>(null)
  const signature = useMemo(() => localSignature(dayMemos), [dayMemos])
  const eligible = Boolean(isConfigured && isSignedIn && supabaseClient && connectionIsEligible(connection))

  const finish = useCallback((safety: DayMemoNormalDifferenceCheckpointSafety, values: Partial<DayMemoNormalDifferenceCheckpointResult> = {}) => {
    setResult({ metadataCursor: null, fullPullMaxSequence: null, cursorDifference: null, remoteCount: 0,
      localCount: dayMemos.length, baselineCount: 0, exactBaselineCandidateCount: 0, unresolvedCount: 0,
      unresolvedCounts: emptyCounts(), unresolvedDates: [], bodyMismatchDates: [], unresolvedClassifications: {}, candidateBaselineCount: 0, candidateBaselineStatus: null,
      candidateBaselineConfirmedAtNull: false, candidateCursor: null, metadataValidatorPassed: false,
      unresolvedReconstructable: false, reclassifiedCounts: emptyCounts(), normalSyncReady: false,
      oneByOneRecoveryPossible: false, persistentStateChanged: false, rpcSent: false,
      diagnosticStopStage: null, remoteUniqueDateCount: null, sequenceValidationPassed: null,
      differenceClassificationReached: false,
      checkedAt: new Date().toISOString(), ...values, safety, nextAction: nextAction(safety) })
  }, [dayMemos.length])

  const finishSavePreparation = useCallback((safety: DayMemoNormalDifferenceCheckpointSafety,
    values: Partial<DayMemoNormalDifferenceCheckpointResult> = {}) => {
    setSavePreparationResult({ metadataCursor: null, fullPullMaxSequence: null, cursorDifference: null,
      remoteCount: 0, localCount: dayMemos.length, baselineCount: 0, exactBaselineCandidateCount: 0,
      unresolvedCount: 0, unresolvedCounts: emptyCounts(), unresolvedDates: [], bodyMismatchDates: [],
      unresolvedClassifications: {}, candidateBaselineCount: 0, candidateBaselineStatus: null,
      candidateBaselineConfirmedAtNull: false, candidateCursor: null, metadataValidatorPassed: false,
      unresolvedReconstructable: false, reclassifiedCounts: emptyCounts(), normalSyncReady: false,
      oneByOneRecoveryPossible: false, persistentStateChanged: false, rpcSent: false,
      diagnosticStopStage: null, remoteUniqueDateCount: null, sequenceValidationPassed: null,
      differenceClassificationReached: false, checkedAt: new Date().toISOString(),
      ...values, safety, nextAction: nextAction(safety) })
  }, [dayMemos.length])

  const discard = useCallback(() => {
    runIdRef.current += 1
    snapshotRef.current = null
    bridgeNormalSnapshotRef.current = null
    setResult(null)
    setSavePreparationResult(null)
    setChecking(false)
    setSavePreparationChecking(false)
  }, [])

  const check = useCallback(async () => {
    if (!eligible || !supabaseClient || !connectionIsEligible(connection) || checking) return
    const runId = ++runIdRef.current
    snapshotRef.current = null; setChecking(true); setResult(null)
    try {
      const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
      const stored = readDayMemoStorageSnapshot(window.localStorage)
      if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata) || stored.status !== 'ready') {
        finish('normal_difference_checkpoint_state_unknown'); return
      }
      const metadata = loaded.metadata
      const common = { metadataCursor: metadata.lastPulledChangeSequence, localCount: stored.memos.length,
        baselineCount: Object.keys(metadata.baselines).length,
        diagnosticStopStage: 'prerequisite_check' as const,
        remoteUniqueDateCount: null, sequenceValidationPassed: null,
        differenceClassificationReached: false }
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
      const bodyMismatchDates = dates.filter((date) => original.get(date) === 'body_mismatch')
      const unresolvedClassifications = Object.fromEntries(unresolvedDates.map((date) => [date, original.get(date)!]))
      const currentCounts = emptyCounts()
      for (const classification of original.values()) currentCounts[classification] += 1
      if (dates.some((date) => ['revision_lineage_mismatch', 'active_tombstone_mismatch', 'unknown'].includes(original.get(date)!))) {
        finish('normal_difference_checkpoint_revision_mismatch', { ...remoteCommon, exactBaselineCandidateCount: exactDates.length,
          unresolvedCount: unresolvedDates.length, unresolvedCounts, unresolvedDates, bodyMismatchDates, unresolvedClassifications, reclassifiedCounts: currentCounts }); return
      }
      if (pulled.maxChangeSequence === metadata.lastPulledChangeSequence) {
        const savedCheckpointIsReconstructable = metadata.baselineStatus === 'recovery_required'
          && exactDates.length === 0 && unresolvedDates.length > 0
          && currentCounts.exact_match_baseline_confirmed === Object.keys(metadata.baselines).length
        finish(savedCheckpointIsReconstructable
          ? 'normal_difference_checkpoint_unresolved_ready'
          : 'normal_difference_checkpoint_cursor_not_advanced', {
          ...remoteCommon, exactBaselineCandidateCount: exactDates.length,
          unresolvedCount: unresolvedDates.length, unresolvedCounts, unresolvedDates, bodyMismatchDates, unresolvedClassifications,
          metadataValidatorPassed: true, unresolvedReconstructable: savedCheckpointIsReconstructable,
          reclassifiedCounts: currentCounts, oneByOneRecoveryPossible: savedCheckpointIsReconstructable,
        }); return
      }
      if (!exactDates.length) {
        finish('normal_difference_checkpoint_no_candidates', { ...remoteCommon, unresolvedCount: unresolvedDates.length,
          unresolvedCounts, unresolvedDates, bodyMismatchDates, unresolvedClassifications, metadataValidatorPassed: true, reclassifiedCounts: currentCounts }); return
      }
      const baselines: DayMemoSyncMetadataV5['baselines'] = { ...metadata.baselines }
      for (const date of exactDates) {
        const local = localByDate.get(date); const remote = remoteByDate.get(date)
        if (!local || !remote || remote.deletedAt !== null || !remote.payload) {
          finish('normal_difference_checkpoint_unsupported', remoteCommon); return
        }
        baselines[date] = { date, remoteRevision: remote.revision, remoteChangeSequence: remote.changeSequence,
          remoteUpdatedAt: remote.payload.updatedAt, baselineLocalUpdatedAt: local.updatedAt, deletedAt: null }
      }
      const candidate: DayMemoSyncMetadataV5 = { ...metadata, baselines, lastPulledChangeSequence: pulled.maxChangeSequence,
        baselineStatus: 'recovery_required', baselineConfirmedAt: null }
      const candidateCommon = { ...remoteCommon, exactBaselineCandidateCount: exactDates.length,
        unresolvedCount: unresolvedDates.length, unresolvedCounts, unresolvedDates, bodyMismatchDates, unresolvedClassifications,
        candidateBaselineCount: Object.keys(baselines).length, candidateBaselineStatus: 'recovery_required' as const,
        candidateBaselineConfirmedAtNull: true, candidateCursor: pulled.maxChangeSequence }
      if (!isDayMemoSyncMetadataV5(candidate)) {
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
          sourceBaselineStatus: metadata.baselineStatus === 'mismatch' ? 'mismatch' : 'recovery_required',
          unresolvedClassifications }
        setResult(readyResult)
      }
    } finally { if (runIdRef.current === runId) setChecking(false) }
  }, [checking, connection, dayMemos, eligible, finish, signature])

  const checkBridgeNormalCandidate = useCallback(async (bridgeDifferences: DayMemoStatusOnlyCheckpointBridgeDifference[]) => {
    if (!eligible || !supabaseClient || !connectionIsEligible(connection) || checking || bridgeDifferences.length === 0) return
    const runId = ++runIdRef.current
    snapshotRef.current = null
    bridgeNormalSnapshotRef.current = null
    setChecking(true)
    setResult(null)
    setSavePreparationResult(null)
    try {
      const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
      const stored = readDayMemoStorageSnapshot(window.localStorage)
      if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata) || stored.status !== 'ready') {
        finish('normal_difference_checkpoint_state_unknown'); return
      }
      const metadata = loaded.metadata
      const common = { metadataCursor: metadata.lastPulledChangeSequence, localCount: stored.memos.length,
        baselineCount: Object.keys(metadata.baselines).length,
        diagnosticStopStage: 'prerequisite_check' as const,
        remoteUniqueDateCount: null, sequenceValidationPassed: null,
        differenceClassificationReached: false }
      if (metadata.workspaceId !== connection.workspaceId) {
        finish('normal_difference_checkpoint_workspace_mismatch', common); return
      }
      if (metadata.baselineStatus !== 'confirmed' || metadata.baselineConfirmedAt === null) {
        finish('normal_difference_checkpoint_unsupported', common); return
      }
      if (localSignature(stored.memos) !== signature || !stored.memos.every(isStoredDayMemo)) {
        finish('normal_difference_checkpoint_state_changed', common); return
      }
      if (metadata.pendingOperation) { finish('normal_difference_checkpoint_pending_remaining', common); return }
      if (Object.keys(metadata.localDeleteIntents).length) { finish('normal_difference_checkpoint_intent_remaining', common); return }
      if (metadata.pushBlock) { finish('normal_difference_checkpoint_push_blocked', common); return }
      if (bridgeDifferences.some((item) => !DAY_MEMO_NORMAL_DIFFERENCE_CLASSIFICATIONS
        .includes(item.classification as DayMemoNormalDifferenceClassification))) {
        finish('normal_difference_status_only_checkpoint_bridge_changed', common); return
      }

      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, connection.workspaceId,
        () => runIdRef.current === runId).catch(() => null)
      if (!pulled || pulled.status !== 'complete') {
        finish('normal_difference_checkpoint_remote_incomplete', { ...common, diagnosticStopStage: 'full_pull' }); return
      }
      const after = loadDayMemoSyncMetadataAny(window.localStorage)
      const afterStored = readDayMemoStorageSnapshot(window.localStorage)
      if (runIdRef.current !== runId || after.status !== 'ready' || after.raw !== loaded.raw
        || afterStored.status !== 'ready' || afterStored.serialized !== stored.serialized
        || localSignature(dayMemos) !== signature) {
        finish('normal_difference_checkpoint_state_changed', { ...common,
          diagnosticStopStage: 'snapshot_revalidation' }); return
      }

      const remoteByDate = new Map(pulled.records.map((record) => [record.entityId, record]))
      const sequenceValidationPassed = Number.isSafeInteger(pulled.maxChangeSequence)
      const remoteCommon = { ...common, remoteCount: pulled.records.length,
        fullPullMaxSequence: pulled.maxChangeSequence,
        cursorDifference: pulled.maxChangeSequence - metadata.lastPulledChangeSequence,
        diagnosticStopStage: 'cursor_validation' as const,
        remoteUniqueDateCount: remoteByDate.size,
        sequenceValidationPassed }
      if (remoteByDate.size !== pulled.records.length || !sequenceValidationPassed
        || pulled.maxChangeSequence < metadata.lastPulledChangeSequence) {
        finish('normal_difference_checkpoint_cursor_invalid', remoteCommon); return
      }

      const localByDate = new Map(stored.memos.map((memo) => [memo.date, memo]))
      const dates = [...new Set([...localByDate.keys(), ...remoteByDate.keys(), ...Object.keys(metadata.baselines)])].sort()
      const classifications = new Map(dates.map((date) => [date, classifyDayMemoNormalDifference(
        localByDate.get(date) ?? null, remoteByDate.get(date) ?? null, metadata.baselines[date] ?? null)]))
      const currentCounts = emptyCounts()
      for (const classification of classifications.values()) currentCounts[classification] += 1
      const exactDates = dates.filter((date) => classifications.get(date) === 'exact_match_baseline_missing')
      const unresolvedDates = dates.filter((date) => UNRESOLVED.includes(classifications.get(date)!))
      const unresolvedCounts = emptyCounts()
      for (const date of unresolvedDates) unresolvedCounts[classifications.get(date)!] += 1
      const unresolvedClassifications = Object.fromEntries(unresolvedDates.map((date) => [date, classifications.get(date)!]))
      const classifiedCommon = { ...remoteCommon, exactBaselineCandidateCount: exactDates.length,
        diagnosticStopStage: 'difference_classification' as const, differenceClassificationReached: true,
        unresolvedCount: unresolvedDates.length, unresolvedCounts, unresolvedDates,
        bodyMismatchDates: unresolvedDates.filter((date) => classifications.get(date) === 'body_mismatch'),
        unresolvedClassifications, reclassifiedCounts: currentCounts }
      if (dates.some((date) => ['revision_lineage_mismatch', 'active_tombstone_mismatch', 'unknown']
        .includes(classifications.get(date)!))) {
        finish('normal_difference_checkpoint_revision_mismatch', classifiedCommon); return
      }
      const currentDifferences = dates.filter((date) => classifications.get(date) !== 'exact_match_baseline_confirmed')
        .map((date) => ({ date, classification: classifications.get(date)! }))
      if (normalizedDifferences(currentDifferences) !== normalizedDifferences(bridgeDifferences)) {
        finish('normal_difference_status_only_checkpoint_bridge_changed', classifiedCommon); return
      }
      const cursorChanges = pulled.maxChangeSequence !== metadata.lastPulledChangeSequence
      if (!cursorChanges && exactDates.length === 0) {
        finish('normal_difference_checkpoint_cursor_not_advanced', classifiedCommon); return
      }

      const baselines: DayMemoSyncMetadataV5['baselines'] = { ...metadata.baselines }
      for (const date of exactDates) {
        const local = localByDate.get(date)
        const remote = remoteByDate.get(date)
        if (!local || !remote || remote.deletedAt !== null || !remote.payload) {
          finish('normal_difference_checkpoint_unsupported', classifiedCommon); return
        }
        baselines[date] = { date, remoteRevision: remote.revision,
          remoteChangeSequence: remote.changeSequence, remoteUpdatedAt: remote.payload.updatedAt,
          baselineLocalUpdatedAt: local.updatedAt, deletedAt: null }
      }
      const candidate: DayMemoSyncMetadataV5 = { ...metadata, baselines,
        lastPulledChangeSequence: pulled.maxChangeSequence,
        baselineStatus: 'recovery_required', baselineConfirmedAt: null }
      const candidateCommon = { ...classifiedCommon,
        candidateBaselineCount: Object.keys(baselines).length,
        candidateBaselineStatus: 'recovery_required' as const,
        candidateBaselineConfirmedAtNull: true, candidateCursor: pulled.maxChangeSequence }
      if (!isDayMemoSyncMetadataV5(candidate)) {
        finish('normal_difference_checkpoint_validator_failed', { ...candidateCommon,
          diagnosticStopStage: 'validator_validation' }); return
      }
      const reclassifiedCounts = emptyCounts()
      const reconstructed = new Map(dates.map((date) => {
        const classification = classifyDayMemoNormalDifference(localByDate.get(date) ?? null,
          remoteByDate.get(date) ?? null, baselines[date] ?? null)
        reclassifiedCounts[classification] += 1
        return [date, classification]
      }))
      const unresolvedReconstructable = dates.every((date) => exactDates.includes(date)
        ? reconstructed.get(date) === 'exact_match_baseline_confirmed'
        : reconstructed.get(date) === classifications.get(date))
      const safety = unresolvedReconstructable
        ? 'normal_difference_checkpoint_ready' : 'normal_difference_checkpoint_unresolved_not_reconstructable'
      const values = { ...candidateCommon, diagnosticStopStage: 'complete' as const,
        metadataValidatorPassed: true, unresolvedReconstructable, reclassifiedCounts,
        oneByOneRecoveryPossible: unresolvedReconstructable && unresolvedDates.length > 0 }
      finish(safety, values)
      if (safety === 'normal_difference_checkpoint_ready') {
        const readyResult: DayMemoNormalDifferenceCheckpointResult = {
          ...values, normalSyncReady: false, persistentStateChanged: false, rpcSent: false,
          checkedAt: new Date().toISOString(), safety, nextAction: nextAction(safety),
        }
        bridgeNormalSnapshotRef.current = { result: readyResult, metadataRaw: loaded.raw,
          localStorageSerialized: stored.serialized, workspaceId: connection.workspaceId,
          bridgeDifferences: bridgeDifferences.map((item) => ({ ...item })),
          remoteRecords: pulled.records.map((record) => ({ ...record,
            payload: record.payload ? { ...record.payload } : null })),
          candidateMetadata: candidate }
        setResult(readyResult)
      }
    } finally {
      if (runIdRef.current === runId) setChecking(false)
    }
  }, [checking, connection, dayMemos, eligible, finish, signature])

  const checkBridgeNormalSavePreparation = useCallback(async (
    bridgeDifferences: DayMemoStatusOnlyCheckpointBridgeDifference[],
  ) => {
    if (!eligible || !supabaseClient || !connectionIsEligible(connection)
      || checking || savePreparationChecking || bridgeDifferences.length === 0) return
    const ready = bridgeNormalSnapshotRef.current
    if (!ready || normalizedDifferences(ready.bridgeDifferences) !== normalizedDifferences(bridgeDifferences)) {
      finishSavePreparation('normal_difference_bridge_checkpoint_save_preparation_snapshot_missing'); return
    }
    const runId = ++runIdRef.current
    setSavePreparationChecking(true)
    setSavePreparationResult(null)
    try {
      const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
      const stored = readDayMemoStorageSnapshot(window.localStorage)
      if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata) || stored.status !== 'ready') {
        finishSavePreparation('normal_difference_checkpoint_state_unknown'); return
      }
      const metadata = loaded.metadata
      const common = { metadataCursor: metadata.lastPulledChangeSequence, localCount: stored.memos.length,
        baselineCount: Object.keys(metadata.baselines).length,
        diagnosticStopStage: 'prerequisite_check' as const,
        remoteUniqueDateCount: null, sequenceValidationPassed: null,
        differenceClassificationReached: false }
      if (metadata.workspaceId !== connection.workspaceId || ready.workspaceId !== connection.workspaceId) {
        finishSavePreparation('normal_difference_checkpoint_workspace_mismatch', common); return
      }
      if (metadata.baselineStatus !== 'confirmed' || metadata.baselineConfirmedAt === null
        || loaded.raw !== ready.metadataRaw || stored.serialized !== ready.localStorageSerialized
        || localSignature(stored.memos) !== signature || !stored.memos.every(isStoredDayMemo)) {
        finishSavePreparation('normal_difference_checkpoint_state_changed', common); return
      }
      if (metadata.pendingOperation) { finishSavePreparation('normal_difference_checkpoint_pending_remaining', common); return }
      if (Object.keys(metadata.localDeleteIntents).length) {
        finishSavePreparation('normal_difference_checkpoint_intent_remaining', common); return
      }
      if (metadata.pushBlock) { finishSavePreparation('normal_difference_checkpoint_push_blocked', common); return }
      if (!isDayMemoSyncMetadataV5(ready.candidateMetadata)) {
        finishSavePreparation('normal_difference_checkpoint_validator_failed', { ...common,
          diagnosticStopStage: 'validator_validation' }); return
      }

      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, connection.workspaceId,
        () => runIdRef.current === runId).catch(() => null)
      if (!pulled || pulled.status !== 'complete') {
        finishSavePreparation('normal_difference_checkpoint_remote_incomplete', { ...common,
          diagnosticStopStage: 'full_pull' }); return
      }
      const after = loadDayMemoSyncMetadataAny(window.localStorage)
      const afterStored = readDayMemoStorageSnapshot(window.localStorage)
      if (runIdRef.current !== runId || after.status !== 'ready' || after.raw !== loaded.raw
        || afterStored.status !== 'ready' || afterStored.serialized !== stored.serialized
        || localSignature(dayMemos) !== signature) {
        finishSavePreparation('normal_difference_checkpoint_state_changed', { ...common,
          diagnosticStopStage: 'snapshot_revalidation' }); return
      }

      const remoteByDate = new Map(pulled.records.map((record) => [record.entityId, record]))
      const sequenceValidationPassed = Number.isSafeInteger(pulled.maxChangeSequence)
      const remoteCommon = { ...common, remoteCount: pulled.records.length,
        fullPullMaxSequence: pulled.maxChangeSequence,
        cursorDifference: pulled.maxChangeSequence - metadata.lastPulledChangeSequence,
        diagnosticStopStage: 'cursor_validation' as const,
        remoteUniqueDateCount: remoteByDate.size, sequenceValidationPassed }
      if (remoteByDate.size !== pulled.records.length || !sequenceValidationPassed
        || pulled.maxChangeSequence < metadata.lastPulledChangeSequence
        || pulled.maxChangeSequence !== ready.candidateMetadata.lastPulledChangeSequence
        || JSON.stringify(pulled.records) !== JSON.stringify(ready.remoteRecords)) {
        finishSavePreparation('normal_difference_checkpoint_cursor_invalid', remoteCommon); return
      }

      const localByDate = new Map(stored.memos.map((memo) => [memo.date, memo]))
      const dates = [...new Set([...localByDate.keys(), ...remoteByDate.keys(), ...Object.keys(metadata.baselines)])].sort()
      const classifications = new Map(dates.map((date) => [date, classifyDayMemoNormalDifference(
        localByDate.get(date) ?? null, remoteByDate.get(date) ?? null, metadata.baselines[date] ?? null)]))
      const exactDates = dates.filter((date) => classifications.get(date) === 'exact_match_baseline_missing')
      const unresolvedDates = dates.filter((date) => UNRESOLVED.includes(classifications.get(date)!))
      const unresolvedCounts = emptyCounts()
      for (const date of unresolvedDates) unresolvedCounts[classifications.get(date)!] += 1
      const unresolvedClassifications = Object.fromEntries(unresolvedDates.map((date) => [date, classifications.get(date)!]))
      const currentCounts = emptyCounts()
      for (const classification of classifications.values()) currentCounts[classification] += 1
      const classifiedCommon = { ...remoteCommon, exactBaselineCandidateCount: exactDates.length,
        diagnosticStopStage: 'difference_classification' as const, differenceClassificationReached: true,
        unresolvedCount: unresolvedDates.length, unresolvedCounts, unresolvedDates,
        bodyMismatchDates: unresolvedDates.filter((date) => classifications.get(date) === 'body_mismatch'),
        unresolvedClassifications, reclassifiedCounts: currentCounts,
        candidateBaselineCount: Object.keys(ready.candidateMetadata.baselines).length,
        candidateBaselineStatus: 'recovery_required' as const,
        candidateBaselineConfirmedAtNull: ready.candidateMetadata.baselineConfirmedAt === null,
        candidateCursor: ready.candidateMetadata.lastPulledChangeSequence }
      if (dates.some((date) => ['revision_lineage_mismatch', 'active_tombstone_mismatch', 'unknown']
        .includes(classifications.get(date)!))) {
        finishSavePreparation('normal_difference_checkpoint_revision_mismatch', classifiedCommon); return
      }
      const currentDifferences = dates.filter((date) => classifications.get(date) !== 'exact_match_baseline_confirmed')
        .map((date) => ({ date, classification: classifications.get(date)! }))
      if (normalizedDifferences(currentDifferences) !== normalizedDifferences(bridgeDifferences)) {
        finishSavePreparation('normal_difference_status_only_checkpoint_bridge_changed', classifiedCommon); return
      }
      const candidateBaselinesValid = exactDates.every((date) => {
        const local = localByDate.get(date)
        const remote = remoteByDate.get(date)
        const baseline = ready.candidateMetadata.baselines[date]
        return Boolean(local && remote && remote.deletedAt === null && remote.payload && baseline
          && baseline.remoteRevision === remote.revision
          && baseline.remoteChangeSequence === remote.changeSequence
          && baseline.remoteUpdatedAt === remote.payload.updatedAt
          && baseline.baselineLocalUpdatedAt === local.updatedAt
          && baseline.deletedAt === null)
      })
      if (!candidateBaselinesValid || ready.candidateMetadata.baselineStatus !== 'recovery_required'
        || ready.candidateMetadata.baselineConfirmedAt !== null) {
        finishSavePreparation('normal_difference_checkpoint_validator_failed', { ...classifiedCommon,
          diagnosticStopStage: 'validator_validation' }); return
      }
      finishSavePreparation('normal_difference_bridge_checkpoint_save_preparation_ready', {
        ...classifiedCommon, diagnosticStopStage: 'complete', metadataValidatorPassed: true,
        unresolvedReconstructable: true, oneByOneRecoveryPossible: unresolvedDates.length > 0,
      })
    } finally {
      if (runIdRef.current === runId) setSavePreparationChecking(false)
    }
  }, [checking, connection, dayMemos, eligible, finishSavePreparation, savePreparationChecking, signature])

  const checkStatusOnlyCandidate = useCallback(async (bridgeDifferences: DayMemoStatusOnlyCheckpointBridgeDifference[]) => {
    if (!eligible || !supabaseClient || !connectionIsEligible(connection) || checking || bridgeDifferences.length === 0) return
    const runId = ++runIdRef.current
    snapshotRef.current = null
    bridgeNormalSnapshotRef.current = null
    setChecking(true)
    setResult(null)
    try {
      const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
      const stored = readDayMemoStorageSnapshot(window.localStorage)
      if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata) || stored.status !== 'ready') {
        finish('normal_difference_checkpoint_state_unknown'); return
      }
      const metadata = loaded.metadata
      const common = { metadataCursor: metadata.lastPulledChangeSequence, localCount: stored.memos.length,
        baselineCount: Object.keys(metadata.baselines).length,
        diagnosticStopStage: 'prerequisite_check' as const,
        remoteUniqueDateCount: null, sequenceValidationPassed: null,
        differenceClassificationReached: false }
      if (metadata.workspaceId !== connection.workspaceId) { finish('normal_difference_checkpoint_workspace_mismatch', common); return }
      if (metadata.baselineStatus !== 'confirmed' || metadata.baselineConfirmedAt === null) {
        finish('normal_difference_checkpoint_unsupported', common); return
      }
      if (localSignature(stored.memos) !== signature || !stored.memos.every(isStoredDayMemo)) {
        finish('normal_difference_checkpoint_state_changed', common); return
      }
      if (metadata.pendingOperation) { finish('normal_difference_checkpoint_pending_remaining', common); return }
      if (Object.keys(metadata.localDeleteIntents).length) { finish('normal_difference_checkpoint_intent_remaining', common); return }
      if (metadata.pushBlock) { finish('normal_difference_checkpoint_push_blocked', common); return }
      if (bridgeDifferences.some((item) => !DAY_MEMO_NORMAL_DIFFERENCE_CLASSIFICATIONS
        .includes(item.classification as DayMemoNormalDifferenceClassification))) {
        finish('normal_difference_status_only_checkpoint_bridge_changed', common); return
      }

      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, connection.workspaceId,
        () => runIdRef.current === runId).catch(() => null)
      if (!pulled || pulled.status !== 'complete') {
        finish('normal_difference_checkpoint_remote_incomplete', { ...common, diagnosticStopStage: 'full_pull' }); return
      }
      const after = loadDayMemoSyncMetadataAny(window.localStorage)
      const afterStored = readDayMemoStorageSnapshot(window.localStorage)
      if (runIdRef.current !== runId || after.status !== 'ready' || after.raw !== loaded.raw
        || afterStored.status !== 'ready' || afterStored.serialized !== stored.serialized
        || localSignature(dayMemos) !== signature) {
        finish('normal_difference_checkpoint_state_changed', { ...common,
          diagnosticStopStage: 'snapshot_revalidation' }); return
      }

      const remoteByDate = new Map(pulled.records.map((record) => [record.entityId, record]))
      const sequenceValidationPassed = Number.isSafeInteger(pulled.maxChangeSequence)
      const remoteCommon = { ...common, remoteCount: pulled.records.length,
        fullPullMaxSequence: pulled.maxChangeSequence,
        cursorDifference: pulled.maxChangeSequence - metadata.lastPulledChangeSequence,
        diagnosticStopStage: 'cursor_validation' as const,
        remoteUniqueDateCount: remoteByDate.size,
        sequenceValidationPassed }
      if (remoteByDate.size !== pulled.records.length || !sequenceValidationPassed
        || pulled.maxChangeSequence !== metadata.lastPulledChangeSequence) {
        finish('normal_difference_checkpoint_cursor_invalid', remoteCommon); return
      }
      const localByDate = new Map(stored.memos.map((memo) => [memo.date, memo]))
      const dates = [...new Set([...localByDate.keys(), ...remoteByDate.keys(), ...Object.keys(metadata.baselines)])].sort()
      const classifications = new Map(dates.map((date) => [date, classifyDayMemoNormalDifference(
        localByDate.get(date) ?? null, remoteByDate.get(date) ?? null, metadata.baselines[date] ?? null)]))
      const currentCounts = emptyCounts()
      for (const classification of classifications.values()) currentCounts[classification] += 1
      const exactBaselineCandidateCount = dates.filter((date) =>
        classifications.get(date) === 'exact_match_baseline_missing').length
      const classifiedCommon = { ...remoteCommon,
        diagnosticStopStage: 'difference_classification' as const,
        differenceClassificationReached: true,
        exactBaselineCandidateCount }
      if (dates.some((date) => ['revision_lineage_mismatch', 'active_tombstone_mismatch', 'unknown']
        .includes(classifications.get(date)!))) {
        finish('normal_difference_checkpoint_revision_mismatch', { ...classifiedCommon,
          reclassifiedCounts: currentCounts }); return
      }
      const unresolvedDates = dates.filter((date) => UNRESOLVED.includes(classifications.get(date)!))
      const unresolvedClassifications = Object.fromEntries(unresolvedDates.map((date) => [date, classifications.get(date)!]))
      const currentDifferences = dates.filter((date) => classifications.get(date) !== 'exact_match_baseline_confirmed')
        .map((date) => ({ date, classification: classifications.get(date)! }))
      if (normalizedDifferences(currentDifferences) !== normalizedDifferences(bridgeDifferences)) {
        finish('normal_difference_status_only_checkpoint_bridge_changed', { ...classifiedCommon,
          unresolvedCount: unresolvedDates.length, unresolvedDates, unresolvedClassifications,
          reclassifiedCounts: currentCounts }); return
      }
      const baselineChangeRequired = dates.some((date) => classifications.get(date) === 'exact_match_baseline_missing')
        || Object.keys(metadata.baselines).some((date) => classifications.get(date) !== 'exact_match_baseline_confirmed')
      if (baselineChangeRequired) {
        finish('normal_difference_status_only_checkpoint_baseline_change_required', { ...classifiedCommon,
          unresolvedCount: unresolvedDates.length, unresolvedDates, unresolvedClassifications,
          reclassifiedCounts: currentCounts }); return
      }
      const unresolvedCounts = emptyCounts()
      for (const date of unresolvedDates) unresolvedCounts[classifications.get(date)!] += 1
      const candidate: DayMemoSyncMetadataV5 = { ...metadata,
        baselineStatus: 'recovery_required', baselineConfirmedAt: null }
      const candidateValues = { ...classifiedCommon,
        unresolvedCount: unresolvedDates.length, unresolvedCounts, unresolvedDates,
        bodyMismatchDates: unresolvedDates.filter((date) => classifications.get(date) === 'body_mismatch'),
        unresolvedClassifications, candidateBaselineCount: Object.keys(metadata.baselines).length,
        candidateBaselineStatus: 'recovery_required' as const, candidateBaselineConfirmedAtNull: true,
        candidateCursor: metadata.lastPulledChangeSequence, reclassifiedCounts: currentCounts }
      if (!isDayMemoSyncMetadataV5(candidate)) {
        finish('normal_difference_checkpoint_validator_failed', { ...candidateValues,
          diagnosticStopStage: 'validator_validation' }); return
      }
      finish('normal_difference_status_only_checkpoint_ready', { ...candidateValues,
        diagnosticStopStage: 'complete',
        metadataValidatorPassed: true, unresolvedReconstructable: unresolvedDates.length > 0,
        oneByOneRecoveryPossible: unresolvedDates.length > 0 })
    } finally {
      if (runIdRef.current === runId) setChecking(false)
    }
  }, [checking, connection, dayMemos, eligible, finish, signature])

  const prepareBridgeNormalSaveSelection = useCallback((
    bridgeDifferences: DayMemoStatusOnlyCheckpointBridgeDifference[],
  ): DayMemoBridgeNormalSaveSelection | null => {
    const ready = bridgeNormalSnapshotRef.current
    if (!ready || savePreparationChecking
      || savePreparationResult?.safety !== 'normal_difference_bridge_checkpoint_save_preparation_ready'
      || ready.result.metadataCursor === null
      || normalizedDifferences(ready.bridgeDifferences) !== normalizedDifferences(bridgeDifferences)) return null
    snapshotRef.current = {
      result: ready.result,
      metadataRaw: ready.metadataRaw,
      localStorageSerialized: ready.localStorageSerialized,
      workspaceId: ready.workspaceId,
      remoteRecords: ready.remoteRecords.map((record) => ({ ...record,
        payload: record.payload ? { ...record.payload } : null })),
      candidateMetadata: structuredClone(ready.candidateMetadata),
      unresolvedClassifications: { ...ready.result.unresolvedClassifications },
      sourceBaselineStatus: 'confirmed',
    }
    setReadySnapshotRevision((current) => current + 1)
    return {
      checkpointMethod: 'normal checkpoint',
      candidateMetadata: structuredClone(ready.candidateMetadata),
      currentCursor: ready.result.metadataCursor,
      candidateCursor: ready.candidateMetadata.lastPulledChangeSequence,
      baselineAdditionCount: ready.result.exactBaselineCandidateCount,
      unresolvedCount: ready.result.unresolvedCount,
      unresolvedClassifications: { ...ready.result.unresolvedClassifications },
    }
  }, [savePreparationChecking, savePreparationResult])

  const getReadySnapshot = useCallback(() => snapshotRef.current, [])
  const consumeReadySnapshot = useCallback(() => {
    snapshotRef.current = null
    bridgeNormalSnapshotRef.current = null
  }, [])
  return { eligible, checking, result, check, checkStatusOnlyCandidate, checkBridgeNormalCandidate,
    savePreparationChecking, savePreparationResult, checkBridgeNormalSavePreparation,
    prepareBridgeNormalSaveSelection, readySnapshotRevision,
    discard, getReadySnapshot, consumeReadySnapshot }
}
