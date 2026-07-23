import { useCallback, useRef, useState } from 'react'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { saveDayMemoPullApplyBackup } from '../utils/dayMemoPullApplyBackupStorage'
import { readDayMemoStorageSnapshot, replaceStoredDayMemosVerified } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords } from '../utils/dayMemoSyncPull'
import { isDayMemoSyncMetadataV5, loadDayMemoSyncMetadataAny, replaceDayMemoSyncMetadataV2 } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import { supabaseClient } from '../lib/supabaseClient'
import { classifyDayMemoNormalDifference, remoteRecordMatchesConfirmedBaseline } from './useDayMemoNormalDifferenceRecoveryPlan'
import type { DayMemoNormalBodyMismatchCandidateSnapshot } from './useDayMemoNormalBodyMismatchCandidate'

export type BodyMismatchRemoteAdoptionStage = 'idle' | 'preparation_ready' | 'execution_ready' | 'local_saved' | 'metadata_ready' | 'completed' | 'blocked'
export interface BodyMismatchRemoteAdoptionResult {
  stage: BodyMismatchRemoteAdoptionStage
  date: string | null
  safety: string
  remainingCount: number | null
  localChanged: boolean
  metadataChanged: boolean
  localState: 'unchanged' | 'saved' | 'rolled_back' | 'uncertain'
  remoteWritten: false
  preparationCreated: boolean
  comparisonRunId: number | null
  candidateRevision: number | null
  contentRevision: number | null
  preparationRevision: number | null
  finalVerificationRevision: number | null
  metadataVerified: boolean
  workspaceVerified: boolean
  localVerified: boolean
  remoteVerified: boolean
  baselineVerified: boolean
  cursorVerified: boolean
  differencesVerified: boolean
  localReadBackVerified: boolean
  rollbackAttempted: boolean
  rollbackSucceeded: boolean
  postApplyVerified: boolean
  metadataSaved: boolean
  metadataReadBackVerified: boolean
  baselineStatus: 'recovery_required' | 'confirmed' | null
  normalSyncReady: boolean
  differenceCount: number | null
  checkedAt: string
}

export interface BodyMismatchRemoteAdoptionPreparationRequest {
  date: string
  comparisonRunId: number
  candidateRevision: number
  contentRevision: number
}

export interface BodyMismatchRemoteAdoptionPreparationSnapshot {
  source: DayMemoNormalBodyMismatchCandidateSnapshot
  comparisonRunId: number
  candidateRevision: number
  contentRevision: number
  preparationRevision: number
  metadataRaw: string
  localStorageSerialized: string
  workspaceId: string
  cursor: number
  fullPullMaxSequence: number
  localAfter: DayMemo[]
  checkedAt: string
}

export interface BodyMismatchRemoteAdoptionExecutionVerificationRequest {
  date: string
  comparisonRunId: number
  candidateRevision: number
  contentRevision: number
  preparationRevision: number
}

export interface BodyMismatchRemoteAdoptionExecutionSnapshot {
  preparation: BodyMismatchRemoteAdoptionPreparationSnapshot
  finalVerificationRevision: number
  metadataRaw: string
  localStorageSerialized: string
  workspaceId: string
  cursor: number
  fullPullMaxSequence: number
  checkedAt: string
}

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  reactMetadata: DayMemoSyncMetadataV5 | null
  getCandidateSnapshot: () => DayMemoNormalBodyMismatchCandidateSnapshot | null
  consumeCandidateSnapshot: () => void
  adoptVerifiedStoredDayMemos: (memos: DayMemo[]) => void
  adoptVerifiedMetadata: (metadata: DayMemoSyncMetadataV5) => void
}

