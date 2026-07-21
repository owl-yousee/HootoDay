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
import { classifyDayMemoNormalDifference } from './useDayMemoNormalDifferenceRecoveryPlan'
import type { DayMemoNormalBodyMismatchCandidateSnapshot } from './useDayMemoNormalBodyMismatchCandidate'

export type BodyMismatchRemoteAdoptionStage = 'idle' | 'local_saved' | 'metadata_ready' | 'completed' | 'blocked'
export interface BodyMismatchRemoteAdoptionResult {
  stage: BodyMismatchRemoteAdoptionStage
  date: string | null
  safety: string
  remainingCount: number | null
  localChanged: boolean
  metadataChanged: boolean
  remoteWritten: false
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
  candidateMetadata: DayMemoSyncMetadataV5 | null
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
  const applied = useRef<ApplySnapshot | null>(null)
  const candidate = input.getCandidateSnapshot()
  const canApply = Boolean(input.isConfigured && input.isSignedIn && eligibleConnection(input.connection)
    && candidate?.candidate === 'remote' && stage === 'idle' && !running)

  const finish = useCallback((next: BodyMismatchRemoteAdoptionStage, safety: string, values: Partial<BodyMismatchRemoteAdoptionResult> = {}) => {
    setStage(next)
    setResult({ stage: next, date: null, safety, remainingCount: null, localChanged: false,
      metadataChanged: false, remoteWritten: false, checkedAt: new Date().toISOString(), ...values })
  }, [])
  const block = useCallback((safety: string, date: string | null) => {
    finish('blocked', safety, { date })
  }, [finish])

  const applyRemote = useCallback(() => {
    const snapshot = input.getCandidateSnapshot()
    if (!canApply || !snapshot || snapshot.candidate !== 'remote' || inFlight.current) return
    if (!window.confirm(`${snapshot.date} の同期先の内容をこのiPhoneへ反映します。このiPhoneの同日内容は置き換わりますが、同期先へは書き込みません。反映しますか？`)) return
    inFlight.current = true; setRunning(true)
    try {
      const metadata = loadDayMemoSyncMetadataAny(window.localStorage)
      const local = readDayMemoStorageSnapshot(window.localStorage)
      if (metadata.status !== 'ready' || !isDayMemoSyncMetadataV5(metadata.metadata) || local.status !== 'ready'
        || metadata.raw !== snapshot.metadataRaw || local.serialized !== snapshot.localStorageSerialized
        || !input.reactMetadata || !same(input.reactMetadata, metadata.metadata) || !same(input.dayMemos, local.memos)
        || !eligibleConnection(input.connection) || input.connection.workspaceId !== snapshot.workspaceId
        || metadata.metadata.baselineStatus !== 'recovery_required' || metadata.metadata.baselineConfirmedAt !== null
        || metadata.metadata.pendingOperation || metadata.metadata.pushBlock || Object.keys(metadata.metadata.localDeleteIntents).length
        || metadata.metadata.baselines[snapshot.date]) {
        block('body_mismatch_remote_source_changed', snapshot.date); return
      }
      const current = local.memos.filter((memo) => memo.date === snapshot.date)
      if (current.length !== 1 || !same(current[0], snapshot.localMemo)
        || snapshot.remoteRecord.deletedAt !== null || !snapshot.remoteRecord.payload
        || snapshot.remoteRecord.payload.date !== snapshot.date) {
        block('body_mismatch_remote_target_changed', snapshot.date); return
      }
      const next = local.memos.map((memo) => memo.date === snapshot.date ? { ...snapshot.remoteRecord.payload! } : memo)
      const backup = saveDayMemoPullApplyBackup(window.localStorage, snapshot.workspaceId, local.memos)
      if (backup !== 'saved' && backup !== 'reused') { block('body_mismatch_remote_backup_failed', snapshot.date); return }
      const saved = replaceStoredDayMemosVerified(window.localStorage, next, local.serialized)
      if (saved !== 'saved') { block(saved === 'rollback_failed' ? 'body_mismatch_remote_rollback_failed' : 'body_mismatch_remote_local_save_failed', snapshot.date); return }
      const readBack = readDayMemoStorageSnapshot(window.localStorage)
      if (readBack.status !== 'ready' || !same(readBack.memos, next)) {
        const rollback = readBack.status === 'ready' ? replaceStoredDayMemosVerified(window.localStorage, local.memos, readBack.serialized) : 'rollback_failed'
        block(rollback === 'saved' ? 'body_mismatch_remote_readback_failed' : 'body_mismatch_remote_rollback_failed', snapshot.date); return
      }
      applied.current = { source: snapshot, localAfter: next, localRawAfter: readBack.serialized, candidateMetadata: null }
      input.adoptVerifiedStoredDayMemos(next.map((memo) => ({ ...memo })))
      finish('local_saved', 'body_mismatch_remote_local_saved', { date: snapshot.date, localChanged: true })
    } finally { inFlight.current = false; setRunning(false) }
  }, [block, canApply, finish, input])

