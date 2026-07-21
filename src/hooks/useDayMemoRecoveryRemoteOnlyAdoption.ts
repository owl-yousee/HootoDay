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
export interface RecoveryRemoteOnlyResult { stage: RecoveryRemoteOnlyStage; date: string | null; safety: string; checkedAt: string; unresolvedCount: number; persistentChanged: boolean }

interface Snapshot {
  token: string; date: string; workspaceId: string; metadataRaw: string; localRaw: string
  remote: RemoteDayMemoRecord & { payload: DayMemo }; candidateLocal: DayMemo[]
  candidateMetadata: DayMemoSyncMetadataV5 | null; consumed: boolean
}
interface Input { dayMemos: DayMemo[]; isConfigured: boolean; isSignedIn: boolean; connection: SyncConnection | null
  reactMetadata: DayMemoSyncMetadataV5 | null; savedResult: DayMemoSavedRecoveryStateResult | null
  adoptVerifiedStoredDayMemos: (memos: DayMemo[]) => void; adoptVerifiedMetadata: (metadata: DayMemoSyncMetadataV5) => void }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const signature = (memos: DayMemo[]) => JSON.stringify(memos.map((m) => [m.date, m.updatedAt, m.content]).sort())
function eligibleConnection(connection: SyncConnection | null): connection is SyncConnection & { workspaceId: string } {
  return Boolean(connection && isUuid(connection.workspaceId) && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
    || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}
function classifyAll(metadata: DayMemoSyncMetadataV5, locals: DayMemo[], remotes: RemoteDayMemoRecord[]) {
  const local = new Map(locals.map((item) => [item.date, item])); const remote = new Map(remotes.map((item) => [item.entityId, item]))
  const dates = [...new Set([...local.keys(), ...remote.keys(), ...Object.keys(metadata.baselines)])].sort()
  return Object.fromEntries(dates.map((date) => [date, classifyDayMemoNormalDifference(local.get(date) ?? null, remote.get(date) ?? null, metadata.baselines[date] ?? null)])) as Record<string, DayMemoNormalDifferenceClassification>
}

export function useDayMemoRecoveryRemoteOnlyAdoption(input: Input) {
  const [stage, setStage] = useState<RecoveryRemoteOnlyStage>('idle'); const [result, setResult] = useState<RecoveryRemoteOnlyResult | null>(null)
  const [running, setRunning] = useState(false); const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const snapshotRef = useRef<Snapshot | null>(null); const runRef = useRef(0); const inFlightRef = useRef(false)
  const currentSignature = useMemo(() => signature(input.dayMemos), [input.dayMemos])
  const targetDate = input.savedResult?.safety === 'normal_difference_checkpoint_saved_state_ready'
    && input.savedResult.nextRecommendedClassification === 'remote_only_active' ? input.savedResult.nextRecommendedDate : null
  const eligible = Boolean(input.isConfigured && input.isSignedIn && eligibleConnection(input.connection) && targetDate && stage === 'idle')
  const finish = (nextStage: RecoveryRemoteOnlyStage, safety: string, date: string | null, unresolvedCount = 0, persistentChanged = false) => {
    setStage(nextStage); setResult({ stage: nextStage, date, safety, checkedAt: new Date().toISOString(), unresolvedCount, persistentChanged })
  }
  const block = (safety: string, date: string | null) => { snapshotRef.current = null; finish('blocked', safety, date); setSafeErrorMessage('同期状態が変化したため、安全側で停止しました。再確認してください。') }
  const loadFresh = () => {
    const metadata = loadDayMemoSyncMetadataAny(window.localStorage); const local = readDayMemoStorageSnapshot(window.localStorage)
    if (metadata.status !== 'ready' || !isDayMemoSyncMetadataV5(metadata.metadata) || local.status !== 'ready') return null
    return { metadata: metadata.metadata, metadataRaw: metadata.raw, local: local.memos, localRaw: local.serialized }
  }

  const checkCandidate = useCallback(async () => {
    if (!eligible || !targetDate || !eligibleConnection(input.connection) || !supabaseClient || inFlightRef.current) return
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
      if (classifications[targetDate] !== 'remote_only_active' || Object.entries(classifications).some(([date, value]) => date !== targetDate && value !== 'exact_match_baseline_confirmed')) { block('remote_only_candidate_other_difference', targetDate); return }
      const candidateLocal = [...before.local, { ...remote.payload }].sort((a, b) => a.date.localeCompare(b.date))
      snapshotRef.current = { token: crypto.randomUUID(), date: targetDate, workspaceId: input.connection.workspaceId, metadataRaw: before.metadataRaw,
        localRaw: before.localRaw, remote: { ...remote, payload: { ...remote.payload } }, candidateLocal, candidateMetadata: null, consumed: false }
      finish('candidate_ready', 'remote_only_active_candidate_ready', targetDate)
    } finally { inFlightRef.current = false; setRunning(false) }
  }, [currentSignature, eligible, input.connection, input.reactMetadata, targetDate])

  const adoptLocal = useCallback(() => {
    const snapshot = snapshotRef.current; if (!snapshot || stage !== 'candidate_ready' || snapshot.consumed) return
    if (!window.confirm('同期先のDayMemoをこの端末へ反映します。よろしいですか？')) return
    const fresh = loadFresh(); if (!fresh || fresh.metadataRaw !== snapshot.metadataRaw || fresh.localRaw !== snapshot.localRaw
      || fresh.local.some((memo) => memo.date === snapshot.date) || !eligibleConnection(input.connection) || input.connection.workspaceId !== snapshot.workspaceId) { block('remote_only_adoption_snapshot_changed', snapshot.date); return }
    const backup = saveDayMemoPullApplyBackup(window.localStorage, snapshot.workspaceId, fresh.local)
    if (backup !== 'saved' && backup !== 'reused') { block('remote_only_adoption_backup_failed', snapshot.date); return }
    const saved = replaceStoredDayMemosVerified(window.localStorage, snapshot.candidateLocal, snapshot.localRaw)
    if (saved !== 'saved') { block(saved === 'rollback_failed' ? 'remote_only_adoption_rollback_failed' : 'remote_only_adoption_local_save_failed', snapshot.date); return }
    const readBack = readDayMemoStorageSnapshot(window.localStorage)
    if (readBack.status !== 'ready' || !same(readBack.memos, snapshot.candidateLocal)) {
      const rollback = readBack.status === 'ready' ? replaceStoredDayMemosVerified(window.localStorage, fresh.local, readBack.serialized) : 'rollback_failed'
      block(rollback === 'saved' ? 'remote_only_adoption_readback_failed' : 'remote_only_adoption_rollback_failed', snapshot.date); return
    }
    input.adoptVerifiedStoredDayMemos(snapshot.candidateLocal.map((memo) => ({ ...memo })))
    finish('local_saved', 'remote_only_active_adoption_succeeded', snapshot.date, 0, true)
  }, [input, stage])

  const checkPostAdoption = useCallback(async () => {
    const snapshot = snapshotRef.current; if (!snapshot || stage !== 'local_saved' || inFlightRef.current || !eligibleConnection(input.connection) || !supabaseClient) return
    inFlightRef.current = true; setRunning(true); const run = ++runRef.current
    try {
      const before = loadFresh(); if (!before || before.metadataRaw !== snapshot.metadataRaw || !same(before.local, snapshot.candidateLocal)) { block('remote_only_post_state_changed', snapshot.date); return }
      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, snapshot.workspaceId, () => runRef.current === run).catch(() => null)
      const after = loadFresh(); if (!pulled || pulled.status !== 'complete' || !after || after.metadataRaw !== snapshot.metadataRaw || !same(after.local, snapshot.candidateLocal)) { block('remote_only_post_pull_failed', snapshot.date); return }
      const remote = pulled.records.filter((record) => record.entityId === snapshot.date)
      if (remote.length !== 1 || !same(remote[0], snapshot.remote)) { block('remote_only_post_remote_changed', snapshot.date); return }
      const candidate: DayMemoSyncMetadataV5 = { ...after.metadata, baselines: { ...after.metadata.baselines, [snapshot.date]: { date: snapshot.date,
        remoteRevision: snapshot.remote.revision, remoteChangeSequence: snapshot.remote.changeSequence, remoteUpdatedAt: snapshot.remote.payload.updatedAt,
        baselineLocalUpdatedAt: snapshot.remote.payload.updatedAt, deletedAt: null } }, lastPulledChangeSequence: pulled.maxChangeSequence,
        baselineStatus: 'recovery_required', baselineConfirmedAt: null, pendingOperation: null }
      if (!isDayMemoSyncMetadataV5(candidate)) { block('remote_only_post_candidate_invalid', snapshot.date); return }
      const classifications = classifyAll(candidate, after.local, pulled.records); const unresolved = Object.values(classifications).filter((value) => value !== 'exact_match_baseline_confirmed').length
      snapshot.candidateMetadata = candidate; snapshot.localRaw = after.localRaw
      finish('post_adoption_ready', 'remote_only_post_adoption_ready', snapshot.date, unresolved, true)
    } finally { inFlightRef.current = false; setRunning(false) }
  }, [input.connection, stage])

  const saveMetadata = useCallback(() => {
    const snapshot = snapshotRef.current; if (!snapshot || stage !== 'post_adoption_ready' || !snapshot.candidateMetadata || snapshot.consumed) return
    if (!window.confirm('確認済みのbaselineとcursorを同期metadataへ保存します。よろしいですか？')) return
    const fresh = loadFresh(); if (!fresh || fresh.metadataRaw !== snapshot.metadataRaw || fresh.localRaw !== snapshot.localRaw || !isDayMemoSyncMetadataV5(snapshot.candidateMetadata)) { block('remote_only_metadata_source_changed', snapshot.date); return }
    snapshot.consumed = true
    const saved = replaceDayMemoSyncMetadataV2(window.localStorage, snapshot.candidateMetadata, snapshot.metadataRaw)
    if (saved !== 'saved') { block(saved === 'rollback_failed' ? 'remote_only_metadata_rollback_failed' : 'remote_only_metadata_save_failed', snapshot.date); return }
    const readBack = loadDayMemoSyncMetadataAny(window.localStorage)
    if (readBack.status !== 'ready' || !same(readBack.metadata, snapshot.candidateMetadata)) {
      const rollback = readBack.status === 'ready' ? replaceDayMemoSyncMetadataV2(window.localStorage, fresh.metadata, readBack.raw) : 'rollback_failed'
      block(rollback === 'saved' ? 'remote_only_metadata_readback_failed' : 'remote_only_metadata_rollback_failed', snapshot.date); return
    }
    input.adoptVerifiedMetadata(snapshot.candidateMetadata); finish('metadata_saved', 'remote_only_metadata_saved', snapshot.date, result?.unresolvedCount ?? 0, true)
  }, [input, result?.unresolvedCount, stage])

  const discard = useCallback(() => { if (running) return; runRef.current += 1; snapshotRef.current = null; setStage('idle'); setResult(null); setSafeErrorMessage(null) }, [running])
  return { stage, result, running, safeErrorMessage, targetDate, eligible, canAdopt: stage === 'candidate_ready', canPostCheck: stage === 'local_saved', canSave: stage === 'post_adoption_ready', checkCandidate, adoptLocal, checkPostAdoption, saveMetadata, discard }
}
