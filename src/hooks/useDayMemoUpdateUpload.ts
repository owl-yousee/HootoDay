import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoPendingOperationV2, DayMemoSyncMetadataV4 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords, type RemoteDayMemoRecord } from '../utils/dayMemoSyncPull'
import { loadDayMemoSyncMetadataAny, replaceDayMemoSyncMetadataV2 } from '../utils/dayMemoSyncStorage'
import {
  isAppliedDayMemoSyncResult,
  isConflictDayMemoSyncResult,
  normalizeDayMemoSyncResult,
} from '../utils/dayMemoSyncUpsertResult'
import { isUuid } from '../utils/syncConnectionStorage'
import { classifyDayMemoSyncSafety } from '../utils/dayMemoSyncSafety'
import { createUuidV4 } from '../utils/uuid'
import type { DayMemoUpdateUploadCandidateSnapshot } from './useDayMemoUpdatePreview'

export type DayMemoUpdateUploadState =
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

export interface DayMemoUpdateUploadResult {
  date: string
  revision: number
  changeSequence: number
}

interface UseDayMemoUpdateUploadInput {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  getSingleCandidateSnapshot: () => DayMemoUpdateUploadCandidateSnapshot | null
  discardUpdatePreview: () => void
}

interface PreflightSnapshot {
  preview: DayMemoUpdateUploadCandidateSnapshot
  remoteRecord: RemoteDayMemoRecord
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

function messageForState(state: DayMemoUpdateUploadState): string | null {
  switch (state) {
    case 'preflight_conflict': return '同期先が変更されているため、更新を送信できません。'
    case 'local_changed': return 'この端末のDayMemoが確認後に変化したため、やり直してください。'
    case 'metadata_changed': return '同期metadataが確認後に変化したため、更新を送信できません。'
    case 'storage_failed': return '送信前のoperation情報を安全に保存できませんでした。RPCは実行していません。'
    case 'conflict': return '同期先との競合を確認しました。自動解決や再送は行いません。'
    case 'response_unknown': return '送信結果を安全に確定できませんでした。同じ操作を再送せず、同期先の確認が必要です。'
    case 'post_rpc_metadata_failed': return '同期先への更新は完了した可能性がありますが、この端末の同期情報を保存できませんでした。再送せず確認してください。'
    case 'recovery_required': return '同期状態を安全に確認できませんでした。自動で再試行しません。'
    case 'error': return '同期先の確認に失敗しました。自動で再試行しません。'
    default: return null
  }
}

function metadataMatchesPreview(metadata: DayMemoSyncMetadataV4, raw: string, preview: DayMemoUpdateUploadCandidateSnapshot): boolean {
  return raw === preview.metadataRaw
    && metadata.workspaceId === preview.workspaceId
    && metadata.baselineStatus === 'confirmed'
    && metadata.baselineConfirmedAt === preview.baselineConfirmedAt
    && metadata.lastPulledChangeSequence === preview.lastPulledChangeSequence
    && metadata.pendingOperation === null
    && metadata.pushBlock === null
}

function localMatchesPreview(dayMemos: DayMemo[], preview: DayMemoUpdateUploadCandidateSnapshot): boolean {
  const stored = readDayMemoStorageSnapshot(window.localStorage)
  return stored.status === 'ready'
    && stored.serialized === preview.localStorageSerialized
    && localSignature(stored.memos) === localSignature(preview.localMemos)
    && localSignature(dayMemos) === localSignature(preview.localMemos)
}

function remoteMatchesAllBaselines(metadata: DayMemoSyncMetadataV4, records: RemoteDayMemoRecord[]): boolean {
  if (records.length !== Object.keys(metadata.baselines).length) return false
  const remoteByDate = new Map(records.map((record) => [record.entityId, record]))
  if (remoteByDate.size !== records.length) return false
  return Object.entries(metadata.baselines).every(([date, baseline]) => {
    const remote = remoteByDate.get(date)
    return Boolean(remote
      && remote.deletedAt === null
      && remote.payload
      && remote.revision === baseline.remoteRevision
      && remote.changeSequence === baseline.remoteChangeSequence
      && remote.payload.updatedAt === baseline.remoteUpdatedAt)
  })
}

export function useDayMemoUpdateUpload({
  dayMemos,
  isConfigured,
  isSignedIn,
  connection,
  getSingleCandidateSnapshot,
  discardUpdatePreview,
}: UseDayMemoUpdateUploadInput) {
  const [state, setState] = useState<DayMemoUpdateUploadState>('unavailable')
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const [result, setResult] = useState<DayMemoUpdateUploadResult | null>(null)
  const preflightRef = useRef<PreflightSnapshot | null>(null)
  const preparedRef = useRef<PreparedSnapshot | null>(null)
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
    setSafeErrorMessage(null)
    if (!eligible || !connection?.workspaceId) {
      setState('unavailable')
      return
    }
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const safety = classifyDayMemoSyncSafety(loaded, connection.workspaceId)
    const nextState: DayMemoUpdateUploadState = safety.state === 'normal'
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
    if (!eligible || !connection?.workspaceId || !supabaseClient || state !== 'idle') return
    const preview = getSingleCandidateSnapshot()
    if (!preview || preview.workspaceId !== connection.workspaceId || !localMatchesPreview(dayMemos, preview)) {
      setState('local_changed')
      setSafeErrorMessage(messageForState('local_changed'))
      return
    }
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    if (loaded.status !== 'ready' || loaded.metadata.version !== 4 || !metadataMatchesPreview(loaded.metadata, loaded.raw, preview)) {
      setState('metadata_changed')
      setSafeErrorMessage(messageForState('metadata_changed'))
      return
    }
    setState('preflighting')
    setSafeErrorMessage(null)
    setResult(null)
    const requestGeneration = ++generation.current
    let pulled
    try {
      pulled = await pullAllDayMemoSyncRecords(
        supabaseClient,
        connection.workspaceId,
        () => generation.current === requestGeneration && latestLocalSignature.current === currentLocalSignature,
      )
    } catch {
      setState('error')
      setSafeErrorMessage(messageForState('error'))
      return
    }
    if (pulled.status !== 'complete') {
      const nextState: DayMemoUpdateUploadState = pulled.status === 'cancelled' ? 'local_changed' : 'error'
      setState(nextState)
      setSafeErrorMessage(messageForState(nextState))
      return
    }
    const latestMetadata = loadDayMemoSyncMetadataAny(window.localStorage)
    if (latestMetadata.status !== 'ready'
      || latestMetadata.metadata.version !== 4
      || !metadataMatchesPreview(latestMetadata.metadata, latestMetadata.raw, preview)) {
      setState('metadata_changed')
      setSafeErrorMessage(messageForState('metadata_changed'))
      return
    }
    if (!localMatchesPreview(dayMemos, preview)) {
      setState('local_changed')
      setSafeErrorMessage(messageForState('local_changed'))
      return
    }
    if (!remoteMatchesAllBaselines(latestMetadata.metadata, pulled.records)) {
      setState('preflight_conflict')
      setSafeErrorMessage(messageForState('preflight_conflict'))
      return
    }
    const target = pulled.records.filter((record) => record.entityId === preview.candidate.date)
    if (target.length !== 1
      || target[0].deletedAt !== null
      || !target[0].payload
      || target[0].revision !== preview.candidate.baseRevision
      || target[0].changeSequence !== preview.candidate.baselineChangeSequence
      || target[0].payload.updatedAt !== preview.candidate.baselineRemoteUpdatedAt) {
      setState('preflight_conflict')
      setSafeErrorMessage(messageForState('preflight_conflict'))
      return
    }
    preflightRef.current = { preview, remoteRecord: target[0] }
    setState('preflight_ready')
  }, [connection, currentLocalSignature, dayMemos, eligible, getSingleCandidateSnapshot, state])

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
    if (loaded.status !== 'ready' || loaded.metadata.version !== 4 || !metadataMatchesPreview(loaded.metadata, loaded.raw, preflight.preview)) {
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
    const pendingOperation: DayMemoPendingOperationV2 = {
      kind: 'upsert',
      date: preflight.preview.candidate.date,
      operationId,
      baseRevision: preflight.preview.candidate.baseRevision,
      preparedLocalUpdatedAt: preflight.preview.candidate.localUpdatedAt,
      preparedAt: new Date().toISOString(),
      status: 'prepared',
    }
    const next: DayMemoSyncMetadataV4 = { ...loaded.metadata, pendingOperation }
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
    if (!eligible || !connection?.workspaceId || !connection.deviceId || !supabaseClient || state !== 'prepared' || !prepared) return
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const expectedPending = loaded.status === 'ready' && loaded.metadata.version === 4 && loaded.metadata.pendingOperation?.kind === 'upsert' ? loaded.metadata.pendingOperation : null
    if (loaded.status !== 'ready'
      || loaded.metadata.version !== 4
      || loaded.raw !== prepared.preparedMetadataRaw
      || loaded.metadata.workspaceId !== connection.workspaceId
      || loaded.metadata.baselineStatus !== 'confirmed'
      || loaded.metadata.pushBlock !== null
      || !expectedPending
      || expectedPending.status !== 'prepared'
      || expectedPending.operationId !== prepared.operationId
      || expectedPending.date !== prepared.preview.candidate.date
      || expectedPending.baseRevision !== prepared.preview.candidate.baseRevision
      || expectedPending.preparedLocalUpdatedAt !== prepared.preview.candidate.localUpdatedAt) {
      setState('metadata_changed')
      setSafeErrorMessage(messageForState('metadata_changed'))
      return
    }
    if (!localMatchesPreview(dayMemos, prepared.preview)) {
      setState('local_changed')
      setSafeErrorMessage(messageForState('local_changed'))
      return
    }
    const sending: DayMemoSyncMetadataV4 = {
      ...loaded.metadata,
      pendingOperation: { ...expectedPending, status: 'sending' },
    }
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
        target_payload: { date: memo.date, content: memo.content, updatedAt: memo.localUpdatedAt },
        target_schema_version: 1,
        base_revision: memo.baseRevision,
        operation_id: prepared.operationId,
        client_updated_at: memo.localUpdatedAt,
        source_device_id: connection.deviceId,
      })
      if (response.error) throw new Error('rpc_result_unknown')
      data = response.data
    } catch {
      const unknown: DayMemoSyncMetadataV4 = {
        ...sending,
        pendingOperation: { ...sending.pendingOperation!, status: 'response_unknown' },
      }
      replaceDayMemoSyncMetadataV2(window.localStorage, unknown, sendingRaw)
      preparedRef.current = null
      preflightRef.current = null
      setState('response_unknown')
      setSafeErrorMessage(messageForState('response_unknown'))
      return
    }
    const normalized = normalizeDayMemoSyncResult(data)
    if (isConflictDayMemoSyncResult(normalized, connection.workspaceId, memo.date)) {
      const conflict: DayMemoSyncMetadataV4 = {
        ...sending,
        pendingOperation: { ...sending.pendingOperation!, status: 'conflict' },
      }
      replaceDayMemoSyncMetadataV2(window.localStorage, conflict, sendingRaw)
      preparedRef.current = null
      preflightRef.current = null
      setState('conflict')
      setSafeErrorMessage(messageForState('conflict'))
      return
    }
    const sentMemo: DayMemo = { date: memo.date, content: memo.content, updatedAt: memo.localUpdatedAt }
    if (!isAppliedDayMemoSyncResult(normalized, connection.workspaceId, sentMemo, memo.baseRevision, memo.baselineChangeSequence)) {
      const unknown: DayMemoSyncMetadataV4 = {
        ...sending,
        pendingOperation: { ...sending.pendingOperation!, status: 'response_unknown' },
      }
      replaceDayMemoSyncMetadataV2(window.localStorage, unknown, sendingRaw)
      preparedRef.current = null
      preflightRef.current = null
      setState('response_unknown')
      setSafeErrorMessage(messageForState('response_unknown'))
      return
    }
    const now = new Date().toISOString()
    const completed: DayMemoSyncMetadataV4 = {
      ...sending,
      baselines: {
        ...sending.baselines,
        [memo.date]: {
          date: memo.date,
          remoteRevision: normalized.revision,
          remoteChangeSequence: normalized.change_sequence,
          remoteUpdatedAt: memo.localUpdatedAt,
          baselineLocalUpdatedAt: memo.localUpdatedAt,
          deletedAt: null,
        },
      },
      lastPulledChangeSequence: Math.max(sending.lastPulledChangeSequence, normalized.change_sequence),
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
    setResult({ date: memo.date, revision: normalized.revision, changeSequence: normalized.change_sequence })
    discardUpdatePreview()
    setState('completed')
  }, [connection, dayMemos, discardUpdatePreview, eligible, state])

  return {
    eligible,
    state,
    safeErrorMessage,
    result,
    hasPendingOperation: state === 'prepared' || state === 'uploading' || state === 'conflict' || state === 'response_unknown' || state === 'post_rpc_metadata_failed',
    runPreflight,
    prepareUpload,
    uploadPrepared,
    reset,
  }
}
