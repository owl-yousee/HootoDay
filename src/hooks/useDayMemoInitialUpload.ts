import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type {
  DayMemoInitialUploadEntryV1,
  DayMemoPushBlockReason,
  DayMemoSyncErrorCode,
  DayMemoSyncMetadataV1,
} from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import {
  bindDayMemoSyncMetadata,
  loadDayMemoSyncMetadata,
  saveDayMemoSyncMetadata,
  setDayMemoPushBlock,
} from '../utils/dayMemoSyncStorage'
import { fromDateKey } from '../utils/date'
import { isUuid } from '../utils/syncConnectionStorage'
import { createUuidV4 } from '../utils/uuid'

export type DayMemoInitialUploadState =
  | 'unavailable'
  | 'idle'
  | 'previewing'
  | 'preview_ready'
  | 'remote_not_empty'
  | 'preparing'
  | 'prepared'
  | 'uploading'
  | 'partially_completed'
  | 'response_unknown'
  | 'conflict'
  | 'completed'
  | 'push_blocked'
  | 'recovery_required'
  | 'error'

interface PreviewSnapshot {
  dates: string[]
  updatedAtByDate: Record<string, string>
}

interface SyncResultRecord {
  status: string
  workspace_id: string
  entity_type: string
  entity_id: string
  revision: number
  change_sequence: number
  server_updated_at: string
  deleted_at: string | null
  payload: unknown
  conflict: boolean
}

