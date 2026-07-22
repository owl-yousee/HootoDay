import { useCallback, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoBodyMismatchRecoveryPendingOperationV5, DayMemoLocalOnlyRecoveryPendingOperationV5 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { isStoredDayMemo, readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords, type RemoteDayMemoRecord } from '../utils/dayMemoSyncPull'
import { isDayMemoSyncMetadataV5, loadDayMemoSyncMetadataAny } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import { classifyDayMemoNormalDifference, remoteRecordMatchesConfirmedBaseline,
  type DayMemoNormalDifferenceClassification } from './useDayMemoNormalDifferenceRecoveryPlan'

export type DayMemoBodyMismatchRecoveryPreflightSafety =
  | 'normal_body_mismatch_recovery_preflight_ready'
  | 'normal_body_mismatch_recovery_preflight_pending_missing'
  | 'normal_body_mismatch_recovery_preflight_wrong_mode'
  | 'normal_body_mismatch_recovery_preflight_pending_invalid'
  | 'normal_body_mismatch_recovery_preflight_workspace_mismatch'
  | 'normal_body_mismatch_recovery_preflight_metadata_invalid'
  | 'normal_body_mismatch_recovery_preflight_checkpoint_unavailable'
  | 'normal_body_mismatch_recovery_preflight_checkpoint_missing'
  | 'normal_body_mismatch_recovery_preflight_checkpoint_invalid'
  | 'normal_body_mismatch_recovery_preflight_checkpoint_target_missing'
  | 'normal_body_mismatch_recovery_preflight_checkpoint_target_changed'
  | 'normal_body_mismatch_recovery_preflight_permitted_pending_mismatch'
  | 'normal_body_mismatch_recovery_preflight_unexpected_pending'
  | 'normal_body_mismatch_recovery_preflight_pending_changed'
  | 'normal_body_mismatch_recovery_preflight_checkpoint_stale'
  | 'normal_body_mismatch_recovery_preflight_target_unavailable'
  | 'normal_body_mismatch_recovery_preflight_local_changed'
  | 'normal_body_mismatch_recovery_preflight_remote_missing'
  | 'normal_body_mismatch_recovery_preflight_remote_tombstone'
  | 'normal_body_mismatch_recovery_preflight_remote_revision_changed'
  | 'normal_body_mismatch_recovery_preflight_remote_sequence_changed'
  | 'normal_body_mismatch_recovery_preflight_remote_updated_at_changed'
  | 'normal_body_mismatch_recovery_preflight_remote_payload_changed'
  | 'normal_body_mismatch_recovery_preflight_difference_changed'
  | 'normal_body_mismatch_recovery_preflight_push_blocked'
  | 'normal_body_mismatch_recovery_preflight_intent_exists'
  | 'normal_body_mismatch_recovery_preflight_pull_failed'
  | 'normal_body_mismatch_recovery_preflight_stale'
  | 'normal_body_mismatch_recovery_preflight_prerequisite_missing'
  | 'normal_body_mismatch_recovery_preflight_unknown'

export interface DayMemoBodyMismatchRecoveryPreflightResult {
  date: string | null
  safety: DayMemoBodyMismatchRecoveryPreflightSafety
  ready: boolean
  operationMode: 'body_mismatch_recovery' | 'local_only_recovery' | null
  pendingVerified: boolean
  localFresh: boolean
  remoteActive: boolean
  revisionVerified: boolean
  changeSequenceVerified: boolean
  remoteUpdatedAtVerified: boolean
  payloadVerified: boolean
  checkpointVerified: boolean
  workspaceVerified: boolean
  snapshotCreated: boolean
  persistentStateChanged: false
  rpcSent: false
  checkedAt: string
  nextAction: string
}

export interface DayMemoBodyMismatchRecoveryPreflightSnapshot {
  result: DayMemoBodyMismatchRecoveryPreflightResult
  metadataRaw: string
  localStorageSerialized: string
  workspaceId: string
  pendingOperation: DayMemoBodyMismatchRecoveryPendingOperationV5 | DayMemoLocalOnlyRecoveryPendingOperationV5
  localMemo: DayMemo
  remoteRecord: RemoteDayMemoRecord | null
  localFingerprint: string
  remoteFingerprint: string
  checkpointFingerprint: string
}

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
}

