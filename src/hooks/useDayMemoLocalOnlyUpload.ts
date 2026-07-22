import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoNormalUpsertPendingOperationV5, DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords } from '../utils/dayMemoSyncPull'
import { loadDayMemoSyncMetadataAny, replaceDayMemoSyncMetadataV2 } from '../utils/dayMemoSyncStorage'
import { isAppliedDayMemoSyncResult, isConflictDayMemoSyncResult, normalizeDayMemoSyncResult } from '../utils/dayMemoSyncUpsertResult'
import { isUuid } from '../utils/syncConnectionStorage'
import { classifyDayMemoSyncSafety } from '../utils/dayMemoSyncSafety'
import { createUuidV4 } from '../utils/uuid'
import type { DayMemoLocalOnlyUploadCandidateSnapshot } from './useDayMemoLocalOnlyPreview'

export type DayMemoLocalOnlyUploadState =
  | 'unavailable'
  | 'idle'
  | 'preflighting'
  | 'preflight_ready'
  | 'preflight_conflict'
  | 'preparing'
  | 'prepared'
  | 'uploading'
  | 'completed'
  | 'conflict'
  | 'response_unknown'
  | 'local_changed'
  | 'metadata_changed'
  | 'storage_failed'
  | 'post_rpc_metadata_failed'
  | 'recovery_required'
  | 'error'

export interface DayMemoLocalOnlyUploadResult {
  date: string
  revision: number
  changeSequence: number
}

export type DayMemoLocalOnlyPreflightFailureClassification =
  | 'target_remote_present'
  | 'outside_active_baseline_mismatch'
  | 'outside_tombstone_baseline_mismatch'
  | 'remote_baseline_set_mismatch'
  | 'metadata_changed'
  | 'local_changed'
  | 'full_pull_failed'

interface UseDayMemoLocalOnlyUploadInput {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  getSingleNewCandidateSnapshot: () => DayMemoLocalOnlyUploadCandidateSnapshot | null
  discardLocalOnlyPreview: () => void
  adoptVerifiedMetadata: (metadata: DayMemoSyncMetadataV5) => void
}

interface PreflightSnapshot {
  preview: DayMemoLocalOnlyUploadCandidateSnapshot
  previousChangeSequence: number
}

interface PreparedSnapshot extends PreflightSnapshot {
  operationId: string
  preparedMetadataRaw: string
}

function localSignature(memos: DayMemo[]): string {
  return JSON.stringify(memos.map((memo) => [memo.date, memo.updatedAt, memo.content]).sort(([left], [right]) => left.localeCompare(right)))
}

