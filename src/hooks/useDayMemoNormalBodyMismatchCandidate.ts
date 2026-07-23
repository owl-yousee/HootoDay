import { useCallback, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { isStoredDayMemo, readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords, type RemoteDayMemoRecord } from '../utils/dayMemoSyncPull'
import { isDayMemoSyncMetadataV5, loadDayMemoSyncMetadataAny } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import { classifyDayMemoNormalDifference, remoteRecordMatchesConfirmedBaseline,
  type DayMemoNormalDifferenceClassification } from './useDayMemoNormalDifferenceRecoveryPlan'
import type { DayMemoSavedRecoveryStateResult } from './useDayMemoSavedRecoveryStateCheck'

export type DayMemoNormalBodyMismatchSafety =
  | 'normal_body_mismatch_compare_ready' | 'normal_body_mismatch_candidate_local' | 'normal_body_mismatch_candidate_remote'
  | 'normal_body_mismatch_checkpoint_missing' | 'normal_body_mismatch_target_missing' | 'normal_body_mismatch_target_mismatch'
  | 'normal_body_mismatch_local_invalid' | 'normal_body_mismatch_remote_invalid' | 'normal_body_mismatch_cursor_invalid'
  | 'normal_body_mismatch_workspace_mismatch' | 'normal_body_mismatch_pending_remaining' | 'normal_body_mismatch_intent_remaining'
  | 'normal_body_mismatch_push_blocked' | 'normal_body_mismatch_remote_changed' | 'normal_body_mismatch_verification_stale'
  | 'normal_body_mismatch_prerequisite_missing' | 'normal_body_mismatch_unsupported' | 'normal_body_mismatch_state_unknown'

export type DayMemoNormalBodyMismatchChoice = 'local' | 'remote'

export interface DayMemoNormalBodyMismatchComparison {
  date: string
  localContent: string
  remoteContent: string
  localUpdatedAt: string
  remoteUpdatedAt: string
  localCharacterCount: number
  remoteCharacterCount: number
  remoteRevision: number
  remoteChangeSequence: number
  checkedAt: string
}

export interface DayMemoNormalBodyMismatchCandidateResult {
  date: string | null
  candidate: DayMemoNormalBodyMismatchChoice | null
  safety: DayMemoNormalBodyMismatchSafety
  localAndRemoteVerified: boolean
  persistentStateChanged: false
  rpcSent: false
  checkedAt: string
  nextAction: string
}

export interface DayMemoNormalBodyMismatchCandidateSnapshot {
  date: string
  candidate: DayMemoNormalBodyMismatchChoice
  metadataRaw: string
  localStorageSerialized: string
  workspaceId: string
  cursor: number
  fullPullMaxSequence: number
  snapshotRevision: number
  baselineRemoteRevision: number
  baselineRemoteChangeSequence: number
  baselineRemoteUpdatedAt: string
  baselineLocalUpdatedAt: string | null
  localMemo: DayMemo
  remoteRecord: RemoteDayMemoRecord
  baselineStatus: 'recovery_required'
  classifications: Record<string, DayMemoNormalDifferenceClassification>
  checkedAt: string
}

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  reactMetadata: DayMemoSyncMetadataV5 | null
  savedRecoveryResult: DayMemoSavedRecoveryStateResult | null
}

const UNRESOLVED = new Set<DayMemoNormalDifferenceClassification>([
  'exact_body_timestamp_mismatch', 'body_mismatch', 'local_only', 'remote_only_active', 'remote_only_tombstone',
])

