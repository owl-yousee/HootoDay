import { useCallback, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords, type RemoteDayMemoRecord } from '../utils/dayMemoSyncPull'
import { isDayMemoSyncMetadataV5, loadDayMemoSyncMetadataAny, replaceDayMemoSyncMetadataV2 } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import { classifyDayMemoNormalDifference } from './useDayMemoNormalDifferenceRecoveryPlan'
import type { DayMemoSavedRecoveryStateResult } from './useDayMemoSavedRecoveryStateCheck'

export type RecoveryFinalizationStage = 'idle' | 'checking' | 'confirmation_ready' | 'confirmed_saved' | 'normal_sync_ready' | 'blocked' | 'failed'
export interface RecoveryFinalizationResult { stage: RecoveryFinalizationStage; safety: string; checkedAt: string; baselineCount: number; cursor: number | null; normalSyncReady: boolean; persistentChanged: boolean }
interface Snapshot { metadataRaw: string; localRaw: string; workspaceId: string; candidate: DayMemoSyncMetadataV5; consumed: boolean }
interface Input { dayMemos: DayMemo[]; isConfigured: boolean; isSignedIn: boolean; connection: SyncConnection | null; reactMetadata: DayMemoSyncMetadataV5 | null
  savedResult: DayMemoSavedRecoveryStateResult | null; adoptVerifiedMetadata: (metadata: DayMemoSyncMetadataV5) => void }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const localSignature = (memos: DayMemo[]) => JSON.stringify(memos.map((memo) => [memo.date, memo.updatedAt, memo.content]).sort())
function connectionEligible(value: SyncConnection | null): value is SyncConnection & { workspaceId: string } { return Boolean(value && isUuid(value.workspaceId)
  && ((value.deviceRole === 'parent' && value.workspaceRole === 'owner' && value.pairingStatus === 'owner') || (value.deviceRole === 'child' && value.workspaceRole === 'member' && value.pairingStatus === 'member'))) }
function allConfirmed(metadata: DayMemoSyncMetadataV5, locals: DayMemo[], remotes: RemoteDayMemoRecord[]) {
  const local = new Map(locals.map((memo) => [memo.date, memo])); const remote = new Map(remotes.map((record) => [record.entityId, record]))
  if (remote.size !== remotes.length) return false
  const dates = new Set([...local.keys(), ...remote.keys(), ...Object.keys(metadata.baselines)])
  return [...dates].every((date) => classifyDayMemoNormalDifference(local.get(date) ?? null, remote.get(date) ?? null, metadata.baselines[date] ?? null) === 'exact_match_baseline_confirmed')
}