interface UseDayMemoInitialUploadInput {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoDateTime(value: unknown): value is string {
  return typeof value === 'string'
    && ISO_DATE_TIME_PATTERN.test(value)
    && !Number.isNaN(Date.parse(value))
}

function isValidDayMemo(value: DayMemo): boolean {
  return DATE_PATTERN.test(value.date)
    && Boolean(fromDateKey(value.date))
    && value.content.length >= 1
    && value.content.length <= 2000
    && value.content === value.content.trim()
    && isIsoDateTime(value.updatedAt)
}

function makeSnapshot(memos: DayMemo[]): PreviewSnapshot | null {
  if (!memos.every(isValidDayMemo)) return null
  const dates = memos.map((memo) => memo.date).sort()
  if (new Set(dates).size !== dates.length) return null
  return {
    dates,
    updatedAtByDate: Object.fromEntries(memos.map((memo) => [memo.date, memo.updatedAt])),
  }
}

function snapshotMatches(snapshot: PreviewSnapshot, memos: DayMemo[]): boolean {
  const current = makeSnapshot(memos)
  return current !== null
    && JSON.stringify(current.dates) === JSON.stringify(snapshot.dates)
    && current.dates.every((date) => current.updatedAtByDate[date] === snapshot.updatedAtByDate[date])
}

function normalizeOne(value: unknown): unknown {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : null
  return value
}

function isRemoteResult(value: unknown, workspaceId: string): value is SyncResultRecord {
  if (!isRecord(value)) return false
  return value.status === 'current'
    && value.workspace_id === workspaceId
    && value.entity_type === 'day_memo'
    && typeof value.entity_id === 'string'
    && DATE_PATTERN.test(value.entity_id)
    && Boolean(fromDateKey(value.entity_id))
    && Number.isSafeInteger(value.revision)
    && Number(value.revision) >= 1
    && Number.isSafeInteger(value.change_sequence)
    && Number(value.change_sequence) >= 1
    && isIsoDateTime(value.server_updated_at)
    && (value.deleted_at === null || isIsoDateTime(value.deleted_at))
    && typeof value.conflict === 'boolean'
    && value.conflict === false
    && ((value.deleted_at === null && isRecord(value.payload)) || (value.deleted_at !== null && value.payload === null))
}

function isAppliedResult(value: unknown, workspaceId: string, memo: DayMemo): value is SyncResultRecord {
  if (!isRecord(value) || !isRecord(value.payload)) return false
  const keys = Object.keys(value.payload).sort()
  return value.status === 'applied'
    && value.workspace_id === workspaceId
    && value.entity_type === 'day_memo'
    && value.entity_id === memo.date
    && value.revision === 1
    && Number.isSafeInteger(value.change_sequence)
    && Number(value.change_sequence) >= 1
    && isIsoDateTime(value.server_updated_at)
    && value.deleted_at === null
    && value.conflict === false
    && JSON.stringify(keys) === JSON.stringify(['content', 'date', 'updatedAt'])
    && value.payload.date === memo.date
    && value.payload.content === memo.content
    && value.payload.updatedAt === memo.updatedAt
}

function isConflictResult(value: unknown, workspaceId: string, date: string): value is SyncResultRecord {
  return isRecord(value)
    && value.status === 'conflict'
    && value.workspace_id === workspaceId
    && value.entity_type === 'day_memo'
    && value.entity_id === date
    && value.conflict === true
    && Number.isSafeInteger(value.revision)
    && Number(value.revision) >= 1
    && Number.isSafeInteger(value.change_sequence)
    && Number(value.change_sequence) >= 1
}

function stateFromMetadata(metadata: DayMemoSyncMetadataV1 | null): DayMemoInitialUploadState {
  if (!metadata) return 'idle'
  if (metadata.pushBlock) return 'push_blocked'
  if (metadata.initialUploadStatus === 'completed') return 'completed'
  if (metadata.initialUploadStatus === 'prepared') return 'prepared'
  if (metadata.initialUploadStatus === 'uploading') return 'recovery_required'
  if (metadata.initialUploadStatus === 'partial') {
    const entries = Object.values(metadata.entries)
    if (entries.some((entry) => entry.status === 'response_unknown')) return 'response_unknown'
    if (entries.some((entry) => entry.status === 'conflict')) return 'conflict'
    return 'partially_completed'
  }
  if (metadata.initialUploadStatus === 'blocked') return 'recovery_required'
  return 'idle'
}

function messageForError(code: DayMemoSyncErrorCode): string {
  switch (code) {
    case 'authentication_required': return '匿名認証を確認できないため、初回アップロードを開始できません。'
    case 'membership_required': return '親機・ownerの同期先情報を確認できません。'
    case 'remote_not_empty': return '同期先にはすでにDayMemoデータがあります。初回アップロードは行わず、今後のpull確認が必要です。'
    case 'local_changed': return '確認後にDayMemoが変更されました。もう一度プレビューしてください。'
    case 'storage_failed': return '同期の進捗を安全に保存できませんでした。RPCは続行しません。'
    case 'metadata_invalid': return 'DayMemo同期設定を安全に確認できません。自動で初期化せず停止しました。'
    case 'response_invalid': return '同期先からの結果を安全に確認できませんでした。自動再試行は行いません。'
    default: return '通信結果を確定できませんでした。自動再試行は行わず、pull確認が必要です。'
  }
}

export function useDayMemoInitialUpload({
  dayMemos,
  isConfigured,
  isSignedIn,
  connection,
}: UseDayMemoInitialUploadInput) {
  const [uploadState, setUploadState] = useState<DayMemoInitialUploadState>('unavailable')
  const [metadata, setMetadata] = useState<DayMemoSyncMetadataV1 | null>(null)
  const [preview, setPreview] = useState<PreviewSnapshot | null>(null)
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)

  const ownerReady = Boolean(
    isConfigured
    && isSignedIn
    && supabaseClient
    && connection
    && isUuid(connection.workspaceId)
    && isUuid(connection.deviceId)
    && connection.deviceRole === 'parent'
    && connection.workspaceRole === 'owner'
    && connection.pairingStatus === 'owner',
  )

