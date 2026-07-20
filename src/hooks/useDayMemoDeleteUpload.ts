import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { SyncConnection } from '../types/sync'
import type { DayMemoPendingOperationV5, DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import { readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import {
  isAppliedDayMemoDeleteSyncResult,
  isConflictDayMemoSyncResult,
  normalizeDayMemoSyncResult,
} from '../utils/dayMemoSyncUpsertResult'
import { loadDayMemoSyncMetadataAny, replaceDayMemoSyncMetadataV2 } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import { createUuidV4 } from '../utils/uuid'
import type { DayMemoDeleteUploadCandidateSnapshot } from './useDayMemoDeletePreview'

export type DayMemoDeleteUploadState =
  | 'unavailable'
  | 'idle'
  | 'preflight_changed'
  | 'preparing'
  | 'prepared'
  | 'uploading'
  | 'completed'
  | 'conflict'
  | 'response_unknown'
  | 'storage_failed'
  | 'metadata_changed'
  | 'post_rpc_metadata_failed'
  | 'recovery_required'

export interface DayMemoDeleteUploadResult {
  date: string
  revision: number
  changeSequence: number
}

interface Input {
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  getSingleDeleteCandidateSnapshot: () => DayMemoDeleteUploadCandidateSnapshot | null
  discardDeletePreview: () => void
}

interface PreparedSnapshot {
  preview: DayMemoDeleteUploadCandidateSnapshot
  operationId: string
  clientDeletedAt: string
  preparedMetadataRaw: string
}

function connectionIsEligible(connection: SyncConnection | null): boolean {
  return Boolean(connection && isUuid(connection.workspaceId) && isUuid(connection.deviceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}

function safeMessage(state: DayMemoDeleteUploadState): string | null {
  switch (state) {
    case 'preflight_changed': return '削除候補の確認結果が変化しました。削除状態をもう一度確認してください。'
    case 'storage_failed': return 'delete operationを安全に保存できませんでした。削除RPCは実行していません。'
    case 'metadata_changed': return '同期metadataまたはローカル状態が確認後に変化したため停止しました。'
    case 'conflict': return '同期先との削除競合を確認しました。自動解決・再送は行いません。'
    case 'response_unknown': return '削除結果を安全に確定できませんでした。再送せず同期先を確認してください。'
    case 'post_rpc_metadata_failed': return '同期先への削除は完了した可能性がありますが、この端末の同期情報を保存できませんでした。'
    case 'recovery_required': return '削除同期の復旧が必要です。自動再試行やoperation IDの再生成は行いません。'
    default: return null
  }
}

function snapshotStillMatches(snapshot: DayMemoDeleteUploadCandidateSnapshot, workspaceId: string): boolean {
  const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
  const stored = readDayMemoStorageSnapshot(window.localStorage)
  if (loaded.status !== 'ready' || loaded.metadata.version !== 5 || loaded.raw !== snapshot.metadataRaw
    || loaded.metadata.workspaceId !== workspaceId || snapshot.workspaceId !== workspaceId
    || loaded.metadata.baselineStatus !== 'confirmed' || loaded.metadata.pendingOperation !== null
    || loaded.metadata.pushBlock !== null || Object.keys(loaded.metadata.localDeleteIntents).length !== 1
    || stored.status !== 'ready' || stored.serialized !== snapshot.localStorageSerialized
    || stored.memos.some((memo) => memo.date === snapshot.date)) return false
  const intent = loaded.metadata.localDeleteIntents[snapshot.date]
  const baseline = loaded.metadata.baselines[snapshot.date]
  return Boolean(intent && baseline && baseline.deletedAt === null
    && intent.baselineRevision === snapshot.intent.baselineRevision
    && intent.baselineChangeSequence === snapshot.intent.baselineChangeSequence
    && intent.deletedLocalUpdatedAt === snapshot.intent.deletedLocalUpdatedAt
    && intent.createdAt === snapshot.intent.createdAt
    && intent.status === snapshot.intent.status
    && baseline.remoteRevision === snapshot.baseline.remoteRevision
    && baseline.remoteChangeSequence === snapshot.baseline.remoteChangeSequence
    && baseline.remoteUpdatedAt === snapshot.baseline.remoteUpdatedAt
    && baseline.baselineLocalUpdatedAt === snapshot.baseline.baselineLocalUpdatedAt)
}

export function useDayMemoDeleteUpload({
  isConfigured,
  isSignedIn,
  connection,
  getSingleDeleteCandidateSnapshot,
  discardDeletePreview,
}: Input) {
  const [state, setState] = useState<DayMemoDeleteUploadState>('unavailable')
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const [result, setResult] = useState<DayMemoDeleteUploadResult | null>(null)
  const preparedRef = useRef<PreparedSnapshot | null>(null)
  const eligible = Boolean(isConfigured && isSignedIn && supabaseClient && connectionIsEligible(connection))

  const reset = useCallback(() => {
    preparedRef.current = null
    setResult(null)
    setSafeErrorMessage(null)
    if (!eligible || !connection?.workspaceId) {
      setState('unavailable')
      return
    }
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const ready = loaded.status === 'ready' && loaded.metadata.version === 5
      && loaded.metadata.workspaceId === connection.workspaceId
      && loaded.metadata.baselineStatus === 'confirmed' && loaded.metadata.pushBlock === null
      && loaded.metadata.pendingOperation === null
    setState(ready ? 'idle' : 'recovery_required')
    if (!ready) setSafeErrorMessage(safeMessage('recovery_required'))
  }, [connection?.workspaceId, eligible])

  useEffect(() => { reset() }, [reset])

  const prepareDelete = useCallback(() => {
    if (!eligible || !connection?.workspaceId || state !== 'idle') return
    const preview = getSingleDeleteCandidateSnapshot()
    if (!preview || !snapshotStillMatches(preview, connection.workspaceId)) {
      setState('preflight_changed')
      setSafeErrorMessage(safeMessage('preflight_changed'))
      return
    }
    setState('preparing')
    setSafeErrorMessage(null)
    const operationId = createUuidV4()
    if (!operationId) {
      setState('storage_failed')
      setSafeErrorMessage('この環境ではoperation IDを安全に作成できませんでした。削除RPCは実行していません。')
      return
    }
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    if (loaded.status !== 'ready' || loaded.metadata.version !== 5 || loaded.raw !== preview.metadataRaw) {
      setState('metadata_changed')
      setSafeErrorMessage(safeMessage('metadata_changed'))
      return
    }
    const clientDeletedAt = new Date().toISOString()
    const pendingOperation: DayMemoPendingOperationV5 = {
      kind: 'delete',
      date: preview.date,
      operationId,
      baseRevision: preview.intent.baselineRevision,
      preparedAt: clientDeletedAt,
      clientDeletedAt,
      status: 'prepared',
    }
    const next: DayMemoSyncMetadataV5 = { ...loaded.metadata, pendingOperation }
    const saved = replaceDayMemoSyncMetadataV2(window.localStorage, next, loaded.raw)
    if (saved !== 'saved') {
      setState(saved === 'rollback_failed' ? 'recovery_required' : 'storage_failed')
      setSafeErrorMessage(safeMessage(saved === 'rollback_failed' ? 'recovery_required' : 'storage_failed'))
      return
    }
    preparedRef.current = { preview, operationId, clientDeletedAt, preparedMetadataRaw: JSON.stringify(next) }
    setState('prepared')
  }, [connection?.workspaceId, eligible, getSingleDeleteCandidateSnapshot, state])

  const uploadPreparedDelete = useCallback(async () => {
    const prepared = preparedRef.current
    if (!eligible || !connection?.workspaceId || !connection.deviceId || !supabaseClient
      || state !== 'prepared' || !prepared) return
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const stored = readDayMemoStorageSnapshot(window.localStorage)
    const pending = loaded.status === 'ready' && loaded.metadata.version === 5
      && loaded.metadata.pendingOperation?.kind === 'delete' ? loaded.metadata.pendingOperation : null
    if (loaded.status !== 'ready' || loaded.metadata.version !== 5 || loaded.raw !== prepared.preparedMetadataRaw
      || loaded.metadata.workspaceId !== connection.workspaceId || loaded.metadata.baselineStatus !== 'confirmed'
      || loaded.metadata.pushBlock !== null || Object.keys(loaded.metadata.localDeleteIntents).length !== 1
      || stored.status !== 'ready' || stored.serialized !== prepared.preview.localStorageSerialized
      || stored.memos.some((memo) => memo.date === prepared.preview.date)
      || !pending || pending.status !== 'prepared' || pending.operationId !== prepared.operationId
      || pending.date !== prepared.preview.date || pending.baseRevision !== prepared.preview.intent.baselineRevision
      || pending.clientDeletedAt !== prepared.clientDeletedAt) {
      setState('metadata_changed')
      setSafeErrorMessage(safeMessage('metadata_changed'))
      return
    }
    const sending: DayMemoSyncMetadataV5 = { ...loaded.metadata, pendingOperation: { ...pending, status: 'sending' } }
    const sendingSave = replaceDayMemoSyncMetadataV2(window.localStorage, sending, loaded.raw)
    if (sendingSave !== 'saved') {
      setState(sendingSave === 'rollback_failed' ? 'recovery_required' : 'storage_failed')
      setSafeErrorMessage(safeMessage(sendingSave === 'rollback_failed' ? 'recovery_required' : 'storage_failed'))
      return
    }
    const sendingRaw = JSON.stringify(sending)
    setState('uploading')
    setSafeErrorMessage(null)
    let data: unknown
    try {
      const response = await supabaseClient.rpc('hooto_day_delete_sync_record', {
        target_workspace_id: connection.workspaceId,
        target_entity_type: 'day_memo',
        target_entity_id: prepared.preview.date,
        base_revision: prepared.preview.intent.baselineRevision,
        operation_id: prepared.operationId,
        client_updated_at: prepared.clientDeletedAt,
        source_device_id: connection.deviceId,
      })
      if (response.error) throw new Error('rpc_result_unknown')
      data = response.data
    } catch {
      const unknown: DayMemoSyncMetadataV5 = { ...sending, pendingOperation: { ...sending.pendingOperation!, status: 'response_unknown' } }
      const saved = replaceDayMemoSyncMetadataV2(window.localStorage, unknown, sendingRaw)
      preparedRef.current = null
      setState(saved === 'saved' ? 'response_unknown' : 'recovery_required')
      setSafeErrorMessage(safeMessage(saved === 'saved' ? 'response_unknown' : 'recovery_required'))
      return
    }
    const normalized = normalizeDayMemoSyncResult(data)
    if (isConflictDayMemoSyncResult(normalized, connection.workspaceId, prepared.preview.date)) {
      const conflict: DayMemoSyncMetadataV5 = { ...sending, pendingOperation: { ...sending.pendingOperation!, status: 'conflict' } }
      const saved = replaceDayMemoSyncMetadataV2(window.localStorage, conflict, sendingRaw)
      preparedRef.current = null
      setState(saved === 'saved' ? 'conflict' : 'recovery_required')
      setSafeErrorMessage(safeMessage(saved === 'saved' ? 'conflict' : 'recovery_required'))
      return
    }
    if (!isAppliedDayMemoDeleteSyncResult(
      normalized,
      connection.workspaceId,
      prepared.preview.date,
      prepared.preview.intent.baselineRevision,
      prepared.preview.previousChangeSequence,
    )) {
      const unknown: DayMemoSyncMetadataV5 = { ...sending, pendingOperation: { ...sending.pendingOperation!, status: 'response_unknown' } }
      const saved = replaceDayMemoSyncMetadataV2(window.localStorage, unknown, sendingRaw)
      preparedRef.current = null
      setState(saved === 'saved' ? 'response_unknown' : 'recovery_required')
      setSafeErrorMessage(safeMessage(saved === 'saved' ? 'response_unknown' : 'recovery_required'))
      return
    }
    const now = new Date().toISOString()
    const { [prepared.preview.date]: _removedIntent, ...remainingIntents } = sending.localDeleteIntents
    void _removedIntent
    const completed: DayMemoSyncMetadataV5 = {
      ...sending,
      baselines: {
        ...sending.baselines,
        [prepared.preview.date]: {
          date: prepared.preview.date,
          remoteRevision: normalized.revision,
          remoteChangeSequence: normalized.change_sequence,
          remoteUpdatedAt: normalized.server_updated_at,
          baselineLocalUpdatedAt: null,
          deletedAt: normalized.deleted_at,
        },
      },
      localDeleteIntents: remainingIntents,
      lastPulledChangeSequence: normalized.change_sequence,
      baselineStatus: 'confirmed',
      baselineConfirmedAt: now,
      pendingOperation: null,
      lastSuccessfulSyncAt: now,
    }
    const completedSave = replaceDayMemoSyncMetadataV2(window.localStorage, completed, sendingRaw)
    preparedRef.current = null
    if (completedSave !== 'saved') {
      const recovery: DayMemoSyncMetadataV5 = { ...sending, pendingOperation: { ...sending.pendingOperation!, status: 'recovery_required' } }
      replaceDayMemoSyncMetadataV2(window.localStorage, recovery, sendingRaw)
      setState('post_rpc_metadata_failed')
      setSafeErrorMessage(safeMessage('post_rpc_metadata_failed'))
      return
    }
    setResult({ date: prepared.preview.date, revision: normalized.revision, changeSequence: normalized.change_sequence })
    discardDeletePreview()
    setState('completed')
  }, [connection, discardDeletePreview, eligible, state])

  return {
    eligible,
    state,
    safeErrorMessage,
    result,
    hasPendingOperation: state === 'prepared' || state === 'uploading' || state === 'conflict'
      || state === 'response_unknown' || state === 'post_rpc_metadata_failed' || state === 'recovery_required',
    prepareDelete,
    uploadPreparedDelete,
    reset,
  }
}