function connectionIsEligible(connection: SyncConnection | null): boolean {
  return Boolean(connection
    && isUuid(connection.workspaceId)
    && isUuid(connection.deviceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}

function messageForState(state: DayMemoLocalOnlyUploadState): string | null {
  switch (state) {
    case 'preflight_conflict': return '同期先に同じ日付のrecordまたは削除済みrecordがあるため、新規追加できません。'
    case 'local_changed': return 'この端末のDayMemoが確認後に変化したため、やり直してください。'
    case 'metadata_changed': return '同期metadataが確認後に変化したため、新規追加できません。'
    case 'storage_failed': return '送信前のoperation情報を安全に保存できませんでした。RPCは実行していません。'
    case 'conflict': return '同期先との競合を確認しました。復活・自動解決・再送は行いません。'
    case 'response_unknown': return '送信結果を安全に確定できませんでした。同じ操作を再送せず、同期先の確認が必要です。'
    case 'post_rpc_metadata_failed': return '同期先への追加は完了した可能性がありますが、この端末の同期情報を保存できませんでした。再送せず確認してください。'
    case 'recovery_required': return '同期状態を安全に確認できませんでした。自動で再試行しません。'
    case 'error': return '同期先の確認に失敗しました。自動で再試行しません。'
    default: return null
  }
}

function metadataMatchesPreview(metadata: DayMemoSyncMetadataV5, raw: string, preview: DayMemoLocalOnlyUploadCandidateSnapshot): boolean {
  return raw === preview.metadataRaw
    && metadata.workspaceId === preview.workspaceId
    && metadata.baselineStatus === 'confirmed'
    && metadata.baselineConfirmedAt !== null
    && metadata.pendingOperation === null
    && metadata.pushBlock === null
    && metadata.baselines[preview.candidate.date] === undefined
}

function localMatchesPreview(dayMemos: DayMemo[], preview: DayMemoLocalOnlyUploadCandidateSnapshot): boolean {
  const stored = readDayMemoStorageSnapshot(window.localStorage)
  return stored.status === 'ready'
    && stored.serialized === preview.localStorageSerialized
    && localSignature(stored.memos) === localSignature(preview.localMemos)
    && localSignature(dayMemos) === localSignature(preview.localMemos)
    && stored.memos.filter((memo) => memo.date === preview.candidate.date).length === 1
}

function classifyRemoteBaselineMismatch(
  metadata: DayMemoSyncMetadataV5,
  records: Awaited<ReturnType<typeof pullAllDayMemoSyncRecords>> extends { records: infer R } ? Exclude<R, null> : never,
): DayMemoLocalOnlyPreflightFailureClassification | null {
  if (records.length !== Object.keys(metadata.baselines).length) return 'remote_baseline_set_mismatch'
  const remoteByDate = new Map(records.map((record) => [record.entityId, record]))
  if (remoteByDate.size !== records.length) return 'remote_baseline_set_mismatch'
  for (const [date, baseline] of Object.entries(metadata.baselines)) {
    const remote = remoteByDate.get(date)
    if (baseline.deletedAt === null) {
      if (!remote || remote.deletedAt !== null || remote.payload === null
        || remote.revision !== baseline.remoteRevision
        || remote.changeSequence !== baseline.remoteChangeSequence
        || remote.payload.updatedAt !== baseline.remoteUpdatedAt
        || baseline.baselineLocalUpdatedAt === null
        || baseline.baselineLocalUpdatedAt !== remote.payload.updatedAt) {
        return 'outside_active_baseline_mismatch'
      }
      continue
    }
    if (!remote || remote.deletedAt === null || remote.payload !== null
      || remote.revision !== baseline.remoteRevision
      || remote.changeSequence !== baseline.remoteChangeSequence
      || remote.deletedAt !== baseline.deletedAt
      || remote.serverUpdatedAt !== baseline.remoteUpdatedAt
      || baseline.baselineLocalUpdatedAt !== null) {
      return 'outside_tombstone_baseline_mismatch'
    }
  }
  return null
}

export function useDayMemoLocalOnlyUpload({
  dayMemos,
  isConfigured,
  isSignedIn,
  connection,
  getSingleNewCandidateSnapshot,
  discardLocalOnlyPreview,
  adoptVerifiedMetadata,
}: UseDayMemoLocalOnlyUploadInput) {
  const [state, setState] = useState<DayMemoLocalOnlyUploadState>('unavailable')
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const [result, setResult] = useState<DayMemoLocalOnlyUploadResult | null>(null)
  const [preflightFailureClassification, setPreflightFailureClassification]
    = useState<DayMemoLocalOnlyPreflightFailureClassification | null>(null)
  const preflightRef = useRef<PreflightSnapshot | null>(null)
  const preparedRef = useRef<PreparedSnapshot | null>(null)
  const preflightInFlightRef = useRef(false)
  const uploadInFlightRef = useRef(false)
  const generation = useRef(0)
  const currentLocalSignature = useMemo(() => localSignature(dayMemos), [dayMemos])
  const latestLocalSignature = useRef(currentLocalSignature)
  latestLocalSignature.current = currentLocalSignature
  const eligible = Boolean(isConfigured && isSignedIn && supabaseClient && connectionIsEligible(connection))

  const reset = useCallback(() => {
    generation.current += 1
    preflightRef.current = null
    preparedRef.current = null
    setResult(null)
    setPreflightFailureClassification(null)
    setSafeErrorMessage(null)
    if (!eligible || !connection?.workspaceId) {
      setState('unavailable')
      return
    }
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const safety = classifyDayMemoSyncSafety(loaded, connection.workspaceId)
    const nextState: DayMemoLocalOnlyUploadState = safety.state === 'normal'
      ? 'idle'
      : safety.state === 'conflict'
        ? 'conflict'
        : safety.state === 'response_unknown'
          ? 'response_unknown'
          : 'recovery_required'
    setState(nextState)
    setSafeErrorMessage(messageForState(nextState))
  }, [connection?.workspaceId, eligible])

  useEffect(() => {
    reset()
  }, [currentLocalSignature, reset])

  const runPreflight = useCallback(async () => {
    if (!eligible || !connection?.workspaceId || !supabaseClient || state !== 'idle' || preflightInFlightRef.current) return
    preflightInFlightRef.current = true
    try {
    const preview = getSingleNewCandidateSnapshot()
    if (!preview || preview.workspaceId !== connection.workspaceId || !localMatchesPreview(dayMemos, preview)) {
      setPreflightFailureClassification('local_changed')
      setState('local_changed')
      setSafeErrorMessage(messageForState('local_changed'))
      return
    }
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    if (loaded.status !== 'ready' || loaded.metadata.version !== 5 || !metadataMatchesPreview(loaded.metadata, loaded.raw, preview)) {
      setPreflightFailureClassification('metadata_changed')
      setState('metadata_changed')
      setSafeErrorMessage(messageForState('metadata_changed'))
      return
    }
    setState('preflighting')
    setSafeErrorMessage(null)
    setResult(null)
    setPreflightFailureClassification(null)
    const requestGeneration = ++generation.current
    const pulled = await pullAllDayMemoSyncRecords(
      supabaseClient,
      connection.workspaceId,
      () => generation.current === requestGeneration && latestLocalSignature.current === currentLocalSignature,
    ).catch(() => null)
    if (!pulled || pulled.status !== 'complete') {
      const nextState: DayMemoLocalOnlyUploadState = pulled?.status === 'cancelled' ? 'local_changed' : 'error'
      setPreflightFailureClassification(pulled?.status === 'cancelled' ? 'local_changed' : 'full_pull_failed')
      setState(nextState)
      setSafeErrorMessage(messageForState(nextState))
      return
    }
    const latestMetadata = loadDayMemoSyncMetadataAny(window.localStorage)
    if (latestMetadata.status !== 'ready'
      || latestMetadata.metadata.version !== 5
      || !metadataMatchesPreview(latestMetadata.metadata, latestMetadata.raw, preview)) {
      setPreflightFailureClassification('metadata_changed')
      setState('metadata_changed')
      setSafeErrorMessage(messageForState('metadata_changed'))
      return
    }
    if (!localMatchesPreview(dayMemos, preview)) {
      setPreflightFailureClassification('local_changed')
      setState('local_changed')
      setSafeErrorMessage(messageForState('local_changed'))
      return
    }
    if (pulled.records.some((record) => record.entityId === preview.candidate.date)) {
      setPreflightFailureClassification('target_remote_present')
      setState('preflight_conflict')
      setSafeErrorMessage('同期先に対象日のrecordまたは削除済みrecordがあるため、新規追加できません。')
      return
    }
    const baselineMismatch = classifyRemoteBaselineMismatch(latestMetadata.metadata, pulled.records)
    if (baselineMismatch) {
      setPreflightFailureClassification(baselineMismatch)
      setState('preflight_conflict')
      setSafeErrorMessage(baselineMismatch === 'outside_tombstone_baseline_mismatch'
        ? '対象外の削除済みbaselineが同期先と一致しないため、新規追加できません。'
        : baselineMismatch === 'outside_active_baseline_mismatch'
          ? '対象外の有効baselineが同期先と一致しないため、新規追加できません。'
          : '同期先のrecord集合が保存済みbaselineと一致しないため、新規追加できません。')
      return
    }
    preflightRef.current = { preview, previousChangeSequence: pulled.maxChangeSequence }
    setState('preflight_ready')
    } finally {
      preflightInFlightRef.current = false
    }
  }, [connection, currentLocalSignature, dayMemos, eligible, getSingleNewCandidateSnapshot, state])

  const prepareUpload = useCallback(() => {
    const preflight = preflightRef.current
    if (!eligible || !connection?.workspaceId || state !== 'preflight_ready' || !preflight) return
    setState('preparing')
    setSafeErrorMessage(null)
    if (!localMatchesPreview(dayMemos, preflight.preview)) {
      setState('local_changed')
      setSafeErrorMessage(messageForState('local_changed'))
      return
    }
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    if (loaded.status !== 'ready' || loaded.metadata.version !== 5 || !metadataMatchesPreview(loaded.metadata, loaded.raw, preflight.preview)) {
      setState('metadata_changed')
      setSafeErrorMessage(messageForState('metadata_changed'))
      return
    }
    const operationId = createUuidV4()
    if (!operationId) {
      setState('storage_failed')
      setSafeErrorMessage('この環境ではoperation IDを安全に作成できませんでした。RPCは実行していません。')
      return
    }
    const pendingOperation: DayMemoNormalUpsertPendingOperationV5 = {
      kind: 'upsert',
      operationMode: 'normal',
      date: preflight.preview.candidate.date,
      operationId,
      baseRevision: 0,
      preparedLocalUpdatedAt: preflight.preview.candidate.updatedAt,
      preparedAt: new Date().toISOString(),
      status: 'prepared',
    }
    const next: DayMemoSyncMetadataV5 = { ...loaded.metadata, pendingOperation }
    const saved = replaceDayMemoSyncMetadataV2(window.localStorage, next, loaded.raw)
    if (saved !== 'saved') {
      setState(saved === 'rollback_failed' ? 'recovery_required' : 'storage_failed')
      setSafeErrorMessage(messageForState(saved === 'rollback_failed' ? 'recovery_required' : 'storage_failed'))
      return
    }
    preparedRef.current = { ...preflight, operationId, preparedMetadataRaw: JSON.stringify(next) }
    setState('prepared')
  }, [connection?.workspaceId, dayMemos, eligible, state])

  const uploadPrepared = useCallback(async () => {
    const prepared = preparedRef.current
    if (!eligible || !connection?.workspaceId || !connection.deviceId || !supabaseClient || state !== 'prepared' || !prepared || uploadInFlightRef.current) return
    uploadInFlightRef.current = true
    try {
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const pending = loaded.status === 'ready' && loaded.metadata.version === 5 && loaded.metadata.pendingOperation?.kind === 'upsert' ? loaded.metadata.pendingOperation : null
    if (loaded.status !== 'ready'
      || loaded.metadata.version !== 5
      || loaded.raw !== prepared.preparedMetadataRaw
      || loaded.metadata.workspaceId !== connection.workspaceId
      || loaded.metadata.baselineStatus !== 'confirmed'
      || loaded.metadata.pushBlock !== null
      || loaded.metadata.baselines[prepared.preview.candidate.date] !== undefined
      || !pending
      || pending.status !== 'prepared'
      || pending.operationId !== prepared.operationId
      || pending.date !== prepared.preview.candidate.date
      || pending.baseRevision !== 0
      || pending.preparedLocalUpdatedAt !== prepared.preview.candidate.updatedAt) {
      setState('metadata_changed')
      setSafeErrorMessage(messageForState('metadata_changed'))
      return
    }
    if (!localMatchesPreview(dayMemos, prepared.preview)) {
      setState('local_changed')
      setSafeErrorMessage(messageForState('local_changed'))
      return
    }
    const sending: DayMemoSyncMetadataV5 = { ...loaded.metadata, pendingOperation: { ...pending, status: 'sending' } }
    const sendingSave = replaceDayMemoSyncMetadataV2(window.localStorage, sending, loaded.raw)
    if (sendingSave !== 'saved') {
      setState(sendingSave === 'rollback_failed' ? 'recovery_required' : 'storage_failed')
      setSafeErrorMessage(messageForState(sendingSave === 'rollback_failed' ? 'recovery_required' : 'storage_failed'))
      return
    }
    const sendingRaw = JSON.stringify(sending)
    setState('uploading')
    setSafeErrorMessage(null)
    const memo = prepared.preview.candidate
    let data: unknown
    try {
      const response = await supabaseClient.rpc('hooto_day_upsert_sync_record', {
        target_workspace_id: connection.workspaceId,
        target_entity_type: 'day_memo',
        target_entity_id: memo.date,
        target_payload: { date: memo.date, content: memo.content, updatedAt: memo.updatedAt },
        target_schema_version: 1,
        base_revision: 0,
        operation_id: prepared.operationId,
        client_updated_at: memo.updatedAt,
        source_device_id: connection.deviceId,
      })
      if (response.error) throw new Error('rpc_result_unknown')
      data = response.data
    } catch {
      const unknown: DayMemoSyncMetadataV5 = { ...sending, pendingOperation: { ...sending.pendingOperation!, status: 'response_unknown' } }
      replaceDayMemoSyncMetadataV2(window.localStorage, unknown, sendingRaw)
      preparedRef.current = null
      preflightRef.current = null
      setState('response_unknown')
      setSafeErrorMessage(messageForState('response_unknown'))
      return
    }
    const normalized = normalizeDayMemoSyncResult(data)
    if (isConflictDayMemoSyncResult(normalized, connection.workspaceId, memo.date)) {
      const conflict: DayMemoSyncMetadataV5 = { ...sending, pendingOperation: { ...sending.pendingOperation!, status: 'conflict' } }
      replaceDayMemoSyncMetadataV2(window.localStorage, conflict, sendingRaw)
      preparedRef.current = null
      preflightRef.current = null
      setState('conflict')
      setSafeErrorMessage(messageForState('conflict'))
      return
    }
    if (!isAppliedDayMemoSyncResult(normalized, connection.workspaceId, memo, 0, prepared.previousChangeSequence)) {
      const unknown: DayMemoSyncMetadataV5 = { ...sending, pendingOperation: { ...sending.pendingOperation!, status: 'response_unknown' } }
      replaceDayMemoSyncMetadataV2(window.localStorage, unknown, sendingRaw)
      preparedRef.current = null
      preflightRef.current = null
      setState('response_unknown')
      setSafeErrorMessage(messageForState('response_unknown'))
      return
    }
    const now = new Date().toISOString()
    const completed: DayMemoSyncMetadataV5 = {
      ...sending,
      baselines: {
        ...sending.baselines,
        [memo.date]: {
          date: memo.date,
          remoteRevision: normalized.revision,
          remoteChangeSequence: normalized.change_sequence,
          remoteUpdatedAt: memo.updatedAt,
          baselineLocalUpdatedAt: memo.updatedAt,
          deletedAt: null,
        },
      },
      lastPulledChangeSequence: normalized.change_sequence,
      baselineStatus: 'confirmed',
      baselineConfirmedAt: now,
      pendingOperation: null,
      lastSuccessfulSyncAt: now,
    }
    const completedSave = replaceDayMemoSyncMetadataV2(window.localStorage, completed, sendingRaw)
    preparedRef.current = null
    preflightRef.current = null
    if (completedSave !== 'saved') {
      setState('post_rpc_metadata_failed')
      setSafeErrorMessage(messageForState('post_rpc_metadata_failed'))
      return
    }
    adoptVerifiedMetadata(completed)
    setResult({ date: memo.date, revision: normalized.revision, changeSequence: normalized.change_sequence })
    discardLocalOnlyPreview()
    setState('completed')
    } finally {
      uploadInFlightRef.current = false
    }
  }, [adoptVerifiedMetadata, connection, dayMemos, discardLocalOnlyPreview, eligible, state])

  return {
    eligible,
    state,
    safeErrorMessage,
    preflightFailureClassification,
    result,
    hasPendingOperation: state === 'prepared' || state === 'uploading' || state === 'conflict' || state === 'response_unknown' || state === 'post_rpc_metadata_failed',
    runPreflight,
    prepareUpload,
    uploadPrepared,
    reset,
  }
}
