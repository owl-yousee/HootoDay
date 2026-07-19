import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type {
  DayMemoPullComparison,
  DayMemoPullApplyResult,
  DayMemoPullApplyState,
  DayMemoPullPreviewItem,
  DayMemoPullPreviewState,
  DayMemoPullPreviewSummary,
} from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { fromDateKey } from '../utils/date'
import { loadDayMemoSyncMetadata } from '../utils/dayMemoSyncStorage'
import { saveDayMemoPullApplyBackup } from '../utils/dayMemoPullApplyBackupStorage'
import { readDayMemoStorageSnapshot, replaceStoredDayMemosVerified } from '../utils/dayMemoStorage'
import { isUuid } from '../utils/syncConnectionStorage'

interface UseDayMemoPullPreviewInput {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  adoptVerifiedStoredDayMemos: (memos: DayMemo[]) => void
}

interface RemoteDayMemoRecord {
  workspaceId: string
  entityId: string
  revision: number
  changeSequence: number
  serverUpdatedAt: string
  deletedAt: string | null
  payload: DayMemo | null
}

interface PullPreviewData {
  items: DayMemoPullPreviewItem[]
  summary: DayMemoPullPreviewSummary
  remoteRecords: RemoteDayMemoRecord[]
  localStorageSnapshot: string
}

const PAGE_LIMIT = 100
const MAX_PAGES = 20
const MAX_RECORDS = PAGE_LIMIT * MAX_PAGES
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

function isValidDayMemo(value: unknown, expectedDate?: string): value is DayMemo {
  if (!isRecord(value)) return false
  const keys = Object.keys(value).sort()
  return JSON.stringify(keys) === JSON.stringify(['content', 'date', 'updatedAt'])
    && typeof value.date === 'string'
    && DATE_PATTERN.test(value.date)
    && Boolean(fromDateKey(value.date))
    && (expectedDate === undefined || value.date === expectedDate)
    && typeof value.content === 'string'
    && value.content.length >= 1
    && value.content.length <= 2000
    && value.content === value.content.trim()
    && isIsoDateTime(value.updatedAt)
}

function validateRemoteRecord(value: unknown, workspaceId: string): RemoteDayMemoRecord | null {
  if (!isRecord(value)
    || value.status !== 'current'
    || value.workspace_id !== workspaceId
    || value.entity_type !== 'day_memo'
    || typeof value.entity_id !== 'string'
    || !DATE_PATTERN.test(value.entity_id)
    || !fromDateKey(value.entity_id)
    || !Number.isSafeInteger(value.revision)
    || Number(value.revision) < 1
    || !Number.isSafeInteger(value.change_sequence)
    || Number(value.change_sequence) < 1
    || !isIsoDateTime(value.server_updated_at)
    || typeof value.conflict !== 'boolean'
    || value.conflict) return null

  if (value.deleted_at === null) {
    if (!isValidDayMemo(value.payload, value.entity_id)) return null
    return {
      workspaceId,
      entityId: value.entity_id,
      revision: Number(value.revision),
      changeSequence: Number(value.change_sequence),
      serverUpdatedAt: value.server_updated_at,
      deletedAt: null,
      payload: { ...value.payload },
    }
  }

  if (!isIsoDateTime(value.deleted_at) || value.payload !== null) return null
  return {
    workspaceId,
    entityId: value.entity_id,
    revision: Number(value.revision),
    changeSequence: Number(value.change_sequence),
    serverUpdatedAt: value.server_updated_at,
    deletedAt: value.deleted_at,
    payload: null,
  }
}

function localSignature(memos: DayMemo[]): string {
  return JSON.stringify(memos.map((memo) => [memo.date, memo.updatedAt, memo.content]).sort(([a], [b]) => a.localeCompare(b)))
}