  useEffect(() => {
    setPreview(null)
    setSafeErrorMessage(null)
    if (!connection?.workspaceId) {
      setMetadata(null)
      setUploadState('unavailable')
      return
    }
    const loaded = loadDayMemoSyncMetadata(window.localStorage)
    if (loaded.status === 'storage_unavailable') {
      setMetadata(null)
      setUploadState('error')
      setSafeErrorMessage(messageForError('storage_failed'))
      return
    }
    if (loaded.status === 'metadata_invalid') {
      setMetadata(null)
      setUploadState('recovery_required')
      setSafeErrorMessage(messageForError('metadata_invalid'))
      return
    }
    if (loaded.status === 'ready' && loaded.metadata.workspaceId !== connection.workspaceId) {
      setMetadata(null)
      setUploadState('recovery_required')
      setSafeErrorMessage('保存済みのDayMemo同期先が現在のworkspaceと一致しません。自動で上書きせず停止しました。')
      return
    }
    const next = loaded.status === 'ready' ? loaded.metadata : null
    setMetadata(next)
    setUploadState(ownerReady ? stateFromMetadata(next) : 'unavailable')
  }, [connection?.workspaceId, ownerReady])

  const counts = useMemo(() => {
    const entries = metadata ? Object.values(metadata.entries) : []
    return {
      total: metadata?.targetDates.length ?? preview?.dates.length ?? dayMemos.length,
      applied: entries.filter((entry) => entry.status === 'applied').length,
      pending: entries.filter((entry) => entry.status === 'pending').length,
      needsConfirmation: entries.filter((entry) => entry.status === 'response_unknown' || entry.status === 'conflict').length,
    }
  }, [dayMemos.length, metadata, preview])

  const previewInitialUpload = useCallback(async () => {
    const canRetryPreview = uploadState === 'error'
      && metadata?.initialUploadStatus !== 'prepared'
      && metadata?.initialUploadStatus !== 'partial'
      && metadata?.initialUploadStatus !== 'completed'
      && !metadata?.pushBlock
    if (!ownerReady || !connection?.workspaceId || !supabaseClient || (uploadState !== 'idle' && !canRetryPreview)) return
    setUploadState('previewing')
    setSafeErrorMessage(null)
    const snapshot = makeSnapshot(dayMemos)
    if (!snapshot) {
      setUploadState('error')
      setSafeErrorMessage('DayMemoの形式を安全に確認できません。ローカルデータは変更していません。')
      return
    }
    const { data, error } = await supabaseClient.rpc('hooto_day_pull_sync_records', {
      target_workspace_id: connection.workspaceId,
      after_change_sequence: 0,
      limit_count: 1,
    })
    if (error || !Array.isArray(data) || data.length > 1) {
      setUploadState('error')
      setSafeErrorMessage('同期先が空かどうか確認できませんでした。アップロードは開始しません。')
      return
    }
    if (data.length === 1) {
      if (!isRemoteResult(data[0], connection.workspaceId)) {
        setUploadState('error')
        setSafeErrorMessage(messageForError('response_invalid'))
        return
      }
      const blocked = setDayMemoPushBlock(window.localStorage, connection.workspaceId, 'remote_not_empty')
      if (blocked.result !== 'saved' || !blocked.metadata) {
        setUploadState('recovery_required')
        setSafeErrorMessage(messageForError(blocked.result === 'metadata_invalid' ? 'metadata_invalid' : 'storage_failed'))
        return
      }
      setMetadata(blocked.metadata)
      setPreview(null)
      setUploadState('remote_not_empty')
      setSafeErrorMessage(messageForError('remote_not_empty'))
      return
    }
    setPreview(snapshot)
    setUploadState('preview_ready')
  }, [connection, dayMemos, metadata, ownerReady, uploadState])