interface ApplySnapshot {
  source: DayMemoNormalBodyMismatchCandidateSnapshot
  localAfter: DayMemo[]
  localRawAfter: string
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function eligibleConnection(value: SyncConnection | null): value is SyncConnection & { workspaceId: string } {
  return Boolean(value && isUuid(value.workspaceId)
    && ((value.deviceRole === 'parent' && value.workspaceRole === 'owner' && value.pairingStatus === 'owner')
      || (value.deviceRole === 'child' && value.workspaceRole === 'member' && value.pairingStatus === 'member')))
}

export function useDayMemoBodyMismatchRemoteAdoption(input: Input) {
  const [stage, setStage] = useState<BodyMismatchRemoteAdoptionStage>('idle')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<BodyMismatchRemoteAdoptionResult | null>(null)
  const inFlight = useRef(false)
  const runId = useRef(0)
  const preparationRevision = useRef(0)
  const finalVerificationRevision = useRef(0)
  const preparation = useRef<BodyMismatchRemoteAdoptionPreparationSnapshot | null>(null)
  const execution = useRef<BodyMismatchRemoteAdoptionExecutionSnapshot | null>(null)
  const resultRef = useRef<BodyMismatchRemoteAdoptionResult | null>(null)
  const applied = useRef<ApplySnapshot | null>(null)
  const candidate = input.getCandidateSnapshot()
  const canApply = Boolean(input.isConfigured && input.isSignedIn && eligibleConnection(input.connection)
    && candidate?.candidate === 'remote' && execution.current && stage === 'execution_ready' && !running)

  const finish = useCallback((next: BodyMismatchRemoteAdoptionStage, safety: string, values: Partial<BodyMismatchRemoteAdoptionResult> = {}) => {
    const nextResult = { stage: next, date: null, safety, remainingCount: null, localChanged: false,
      metadataChanged: false, localState: 'unchanged' as const, remoteWritten: false as const,
      preparationCreated: false, comparisonRunId: null, candidateRevision: null, contentRevision: null,
      preparationRevision: null, finalVerificationRevision: null, metadataVerified: false, workspaceVerified: false, localVerified: false,
      remoteVerified: false, baselineVerified: false, cursorVerified: false, differencesVerified: false,
      localReadBackVerified: false, rollbackAttempted: false, rollbackSucceeded: false,
      postApplyVerified: false, metadataSaved: false, metadataReadBackVerified: false,
      baselineStatus: null, normalSyncReady: false, differenceCount: null,
      checkedAt: new Date().toISOString(), ...values }
    resultRef.current = nextResult
    setStage(next)
    setResult(nextResult)
    return nextResult
  }, [])
  const block = useCallback((safety: string, date: string | null,
    localState: BodyMismatchRemoteAdoptionResult['localState'] = 'unchanged') => {
    input.consumeCandidateSnapshot()
    finish('blocked', safety, { date, localState, localChanged: localState === 'saved',
      rollbackAttempted: localState === 'rolled_back' || localState === 'uncertain',
      rollbackSucceeded: localState === 'rolled_back' })
  }, [finish, input])

  const prepareRemote = useCallback(async (request: BodyMismatchRemoteAdoptionPreparationRequest) => {
    const snapshot = input.getCandidateSnapshot()
    const fail = (safety: string, values: Partial<BodyMismatchRemoteAdoptionResult> = {}) => {
      preparation.current = null
      execution.current = null
      return finish('blocked', safety, { date: request.date, comparisonRunId: request.comparisonRunId,
        candidateRevision: request.candidateRevision, contentRevision: request.contentRevision, ...values })
    }
    if (inFlight.current) return resultRef.current
    if (!snapshot) return fail('remote_candidate_missing')
    if (snapshot.candidate !== 'remote') return fail('candidate_choice_mismatch')
    if (snapshot.date !== request.date) return fail('candidate_target_mismatch')
    if (!Number.isSafeInteger(request.comparisonRunId) || request.comparisonRunId < 1
      || !Number.isSafeInteger(request.candidateRevision) || request.candidateRevision < 1
      || !Number.isSafeInteger(request.contentRevision) || request.contentRevision < request.candidateRevision) {
      return fail('preparation_input_invalid')
    }
    if (snapshot.snapshotRevision !== request.contentRevision) return fail('content_revision_mismatch')
    if (!supabaseClient || !input.isConfigured || !input.isSignedIn || !eligibleConnection(input.connection)) {
      return fail('remote_content_check_not_ready')
    }
    inFlight.current = true
    setRunning(true)
    const currentRun = ++runId.current
    try {
      const metadata = loadDayMemoSyncMetadataAny(window.localStorage)
      const local = readDayMemoStorageSnapshot(window.localStorage)
      if (metadata.status !== 'ready' || !isDayMemoSyncMetadataV5(metadata.metadata)
        || local.status !== 'ready' || !input.reactMetadata || !same(input.reactMetadata, metadata.metadata)) {
        return fail('metadata_changed')
      }
      const metadataVerified = metadata.raw === snapshot.metadataRaw
        && metadata.metadata.version === 5 && metadata.metadata.baselineStatus === 'recovery_required'
        && metadata.metadata.baselineConfirmedAt === null && !metadata.metadata.pendingOperation
        && !metadata.metadata.pushBlock && Object.keys(metadata.metadata.localDeleteIntents).length === 0
      if (!metadataVerified) return fail('metadata_changed', { metadataVerified: false })
      const workspaceVerified = input.connection.workspaceId === snapshot.workspaceId
        && metadata.metadata.workspaceId === snapshot.workspaceId
      if (!workspaceVerified) return fail('workspace_changed', { metadataVerified: true })
      const localVerified = local.serialized === snapshot.localStorageSerialized
        && same(input.dayMemos, local.memos)
        && same(local.memos.find((memo) => memo.date === request.date) ?? null, snapshot.localMemo)
      if (!localVerified) return fail('local_changed', { metadataVerified: true, workspaceVerified: true })
      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, snapshot.workspaceId,
        () => runId.current === currentRun).catch(() => null)
      if (!pulled || pulled.status !== 'complete') {
        return fail('full_pull_failed', { metadataVerified: true, workspaceVerified: true, localVerified: true })
      }
      const afterMetadata = loadDayMemoSyncMetadataAny(window.localStorage)
      const afterLocal = readDayMemoStorageSnapshot(window.localStorage)
      if (runId.current !== currentRun || afterMetadata.status !== 'ready' || afterMetadata.raw !== metadata.raw
        || afterLocal.status !== 'ready' || afterLocal.serialized !== local.serialized
        || !same(input.dayMemos, local.memos)) {
        return fail('snapshot_expired', { metadataVerified: true, workspaceVerified: true, localVerified: true })
      }
      const cursorVerified = pulled.maxChangeSequence === metadata.metadata.lastPulledChangeSequence
        && pulled.maxChangeSequence === snapshot.cursor && pulled.maxChangeSequence === snapshot.fullPullMaxSequence
      if (!cursorVerified) return fail('cursor_changed', {
        metadataVerified: true, workspaceVerified: true, localVerified: true })
      const remoteByDate = new Map(pulled.records.map((record) => [record.entityId, record]))
      if (remoteByDate.size !== pulled.records.length) return fail('sequence_invalid', {
        metadataVerified: true, workspaceVerified: true, localVerified: true, cursorVerified: true })
      const target = remoteByDate.get(request.date)
      if (!target || target.deletedAt !== null || !target.payload || !same(target, snapshot.remoteRecord)) {
        return fail('remote_changed', { metadataVerified: true, workspaceVerified: true,
          localVerified: true, cursorVerified: true })
      }
      const baseline = metadata.metadata.baselines[request.date] ?? null
      if (!baseline || !remoteRecordMatchesConfirmedBaseline(target, baseline)) {
        return fail('baseline_mismatch', { metadataVerified: true, workspaceVerified: true,
          localVerified: true, cursorVerified: true, remoteVerified: true })
      }
      const localByDate = new Map(local.memos.map((memo) => [memo.date, memo]))
      const dates = [...new Set([...localByDate.keys(), ...remoteByDate.keys(), ...Object.keys(metadata.metadata.baselines)])].sort()
      for (const date of dates) {
        const classification = classifyDayMemoNormalDifference(localByDate.get(date) ?? null,
          remoteByDate.get(date) ?? null, metadata.metadata.baselines[date] ?? null)
        if (classification !== snapshot.classifications[date]) {
          const tombstone = metadata.metadata.baselines[date]?.deletedAt != null
          return fail(tombstone ? 'confirmed_tombstone_mismatch' : 'difference_changed', {
            metadataVerified: true, workspaceVerified: true, localVerified: true, cursorVerified: true,
            remoteVerified: true, baselineVerified: true })
        }
      }
      if (snapshot.classifications[request.date] !== 'body_mismatch') return fail('body_mismatch_not_found', {
        metadataVerified: true, workspaceVerified: true, localVerified: true, cursorVerified: true,
        remoteVerified: true, baselineVerified: true })
      const checkedAt = new Date().toISOString()
      const nextPreparationRevision = ++preparationRevision.current
      const prepared = { source: snapshot, comparisonRunId: request.comparisonRunId,
        candidateRevision: request.candidateRevision, contentRevision: request.contentRevision,
        preparationRevision: nextPreparationRevision, metadataRaw: metadata.raw,
        localStorageSerialized: local.serialized, workspaceId: snapshot.workspaceId,
        cursor: metadata.metadata.lastPulledChangeSequence, fullPullMaxSequence: pulled.maxChangeSequence,
        localAfter: local.memos.map((memo) => memo.date === request.date ? { ...target.payload! } : { ...memo }), checkedAt }
      preparation.current = prepared
      const nextFinalRevision = ++finalVerificationRevision.current
      execution.current = { preparation: prepared, finalVerificationRevision: nextFinalRevision,
        metadataRaw: metadata.raw, localStorageSerialized: local.serialized, workspaceId: snapshot.workspaceId,
        cursor: metadata.metadata.lastPulledChangeSequence, fullPullMaxSequence: pulled.maxChangeSequence, checkedAt }
      return finish('execution_ready', 'body_mismatch_remote_execution_verification_ready', {
        date: request.date, preparationCreated: true, comparisonRunId: request.comparisonRunId,
        candidateRevision: request.candidateRevision, contentRevision: request.contentRevision,
        preparationRevision: nextPreparationRevision, finalVerificationRevision: nextFinalRevision,
        metadataVerified: true, workspaceVerified: true,
        localVerified: true, remoteVerified: true, baselineVerified: true, cursorVerified: true,
        differencesVerified: true, checkedAt })
    } catch {
      return fail('unknown')
    } finally {
      inFlight.current = false
      setRunning(false)
    }
  }, [finish, input])

