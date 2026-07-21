import { useCallback, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { saveDayMemoPullApplyBackup } from '../utils/dayMemoPullApplyBackupStorage'
import { isStoredDayMemo, readDayMemoStorageSnapshot, replaceStoredDayMemosVerified } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords, type RemoteDayMemoRecord } from '../utils/dayMemoSyncPull'
import { isDayMemoSyncMetadataV5, loadDayMemoSyncMetadataAny, replaceDayMemoSyncMetadataV2 } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import { classifyDayMemoNormalDifference, type DayMemoNormalDifferenceClassification } from './useDayMemoNormalDifferenceRecoveryPlan'
import type { DayMemoSavedRecoveryStateResult } from './useDayMemoSavedRecoveryStateCheck'

export type RecoveryRemoteOnlyStage = 'idle' | 'candidate_ready' | 'local_saved' | 'post_adoption_ready' | 'metadata_saved' | 'blocked'
export interface RecoveryRemoteOnlyResult { stage: RecoveryRemoteOnlyStage; date: string | null; safety: string; checkedAt: string
  unresolvedCount: number; persistentChanged: boolean; localState: 'unchanged' | 'saved' | 'rolled_back' | 'uncertain' }

interface Snapshot {
  token: string; date: string; workspaceId: string; metadataRaw: string; localRaw: string
  remote: RemoteDayMemoRecord & { payload: DayMemo }; candidateLocal: DayMemo[]
  candidateMetadata: DayMemoSyncMetadataV5 | null; outsideClassifications: Record<string, DayMemoNormalDifferenceClassification>
  remoteFingerprint: string; unresolvedCount: number; consumed: boolean
}
interface Input { dayMemos: DayMemo[]; isConfigured: boolean; isSignedIn: boolean; connection: SyncConnection | null
  reactMetadata: DayMemoSyncMetadataV5 | null; savedResult: DayMemoSavedRecoveryStateResult | null
  adoptVerifiedStoredDayMemos: (memos: DayMemo[]) => void; adoptVerifiedMetadata: (metadata: DayMemoSyncMetadataV5) => void }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const signature = (memos: DayMemo[]) => JSON.stringify(memos.map((m) => [m.date, m.updatedAt, m.content]).sort())
const remoteFingerprint = (records: RemoteDayMemoRecord[]) => JSON.stringify([...records]
  .sort((a, b) => a.entityId.localeCompare(b.entityId)))