  const prepareInitialUpload = useCallback(() => {
    if (!ownerReady || !connection?.workspaceId || uploadState !== 'preview_ready' || !preview) return
    setUploadState('preparing')
    setSafeErrorMessage(null)
    if (preview.dates.length === 0) {
      setUploadState('preview_ready')
      return
    }
    if (!snapshotMatches(preview, dayMemos)) {
      setPreview(null)
      setUploadState('idle')
      setSafeErrorMessage(messageForError('local_changed'))
      return
    }
    const loaded = loadDayMemoSyncMetadata(window.localStorage)
    const current = bindDayMemoSyncMetadata(loaded, connection.workspaceId)
    if (!current || current.pushBlock || current.initialUploadStatus !== 'not_started') {
      setUploadState('recovery_required')
      setSafeErrorMessage(messageForError('metadata_invalid'))
      return
    }
    const entries: Record<string, DayMemoInitialUploadEntryV1> = {}
    for (const date of preview.dates) {
      const operationId = createUuidV4()
      if (!operationId) {
        setUploadState('error')
        setSafeErrorMessage('この環境ではoperation IDを安全に作成できませんでした。')
        return
      }
      entries[date] = {
        status: 'pending',
        operationId,
        preparedUpdatedAt: preview.updatedAtByDate[date],
        baseRevision: 0,
        remoteRevision: null,
        remoteChangeSequence: null,
        errorCode: null,
      }
    }
    const next: DayMemoSyncMetadataV1 = {
      ...current,
      initialUploadStatus: 'prepared',
      preparedAt: new Date().toISOString(),
      completedAt: null,
      targetDates: [...preview.dates],
      entries,
    }
    const saved = saveDayMemoSyncMetadata(window.localStorage, next)
    if (saved !== 'saved') {
      setUploadState('error')
      setSafeErrorMessage(messageForError(saved === 'metadata_invalid' ? 'metadata_invalid' : 'storage_failed'))
      return
    }
    setMetadata(next)
    setUploadState('prepared')
  }, [connection, dayMemos, ownerReady, preview, uploadState])