  const verifyPreparedRemote = useCallback(async (request: BodyMismatchRemoteAdoptionExecutionVerificationRequest) => {
    const prepared = preparation.current
    const candidate = input.getCandidateSnapshot()
    const fail = (safety: string, values: Partial<BodyMismatchRemoteAdoptionResult> = {}) => {
      execution.current = null
      return finish('blocked', safety, { date: request.date, comparisonRunId: request.comparisonRunId,
        candidateRevision: request.candidateRevision, contentRevision: request.contentRevision,
        preparationRevision: request.preparationRevision, ...values })
    }
    if (inFlight.current) return resultRef.current
    if (!prepared) return fail('remote_preparation_missing')
    if (stage !== 'preparation_ready' && stage !== 'blocked') return fail('remote_preparation_not_ready')
    if (!candidate) return fail('candidate_missing')
    if (candidate.candidate !== 'remote') return fail('candidate_choice_mismatch')
    if (candidate.date !== request.date || prepared.source.date !== request.date) return fail('candidate_target_mismatch')
    if (prepared.comparisonRunId !== request.comparisonRunId) return fail('comparison_run_mismatch')
    if (prepared.candidateRevision !== request.candidateRevision) return fail('candidate_revision_mismatch')
    if (prepared.contentRevision !== request.contentRevision
      || candidate.snapshotRevision !== request.contentRevision) return fail('content_revision_mismatch')
    if (prepared.preparationRevision !== request.preparationRevision) return fail('preparation_revision_mismatch')
    if (!supabaseClient || !input.isConfigured || !input.isSignedIn || !eligibleConnection(input.connection)) {
      return fail('execution_verification_input_invalid')
    }
    inFlight.current = true
    setRunning(true)
    const currentRun = ++runId.current
    try {
      const metadata = loadDayMemoSyncMetadataAny(window.localStorage)
      const local = readDayMemoStorageSnapshot(window.localStorage)
      if (metadata.status !== 'ready' || !isDayMemoSyncMetadataV5(metadata.metadata)
        || local.status !== 'ready' || !input.reactMetadata || !same(input.reactMetadata, metadata.metadata)) {
        return fail('metadata_changed')
      }
      const metadataVerified = metadata.raw === prepared.metadataRaw && metadata.raw === candidate.metadataRaw
        && metadata.metadata.version === 5 && metadata.metadata.baselineStatus === 'recovery_required'
        && metadata.metadata.baselineConfirmedAt === null && !metadata.metadata.pendingOperation
        && !metadata.metadata.pushBlock && Object.keys(metadata.metadata.localDeleteIntents).length === 0
      if (!metadataVerified) return fail('metadata_changed')
      const workspaceVerified = input.connection.workspaceId === prepared.workspaceId
        && candidate.workspaceId === prepared.workspaceId && metadata.metadata.workspaceId === prepared.workspaceId
      if (!workspaceVerified) return fail('workspace_changed', { metadataVerified: true })
      const storageLocalVerified = local.serialized === prepared.localStorageSerialized
        && local.serialized === candidate.localStorageSerialized
        && same(local.memos.find((memo) => memo.date === request.date) ?? null, candidate.localMemo)
      if (!storageLocalVerified) return fail('local_changed', { metadataVerified: true, workspaceVerified: true })
      if (!same(input.dayMemos, local.memos)) return fail('react_local_changed', {
        metadataVerified: true, workspaceVerified: true })
      const expectedLocalAfter = local.memos.map((memo) => memo.date === request.date
        ? { ...candidate.remoteRecord.payload! } : { ...memo })
      if (!candidate.remoteRecord.payload || !same(expectedLocalAfter, prepared.localAfter)
        || expectedLocalAfter.filter((memo) => memo.date === request.date).length !== 1) {
        return fail('execution_verification_input_invalid', {
          metadataVerified: true, workspaceVerified: true, localVerified: true })
      }
      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, prepared.workspaceId,
        () => runId.current === currentRun).catch(() => null)
      if (!pulled || pulled.status !== 'complete') return fail('full_pull_failed', {
        metadataVerified: true, workspaceVerified: true, localVerified: true })
      const afterMetadata = loadDayMemoSyncMetadataAny(window.localStorage)
      const afterLocal = readDayMemoStorageSnapshot(window.localStorage)
      if (runId.current !== currentRun || afterMetadata.status !== 'ready' || afterMetadata.raw !== metadata.raw
        || afterLocal.status !== 'ready' || afterLocal.serialized !== local.serialized
        || !same(input.dayMemos, local.memos)) {
        return fail('snapshot_expired', { metadataVerified: true, workspaceVerified: true, localVerified: true })
      }
      const cursorVerified = pulled.maxChangeSequence === metadata.metadata.lastPulledChangeSequence
        && pulled.maxChangeSequence === prepared.cursor && pulled.maxChangeSequence === prepared.fullPullMaxSequence
        && pulled.maxChangeSequence === candidate.cursor && pulled.maxChangeSequence === candidate.fullPullMaxSequence
      if (!cursorVerified) return fail('cursor_changed', {
        metadataVerified: true, workspaceVerified: true, localVerified: true })
      const remoteByDate = new Map(pulled.records.map((record) => [record.entityId, record]))
      if (remoteByDate.size !== pulled.records.length) return fail('sequence_invalid', {
        metadataVerified: true, workspaceVerified: true, localVerified: true, cursorVerified: true })
      const target = remoteByDate.get(request.date)
      if (!target || target.deletedAt !== null || !target.payload || !same(target, candidate.remoteRecord)) {
        return fail('remote_changed', { metadataVerified: true, workspaceVerified: true,
          localVerified: true, cursorVerified: true })
      }
      const baseline = metadata.metadata.baselines[request.date] ?? null
      if (!baseline || !remoteRecordMatchesConfirmedBaseline(target, baseline)) {
        return fail('baseline_mismatch', { metadataVerified: true, workspaceVerified: true,
          localVerified: true, cursorVerified: true, remoteVerified: true })
      }
      const localByDate = new Map(local.memos.map((memo) => [memo.date, memo]))
      const dates = [...new Set([...localByDate.keys(), ...remoteByDate.keys(), ...Object.keys(metadata.metadata.baselines)])].sort()
      for (const date of dates) {
        const classification = classifyDayMemoNormalDifference(localByDate.get(date) ?? null,
          remoteByDate.get(date) ?? null, metadata.metadata.baselines[date] ?? null)
        if (classification !== candidate.classifications[date]) {
          const tombstone = metadata.metadata.baselines[date]?.deletedAt != null
          return fail(tombstone ? 'confirmed_tombstone_mismatch' : 'difference_changed', {
            metadataVerified: true, workspaceVerified: true, localVerified: true, cursorVerified: true,
            remoteVerified: true, baselineVerified: true })
        }
      }
      if (candidate.classifications[request.date] !== 'body_mismatch') return fail('body_mismatch_not_found', {
        metadataVerified: true, workspaceVerified: true, localVerified: true, cursorVerified: true,
        remoteVerified: true, baselineVerified: true })
      const checkedAt = new Date().toISOString()
      const nextFinalRevision = ++finalVerificationRevision.current
      execution.current = { preparation: prepared, finalVerificationRevision: nextFinalRevision,
        metadataRaw: metadata.raw, localStorageSerialized: local.serialized, workspaceId: prepared.workspaceId,
        cursor: metadata.metadata.lastPulledChangeSequence, fullPullMaxSequence: pulled.maxChangeSequence, checkedAt }
      return finish('execution_ready', 'body_mismatch_remote_execution_verification_ready', {
        date: request.date, preparationCreated: true, comparisonRunId: request.comparisonRunId,
        candidateRevision: request.candidateRevision, contentRevision: request.contentRevision,
        preparationRevision: request.preparationRevision, finalVerificationRevision: nextFinalRevision,
        metadataVerified: true, workspaceVerified: true, localVerified: true, remoteVerified: true,
        baselineVerified: true, cursorVerified: true, differencesVerified: true, checkedAt })
    } catch {
      return fail('unknown')
    } finally {
      inFlight.current = false
      setRunning(false)
    }
  }, [finish, input, stage])

  const applyRemote = useCallback(async () => {
    const verified = execution.current
    const snapshot = verified?.preparation.source ?? null
    if (!verified || !snapshot || snapshot.candidate !== 'remote' || inFlight.current
      || !input.isConfigured || !input.isSignedIn || !eligibleConnection(input.connection)) return
    inFlight.current = true; setRunning(true)
    let localWriteCompleted = false
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      const metadata = loadDayMemoSyncMetadataAny(window.localStorage)
      const local = readDayMemoStorageSnapshot(window.localStorage)
      if (metadata.status !== 'ready' || !isDayMemoSyncMetadataV5(metadata.metadata) || local.status !== 'ready'
        || metadata.raw !== verified.metadataRaw || metadata.raw !== snapshot.metadataRaw
        || local.serialized !== verified.localStorageSerialized || local.serialized !== snapshot.localStorageSerialized
        || !input.reactMetadata || !same(input.reactMetadata, metadata.metadata) || !same(input.dayMemos, local.memos)
        || !eligibleConnection(input.connection) || input.connection.workspaceId !== snapshot.workspaceId
        || metadata.metadata.baselineStatus !== 'recovery_required' || metadata.metadata.baselineConfirmedAt !== null
        || metadata.metadata.pendingOperation || metadata.metadata.pushBlock || Object.keys(metadata.metadata.localDeleteIntents).length) {
        block('body_mismatch_remote_source_changed', snapshot.date); return
      }
      const current = local.memos.filter((memo) => memo.date === snapshot.date)
      if (current.length !== 1 || !same(current[0], snapshot.localMemo)
        || snapshot.remoteRecord.deletedAt !== null || !snapshot.remoteRecord.payload
        || snapshot.remoteRecord.payload.date !== snapshot.date) {
        block('body_mismatch_remote_target_changed', snapshot.date); return
      }
      const targetBaseline = metadata.metadata.baselines[snapshot.date] ?? null
      if (targetBaseline && !remoteRecordMatchesConfirmedBaseline(snapshot.remoteRecord, targetBaseline)) {
        block('body_mismatch_remote_source_changed', snapshot.date); return
      }
      const next = local.memos.map((memo) => memo.date === snapshot.date ? { ...snapshot.remoteRecord.payload! } : memo)
      if (!same(next, verified.preparation.localAfter)) {
        block('execution_snapshot_expired', snapshot.date); return
      }
      const backup = saveDayMemoPullApplyBackup(window.localStorage, snapshot.workspaceId, local.memos,
        { replaceExistingForSameWorkspace: true })
      if (backup !== 'saved' && backup !== 'reused') {
        block(backup === 'rollback_failed' ? 'body_mismatch_remote_backup_rollback_failed' : 'body_mismatch_remote_backup_failed', snapshot.date)
        return
      }
      const saved = replaceStoredDayMemosVerified(window.localStorage, next, local.serialized)
      if (saved !== 'saved') {
        block(saved === 'rollback_failed' ? 'body_mismatch_remote_rollback_failed' : 'body_mismatch_remote_local_save_failed',
          snapshot.date, saved === 'rollback_failed' ? 'uncertain' : saved === 'readback_invalid' ? 'rolled_back' : 'unchanged')
        return
      }
      const readBack = readDayMemoStorageSnapshot(window.localStorage)
      if (readBack.status !== 'ready' || !same(readBack.memos, next)) {
        const rollback = readBack.status === 'ready' ? replaceStoredDayMemosVerified(window.localStorage, local.memos, readBack.serialized) : 'rollback_failed'
        block(rollback === 'saved' ? 'body_mismatch_remote_readback_failed' : 'body_mismatch_remote_rollback_failed',
          snapshot.date, rollback === 'saved' ? 'rolled_back' : 'uncertain')
        return
      }
      localWriteCompleted = true
      applied.current = { source: snapshot, localAfter: next, localRawAfter: readBack.serialized }
      execution.current = null
      input.adoptVerifiedStoredDayMemos(next.map((memo) => ({ ...memo })))
      input.consumeCandidateSnapshot()
      finish('local_saved', 'body_mismatch_remote_local_saved', { date: snapshot.date,
        localChanged: true, localState: 'saved', localReadBackVerified: true })
    } catch {
      block('body_mismatch_remote_unexpected_failure', snapshot.date, localWriteCompleted ? 'uncertain' : 'unchanged')
    } finally { inFlight.current = false; setRunning(false) }
  }, [block, finish, input])

  const verifyAndApplyRemote = useCallback(async () => {
    const snapshot = input.getCandidateSnapshot()
    if (!snapshot || snapshot.candidate !== 'remote') {
      return finish('blocked', 'remote_candidate_missing')
    }
    const verified = await prepareRemote({ date: snapshot.date,
      comparisonRunId: snapshot.snapshotRevision, candidateRevision: snapshot.snapshotRevision,
      contentRevision: snapshot.snapshotRevision })
    if (verified?.stage !== 'execution_ready') return verified
    await applyRemote()
    return resultRef.current
  }, [applyRemote, finish, input, prepareRemote])

  const finalizeRemoteAdoption = useCallback(async () => {
    const snapshot = applied.current
    if (!snapshot || (stage !== 'local_saved' && stage !== 'blocked') || inFlight.current || !supabaseClient
      || !eligibleConnection(input.connection)) return resultRef.current
    inFlight.current = true
    setRunning(true)
    const currentRun = ++runId.current
    try {
      const metadata = loadDayMemoSyncMetadataAny(window.localStorage)
      const local = readDayMemoStorageSnapshot(window.localStorage)
      if (metadata.status !== 'ready' || !isDayMemoSyncMetadataV5(metadata.metadata) || local.status !== 'ready'
        || metadata.raw !== snapshot.source.metadataRaw || local.serialized !== snapshot.localRawAfter
        || !same(local.memos, snapshot.localAfter) || !same(input.dayMemos, snapshot.localAfter)
        || !input.reactMetadata || !same(input.reactMetadata, metadata.metadata)
        || input.connection.workspaceId !== snapshot.source.workspaceId
        || metadata.metadata.baselineStatus !== 'recovery_required' || metadata.metadata.baselineConfirmedAt !== null
        || metadata.metadata.pendingOperation || metadata.metadata.pushBlock
        || Object.keys(metadata.metadata.localDeleteIntents).length) {
        block('post_apply_verification_failed', snapshot.source.date, 'saved'); return resultRef.current
      }
      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, snapshot.source.workspaceId,
        () => runId.current === currentRun).catch(() => null)
      const afterMetadata = loadDayMemoSyncMetadataAny(window.localStorage)
      const afterLocal = readDayMemoStorageSnapshot(window.localStorage)
      if (!pulled || pulled.status !== 'complete' || afterMetadata.status !== 'ready'
        || afterMetadata.raw !== metadata.raw || afterLocal.status !== 'ready'
        || afterLocal.serialized !== local.serialized
        || pulled.maxChangeSequence !== metadata.metadata.lastPulledChangeSequence) {
        block('post_apply_full_pull_failed', snapshot.source.date, 'saved'); return resultRef.current
      }
      const remoteByDate = new Map(pulled.records.map((record) => [record.entityId, record]))
      if (remoteByDate.size !== pulled.records.length) {
        block('sequence_invalid', snapshot.source.date, 'saved'); return resultRef.current
      }
      const target = remoteByDate.get(snapshot.source.date)
      const targetLocal = local.memos.find((memo) => memo.date === snapshot.source.date) ?? null
      if (!target || !targetLocal || target.deletedAt !== null || !target.payload
        || !same(target, snapshot.source.remoteRecord) || !same(targetLocal, target.payload)) {
        block('post_apply_verification_failed', snapshot.source.date, 'saved'); return resultRef.current
      }
      const localByDate = new Map(local.memos.map((memo) => [memo.date, memo]))
      const dates = [...new Set([...localByDate.keys(), ...remoteByDate.keys(), ...Object.keys(metadata.metadata.baselines)])].sort()
      for (const date of dates) {
        if (date === snapshot.source.date) continue
        const classification = classifyDayMemoNormalDifference(localByDate.get(date) ?? null,
          remoteByDate.get(date) ?? null, metadata.metadata.baselines[date] ?? null)
        if (classification !== snapshot.source.classifications[date]) {
          block(metadata.metadata.baselines[date]?.deletedAt != null
            ? 'confirmed_tombstone_mismatch' : 'difference_changed', snapshot.source.date, 'saved')
          return resultRef.current
        }
      }
      const now = new Date().toISOString()
      const baselines = { ...metadata.metadata.baselines, [snapshot.source.date]: {
        date: snapshot.source.date, remoteRevision: target.revision,
        remoteChangeSequence: target.changeSequence, remoteUpdatedAt: target.payload.updatedAt,
        baselineLocalUpdatedAt: targetLocal.updatedAt, deletedAt: null } }
      const recoveryCandidate: DayMemoSyncMetadataV5 = { ...metadata.metadata, baselines,
        lastPulledChangeSequence: pulled.maxChangeSequence, baselineStatus: 'recovery_required', baselineConfirmedAt: null }
      if (!isDayMemoSyncMetadataV5(recoveryCandidate)) {
        block('cleanup_candidate_failed', snapshot.source.date, 'saved'); return resultRef.current
      }
      const differenceCount = dates.filter((date) => classifyDayMemoNormalDifference(localByDate.get(date) ?? null,
        remoteByDate.get(date) ?? null, recoveryCandidate.baselines[date] ?? null) !== 'exact_match_baseline_confirmed').length
      const candidateMetadata: DayMemoSyncMetadataV5 = differenceCount === 0
        ? { ...recoveryCandidate, baselineStatus: 'confirmed', baselineConfirmedAt: now,
          pendingOperation: null, lastSuccessfulSyncAt: now }
        : recoveryCandidate
      if (!isDayMemoSyncMetadataV5(candidateMetadata)) {
        block('cleanup_candidate_failed', snapshot.source.date, 'saved'); return resultRef.current
      }
      const saved = replaceDayMemoSyncMetadataV2(window.localStorage, candidateMetadata, metadata.raw)
      if (saved !== 'saved') {
        finish('blocked', saved === 'rollback_failed' ? 'cleanup_rollback_failed' : 'cleanup_write_failed', {
          date: snapshot.source.date, localChanged: true, localState: 'saved', postApplyVerified: true,
          rollbackAttempted: saved === 'rollback_failed', rollbackSucceeded: false, differenceCount })
        return resultRef.current
      }
      const readBack = loadDayMemoSyncMetadataAny(window.localStorage)
      if (readBack.status !== 'ready' || !isDayMemoSyncMetadataV5(readBack.metadata)
        || !same(readBack.metadata, candidateMetadata)) {
        const rollback = readBack.status === 'ready'
          ? replaceDayMemoSyncMetadataV2(window.localStorage, metadata.metadata, readBack.raw) : 'rollback_failed'
        finish('blocked', rollback === 'saved' ? 'cleanup_read_back_failed' : 'cleanup_rollback_failed', {
          date: snapshot.source.date, localChanged: true, localState: 'saved', postApplyVerified: true,
          rollbackAttempted: true, rollbackSucceeded: rollback === 'saved', differenceCount })
        return resultRef.current
      }
      const normalSyncReady = differenceCount === 0 && readBack.metadata.baselineStatus === 'confirmed'
        && Boolean(readBack.metadata.baselineConfirmedAt) && !readBack.metadata.pendingOperation
        && !readBack.metadata.pushBlock && Object.keys(readBack.metadata.localDeleteIntents).length === 0
      input.adoptVerifiedMetadata(readBack.metadata)
      applied.current = null
      preparation.current = null
      execution.current = null
      return finish('completed', normalSyncReady ? 'body_mismatch_remote_completed_normal_sync_ready'
        : 'body_mismatch_remote_completed_remaining_differences', {
        date: snapshot.source.date, remainingCount: differenceCount, localChanged: true,
        metadataChanged: true, localState: 'saved', localReadBackVerified: true,
        postApplyVerified: true, metadataSaved: true, metadataReadBackVerified: true,
        baselineStatus: readBack.metadata.baselineStatus === 'confirmed' ? 'confirmed' : 'recovery_required',
        normalSyncReady, differenceCount,
        metadataVerified: true, workspaceVerified: true, localVerified: true,
        remoteVerified: true, baselineVerified: true, cursorVerified: true,
        differencesVerified: true })
    } catch {
      block('unknown', snapshot.source.date, 'saved')
      return resultRef.current
    } finally {
      inFlight.current = false
      setRunning(false)
    }
  }, [block, finish, input, stage])

  const discard = useCallback(() => {
    if (running) return
    runId.current += 1; preparation.current = null; execution.current = null; applied.current = null; resultRef.current = null; setStage('idle'); setResult(null)
  }, [running])
  const getPreparationSnapshot = useCallback(() => preparation.current, [])
  const getExecutionSnapshot = useCallback(() => execution.current, [])
  return { stage, running, result, canPrepare: stage === 'idle' && Boolean(candidate), canApply,
    prepareRemote, verifyPreparedRemote, verifyAndApplyRemote, getPreparationSnapshot, getExecutionSnapshot,
    applyRemote, finalizeRemoteAdoption, discard }
}