function connectionIsEligible(connection: SyncConnection | null): connection is SyncConnection & { workspaceId: string } {
  return Boolean(connection && isUuid(connection.workspaceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}

function localSignature(memos: DayMemo[]): string {
  return JSON.stringify(memos.map((memo) => [memo.date, memo.updatedAt, memo.content]).sort(([left], [right]) => left.localeCompare(right)))
}

function nextAction(safety: DayMemoNormalBodyMismatchSafety): string {
  if (safety === 'normal_body_mismatch_compare_ready') return 'localまたはremoteを候補に選び、この候補を確定してください。確定しても採用は実行されません。'
  if (safety === 'normal_body_mismatch_candidate_local') return '次Phaseでlocal候補の鮮度を再確認し、新しいoperationの永続準備を行います。'
  if (safety === 'normal_body_mismatch_candidate_remote') return '次Phaseでremote候補を再取得・再確認し、この端末への明示反映を行います。'
  return '永続状態を変更せず、checkpoint確認から安全条件を再確認してください。'
}

export function useDayMemoNormalBodyMismatchCandidate({ dayMemos, isConfigured, isSignedIn, connection, reactMetadata,
  savedRecoveryResult }: Input) {
  const [selectedDate, setSelectedDateState] = useState('')
  const [checking, setChecking] = useState(false)
  const [comparison, setComparison] = useState<DayMemoNormalBodyMismatchComparison | null>(null)
  const [choice, setChoice] = useState<DayMemoNormalBodyMismatchChoice | null>(null)
  const [result, setResult] = useState<DayMemoNormalBodyMismatchCandidateResult | null>(null)
  const runIdRef = useRef(0)
  const snapshotRevisionRef = useRef(0)
  const comparisonSnapshotRef = useRef<Omit<DayMemoNormalBodyMismatchCandidateSnapshot, 'candidate'> | null>(null)
  const candidateSnapshotRef = useRef<DayMemoNormalBodyMismatchCandidateSnapshot | null>(null)
  const signature = useMemo(() => localSignature(dayMemos), [dayMemos])
  const savedStateReady = savedRecoveryResult?.safety === 'normal_difference_checkpoint_saved_state_ready'
    && savedRecoveryResult.baselineStatus === 'recovery_required'
    && savedRecoveryResult.baselineConfirmedAtNull && savedRecoveryResult.cursorMatched
    && savedRecoveryResult.allBaselinesVerified
  const bodyMismatchDates = useMemo(() => savedStateReady
    ? Object.entries(savedRecoveryResult.unresolvedClassifications)
      .filter(([, classification]) => classification === 'body_mismatch').map(([date]) => date).sort()
    : [], [savedRecoveryResult, savedStateReady])
  const eligible = Boolean(isConfigured && isSignedIn && supabaseClient && connectionIsEligible(connection)
    && reactMetadata?.version === 5 && savedStateReady && bodyMismatchDates.length === 1)

  const finish = useCallback((safety: DayMemoNormalBodyMismatchSafety, date: string | null = selectedDate, candidate: DayMemoNormalBodyMismatchChoice | null = null, verified = false) => {
    setResult({ date, candidate, safety, localAndRemoteVerified: verified, persistentStateChanged: false, rpcSent: false,
      checkedAt: new Date().toISOString(), nextAction: nextAction(safety) })
  }, [selectedDate])

  const discard = useCallback(() => {
    runIdRef.current += 1
    comparisonSnapshotRef.current = null
    candidateSnapshotRef.current = null
    setSelectedDateState(''); setComparison(null); setChoice(null); setResult(null); setChecking(false)
  }, [])

  const setSelectedDate = useCallback((date: string) => {
    runIdRef.current += 1
    comparisonSnapshotRef.current = null
    candidateSnapshotRef.current = null
    setSelectedDateState(bodyMismatchDates.includes(date) ? date : '')
    setComparison(null); setChoice(null); setResult(null); setChecking(false)
  }, [bodyMismatchDates])

  const compare = useCallback(async () => {
    if (!eligible || checking || !supabaseClient || !connectionIsEligible(connection) || !selectedDate) return
    const runId = ++runIdRef.current
    comparisonSnapshotRef.current = null; candidateSnapshotRef.current = null
    setChecking(true); setComparison(null); setChoice(null); setResult(null)
    try {
      if (!savedStateReady || !savedRecoveryResult
        || savedRecoveryResult.unresolvedClassifications[selectedDate] !== 'body_mismatch'
        || bodyMismatchDates.length !== 1) { finish('normal_body_mismatch_checkpoint_missing'); return }
      const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
      const stored = readDayMemoStorageSnapshot(window.localStorage)
      if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata) || !reactMetadata
        || JSON.stringify(loaded.metadata) !== JSON.stringify(reactMetadata) || stored.status !== 'ready') {
        finish('normal_body_mismatch_verification_stale'); return
      }
      const metadata = loaded.metadata
      if (metadata.workspaceId !== connection.workspaceId) { finish('normal_body_mismatch_workspace_mismatch'); return }
      if (metadata.baselineStatus !== 'recovery_required' || metadata.baselineConfirmedAt !== null) { finish('normal_body_mismatch_prerequisite_missing'); return }
      if (metadata.pendingOperation) { finish('normal_body_mismatch_pending_remaining'); return }
      if (Object.keys(metadata.localDeleteIntents).length) { finish('normal_body_mismatch_intent_remaining'); return }
      if (metadata.pushBlock) { finish('normal_body_mismatch_push_blocked'); return }
      if (localSignature(stored.memos) !== signature || localSignature(dayMemos) !== signature) {
        finish('normal_body_mismatch_verification_stale'); return
      }
      const local = stored.memos.find((memo) => memo.date === selectedDate)
      if (!local || !isStoredDayMemo(local)) { finish('normal_body_mismatch_local_invalid'); return }
      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, connection.workspaceId, () => runIdRef.current === runId).catch(() => null)
      if (!pulled || pulled.status !== 'complete') { finish('normal_body_mismatch_remote_invalid'); return }
      const after = loadDayMemoSyncMetadataAny(window.localStorage)
      const afterStored = readDayMemoStorageSnapshot(window.localStorage)
      if (runIdRef.current !== runId || after.status !== 'ready' || after.raw !== loaded.raw
        || afterStored.status !== 'ready' || afterStored.serialized !== stored.serialized || localSignature(dayMemos) !== signature) {
        finish('normal_body_mismatch_verification_stale'); return
      }
      if (pulled.maxChangeSequence !== metadata.lastPulledChangeSequence) { finish('normal_body_mismatch_cursor_invalid'); return }
      const remoteByDate = new Map(pulled.records.map((record) => [record.entityId, record]))
      if (remoteByDate.size !== pulled.records.length) { finish('normal_body_mismatch_remote_invalid'); return }
      const remote = remoteByDate.get(selectedDate)
      if (!remote) { finish('normal_body_mismatch_target_missing'); return }
      if (remote.deletedAt !== null || !remote.payload || remote.payload.date !== selectedDate) {
        finish('normal_body_mismatch_remote_changed'); return
      }
      const targetBaseline = metadata.baselines[selectedDate] ?? null
      if (!targetBaseline || targetBaseline.deletedAt !== null
        || !remoteRecordMatchesConfirmedBaseline(remote, targetBaseline)) {
        finish('normal_body_mismatch_target_mismatch'); return
      }
      if (local.updatedAt === targetBaseline.baselineLocalUpdatedAt
        || local.content === remote.payload.content) {
        finish('normal_body_mismatch_target_mismatch'); return
      }
      const localByDate = new Map(stored.memos.map((memo) => [memo.date, memo]))
      const dates = [...new Set([...localByDate.keys(), ...remoteByDate.keys(), ...Object.keys(metadata.baselines)])].sort()
      const classifications = new Map(dates.map((date) => [date, classifyDayMemoNormalDifference(
        localByDate.get(date) ?? null, remoteByDate.get(date) ?? null, metadata.baselines[date] ?? null)]))
      if (classifications.get(selectedDate) !== 'body_mismatch') { finish('normal_body_mismatch_target_mismatch'); return }
      if ([...classifications.values()].some((value) => ['revision_lineage_mismatch', 'active_tombstone_mismatch', 'unknown'].includes(value))) {
        finish('normal_body_mismatch_remote_changed'); return
      }
      const unresolvedDates = [...classifications].filter(([, value]) => UNRESOLVED.has(value)).map(([date]) => date).sort()
      if (JSON.stringify(Object.fromEntries(unresolvedDates.map((date) => [date, classifications.get(date)])))
          !== JSON.stringify(savedRecoveryResult.unresolvedClassifications)) {
        finish('normal_body_mismatch_remote_changed'); return
      }
      const checkedAt = new Date().toISOString()
      const snapshotRevision = ++snapshotRevisionRef.current
      comparisonSnapshotRef.current = { date: selectedDate, metadataRaw: loaded.raw,
        localStorageSerialized: stored.serialized, workspaceId: connection.workspaceId, cursor: metadata.lastPulledChangeSequence,
        fullPullMaxSequence: pulled.maxChangeSequence, snapshotRevision,
        baselineRemoteRevision: targetBaseline.remoteRevision,
        baselineRemoteChangeSequence: targetBaseline.remoteChangeSequence,
        baselineRemoteUpdatedAt: targetBaseline.remoteUpdatedAt,
        baselineLocalUpdatedAt: targetBaseline.baselineLocalUpdatedAt,
        localMemo: { ...local }, remoteRecord: { ...remote, payload: { ...remote.payload } }, baselineStatus: 'recovery_required',
        classifications: Object.fromEntries(classifications), checkedAt }
      setComparison({ date: selectedDate, localContent: local.content, remoteContent: remote.payload.content,
        localUpdatedAt: local.updatedAt, remoteUpdatedAt: remote.payload.updatedAt,
        localCharacterCount: local.content.length, remoteCharacterCount: remote.payload.content.length,
        remoteRevision: remote.revision, remoteChangeSequence: remote.changeSequence, checkedAt })
      finish('normal_body_mismatch_compare_ready', selectedDate, null, true)
    } finally { if (runIdRef.current === runId) setChecking(false) }
  }, [bodyMismatchDates.length, checking, connection, dayMemos, eligible, finish, reactMetadata,
    savedRecoveryResult, savedStateReady, selectedDate, signature])

  const confirmCandidate = useCallback(() => {
    const snapshot = comparisonSnapshotRef.current
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const stored = readDayMemoStorageSnapshot(window.localStorage)
    if (!snapshot || !choice || !comparison || comparison.date !== snapshot.date
      || !savedStateReady || savedRecoveryResult?.unresolvedClassifications[snapshot.date] !== 'body_mismatch'
      || !connectionIsEligible(connection) || connection.workspaceId !== snapshot.workspaceId
      || loaded.status !== 'ready' || loaded.raw !== snapshot.metadataRaw
      || stored.status !== 'ready' || stored.serialized !== snapshot.localStorageSerialized
      || localSignature(dayMemos) !== localSignature(stored.status === 'ready' ? stored.memos : [])) {
      finish('normal_body_mismatch_verification_stale'); return
    }
    candidateSnapshotRef.current = { ...snapshot, candidate: choice }
    finish(choice === 'local' ? 'normal_body_mismatch_candidate_local' : 'normal_body_mismatch_candidate_remote', snapshot.date, choice, true)
  }, [choice, comparison, connection, dayMemos, finish, savedRecoveryResult, savedStateReady])

  const selectChoice = useCallback((nextChoice: DayMemoNormalBodyMismatchChoice) => {
    candidateSnapshotRef.current = null
    setChoice(nextChoice)
    if (comparison) finish('normal_body_mismatch_compare_ready', comparison.date, null, true)
  }, [comparison, finish])

  const clearChoice = useCallback(() => {
    candidateSnapshotRef.current = null
    setChoice(null)
    if (comparison) finish('normal_body_mismatch_compare_ready', comparison.date, null, true)
  }, [comparison, finish])

  const getCandidateSnapshot = useCallback(() => {
    const snapshot = candidateSnapshotRef.current
    if (!snapshot || !savedStateReady || savedRecoveryResult?.unresolvedClassifications[snapshot.date] !== 'body_mismatch'
      || !connectionIsEligible(connection) || connection.workspaceId !== snapshot.workspaceId) return null
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const stored = readDayMemoStorageSnapshot(window.localStorage)
    if (loaded.status !== 'ready' || loaded.raw !== snapshot.metadataRaw || stored.status !== 'ready'
      || stored.serialized !== snapshot.localStorageSerialized || localSignature(dayMemos) !== localSignature(stored.memos)) return null
    return snapshot
  }, [connection, dayMemos, savedRecoveryResult, savedStateReady])

  const consumeCandidateSnapshot = useCallback(() => {
    comparisonSnapshotRef.current = null
    candidateSnapshotRef.current = null
    setComparison(null)
    setChoice(null)
    setResult(null)
  }, [])

  return { eligible, bodyMismatchDates, selectedDate, setSelectedDate, checking, comparison, choice, setChoice: selectChoice, clearChoice,
    result, compare, confirmCandidate, discard, getCandidateSnapshot, consumeCandidateSnapshot }
}