function buildPreview(remoteRecords: RemoteDayMemoRecord[], localMemos: DayMemo[]): Omit<PullPreviewData, 'localStorageSnapshot'> | null {
  if (!localMemos.every((memo) => isValidDayMemo(memo))) return null
  const localByDate = new Map<string, DayMemo>()
  for (const memo of localMemos) {
    if (localByDate.has(memo.date)) return null
    localByDate.set(memo.date, memo)
  }

  const remoteDates = new Set(remoteRecords.map((record) => record.entityId))
  const items: DayMemoPullPreviewItem[] = remoteRecords.map((record) => {
    const local = localByDate.get(record.entityId)
    let comparison: DayMemoPullComparison
    if (record.deletedAt !== null) {
      comparison = local ? 'remote_tombstone_local_exists' : 'remote_tombstone_local_missing'
    } else if (!local) {
      comparison = 'remote_only'
    } else {
      comparison = local.updatedAt === record.payload!.updatedAt && local.content === record.payload!.content
        ? 'same'
        : 'different'
    }
    return {
      date: record.entityId,
      comparison,
      remoteRevision: record.revision,
      remoteChangeSequence: record.changeSequence,
      tombstone: record.deletedAt !== null,
    }
  })

  for (const memo of localMemos) {
    if (!remoteDates.has(memo.date)) {
      items.push({ date: memo.date, comparison: 'local_only', remoteRevision: null, remoteChangeSequence: null, tombstone: false })
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date))

  const count = (comparison: DayMemoPullComparison) => items.filter((item) => item.comparison === comparison).length
  return {
    items,
    summary: {
      remoteActiveCount: remoteRecords.filter((record) => record.deletedAt === null).length,
      remoteTombstoneCount: remoteRecords.filter((record) => record.deletedAt !== null).length,
      remoteOnlyCount: count('remote_only'),
      localOnlyCount: count('local_only'),
      sameCount: count('same'),
      differentCount: count('different'),
      remoteTombstoneLocalExistsCount: count('remote_tombstone_local_exists'),
      remoteTombstoneLocalMissingCount: count('remote_tombstone_local_missing'),
      maxChangeSequence: remoteRecords.at(-1)?.changeSequence ?? 0,
    },
    remoteRecords,
  }
}

function messageForState(state: DayMemoPullPreviewState): string | null {
  switch (state) {
    case 'incomplete': return '途中で通信が完了しなかったため、取得済みデータは破棄しました。もう一度確認してください。'
    case 'validation_error': return '同期先のDayMemoを安全に検証できなかったため、確認結果を破棄しました。'
    case 'workspace_mismatch': return '現在のworkspaceと同期設定が一致しないため、確認を停止しました。'
    case 'auth_error': return '匿名認証を確認できないため、DayMemoを確認できませんでした。'
    case 'rpc_error': return '同期先のDayMemoを取得できませんでした。自動再試行は行いません。'
    case 'limit_reached': return '安全な取得上限に達したため、完全な確認結果として扱いません。'
    case 'recovery_required': return 'この端末の同期設定を安全に確認できませんでした。'
    default: return null
  }
}