export function useDayMemoRecoveryFinalization(input: Input) {
  const [stage, setStage] = useState<RecoveryFinalizationStage>('idle'); const [result, setResult] = useState<RecoveryFinalizationResult | null>(null)
  const [running, setRunning] = useState(false); const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const snapshotRef = useRef<Snapshot | null>(null); const runRef = useRef(0); const inFlightRef = useRef(false)
  const signature = useMemo(() => localSignature(input.dayMemos), [input.dayMemos])
  const finish = (next: RecoveryFinalizationStage, safety: string, metadata: DayMemoSyncMetadataV5 | null, ready = false, changed = false) => {
    setStage(next); setResult({ stage: next, safety, checkedAt: new Date().toISOString(), baselineCount: metadata ? Object.keys(metadata.baselines).length : 0,
      cursor: metadata?.lastPulledChangeSequence ?? null, normalSyncReady: ready, persistentChanged: changed })
  }
  const block = (safety: string) => { snapshotRef.current = null; finish('blocked', safety, null); setSafeErrorMessage('最終同期状態を安全に確認できないため停止しました。再確認してください。') }
  const fail = (safety: string) => { snapshotRef.current = null; finish('failed', safety, null); setSafeErrorMessage('最終同期状態の確認に失敗しました。永続状態は変更していません。') }
  const loadFresh = () => { const metadata = loadDayMemoSyncMetadataAny(window.localStorage); const local = readDayMemoStorageSnapshot(window.localStorage)
    return metadata.status === 'ready' && isDayMemoSyncMetadataV5(metadata.metadata) && local.status === 'ready'
      ? { metadata: metadata.metadata, metadataRaw: metadata.raw, local: local.memos, localRaw: local.serialized } : null }
  const prerequisite = Boolean(input.savedResult?.safety === 'normal_difference_checkpoint_saved_state_ready' && input.savedResult.unresolvedCount === 0
    && input.isConfigured && input.isSignedIn && connectionEligible(input.connection))

  const check = useCallback(async () => {
    if (inFlightRef.current) return
    if (!prerequisite || !connectionEligible(input.connection) || !supabaseClient) { block('final_confirmation_start_prerequisite_invalid'); return }
    inFlightRef.current = true; setRunning(true); setStage('checking'); setResult(null); setSafeErrorMessage(null); snapshotRef.current = null; const run = ++runRef.current
    try {
      const before = loadFresh(); if (!before || !input.reactMetadata || !same(before.metadata, input.reactMetadata) || localSignature(before.local) !== signature
        || before.metadata.workspaceId !== input.connection.workspaceId || before.metadata.baselineStatus !== 'recovery_required' || before.metadata.baselineConfirmedAt !== null
        || before.metadata.pendingOperation || before.metadata.pushBlock || Object.keys(before.metadata.localDeleteIntents).length) { block('final_confirmation_prerequisite_changed'); return }
      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, input.connection.workspaceId, () => runRef.current === run).catch(() => null)
      const after = loadFresh(); if (!pulled || pulled.status !== 'complete' || !after || after.metadataRaw !== before.metadataRaw || after.localRaw !== before.localRaw
        || pulled.maxChangeSequence !== before.metadata.lastPulledChangeSequence || !allConfirmed(before.metadata, before.local, pulled.records)) { block('final_confirmation_mismatch'); return }
      const confirmedAt = new Date().toISOString(); const candidate: DayMemoSyncMetadataV5 = { ...before.metadata, baselines: { ...before.metadata.baselines },
        lastPulledChangeSequence: pulled.maxChangeSequence, baselineStatus: 'confirmed', baselineConfirmedAt: confirmedAt, pendingOperation: null }
      if (!isDayMemoSyncMetadataV5(candidate)) { block('final_confirmation_candidate_invalid'); return }
      snapshotRef.current = { metadataRaw: before.metadataRaw, localRaw: before.localRaw, workspaceId: input.connection.workspaceId, candidate, consumed: false }
      finish('confirmation_ready', 'normal_difference_recovery_final_confirmation_ready', before.metadata)
    } catch {
      fail('final_confirmation_unexpected_failure')
    } finally { inFlightRef.current = false; setRunning(false) }
  }, [input.connection, input.reactMetadata, prerequisite, signature])

  const save = useCallback(() => {
    const snapshot = snapshotRef.current; if (!snapshot || stage !== 'confirmation_ready' || snapshot.consumed) return
    if (!window.confirm('全件一致を確認済みです。通常同期へ戻しますか？')) return
    const fresh = loadFresh(); if (!fresh || fresh.metadataRaw !== snapshot.metadataRaw || fresh.localRaw !== snapshot.localRaw || !isDayMemoSyncMetadataV5(snapshot.candidate)
      || !connectionEligible(input.connection) || input.connection.workspaceId !== snapshot.workspaceId || !input.isConfigured || !input.isSignedIn
      || fresh.metadata.pendingOperation || fresh.metadata.pushBlock || Object.keys(fresh.metadata.localDeleteIntents).length) { block('final_confirmation_candidate_stale'); return }
    snapshot.consumed = true; const saved = replaceDayMemoSyncMetadataV2(window.localStorage, snapshot.candidate, snapshot.metadataRaw)
    if (saved !== 'saved') { block(saved === 'rollback_failed' ? 'final_confirmation_rollback_failed' : 'final_confirmation_save_failed'); return }
    const readBack = loadDayMemoSyncMetadataAny(window.localStorage)
    if (readBack.status !== 'ready' || !isDayMemoSyncMetadataV5(readBack.metadata) || !same(readBack.metadata, snapshot.candidate)) {
      const rollback = readBack.status === 'ready' ? replaceDayMemoSyncMetadataV2(window.localStorage, fresh.metadata, readBack.raw) : 'rollback_failed'
      block(rollback === 'saved' ? 'final_confirmation_readback_failed' : 'final_confirmation_rollback_failed'); return
    }
    input.adoptVerifiedMetadata(readBack.metadata); finish('confirmed_saved', 'normal_difference_recovery_confirmed', readBack.metadata, false, true)
  }, [input, stage])

  const verify = useCallback(async () => {
    if (stage !== 'confirmed_saved' || !connectionEligible(input.connection) || !supabaseClient || inFlightRef.current) return
    inFlightRef.current = true; setRunning(true); const run = ++runRef.current
    try {
      const before = loadFresh(); if (!before || before.metadata.baselineStatus !== 'confirmed' || !before.metadata.baselineConfirmedAt || before.metadata.pendingOperation
        || before.metadata.pushBlock || Object.keys(before.metadata.localDeleteIntents).length || !input.reactMetadata || !same(before.metadata, input.reactMetadata)) { block('normal_sync_ready_prerequisite_invalid'); return }
      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, input.connection.workspaceId, () => runRef.current === run).catch(() => null)
      const after = loadFresh(); if (!pulled || pulled.status !== 'complete' || !after || after.metadataRaw !== before.metadataRaw || after.localRaw !== before.localRaw
        || pulled.maxChangeSequence !== before.metadata.lastPulledChangeSequence || !allConfirmed(before.metadata, before.local, pulled.records)) { block('normal_sync_ready_mismatch'); return }
      finish('normal_sync_ready', 'normal_sync_ready', before.metadata, true)
    } finally { inFlightRef.current = false; setRunning(false) }
  }, [input.connection, input.reactMetadata, stage])
  const discard = useCallback(() => { if (running) return; runRef.current += 1; snapshotRef.current = null; setStage('idle'); setResult(null); setSafeErrorMessage(null) }, [running])
  return { stage, result, running, safeErrorMessage, eligible: prerequisite && (stage === 'idle' || stage === 'blocked' || stage === 'failed'), canSave: stage === 'confirmation_ready', canVerify: stage === 'confirmed_saved', check, save, verify, discard }
}