const UNRESOLVED = new Set<DayMemoNormalDifferenceClassification>([
  'exact_body_timestamp_mismatch', 'body_mismatch', 'local_only', 'remote_only_active', 'remote_only_tombstone',
])

function connectionIsEligible(connection: SyncConnection | null): connection is SyncConnection & { workspaceId: string } {
  return Boolean(connection && isUuid(connection.workspaceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}

function isRecoveryPending(value: unknown): value is DayMemoBodyMismatchRecoveryPendingOperationV5 | DayMemoLocalOnlyRecoveryPendingOperationV5 {
  if (!value || typeof value !== 'object') return false
  const pending = value as Partial<DayMemoBodyMismatchRecoveryPendingOperationV5 | DayMemoLocalOnlyRecoveryPendingOperationV5>
  const modeValid = pending.operationMode === 'body_mismatch_recovery'
    ? Number(pending.baseRevision) >= 1 && Number(pending.baseChangeSequence) >= 1
      && pending.baseRemoteState === 'active' && typeof pending.baseRemoteUpdatedAt === 'string'
      && !Number.isNaN(Date.parse(pending.baseRemoteUpdatedAt))
    : pending.operationMode === 'local_only_recovery' && pending.baseRevision === 0
      && pending.baseChangeSequence === 0 && pending.baseRemoteState === 'missing' && pending.baseRemoteUpdatedAt === null
  return pending.kind === 'upsert' && modeValid && pending.status === 'prepared'
    && typeof pending.date === 'string' && isUuid(pending.operationId ?? '')
    && Number.isSafeInteger(pending.baseRevision) && Number.isSafeInteger(pending.baseChangeSequence)
    && typeof pending.preparedLocalUpdatedAt === 'string'
    && !Number.isNaN(Date.parse(pending.preparedLocalUpdatedAt))
}

function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right) }
function fingerprint(value: unknown): string { return JSON.stringify(value) }

function message(safety: DayMemoBodyMismatchRecoveryPreflightSafety): string {
  if (safety === 'normal_body_mismatch_recovery_preflight_ready') return '送信はまだ行っていません。次Phaseで再度鮮度を確認してから明示送信します。'
  if (safety.includes('local_changed')) return '準備後にlocal DayMemoが変化したため、送信前確認を停止しました。'
  if (safety.includes('remote_') || safety.includes('difference_changed')) return '準備後に同期先または差異状態が変化したため、送信前確認を停止しました。'
  if (safety.includes('pull_failed')) return '同期先を完全に確認できなかったため、送信前確認を停止しました。'
  return 'prepared recoveryの前提を安全に確認できなかったため、送信前確認を停止しました。'
}

function inspectPreparedRecovery(connection: SyncConnection | null): DayMemoBodyMismatchRecoveryPendingOperationV5 | DayMemoLocalOnlyRecoveryPendingOperationV5 | null {
  if (!connectionIsEligible(connection)) return null
  const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
  if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata)
    || loaded.metadata.workspaceId !== connection.workspaceId || !isRecoveryPending(loaded.metadata.pendingOperation)) return null
  return loaded.metadata.pendingOperation
}

function checkpointIdentity(metadata: ReturnType<typeof loadDayMemoSyncMetadataAny> extends { metadata: infer M } ? M : never): string {
  if (!metadata || typeof metadata !== 'object' || !('version' in metadata)) return ''
  const current = metadata as { version: number; workspaceId: string; baselines: unknown; lastPulledChangeSequence: number; baselineStatus: string; baselineConfirmedAt: string | null }
  return fingerprint({ version: current.version, workspaceId: current.workspaceId, baselines: current.baselines,
    cursor: current.lastPulledChangeSequence, baselineStatus: current.baselineStatus, baselineConfirmedAt: current.baselineConfirmedAt })
}