export function useDayMemoPullPreview({
  dayMemos,
  isConfigured,
  isSignedIn,
  connection,
  adoptVerifiedStoredDayMemos,
}: UseDayMemoPullPreviewInput) {
  const [previewState, setPreviewState] = useState<DayMemoPullPreviewState>('unavailable')
  const [preview, setPreview] = useState<PullPreviewData | null>(null)
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const [applyState, setApplyState] = useState<DayMemoPullApplyState>('idle')
  const [applyResult, setApplyResult] = useState<DayMemoPullApplyResult | null>(null)
  const previewLocalSignature = useRef<string | null>(null)
  const requestGeneration = useRef(0)
  const currentLocalSignature = useMemo(() => localSignature(dayMemos), [dayMemos])
  const latestLocalSignature = useRef(currentLocalSignature)
  latestLocalSignature.current = currentLocalSignature

  const memberReady = Boolean(
    isConfigured && isSignedIn && supabaseClient && connection
    && isUuid(connection.workspaceId) && isUuid(connection.deviceId)
    && connection.deviceRole === 'child'
    && connection.workspaceRole === 'member'
    && connection.pairingStatus === 'member',
  )

  useEffect(() => {
    requestGeneration.current += 1
    setPreview(null)
    previewLocalSignature.current = null
    setSafeErrorMessage(null)
    setApplyState('idle')
    setApplyResult(null)
    setPreviewState(memberReady ? 'idle' : 'unavailable')
  }, [connection?.workspaceId, memberReady])

  useEffect(() => {
    if (previewLocalSignature.current !== null && previewLocalSignature.current !== currentLocalSignature) {
      setPreview(null)
      previewLocalSignature.current = null
      setPreviewState('recovery_required')
      setSafeErrorMessage('確認後にローカルDayMemoが変わったため、previewを破棄しました。もう一度確認してください。')
    }
  }, [currentLocalSignature])

  const pullPreview = useCallback(async () => {
    if (!memberReady || !connection?.workspaceId || !supabaseClient || previewState === 'pulling') return
    setPreview(null)
    previewLocalSignature.current = null
    setSafeErrorMessage(null)
    setPreviewState('pulling')
    const generation = ++requestGeneration.current
    const requestLocalSignature = currentLocalSignature

    const metadata = loadDayMemoSyncMetadata(window.localStorage)
    if (metadata.status === 'storage_unavailable' || metadata.status === 'metadata_invalid') {
      setPreviewState('recovery_required')
      setSafeErrorMessage(messageForState('recovery_required'))
      return
    }
    if (metadata.status === 'ready' && metadata.metadata.workspaceId !== connection.workspaceId) {
      setPreviewState('workspace_mismatch')
      setSafeErrorMessage(messageForState('workspace_mismatch'))
      return
    }

    const records: RemoteDayMemoRecord[] = []
    const entityKeys = new Set<string>()
    const changeSequences = new Set<number>()
    let cursor = 0

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const { data, error } = await supabaseClient.rpc('hooto_day_pull_sync_records', {
        target_workspace_id: connection.workspaceId,
        after_change_sequence: cursor,
        limit_count: PAGE_LIMIT,
      })
      if (generation !== requestGeneration.current) return
      if (requestLocalSignature !== latestLocalSignature.current) {
        setPreviewState('recovery_required')
        setSafeErrorMessage('確認中にローカルDayMemoが変わったため、取得済みデータを破棄しました。もう一度確認してください。')
        return
      }
      if (error) {
        const message = typeof error.message === 'string' ? error.message.toLowerCase() : ''
        const nextState: DayMemoPullPreviewState = message.includes('authentication is required')
          ? 'auth_error'
          : message.includes('workspace membership is required') ? 'workspace_mismatch' : records.length > 0 ? 'incomplete' : 'rpc_error'
        setPreviewState(nextState)
        setSafeErrorMessage(messageForState(nextState))
        return
      }
      if (!Array.isArray(data) || data.length > PAGE_LIMIT) {
        setPreviewState('validation_error')
        setSafeErrorMessage(messageForState('validation_error'))
        return
      }

      let nextCursor = cursor
      for (const value of data) {
        const record = validateRemoteRecord(value, connection.workspaceId)
        if (!record || record.changeSequence <= nextCursor || entityKeys.has(record.entityId) || changeSequences.has(record.changeSequence)) {
          setPreviewState('validation_error')
          setSafeErrorMessage(messageForState('validation_error'))
          return
        }
        records.push(record)
        entityKeys.add(record.entityId)
        changeSequences.add(record.changeSequence)
        nextCursor = record.changeSequence
      }

      if (data.length < PAGE_LIMIT) {
        const nextPreview = buildPreview(records, dayMemos)
        if (!nextPreview) {
          setPreviewState('validation_error')
          setSafeErrorMessage(messageForState('validation_error'))
          return
        }
        const storageSnapshot = readDayMemoStorageSnapshot(window.localStorage)
        if (storageSnapshot.status !== 'ready'
          || localSignature(storageSnapshot.memos) !== requestLocalSignature) {
          setPreviewState('recovery_required')
          setSafeErrorMessage(messageForState('recovery_required'))
          return
        }
        setPreview({ ...nextPreview, localStorageSnapshot: storageSnapshot.serialized })
        previewLocalSignature.current = currentLocalSignature
        setPreviewState(records.length === 0
          ? 'empty_remote'
          : nextPreview.summary.remoteTombstoneCount > 0 ? 'tombstones_present' : 'preview_ready')
        return
      }

      if (nextCursor <= cursor || records.length >= MAX_RECORDS) {
        setPreviewState('limit_reached')
        setSafeErrorMessage(messageForState('limit_reached'))
        return
      }
      cursor = nextCursor
    }

    setPreviewState('limit_reached')
    setSafeErrorMessage(messageForState('limit_reached'))
  }, [connection?.workspaceId, currentLocalSignature, dayMemos, memberReady, previewState])

  const clearPreview = useCallback(() => {
    requestGeneration.current += 1
    setPreview(null)
    previewLocalSignature.current = null
    setSafeErrorMessage(null)
    setApplyState('idle')
    setApplyResult(null)
    setPreviewState(memberReady ? 'idle' : 'unavailable')
  }, [memberReady])

  const canApplyPreview = Boolean(
    memberReady
    && previewState === 'preview_ready'
    && preview
    && preview.summary.remoteOnlyCount > 0
    && preview.summary.localOnlyCount === 0
    && preview.summary.differentCount === 0
    && preview.summary.remoteTombstoneCount === 0
    && preview.summary.remoteTombstoneLocalExistsCount === 0
    && preview.summary.remoteTombstoneLocalMissingCount === 0
    && applyState !== 'applying'
    && applyState !== 'completed',
  )

  const applyPreview = useCallback(() => {
    if (!canApplyPreview || !preview || !connection?.workspaceId || applyState === 'applying') return
    setSafeErrorMessage(null)
    setApplyState('applying')

    if (!memberReady
      || connection.deviceRole !== 'child'
      || connection.workspaceRole !== 'member'
      || connection.pairingStatus !== 'member') {
      setApplyState('connection_changed')
      setSafeErrorMessage('接続状態が変わったため、DayMemoの反映を中止しました。もう一度確認してください。')
      return
    }

    const currentSignature = localSignature(dayMemos)
    const currentStorage = readDayMemoStorageSnapshot(window.localStorage)
    if (previewLocalSignature.current !== currentSignature
      || currentStorage.status !== 'ready'
      || currentStorage.serialized !== preview.localStorageSnapshot
      || localSignature(currentStorage.memos) !== currentSignature) {
      setApplyState('local_changed')
      setSafeErrorMessage('確認後にこの端末のDayMemoが変わったため、反映を中止しました。もう一度確認してください。')
      return
    }

    const metadata = loadDayMemoSyncMetadata(window.localStorage)
    if ((metadata.status === 'ready' && (metadata.metadata.workspaceId !== connection.workspaceId || metadata.metadata.pushBlock !== null))
      || metadata.status === 'storage_unavailable'
      || metadata.status === 'metadata_invalid') {
      setApplyState('metadata_invalid')
      setSafeErrorMessage('同期設定を安全に確認できないため、DayMemoの反映を中止しました。')
      return
    }

    const remoteOnlyRecords = preview.remoteRecords.filter((record) => record.deletedAt === null
      && preview.items.some((item) => item.date === record.entityId && item.comparison === 'remote_only'))
    if (remoteOnlyRecords.length !== preview.summary.remoteOnlyCount
      || remoteOnlyRecords.some((record) => record.payload === null)
      || new Set(remoteOnlyRecords.map((record) => record.entityId)).size !== remoteOnlyRecords.length) {
      setApplyState('preview_invalid')
      setSafeErrorMessage('確認結果を安全に再検証できなかったため、反映を中止しました。')
      return
    }

    const nextMemos = [
      ...dayMemos.map((memo) => ({ ...memo })),
      ...remoteOnlyRecords.map((record) => ({ ...record.payload! })),
    ].sort((left, right) => left.date.localeCompare(right.date))
    if (new Set(nextMemos.map((memo) => memo.date)).size !== nextMemos.length) {
      setApplyState('preview_invalid')
      setSafeErrorMessage('日付の重複を検出したため、DayMemoの反映を中止しました。')
      return
    }

    const backupResult = saveDayMemoPullApplyBackup(window.localStorage, connection.workspaceId, dayMemos)
    if (backupResult !== 'saved' && backupResult !== 'reused') {
      setApplyState('backup_failed')
      setSafeErrorMessage('反映前バックアップを安全に保存できなかったため、DayMemoは変更していません。')
      return
    }

    const saveResult = replaceStoredDayMemosVerified(window.localStorage, nextMemos, preview.localStorageSnapshot)
    if (saveResult !== 'saved') {
      setApplyState(saveResult === 'rollback_failed' ? 'recovery_required' : 'storage_failed')
      setSafeErrorMessage(saveResult === 'rollback_failed'
        ? '保存状態を安全に復旧できませんでした。操作を止めて、この画面を再読み込みしないでください。'
        : 'DayMemoを安全に保存できなかったため、元のデータを維持しました。')
      return
    }

    try {
      adoptVerifiedStoredDayMemos(nextMemos)
    } catch {
      setApplyState('recovery_required')
      setSafeErrorMessage('保存後の画面更新を完了できませんでした。再操作せず確認してください。')
      return
    }

    const result = { appliedCount: remoteOnlyRecords.length, localTotalCount: nextMemos.length }
    requestGeneration.current += 1
    setPreview(null)
    previewLocalSignature.current = null
    setPreviewState('idle')
    setApplyResult(result)
    setApplyState('completed')
  }, [adoptVerifiedStoredDayMemos, applyState, canApplyPreview, connection, dayMemos, memberReady, preview])

  return {
    previewState,
    items: preview?.items ?? [],
    summary: preview?.summary ?? null,
    memberReady,
    safeErrorMessage,
    pageLimit: PAGE_LIMIT,
    maxRecords: MAX_RECORDS,
    pullPreview,
    clearPreview,
    applyState,
    applyResult,
    canApplyPreview,
    applyPreview,
  }
}