  const verifyAfterApply = useCallback(async () => {
    const snapshot = applied.current
    if (!snapshot || stage !== 'local_saved' || inFlight.current || !supabaseClient || !eligibleConnection(input.connection)) return
    inFlight.current = true; setRunning(true); const currentRun = ++runId.current
    try {
      const metadata = loadDayMemoSyncMetadataAny(window.localStorage)
      const local = readDayMemoStorageSnapshot(window.localStorage)
      if (metadata.status !== 'ready' || !isDayMemoSyncMetadataV5(metadata.metadata) || local.status !== 'ready'
        || metadata.raw !== snapshot.source.metadataRaw || local.serialized !== snapshot.localRawAfter
        || !same(local.memos, snapshot.localAfter) || input.connection.workspaceId !== snapshot.source.workspaceId) {
        block('body_mismatch_remote_post_state_changed', snapshot.source.date); return
      }
      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, snapshot.source.workspaceId, () => runId.current === currentRun).catch(() => null)
      const afterMetadata = loadDayMemoSyncMetadataAny(window.localStorage)
      const afterLocal = readDayMemoStorageSnapshot(window.localStorage)
      if (!pulled || pulled.status !== 'complete' || afterMetadata.status !== 'ready' || afterMetadata.raw !== metadata.raw
        || afterLocal.status !== 'ready' || afterLocal.serialized !== local.serialized
        || pulled.maxChangeSequence !== metadata.metadata.lastPulledChangeSequence) {
        block('body_mismatch_remote_post_pull_failed', snapshot.source.date); return
      }
      const remoteByDate = new Map(pulled.records.map((record) => [record.entityId, record]))
      const target = remoteByDate.get(snapshot.source.date)
      if (!target || !same(target, snapshot.source.remoteRecord)) { block('body_mismatch_remote_changed', snapshot.source.date); return }
      const localByDate = new Map(local.memos.map((memo) => [memo.date, memo]))
      const dates = [...new Set([...localByDate.keys(), ...remoteByDate.keys(), ...Object.keys(metadata.metadata.baselines)])].sort()
      const beforeOthers = snapshot.source.classifications
      for (const date of dates) {
        if (date === snapshot.source.date) continue
        const classification = classifyDayMemoNormalDifference(localByDate.get(date) ?? null, remoteByDate.get(date) ?? null, metadata.metadata.baselines[date] ?? null)
        if (classification !== beforeOthers[date]) { block('body_mismatch_remote_other_difference_changed', snapshot.source.date); return }
      }
      const targetLocal = localByDate.get(snapshot.source.date)
      if (!targetLocal || target.deletedAt !== null || !target.payload || !same(targetLocal, target.payload)) {
        block('body_mismatch_remote_target_not_equal', snapshot.source.date); return
      }
      const candidateMetadata: DayMemoSyncMetadataV5 = { ...metadata.metadata,
        baselines: { ...metadata.metadata.baselines, [snapshot.source.date]: { date: snapshot.source.date,
          remoteRevision: target.revision, remoteChangeSequence: target.changeSequence, remoteUpdatedAt: target.payload.updatedAt,
          baselineLocalUpdatedAt: targetLocal.updatedAt, deletedAt: null } },
        lastPulledChangeSequence: pulled.maxChangeSequence, baselineStatus: 'recovery_required', baselineConfirmedAt: null }
      if (!isDayMemoSyncMetadataV5(candidateMetadata)) { block('body_mismatch_remote_candidate_invalid', snapshot.source.date); return }
      const remaining = dates.filter((date) => classifyDayMemoNormalDifference(localByDate.get(date) ?? null,
        remoteByDate.get(date) ?? null, candidateMetadata.baselines[date] ?? null) !== 'exact_match_baseline_confirmed').length
      snapshot.candidateMetadata = candidateMetadata
      finish('metadata_ready', 'body_mismatch_remote_metadata_ready', { date: snapshot.source.date, remainingCount: remaining, localChanged: true })
    } finally { inFlight.current = false; setRunning(false) }
  }, [block, finish, input.connection, stage])

  const saveMetadata = useCallback(() => {
    const snapshot = applied.current
    if (!snapshot?.candidateMetadata || stage !== 'metadata_ready' || inFlight.current) return
    if (!window.confirm('確認済みのbaselineとcursorを同期情報へ保存します。ほかの未解決差異は残します。保存しますか？')) return
    const metadata = loadDayMemoSyncMetadataAny(window.localStorage)
    const local = readDayMemoStorageSnapshot(window.localStorage)
    if (metadata.status !== 'ready' || !isDayMemoSyncMetadataV5(metadata.metadata)
      || local.status !== 'ready' || metadata.raw !== snapshot.source.metadataRaw
      || local.serialized !== snapshot.localRawAfter || !same(local.memos, snapshot.localAfter)) {
      block('body_mismatch_remote_metadata_source_changed', snapshot.source.date); return
    }
    const saved = replaceDayMemoSyncMetadataV2(window.localStorage, snapshot.candidateMetadata, metadata.raw)
    if (saved !== 'saved') { block(saved === 'rollback_failed' ? 'body_mismatch_remote_metadata_rollback_failed' : 'body_mismatch_remote_metadata_save_failed', snapshot.source.date); return }
    const readBack = loadDayMemoSyncMetadataAny(window.localStorage)
    if (readBack.status !== 'ready' || !isDayMemoSyncMetadataV5(readBack.metadata) || !same(readBack.metadata, snapshot.candidateMetadata)) {
      const candidateRaw = JSON.stringify(snapshot.candidateMetadata)
      const rollback = readBack.status === 'ready' && readBack.raw === candidateRaw
        ? replaceDayMemoSyncMetadataV2(window.localStorage, metadata.metadata, candidateRaw) : 'rollback_failed'
      block(rollback === 'saved' ? 'body_mismatch_remote_metadata_readback_failed' : 'body_mismatch_remote_metadata_rollback_failed', snapshot.source.date); return
    }
    input.adoptVerifiedMetadata(readBack.metadata); input.consumeCandidateSnapshot()
    finish('completed', 'body_mismatch_remote_completed', { date: snapshot.source.date,
      remainingCount: result?.remainingCount ?? null, localChanged: true, metadataChanged: true })
  }, [block, finish, input, result?.remainingCount, stage])

  const discard = useCallback(() => {
    if (running) return
    runId.current += 1; applied.current = null; setStage('idle'); setResult(null)
  }, [running])
  return { stage, running, result, canApply, canVerify: stage === 'local_saved', canSave: stage === 'metadata_ready',
    applyRemote, verifyAfterApply, saveMetadata, discard }
}