export function useDayMemoBodyMismatchRecoveryPreflight({ dayMemos, isConfigured, isSignedIn, connection }: Input) {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<DayMemoBodyMismatchRecoveryPreflightResult | null>(null)
  const snapshotRef = useRef<DayMemoBodyMismatchRecoveryPreflightSnapshot | null>(null)
  const runIdRef = useRef(0)
  const pending = inspectPreparedRecovery(connection)
  const eligible = Boolean(isConfigured && isSignedIn && supabaseClient && pending)

  const finish = useCallback((safety: DayMemoBodyMismatchRecoveryPreflightSafety,
    values: Partial<DayMemoBodyMismatchRecoveryPreflightResult> = {}) => {
    const next: DayMemoBodyMismatchRecoveryPreflightResult = { date: null, safety, ready: false, operationMode: null,
      pendingVerified: false, localFresh: false, remoteActive: false, revisionVerified: false,
      changeSequenceVerified: false, remoteUpdatedAtVerified: false, payloadVerified: false,
      checkpointVerified: false, workspaceVerified: false, snapshotCreated: false,
      persistentStateChanged: false, rpcSent: false, checkedAt: new Date().toISOString(), nextAction: message(safety), ...values }
    setResult(next); snapshotRef.current = null
    return next
  }, [])

  const check = useCallback(async () => {
    if (checking) return
    const runId = ++runIdRef.current
    setChecking(true); setResult(null); snapshotRef.current = null
    try {
      if (!isConfigured || !isSignedIn || !supabaseClient || !connectionIsEligible(connection)) {
        finish('normal_body_mismatch_recovery_preflight_prerequisite_missing'); return
      }
      const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
      const stored = readDayMemoStorageSnapshot(window.localStorage)
      if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata) || stored.status !== 'ready') {
        finish('normal_body_mismatch_recovery_preflight_metadata_invalid'); return
      }
      const metadata = loaded.metadata
      if (metadata.workspaceId !== connection.workspaceId) { finish('normal_body_mismatch_recovery_preflight_workspace_mismatch'); return }
      if (metadata.pushBlock) { finish('normal_body_mismatch_recovery_preflight_push_blocked'); return }
      if (!metadata.pendingOperation) { finish('normal_body_mismatch_recovery_preflight_pending_missing'); return }
      if (metadata.pendingOperation.kind !== 'upsert' || !['body_mismatch_recovery', 'local_only_recovery'].includes(metadata.pendingOperation.operationMode)) {
        finish('normal_body_mismatch_recovery_preflight_unexpected_pending'); return
      }
      if (!isRecoveryPending(metadata.pendingOperation)) { finish('normal_body_mismatch_recovery_preflight_pending_invalid'); return }
      const prepared = metadata.pendingOperation
      const base = { date: prepared.date, operationMode: prepared.operationMode, pendingVerified: true, workspaceVerified: true }
      if (metadata.baselineStatus !== 'recovery_required' || metadata.baselineConfirmedAt !== null
        || (prepared.operationMode === 'local_only_recovery' && metadata.baselines[prepared.date])) {
        finish(metadata.baselineStatus !== 'recovery_required' || metadata.baselineConfirmedAt !== null
          ? 'normal_body_mismatch_recovery_preflight_checkpoint_missing'
          : 'normal_body_mismatch_recovery_preflight_checkpoint_target_changed', base); return
      }
      if (metadata.lastPulledChangeSequence < 1 || Object.keys(metadata.baselines).length === 0) {
        finish('normal_body_mismatch_recovery_preflight_checkpoint_invalid', base); return
      }
      if (metadata.localDeleteIntents[prepared.date] || Object.keys(metadata.localDeleteIntents).length) {
        finish('normal_body_mismatch_recovery_preflight_intent_exists', base); return
      }
      const persistentCheckpointFingerprint = checkpointIdentity(metadata)
      const targets = stored.memos.filter((memo) => memo.date === prepared.date)
      if (targets.length !== 1 || !isStoredDayMemo(targets[0]) || targets[0].updatedAt !== prepared.preparedLocalUpdatedAt
        || !same(dayMemos, stored.memos)) {
        finish('normal_body_mismatch_recovery_preflight_local_changed', { ...base, checkpointVerified: true }); return
      }
      const local = targets[0]
      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, connection.workspaceId, () => runIdRef.current === runId).catch(() => null)
      if (runIdRef.current !== runId) return
      if (!pulled || pulled.status !== 'complete') {
        finish('normal_body_mismatch_recovery_preflight_pull_failed', { ...base, checkpointVerified: true, localFresh: true }); return
      }
      const afterLoaded = loadDayMemoSyncMetadataAny(window.localStorage)
      const afterStored = readDayMemoStorageSnapshot(window.localStorage)
      if (afterLoaded.status !== 'ready' || afterLoaded.raw !== loaded.raw || afterStored.status !== 'ready'
        || afterStored.serialized !== stored.serialized || !same(dayMemos, stored.memos)
        || !isDayMemoSyncMetadataV5(afterLoaded.metadata)
        || !same(afterLoaded.metadata.pendingOperation, prepared)) {
        finish('normal_body_mismatch_recovery_preflight_pending_changed', base); return
      }
      if (checkpointIdentity(afterLoaded.metadata) !== persistentCheckpointFingerprint) {
        finish('normal_body_mismatch_recovery_preflight_checkpoint_stale', base); return
      }
      if (pulled.maxChangeSequence !== metadata.lastPulledChangeSequence) {
        finish('normal_body_mismatch_recovery_preflight_stale', { ...base, checkpointVerified: true, localFresh: true }); return
      }
      const targetRecords = pulled.records.filter((record) => record.entityId === prepared.date)
      if (prepared.operationMode === 'body_mismatch_recovery' && targetRecords.length === 0) { finish('normal_body_mismatch_recovery_preflight_remote_missing', { ...base, checkpointVerified: true, localFresh: true }); return }
      if (prepared.operationMode === 'local_only_recovery' && targetRecords.length !== 0) {
        finish(targetRecords[0]?.deletedAt ? 'normal_body_mismatch_recovery_preflight_remote_tombstone'
          : 'normal_body_mismatch_recovery_preflight_remote_revision_changed', { ...base, checkpointVerified: true, localFresh: true }); return
      }
      if (prepared.operationMode === 'body_mismatch_recovery' && targetRecords.length !== 1) { finish('normal_body_mismatch_recovery_preflight_unknown', base); return }
      const remote = targetRecords[0] ?? null
      if (prepared.operationMode === 'body_mismatch_recovery' && (!remote || remote.deletedAt !== null || remote.payload === null)) {
        finish('normal_body_mismatch_recovery_preflight_remote_tombstone', { ...base, checkpointVerified: true, localFresh: true }); return
      }
      if (prepared.operationMode === 'body_mismatch_recovery' && remote!.revision !== prepared.baseRevision) { finish('normal_body_mismatch_recovery_preflight_remote_revision_changed', base); return }
      if (prepared.operationMode === 'body_mismatch_recovery' && remote!.changeSequence !== prepared.baseChangeSequence) { finish('normal_body_mismatch_recovery_preflight_remote_sequence_changed', base); return }
      if (prepared.operationMode === 'body_mismatch_recovery' && remote!.payload?.updatedAt !== prepared.baseRemoteUpdatedAt) { finish('normal_body_mismatch_recovery_preflight_remote_updated_at_changed', base); return }
      if (prepared.operationMode === 'body_mismatch_recovery' && metadata.baselines[prepared.date]
        && !remoteRecordMatchesConfirmedBaseline(remote, metadata.baselines[prepared.date])) {
        finish('normal_body_mismatch_recovery_preflight_checkpoint_target_changed', base); return
      }
      const remoteByDate = new Map(pulled.records.map((record) => [record.entityId, record]))
      if (remoteByDate.size !== pulled.records.length || (prepared.operationMode === 'body_mismatch_recovery'
        && (remote!.entityId !== prepared.date || remote!.payload?.date !== prepared.date))) {
        finish('normal_body_mismatch_recovery_preflight_remote_payload_changed', base); return
      }
      const localByDate = new Map(stored.memos.map((memo) => [memo.date, memo]))
      const dates = [...new Set([...localByDate.keys(), ...remoteByDate.keys(), ...Object.keys(metadata.baselines)])].sort()
      const classifications = Object.fromEntries(dates.map((date) => [date, classifyDayMemoNormalDifference(
        localByDate.get(date) ?? null, remoteByDate.get(date) ?? null, metadata.baselines[date] ?? null)]))
      const unresolved = Object.fromEntries(dates.filter((date) => UNRESOLVED.has(classifications[date])).map((date) => [date, classifications[date]]))
      if (!(prepared.date in classifications)) {
        finish('normal_body_mismatch_recovery_preflight_checkpoint_target_missing', base); return
      }
      const expectedClassification = prepared.operationMode === 'body_mismatch_recovery' ? 'body_mismatch' : 'local_only'
      if (classifications[prepared.date] !== expectedClassification) {
        finish('normal_body_mismatch_recovery_preflight_checkpoint_target_changed', base); return
      }
      if (Object.values(classifications).some((value) => value === 'revision_lineage_mismatch' || value === 'active_tombstone_mismatch' || value === 'unknown')) {
        finish('normal_body_mismatch_recovery_preflight_checkpoint_invalid', base); return
      }
      const checkpointFingerprint = fingerprint({ persistentCheckpointFingerprint, unresolved })
      const next = finish('normal_body_mismatch_recovery_preflight_ready', { ...base, ready: true, localFresh: true,
        remoteActive: prepared.operationMode === 'body_mismatch_recovery', revisionVerified: true, changeSequenceVerified: true, remoteUpdatedAtVerified: true,
        payloadVerified: true, checkpointVerified: true, snapshotCreated: true })
      snapshotRef.current = { result: { ...next }, metadataRaw: loaded.raw, localStorageSerialized: stored.serialized,
        workspaceId: connection.workspaceId, pendingOperation: { ...prepared }, localMemo: { ...local },
        remoteRecord: prepared.operationMode === 'body_mismatch_recovery' && remote ? { ...remote, payload: remote.payload ? { ...remote.payload } : null } : null, localFingerprint: fingerprint(local),
        remoteFingerprint: fingerprint(remote), checkpointFingerprint }
    } finally { if (runIdRef.current === runId) setChecking(false) }
  }, [checking, connection, dayMemos, finish, isConfigured, isSignedIn])

  const discard = useCallback(() => { runIdRef.current += 1; snapshotRef.current = null; setResult(null); setChecking(false) }, [])
  const consumeReadySnapshot = useCallback(() => {
    runIdRef.current += 1
    snapshotRef.current = null
    setResult((current) => current ? { ...current, snapshotCreated: false } : null)
  }, [])
  const getReadySnapshot = useCallback(() => {
    const current = snapshotRef.current
    if (!current || !isConfigured || !isSignedIn || !connectionIsEligible(connection) || current.workspaceId !== connection.workspaceId) return null
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const stored = readDayMemoStorageSnapshot(window.localStorage)
    if (loaded.status !== 'ready' || loaded.raw !== current.metadataRaw || stored.status !== 'ready'
      || stored.serialized !== current.localStorageSerialized || !same(dayMemos, stored.memos)
      || !isDayMemoSyncMetadataV5(loaded.metadata)
      || checkpointIdentity(loaded.metadata) === '') return null
    return { ...current, result: { ...current.result }, pendingOperation: { ...current.pendingOperation },
      localMemo: { ...current.localMemo }, remoteRecord: current.remoteRecord ? { ...current.remoteRecord, payload: current.remoteRecord.payload ? { ...current.remoteRecord.payload } : null } : null }
  }, [connection, dayMemos, isConfigured, isSignedIn])

  return { eligible, checking, result, check, discard, getReadySnapshot, consumeReadySnapshot }
}