  const uploadPending = useCallback(async () => {
    if (!ownerReady || !connection?.workspaceId || !connection.deviceId || !supabaseClient || !metadata) return
    if (!['prepared', 'partially_completed'].includes(uploadState)) return
    if (metadata.pushBlock
      || metadata.workspaceId !== connection.workspaceId
      || Object.values(metadata.entries).some((entry) => entry.status === 'response_unknown' || entry.status === 'conflict')) return

    let progress: DayMemoSyncMetadataV1 = { ...metadata, initialUploadStatus: 'uploading' }
    if (saveDayMemoSyncMetadata(window.localStorage, progress) !== 'saved') {
      setUploadState('error')
      setSafeErrorMessage(messageForError('storage_failed'))
      return
    }
    setMetadata(progress)
    setUploadState('uploading')
    setSafeErrorMessage(null)

    for (const date of progress.targetDates) {
      const entry = progress.entries[date]
      if (entry.status === 'applied') continue
      if (entry.status !== 'pending' || !entry.operationId) return
      const memo = dayMemos.find((item) => item.date === date)
      if (!memo || memo.updatedAt !== entry.preparedUpdatedAt || !isValidDayMemo(memo)) {
        progress = {
          ...progress,
          initialUploadStatus: 'blocked',
          entries: { ...progress.entries, [date]: { ...entry, errorCode: 'local_changed' } },
        }
        if (saveDayMemoSyncMetadata(window.localStorage, progress) !== 'saved') {
          setUploadState('recovery_required')
          setSafeErrorMessage(messageForError('storage_failed'))
          return
        }
        setMetadata(progress)
        setUploadState('recovery_required')
        setSafeErrorMessage(messageForError('local_changed'))
        return
      }

      if (progress.initialUploadStatus !== 'uploading') {
        progress = { ...progress, initialUploadStatus: 'uploading' }
        if (saveDayMemoSyncMetadata(window.localStorage, progress) !== 'saved') {
          setUploadState('recovery_required')
          setSafeErrorMessage(messageForError('storage_failed'))
          return
        }
        setMetadata(progress)
      }

      const { data, error } = await supabaseClient.rpc('hooto_day_upsert_sync_record', {
        target_workspace_id: connection.workspaceId,
        target_entity_type: 'day_memo',
        target_entity_id: memo.date,
        target_payload: { date: memo.date, content: memo.content, updatedAt: memo.updatedAt },
        target_schema_version: 1,
        base_revision: 0,
        operation_id: entry.operationId,
        client_updated_at: memo.updatedAt,
        source_device_id: connection.deviceId,
      })

      if (error) {
        progress = {
          ...progress,
          initialUploadStatus: 'partial',
          entries: {
            ...progress.entries,
            [date]: { ...entry, status: 'response_unknown', errorCode: 'rpc_failed' },
          },
        }
        if (saveDayMemoSyncMetadata(window.localStorage, progress) !== 'saved') {
          setUploadState('recovery_required')
          setSafeErrorMessage(messageForError('storage_failed'))
          return
        }
        setMetadata(progress)
        setUploadState('response_unknown')
        setSafeErrorMessage(messageForError('rpc_failed'))
        return
      }

      const result = normalizeOne(data)
      if (isConflictResult(result, connection.workspaceId, date)) {
        progress = {
          ...progress,
          initialUploadStatus: 'partial',
          entries: {
            ...progress.entries,
            [date]: { ...entry, status: 'conflict', errorCode: 'remote_not_empty' },
          },
        }
        if (saveDayMemoSyncMetadata(window.localStorage, progress) !== 'saved') {
          setUploadState('recovery_required')
          setSafeErrorMessage(messageForError('storage_failed'))
          return
        }
        setMetadata(progress)
        setUploadState('conflict')
        setSafeErrorMessage('同期先に同じ日付のデータがあるため停止しました。ローカル内容は変更していません。')
        return
      }
      if (!isAppliedResult(result, connection.workspaceId, memo)) {
        progress = {
          ...progress,
          initialUploadStatus: 'partial',
          entries: {
            ...progress.entries,
            [date]: { ...entry, status: 'response_unknown', errorCode: 'response_invalid' },
          },
        }
        if (saveDayMemoSyncMetadata(window.localStorage, progress) !== 'saved') {
          setUploadState('recovery_required')
          setSafeErrorMessage(messageForError('storage_failed'))
          return
        }
        setMetadata(progress)
        setUploadState('response_unknown')
        setSafeErrorMessage(messageForError('response_invalid'))
        return
      }

      const appliedEntry: DayMemoInitialUploadEntryV1 = {
        ...entry,
        status: 'applied',
        operationId: null,
        remoteRevision: result.revision,
        remoteChangeSequence: result.change_sequence,
        errorCode: null,
      }
      const entries = { ...progress.entries, [date]: appliedEntry }
      const allApplied = progress.targetDates.every((target) => entries[target].status === 'applied')
      const now = new Date().toISOString()
      progress = {
        ...progress,
        initialUploadStatus: allApplied ? 'completed' : 'partial',
        completedAt: allApplied ? now : null,
        entries,
        lastSuccessfulSyncAt: now,
      }
      if (saveDayMemoSyncMetadata(window.localStorage, progress) !== 'saved') {
        setUploadState('recovery_required')
        setSafeErrorMessage(messageForError('storage_failed'))
        return
      }
      setMetadata(progress)
    }

    setUploadState(progress.initialUploadStatus === 'completed' ? 'completed' : 'partially_completed')
  }, [connection, dayMemos, metadata, ownerReady, uploadState])

  const guardLocalDataReplacement = useCallback((reason: DayMemoPushBlockReason): boolean => {
    const workspaceId = connection?.workspaceId && isUuid(connection.workspaceId) ? connection.workspaceId : null
    const result = setDayMemoPushBlock(window.localStorage, workspaceId, reason)
    if (result.result === 'not_required') return true
    if (result.result !== 'saved' || !result.metadata) {
      setUploadState('recovery_required')
      setSafeErrorMessage(messageForError(result.result === 'metadata_invalid' ? 'metadata_invalid' : 'storage_failed'))
      return false
    }
    setMetadata(result.metadata)
    setPreview(null)
    setUploadState('push_blocked')
    setSafeErrorMessage('復元または全初期化後の誤送信を防ぐため、DayMemoのアップロードを停止しています。')
    return true
  }, [connection?.workspaceId])

  return {
    uploadState,
    metadata,
    previewDates: preview?.dates ?? [],
    dayMemoCount: dayMemos.length,
    counts,
    ownerReady,
    safeErrorMessage,
    previewInitialUpload,
    prepareInitialUpload,
    uploadPending,
    guardLocalDataReplacement,
  }
}
