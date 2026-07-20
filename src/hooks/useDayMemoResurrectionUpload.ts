import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoNormalUpsertPendingOperationV5, DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
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
import type { DayMemoResurrectionUploadSnapshot } from './useDayMemoResurrectionPreview'

export type DayMemoResurrectionUploadState =
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

export interface DayMemoResurrectionUploadResult {
  date: string
  revision: number
  changeSequence: number
}

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  getSingleCandidateSnapshot: () => DayMemoResurrectionUploadSnapshot | null
  discardPreview: () => void
}

interface PreflightSnapshot {
  preview: DayMemoResurrectionUploadSnapshot
  remoteRecord: RemoteDayMemoRecord
}

interface PreparedSnapshot extends PreflightSnapshot {
  operationId: string
  preparedMetadataRaw: string
}

function localSignature(memos: DayMemo[]): string {
  return JSON.stringify(memos
    .map((memo) => [memo.date, memo.updatedAt, memo.content])
    .sort(([left], [right]) => left.localeCompare(right)))
}

function connectionIsEligible(connection: SyncConnection | null): boolean {
  return Boolean(connection
    && isUuid(connection.workspaceId)
    && isUuid(connection.deviceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}

function messageForState(state: DayMemoResurrectionUploadState): string | null {
  switch (state) {
    case 'preflight_conflict': return '同期先のtombstone状態が変わったため、復活できません。'
    case 'local_changed': return '確認後にこの端末のDayMemoが変わったため、復活を停止しました。'
    case 'metadata_changed': return '確認後に同期metadataが変わったため、復活を停止しました。'
    case 'storage_failed': return '復活用の未完了処理を安全に保存できませんでした。RPCは実行していません。'
    case 'conflict': return '復活操作で同期先との競合を確認しました。自動解決や再送は行いません。'
    case 'response_unknown': return '復活操作の結果を安全に確認できませんでした。再送せず、同期先の状態を確認してください。'
    case 'post_rpc_metadata_failed': return '同期先で復活した可能性がありますが、この端末のmetadataを保存できませんでした。再送しないでください。'
    case 'recovery_required': return '復活処理の同期状態を安全に確定できません。自動で再試行しません。'
    case 'error': return '同期先の復活前確認に失敗しました。自動で再試行しません。'
    default: return null
  }
}

function metadataMatchesPreview(metadata: DayMemoSyncMetadataV5, raw: string, preview: DayMemoResurrectionUploadSnapshot): boolean {
  const baseline = metadata.baselines[preview.memo.date]
  return raw === preview.metadataRaw
    && metadata.workspaceId === preview.workspaceId
    && metadata.baselineStatus === 'confirmed'
    && metadata.baselineConfirmedAt === preview.baselineConfirmedAt
    && metadata.lastPulledChangeSequence === preview.lastPulledChangeSequence
    && metadata.pendingOperation === null
    && metadata.pushBlock === null
    && Object.keys(metadata.localDeleteIntents).length === 0
    && Boolean(baseline
      && baseline.deletedAt !== null
      && baseline.baselineLocalUpdatedAt === null
      && JSON.stringify(baseline) === JSON.stringify(preview.baseline))
}

function localMatchesPreview(dayMemos: DayMemo[], preview: DayMemoResurrectionUploadSnapshot): boolean {
  const stored = readDayMemoStorageSnapshot(window.localStorage)
  return stored.status === 'ready'
    && stored.serialized === preview.localStorageSerialized
    && localSignature(stored.memos) === localSignature(preview.localMemos)
    && localSignature(dayMemos) === localSignature(preview.localMemos)
    && stored.memos.filter((memo) => memo.date === preview.memo.date).length === 1
    && localSignature([preview.memo]) === localSignature(stored.memos.filter((memo) => memo.date === preview.memo.date))
}

function remoteMatchesAllBaselines(metadata: DayMemoSyncMetadataV5, records: RemoteDayMemoRecord[]): boolean {
  if (records.length !== Object.keys(metadata.baselines).length) return false
  const remoteByDate = new Map(records.map((record) => [record.entityId, record]))
  if (remoteByDate.size !== records.length) return false
  return Object.entries(metadata.baselines).every(([date, baseline]) => {
    const remote = remoteByDate.get(date)
    if (!remote
      || remote.revision !== baseline.remoteRevision
      || remote.changeSequence !== baseline.remoteChangeSequence
      || remote.deletedAt !== baseline.deletedAt) return false
    return baseline.deletedAt === null
      ? Boolean(remote.payload && remote.payload.updatedAt === baseline.remoteUpdatedAt)
      : remote.payload === null
        && remote.serverUpdatedAt === baseline.remoteUpdatedAt
        && baseline.baselineLocalUpdatedAt === null
  })
}

export function useDayMemoResurrectionUpload({
  dayMemos,
  isConfigured,
  isSignedIn,
  connection,
  getSingleCandidateSnapshot,
  discardPreview,
}: Input) {
  const [state, setState] = useState<DayMemoResurrectionUploadState>('unavailable')
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const [result, setResult] = useState<DayMemoResurrectionUploadResult | null>(null)
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
    const safety = classifyDayMemoSyncSafety(loadDayMemoSyncMetadataAny(window.localStorage), connection.workspaceId)
    const nextState: DayMemoResurrectionUploadState = safety.state === 'normal'
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
    if (loaded.status !== 'ready' || loaded.metadata.version !== 5 || !metadataMatchesPreview(loaded.metadata, loaded.raw, preview)) {
      setState('metadata_changed')
      setSafeErrorMessage(messageForState('metadata_changed'))
      return
    }
    setState('preflighting')
    setSafeErrorMessage(null)
    setResult(null)
    const requestGeneration = ++generation.current
    const pulled = await pullAllDayMemoSyncRecords(
      supabaseClient,
      connection.workspaceId,
      () => generation.current === requestGeneration && latestLocalSignature.current === currentLocalSignature,
    ).catch(() => null)
    if (!pulled || pulled.status !== 'complete') {
      const nextState: DayMemoResurrectionUploadState = pulled?.status === 'cancelled' ? 'local_changed' : 'error'
      setState(nextState)
      setSafeErrorMessage(messageForState(nextState))
      return
    }
    const latest = loadDayMemoSyncMetadataAny(window.localStorage)
    if (latest.status !== 'ready'
      || latest.metadata.version !== 5
      || !metadataMatchesPreview(latest.metadata, latest.raw, preview)) {
      setState('metadata_changed')
      setSafeErrorMessage(messageForState('metadata_changed'))
      return
    }
    if (!localMatchesPreview(dayMemos, preview)) {
      setState('local_changed')
      setSafeErrorMessage(messageForState('local_changed'))
      return
    }
    const target = pulled.records.filter((record) => record.entityId === preview.memo.date)
    if (!remoteMatchesAllBaselines(latest.metadata, pulled.records)
      || target.length !== 1
      || target[0].payload !== null
      || target[0].deletedAt !== preview.baseline.deletedAt
      || target[0].revision !== preview.baseline.remoteRevision
      || target[0].changeSequence !== preview.baseline.remoteChangeSequence) {
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
    if (loaded.status !== 'ready'
      || loaded.metadata.version !== 5
      || !metadataMatchesPreview(loaded.metadata, loaded.raw, preflight.preview)) {
      setState('metadata_changed')
      setSafeErrorMessage(messageForState('metadata_changed'))
      return
    }
    const operationId = createUuidV4()
    if (!operationId) {
      setState('storage_failed')
      setSafeErrorMessage('この環境では復活用operation IDを安全に作成できませんでした。RPCは実行していません。')
      return
    }
    const pendingOperation: DayMemoNormalUpsertPendingOperationV5 = {
      kind: 'upsert',
      operationMode: 'normal',
      date: preflight.preview.memo.date,
      operationId,
      baseRevision: preflight.preview.baseline.remoteRevision,
      preparedLocalUpdatedAt: preflight.preview.memo.updatedAt,
      preparedAt: new Date().toISOString(),
      status: 'prepared',
    }
    const next: DayMemoSyncMetadataV5 = { ...loaded.metadata, pendingOperation }
    const saved = replaceDayMemoSyncMetadataV2(window.localStorage, next, loaded.raw)
    if (saved !== 'saved') {
      const failureState: DayMemoResurrectionUploadState = saved === 'rollback_failed' ? 'recovery_required' : 'storage_failed'
      setState(failureState)
      setSafeErrorMessage(messageForState(failureState))
      return
    }
    preparedRef.current = { ...preflight, operationId, preparedMetadataRaw: JSON.stringify(next) }
    setState('prepared')
  }, [connection?.workspaceId, dayMemos, eligible, state])

  const uploadPrepared = useCallback(async () => {
    const prepared = preparedRef.current
    if (!eligible || !connection?.workspaceId || !connection.deviceId || !supabaseClient || state !== 'prepared' || !prepared) return
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const pending = loaded.status === 'ready'
      && loaded.metadata.version === 5
      && loaded.metadata.pendingOperation?.kind === 'upsert'
      ? loaded.metadata.pendingOperation
      : null
    const baseline = loaded.status === 'ready' && loaded.metadata.version === 5
      ? loaded.metadata.baselines[prepared.preview.memo.date]
      : null
    if (loaded.status !== 'ready'
      || loaded.metadata.version !== 5
      || loaded.raw !== prepared.preparedMetadataRaw
      || loaded.metadata.workspaceId !== connection.workspaceId
      || loaded.metadata.baselineStatus !== 'confirmed'
      || loaded.metadata.pushBlock !== null
      || Object.keys(loaded.metadata.localDeleteIntents).length !== 0
      || !baseline
      || baseline.deletedAt === null
      || baseline.baselineLocalUpdatedAt !== null
      || JSON.stringify(baseline) !== JSON.stringify(prepared.preview.baseline)
      || !pending
      || pending.status !== 'prepared'
      || pending.operationId !== prepared.operationId
      || pending.date !== prepared.preview.memo.date
      || pending.baseRevision !== prepared.preview.baseline.remoteRevision
      || pending.preparedLocalUpdatedAt !== prepared.preview.memo.updatedAt) {
      setState('metadata_changed')
      setSafeErrorMessage(messageForState('metadata_changed'))
      return
    }
    if (!localMatchesPreview(dayMemos, prepared.preview)) {
      setState('local_changed')
      setSafeErrorMessage(messageForState('local_changed'))
      return
    }
    const sending: DayMemoSyncMetadataV5 = {
      ...loaded.metadata,
      pendingOperation: { ...pending, status: 'sending' },
    }
    const sendingSave = replaceDayMemoSyncMetadataV2(window.localStorage, sending, loaded.raw)
    if (sendingSave !== 'saved') {
      const failureState: DayMemoResurrectionUploadState = sendingSave === 'rollback_failed' ? 'recovery_required' : 'storage_failed'
      setState(failureState)
      setSafeErrorMessage(messageForState(failureState))
      return
    }
    const sendingRaw = JSON.stringify(sending)
    setState('uploading')
    setSafeErrorMessage(null)
    const memo = prepared.preview.memo
    let data: unknown
    try {
      const response = await supabaseClient.rpc('hooto_day_upsert_sync_record', {
        target_workspace_id: connection.workspaceId,
        target_entity_type: 'day_memo',
        target_entity_id: memo.date,
        target_payload: { date: memo.date, content: memo.content, updatedAt: memo.updatedAt },
        target_schema_version: 1,
        base_revision: prepared.preview.baseline.remoteRevision,
        operation_id: prepared.operationId,
        client_updated_at: memo.updatedAt,
        source_device_id: connection.deviceId,
      })
      if (response.error) throw new Error('rpc_result_unknown')
      data = response.data
    } catch {
      const unknown: DayMemoSyncMetadataV5 = {
        ...sending,
        pendingOperation: { ...sending.pendingOperation!, status: 'response_unknown' },
      }
      const saved = replaceDayMemoSyncMetadataV2(window.localStorage, unknown, sendingRaw)
      preparedRef.current = null
      preflightRef.current = null
      const nextState: DayMemoResurrectionUploadState = saved === 'saved' ? 'response_unknown' : 'recovery_required'
      setState(nextState)
      setSafeErrorMessage(messageForState(nextState))
      return
    }
    const normalized = normalizeDayMemoSyncResult(data)
    if (isConflictDayMemoSyncResult(normalized, connection.workspaceId, memo.date)) {
      const conflict: DayMemoSyncMetadataV5 = {
        ...sending,
        pendingOperation: { ...sending.pendingOperation!, status: 'conflict' },
      }
      const saved = replaceDayMemoSyncMetadataV2(window.localStorage, conflict, sendingRaw)
      preparedRef.current = null
      preflightRef.current = null
      const nextState: DayMemoResurrectionUploadState = saved === 'saved' ? 'conflict' : 'recovery_required'
      setState(nextState)
      setSafeErrorMessage(messageForState(nextState))
      return
    }
    if (!isAppliedDayMemoSyncResult(
      normalized,
      connection.workspaceId,
      memo,
      prepared.preview.baseline.remoteRevision,
      prepared.preview.baseline.remoteChangeSequence,
    )) {
      const unknown: DayMemoSyncMetadataV5 = {
        ...sending,
        pendingOperation: { ...sending.pendingOperation!, status: 'response_unknown' },
      }
      const saved = replaceDayMemoSyncMetadataV2(window.localStorage, unknown, sendingRaw)
      preparedRef.current = null
      preflightRef.current = null
      const nextState: DayMemoResurrectionUploadState = saved === 'saved' ? 'response_unknown' : 'recovery_required'
      setState(nextState)
      setSafeErrorMessage(messageForState(nextState))
      return
    }
    const completedAt = new Date().toISOString()
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
      lastPulledChangeSequence: Math.max(sending.lastPulledChangeSequence, normalized.change_sequence),
      baselineStatus: 'confirmed',
      baselineConfirmedAt: completedAt,
      pendingOperation: null,
      lastSuccessfulSyncAt: completedAt,
    }
    const completedSave = replaceDayMemoSyncMetadataV2(window.localStorage, completed, sendingRaw)
    preparedRef.current = null
    preflightRef.current = null
    if (completedSave !== 'saved') {
      const nextState: DayMemoResurrectionUploadState = completedSave === 'rollback_failed'
        ? 'recovery_required'
        : 'post_rpc_metadata_failed'
      setState(nextState)
      setSafeErrorMessage(messageForState(nextState))
      return
    }
    setResult({ date: memo.date, revision: normalized.revision, changeSequence: normalized.change_sequence })
    discardPreview()
    setState('completed')
  }, [connection, dayMemos, discardPreview, eligible, state])

  return {
    eligible,
    state,
    safeErrorMessage,
    result,
    hasPendingOperation: state === 'prepared'
      || state === 'uploading'
      || state === 'conflict'
      || state === 'response_unknown'
      || state === 'post_rpc_metadata_failed'
      || state === 'recovery_required',
    runPreflight,
    prepareUpload,
    uploadPrepared,
    reset,
  }
}