function eligibleConnection(connection: SyncConnection | null): connection is SyncConnection & { workspaceId: string } {
  return Boolean(connection && isUuid(connection.workspaceId) && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
    || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}
function classifyAll(metadata: DayMemoSyncMetadataV5, locals: DayMemo[], remotes: RemoteDayMemoRecord[]) {
  const local = new Map(locals.map((item) => [item.date, item])); const remote = new Map(remotes.map((item) => [item.entityId, item]))
  const dates = [...new Set([...local.keys(), ...remote.keys(), ...Object.keys(metadata.baselines)])].sort()
  return Object.fromEntries(dates.map((date) => [date, classifyDayMemoNormalDifference(local.get(date) ?? null, remote.get(date) ?? null, metadata.baselines[date] ?? null)])) as Record<string, DayMemoNormalDifferenceClassification>
}
function unresolvedOnly(classifications: Record<string, DayMemoNormalDifferenceClassification>) {
  return Object.fromEntries(Object.entries(classifications)
    .filter(([, value]) => value !== 'exact_match_baseline_confirmed')) as Record<string, DayMemoNormalDifferenceClassification>
}

export function useDayMemoRecoveryRemoteOnlyAdoption(input: Input) {
  const [stage, setStage] = useState<RecoveryRemoteOnlyStage>('idle'); const [result, setResult] = useState<RecoveryRemoteOnlyResult | null>(null)
  const [running, setRunning] = useState(false); const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const snapshotRef = useRef<Snapshot | null>(null); const runRef = useRef(0); const inFlightRef = useRef(false)
  const currentSignature = useMemo(() => signature(input.dayMemos), [input.dayMemos])
  const candidateDates = useMemo(() => input.savedResult?.safety === 'normal_difference_checkpoint_saved_state_ready'
    ? Object.entries(input.savedResult.unresolvedClassifications).filter(([, value]) => value === 'remote_only_active').map(([date]) => date)
    : [], [input.savedResult])
  const eligible = Boolean(input.isConfigured && input.isSignedIn && eligibleConnection(input.connection) && candidateDates.length && stage === 'idle')
  const finish = (nextStage: RecoveryRemoteOnlyStage, safety: string, date: string | null, unresolvedCount = 0,
    persistentChanged = false, localState: RecoveryRemoteOnlyResult['localState'] = 'unchanged') => {
    setStage(nextStage); setResult({ stage: nextStage, date, safety, checkedAt: new Date().toISOString(), unresolvedCount, persistentChanged, localState })
  }
  const block = (safety: string, date: string | null, localState: RecoveryRemoteOnlyResult['localState'] = 'unchanged') => {
    snapshotRef.current = null; finish('blocked', safety, date, 0, localState === 'saved' || localState === 'uncertain', localState)
    setSafeErrorMessage('同期状態が変化したため、安全側で停止しました。再確認してください。')
  }
  const loadFresh = () => {
    const metadata = loadDayMemoSyncMetadataAny(window.localStorage); const local = readDayMemoStorageSnapshot(window.localStorage)
    if (metadata.status !== 'ready' || !isDayMemoSyncMetadataV5(metadata.metadata) || local.status !== 'ready') return null
    return { metadata: metadata.metadata, metadataRaw: metadata.raw, local: local.memos, localRaw: local.serialized }
  }

  const checkCandidate = useCallback(async (targetDate: string) => {
    if (!eligible || !candidateDates.includes(targetDate) || !eligibleConnection(input.connection) || !supabaseClient || inFlightRef.current) return
    inFlightRef.current = true; setRunning(true); setSafeErrorMessage(null); const run = ++runRef.current
    try {
      const before = loadFresh(); if (!before || !input.reactMetadata || !same(before.metadata, input.reactMetadata)
        || signature(before.local) !== currentSignature || before.metadata.workspaceId !== input.connection.workspaceId
        || before.metadata.baselineStatus !== 'recovery_required' || before.metadata.baselineConfirmedAt !== null
        || before.metadata.pendingOperation || before.metadata.pushBlock || Object.keys(before.metadata.localDeleteIntents).length
        || before.metadata.baselines[targetDate] || before.local.some((memo) => memo.date === targetDate)) { block('remote_only_candidate_prerequisite_changed', targetDate); return }
      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, input.connection.workspaceId, () => runRef.current === run).catch(() => null)
      const after = loadFresh(); if (!pulled || pulled.status !== 'complete' || !after || after.metadataRaw !== before.metadataRaw || after.localRaw !== before.localRaw
        || pulled.maxChangeSequence !== before.metadata.lastPulledChangeSequence) { block('remote_only_candidate_pull_or_state_invalid', targetDate); return }
      const targets = pulled.records.filter((record) => record.entityId === targetDate); const remote = targets.length === 1 ? targets[0] : null
      if (!remote || remote.deletedAt !== null || !remote.payload || !isStoredDayMemo(remote.payload) || remote.payload.date !== targetDate
        || classifyDayMemoNormalDifference(null, remote, null) !== 'remote_only_active') { block(remote?.deletedAt ? 'remote_only_candidate_tombstone' : 'remote_only_candidate_invalid_remote', targetDate); return }
      const classifications = classifyAll(before.metadata, before.local, pulled.records)
      const unresolved = unresolvedOnly(classifications)
      if (classifications[targetDate] !== 'remote_only_active'
        || !same(unresolved, input.savedResult?.unresolvedClassifications)) { block('remote_only_candidate_other_difference_changed', targetDate); return }
      const outsideClassifications = Object.fromEntries(Object.entries(unresolved).filter(([date]) => date !== targetDate))
      const candidateLocal = [...before.local, { ...remote.payload }].sort((a, b) => a.date.localeCompare(b.date))
      snapshotRef.current = { token: crypto.randomUUID(), date: targetDate, workspaceId: input.connection.workspaceId, metadataRaw: before.metadataRaw,
        localRaw: before.localRaw, remote: { ...remote, payload: { ...remote.payload } }, candidateLocal, candidateMetadata: null,
        outsideClassifications, remoteFingerprint: remoteFingerprint(pulled.records), unresolvedCount: Object.keys(unresolved).length, consumed: false }
      finish('candidate_ready', 'remote_only_active_candidate_ready', targetDate, Object.keys(unresolved).length)
    } finally { inFlightRef.current = false; setRunning(false) }
  }, [candidateDates, currentSignature, eligible, input.connection, input.reactMetadata, input.savedResult])

  const adoptLocal = useCallback(async () => {
    const snapshot = snapshotRef.current; if (!snapshot || stage !== 'candidate_ready' || snapshot.consumed) return
    if (!window.confirm('同期先のDayMemoをこの端末へ反映します。よろしいですか？')) return
    if (inFlightRef.current || !eligibleConnection(input.connection) || !supabaseClient) return
    inFlightRef.current = true; setRunning(true); const run = ++runRef.current
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      const fresh = loadFresh(); if (!fresh || fresh.metadataRaw !== snapshot.metadataRaw || fresh.localRaw !== snapshot.localRaw
        || fresh.local.some((memo) => memo.date === snapshot.date) || input.connection.workspaceId !== snapshot.workspaceId) {
        block('remote_only_adoption_snapshot_changed', snapshot.date); return
      }
      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, snapshot.workspaceId, () => runRef.current === run).catch(() => null)
      const after = loadFresh()
      if (!pulled || pulled.status !== 'complete' || !after || after.metadataRaw !== snapshot.metadataRaw || after.localRaw !== snapshot.localRaw
        || pulled.maxChangeSequence !== fresh.metadata.lastPulledChangeSequence
        || remoteFingerprint(pulled.records) !== snapshot.remoteFingerprint) {
        block('remote_only_adoption_remote_or_state_changed', snapshot.date); return
      }
      const classifications = classifyAll(fresh.metadata, fresh.local, pulled.records)
      const outside = Object.fromEntries(Object.entries(unresolvedOnly(classifications)).filter(([date]) => date !== snapshot.date))
      const remote = pulled.records.filter((record) => record.entityId === snapshot.date)
      if (remote.length !== 1 || !same(remote[0], snapshot.remote) || classifications[snapshot.date] !== 'remote_only_active'
        || !same(outside, snapshot.outsideClassifications)) { block('remote_only_adoption_outside_difference_changed', snapshot.date); return }
      const backup = saveDayMemoPullApplyBackup(window.localStorage, snapshot.workspaceId, fresh.local,
        { replaceExistingForSameWorkspace: true })
      if (backup !== 'saved' && backup !== 'reused') { block('remote_only_adoption_backup_failed', snapshot.date); return }
      const saved = replaceStoredDayMemosVerified(window.localStorage, snapshot.candidateLocal, snapshot.localRaw)
      if (saved !== 'saved') {
        block(saved === 'rollback_failed' ? 'remote_only_adoption_rollback_failed' : 'remote_only_adoption_local_save_failed', snapshot.date,
          saved === 'rollback_failed' ? 'uncertain' : saved === 'readback_invalid' ? 'rolled_back' : 'unchanged'); return
      }
      const readBack = readDayMemoStorageSnapshot(window.localStorage)
      if (readBack.status !== 'ready' || !same(readBack.memos, snapshot.candidateLocal)) {
        const rollback = readBack.status === 'ready' ? replaceStoredDayMemosVerified(window.localStorage, fresh.local, readBack.serialized) : 'rollback_failed'
        block(rollback === 'saved' ? 'remote_only_adoption_readback_failed' : 'remote_only_adoption_rollback_failed', snapshot.date,
          rollback === 'saved' ? 'rolled_back' : 'uncertain'); return
      }
      snapshot.localRaw = readBack.serialized
      input.adoptVerifiedStoredDayMemos(snapshot.candidateLocal.map((memo) => ({ ...memo })))
      finish('local_saved', 'remote_only_active_adoption_succeeded', snapshot.date, snapshot.unresolvedCount - 1, true, 'saved')
    } finally { inFlightRef.current = false; setRunning(false) }
  }, [input, stage])

  const checkPostAdoption = useCallback(async () => {
    const snapshot = snapshotRef.current; if (!snapshot || stage !== 'local_saved' || inFlightRef.current || !eligibleConnection(input.connection) || !supabaseClient) return
    inFlightRef.current = true; setRunning(true); const run = ++runRef.current
    try {
      const before = loadFresh(); if (!before || before.metadataRaw !== snapshot.metadataRaw || !same(before.local, snapshot.candidateLocal)) {
        block('remote_only_post_state_changed', snapshot.date, 'saved'); return
      }
      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, snapshot.workspaceId, () => runRef.current === run).catch(() => null)
      const after = loadFresh(); if (!pulled || pulled.status !== 'complete' || !after || after.metadataRaw !== snapshot.metadataRaw || !same(after.local, snapshot.candidateLocal)) {
        block('remote_only_post_pull_failed', snapshot.date, 'saved'); return
      }
      const remote = pulled.records.filter((record) => record.entityId === snapshot.date)
      if (remote.length !== 1 || !same(remote[0], snapshot.remote) || remoteFingerprint(pulled.records) !== snapshot.remoteFingerprint) {
        block('remote_only_post_remote_changed', snapshot.date, 'saved'); return
      }
      const candidate: DayMemoSyncMetadataV5 = { ...after.metadata, baselines: { ...after.metadata.baselines, [snapshot.date]: { date: snapshot.date,
        remoteRevision: snapshot.remote.revision, remoteChangeSequence: snapshot.remote.changeSequence, remoteUpdatedAt: snapshot.remote.payload.updatedAt,
        baselineLocalUpdatedAt: snapshot.remote.payload.updatedAt, deletedAt: null } }, lastPulledChangeSequence: pulled.maxChangeSequence,
        baselineStatus: 'recovery_required', baselineConfirmedAt: null, pendingOperation: null }
      if (!isDayMemoSyncMetadataV5(candidate)) { block('remote_only_post_candidate_invalid', snapshot.date, 'saved'); return }
      const classifications = classifyAll(candidate, after.local, pulled.records)
      const outside = Object.fromEntries(Object.entries(unresolvedOnly(classifications)).filter(([date]) => date !== snapshot.date))
      if (!same(outside, snapshot.outsideClassifications)) { block('remote_only_post_outside_difference_changed', snapshot.date, 'saved'); return }
      const unresolved = Object.values(classifications).filter((value) => value !== 'exact_match_baseline_confirmed').length
      snapshot.candidateMetadata = candidate; snapshot.localRaw = after.localRaw
      finish('post_adoption_ready', 'remote_only_post_adoption_ready', snapshot.date, unresolved, true, 'saved')
    } finally { inFlightRef.current = false; setRunning(false) }
  }, [input.connection, stage])

  const saveMetadata = useCallback(() => {
    const snapshot = snapshotRef.current; if (!snapshot || stage !== 'post_adoption_ready' || !snapshot.candidateMetadata || snapshot.consumed) return
    if (!window.confirm('確認済みのbaselineとcursorを同期metadataへ保存します。よろしいですか？')) return
    const fresh = loadFresh(); if (!fresh || fresh.metadataRaw !== snapshot.metadataRaw || fresh.localRaw !== snapshot.localRaw || !isDayMemoSyncMetadataV5(snapshot.candidateMetadata)) {
      block('remote_only_metadata_source_changed', snapshot.date, 'saved'); return
    }
    snapshot.consumed = true
    const saved = replaceDayMemoSyncMetadataV2(window.localStorage, snapshot.candidateMetadata, snapshot.metadataRaw)
    if (saved !== 'saved') {
      block(saved === 'rollback_failed' ? 'remote_only_metadata_rollback_failed' : 'remote_only_metadata_save_failed', snapshot.date, 'saved'); return
    }
    const readBack = loadDayMemoSyncMetadataAny(window.localStorage)
    if (readBack.status !== 'ready' || !same(readBack.metadata, snapshot.candidateMetadata)) {
      const rollback = readBack.status === 'ready' ? replaceDayMemoSyncMetadataV2(window.localStorage, fresh.metadata, readBack.raw) : 'rollback_failed'
      block(rollback === 'saved' ? 'remote_only_metadata_readback_failed' : 'remote_only_metadata_rollback_failed', snapshot.date, 'saved'); return
    }
    input.adoptVerifiedMetadata(snapshot.candidateMetadata)
    finish('metadata_saved', 'remote_only_metadata_saved', snapshot.date, result?.unresolvedCount ?? 0, true, 'saved')
  }, [input, result?.unresolvedCount, stage])

  const inspectSnapshotAvailability = useCallback((expectedDate?: string | null) => {
    const snapshot = snapshotRef.current
    if (!snapshot) return 'missing' as const
    if (snapshot.consumed) return 'consumed' as const
    if (expectedDate && snapshot.date !== expectedDate) return 'stale' as const
    if (result?.date !== snapshot.date || !['candidate_ready', 'local_saved', 'post_adoption_ready'].includes(stage)) return 'stale' as const
    return 'ready' as const
  }, [result?.date, stage])

  const discard = useCallback(() => { if (running) return; runRef.current += 1; snapshotRef.current = null; setStage('idle'); setResult(null); setSafeErrorMessage(null) }, [running])
  return { stage, result, running, safeErrorMessage, targetDate: result?.date ?? null, candidateDates, eligible,
    canAdopt: stage === 'candidate_ready', canPostCheck: stage === 'local_saved', canSave: stage === 'post_adoption_ready',
    checkCandidate, adoptLocal, checkPostAdoption, saveMetadata, inspectSnapshotAvailability, discard }
}
