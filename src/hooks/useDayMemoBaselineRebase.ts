import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoSyncMetadataV4 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { fromDateKey } from '../utils/date'
import { readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords, type RemoteDayMemoRecord } from '../utils/dayMemoSyncPull'
import { loadDayMemoSyncMetadataAny, replaceDayMemoSyncMetadataV2 } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'

export type DayMemoBaselineRebaseState =
  | 'unavailable'
  | 'idle'
  | 'checking'
  | 'preview_ready'
  | 'rebase_ready'
  | 'content_difference'
  | 'remote_local_mismatch'
  | 'tombstone_present'
  | 'local_state_mismatch'
  | 'metadata_invalid'
  | 'workspace_mismatch'
  | 'pending_operation_present'
  | 'push_blocked'
  | 'saving'
  | 'completed'
  | 'save_failed'
  | 'readback_failed'
  | 'rollback_failed'
  | 'recovery_required'
  | 'error'

export type DayMemoBaselineRebaseClassification =
  | 'content_and_updated_at_match'
  | 'content_match_updated_at_diff'
  | 'content_diff'
  | 'remote_only'
  | 'local_only'
  | 'tombstone'
  | 'invalid'
  | 'incomplete'

export interface DayMemoBaselineRebaseItem {
  date: string
  classification: DayMemoBaselineRebaseClassification
  remoteRevision: number | null
  remoteChangeSequence: number | null
}

export interface DayMemoBaselineRebaseSummary {
  remoteCount: number
  localCount: number
  contentAndUpdatedAtMatchCount: number
  contentMatchUpdatedAtDiffCount: number
  contentDiffCount: number
  remoteOnlyCount: number
  localOnlyCount: number
  tombstoneCount: number
  invalidCount: number
  incompleteCount: number
  lastPulledChangeSequence: number
}

interface RebasePreviewSnapshot {
  workspaceId: string
  metadataRaw: string
  localStorageSerialized: string
  localSignature: string
  localMemos: DayMemo[]
  remoteRecords: RemoteDayMemoRecord[]
  maxChangeSequence: number
}

interface UseDayMemoBaselineRebaseInput {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
}

const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/

function isIsoDateTime(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE_TIME_PATTERN.test(value) && !Number.isNaN(Date.parse(value))
}

function isValidSyncLocalMemo(memo: DayMemo): boolean {
  return Boolean(fromDateKey(memo.date))
    && memo.content.length >= 1
    && memo.content.length <= 2000
    && memo.content === memo.content.trim()
    && isIsoDateTime(memo.updatedAt)
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

function classify(remoteRecords: RemoteDayMemoRecord[], localMemos: DayMemo[], maxChangeSequence: number) {
  const localByDate = new Map(localMemos.map((memo) => [memo.date, memo]))
  const items: DayMemoBaselineRebaseItem[] = []
  for (const record of remoteRecords) {
    const local = localByDate.get(record.entityId)
    let classification: DayMemoBaselineRebaseClassification
    if (record.deletedAt !== null) classification = 'tombstone'
    else if (!record.payload) classification = 'invalid'
    else if (!local) classification = 'remote_only'
    else if (!isValidSyncLocalMemo(local)) classification = 'invalid'
    else if (local.content !== record.payload.content) classification = 'content_diff'
    else if (local.updatedAt === record.payload.updatedAt) classification = 'content_and_updated_at_match'
    else classification = 'content_match_updated_at_diff'
    items.push({
      date: record.entityId,
      classification,
      remoteRevision: record.revision,
      remoteChangeSequence: record.changeSequence,
    })
    localByDate.delete(record.entityId)
  }
  for (const memo of localByDate.values()) {
    items.push({
      date: memo.date,
      classification: isValidSyncLocalMemo(memo) ? 'local_only' : 'invalid',
      remoteRevision: null,
      remoteChangeSequence: null,
    })
  }
  items.sort((left, right) => left.date.localeCompare(right.date))
  const count = (classification: DayMemoBaselineRebaseClassification) => items.filter((item) => item.classification === classification).length
  const summary: DayMemoBaselineRebaseSummary = {
    remoteCount: remoteRecords.filter((record) => record.deletedAt === null).length,
    localCount: localMemos.length,
    contentAndUpdatedAtMatchCount: count('content_and_updated_at_match'),
    contentMatchUpdatedAtDiffCount: count('content_match_updated_at_diff'),
    contentDiffCount: count('content_diff'),
    remoteOnlyCount: count('remote_only'),
    localOnlyCount: count('local_only'),
    tombstoneCount: count('tombstone'),
    invalidCount: count('invalid'),
    incompleteCount: count('incomplete'),
    lastPulledChangeSequence: maxChangeSequence,
  }
  return { items, summary }
}

function previewState(summary: DayMemoBaselineRebaseSummary): DayMemoBaselineRebaseState {
  if (summary.tombstoneCount > 0) return 'tombstone_present'
  if (summary.contentDiffCount > 0) return 'content_difference'
  if (summary.remoteOnlyCount > 0 || summary.localOnlyCount > 0 || summary.remoteCount !== summary.localCount) return 'remote_local_mismatch'
  if (summary.invalidCount > 0 || summary.incompleteCount > 0) return 'recovery_required'
  return summary.contentMatchUpdatedAtDiffCount > 0 ? 'rebase_ready' : 'preview_ready'
}

function safeMessage(state: DayMemoBaselineRebaseState): string | null {
  switch (state) {
    case 'content_difference': return '本文が異なるDayMemoがあります。baselineだけでは再確立できません。'
    case 'remote_local_mismatch': return '同期先とこの端末の日付構成が異なるため、baselineを再確立できません。'
    case 'tombstone_present': return '削除済みデータが含まれるため、baselineを再確立できません。'
    case 'local_state_mismatch': return '確認中または確認後にローカルDayMemoが変化したため停止しました。'
    case 'metadata_invalid': return '同期metadataを安全に確認できませんでした。'
    case 'workspace_mismatch': return '保存済みの同期先と現在の同期先が一致しません。'
    case 'pending_operation_present': return '未確認の同期操作があるため、baselineを再確立できません。'
    case 'push_blocked': return 'アップロード禁止状態のため、baselineを再確立できません。'
    case 'save_failed': return 'baseline metadataを安全に保存できませんでした。元の不一致状態を維持しています。'
    case 'readback_failed': return '保存後のbaseline metadataを確認できませんでした。元の不一致状態へ戻しました。'
    case 'rollback_failed': return '保存失敗後に元のmetadataを確認できませんでした。自動で再試行しないでください。'
    case 'recovery_required': return '取得結果を安全に検証できませんでした。baselineは変更していません。'
    case 'error': return '同期先の確認に失敗しました。自動で再試行しません。'
    default: return null
  }
}

export function useDayMemoBaselineRebase({ dayMemos, isConfigured, isSignedIn, connection }: UseDayMemoBaselineRebaseInput) {
  const [state, setState] = useState<DayMemoBaselineRebaseState>('unavailable')
  const [items, setItems] = useState<DayMemoBaselineRebaseItem[]>([])
  const [summary, setSummary] = useState<DayMemoBaselineRebaseSummary | null>(null)
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const previewRef = useRef<RebasePreviewSnapshot | null>(null)
  const generation = useRef(0)
  const currentLocalSignature = useMemo(() => localSignature(dayMemos), [dayMemos])
  const latestLocalSignature = useRef(currentLocalSignature)
  latestLocalSignature.current = currentLocalSignature
  const eligibleConnection = connectionIsEligible(connection)
  const eligible = Boolean(isConfigured && isSignedIn && supabaseClient && eligibleConnection)

  const clearPreview = useCallback(() => {
    generation.current += 1
    previewRef.current = null
    setItems([])
    setSummary(null)
    setSafeErrorMessage(null)
    if (!eligible || !connection?.workspaceId) {
      setState('unavailable')
      return
    }
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    setState(loaded.status === 'ready'
      && loaded.metadata.version === 4
      && loaded.metadata.workspaceId === connection.workspaceId
      && loaded.metadata.baselineStatus === 'mismatch'
      && loaded.metadata.pendingOperation === null
      && loaded.metadata.pushBlock === null ? 'idle' : 'unavailable')
  }, [connection?.workspaceId, eligible])

  useEffect(() => {
    clearPreview()
  }, [clearPreview, currentLocalSignature])

  const checkBaselineDifference = useCallback(async () => {
    if (!eligible || !connection?.workspaceId || !supabaseClient || state === 'checking' || state === 'saving') return
    previewRef.current = null
    setItems([])
    setSummary(null)
    setSafeErrorMessage(null)

    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    if (loaded.status !== 'ready' || loaded.metadata.version !== 4) {
      setState('metadata_invalid')
      setSafeErrorMessage(safeMessage('metadata_invalid'))
      return
    }
    if (loaded.metadata.workspaceId !== connection.workspaceId) {
      setState('workspace_mismatch')
      setSafeErrorMessage(safeMessage('workspace_mismatch'))
      return
    }
    if (loaded.metadata.baselineStatus !== 'mismatch') {
      setState('unavailable')
      return
    }
    if (loaded.metadata.pendingOperation !== null) {
      setState('pending_operation_present')
      setSafeErrorMessage(safeMessage('pending_operation_present'))
      return
    }
    if (loaded.metadata.pushBlock !== null) {
      setState('push_blocked')
      setSafeErrorMessage(safeMessage('push_blocked'))
      return
    }
    const localSnapshot = readDayMemoStorageSnapshot(window.localStorage)
    if (localSnapshot.status !== 'ready'
      || !localSnapshot.memos.every(isValidSyncLocalMemo)
      || localSignature(localSnapshot.memos) !== currentLocalSignature) {
      setState('local_state_mismatch')
      setSafeErrorMessage(safeMessage('local_state_mismatch'))
      return
    }

    const requestGeneration = ++generation.current
    setState('checking')
    let pulled
    try {
      pulled = await pullAllDayMemoSyncRecords(
        supabaseClient,
        connection.workspaceId,
        () => generation.current === requestGeneration && latestLocalSignature.current === currentLocalSignature,
      )
    } catch {
      setState('error')
      setSafeErrorMessage(safeMessage('error'))
      return
    }
    if (pulled.status !== 'complete') {
      const nextState: DayMemoBaselineRebaseState = pulled.status === 'cancelled' ? 'local_state_mismatch'
        : pulled.status === 'validation_error' || pulled.status === 'limit_reached' ? 'recovery_required' : 'error'
      setState(nextState)
      setSafeErrorMessage(safeMessage(nextState))
      return
    }
    const currentSnapshot = readDayMemoStorageSnapshot(window.localStorage)
    if (currentSnapshot.status !== 'ready'
      || currentSnapshot.serialized !== localSnapshot.serialized
      || localSignature(currentSnapshot.memos) !== currentLocalSignature) {
      setState('local_state_mismatch')
      setSafeErrorMessage(safeMessage('local_state_mismatch'))
      return
    }
    const result = classify(pulled.records, localSnapshot.memos, pulled.maxChangeSequence)
    const nextState = previewState(result.summary)
    previewRef.current = {
      workspaceId: connection.workspaceId,
      metadataRaw: loaded.raw,
      localStorageSerialized: localSnapshot.serialized,
      localSignature: currentLocalSignature,
      localMemos: localSnapshot.memos.map((memo) => ({ ...memo })),
      remoteRecords: pulled.records.map((record) => ({ ...record, payload: record.payload ? { ...record.payload } : null })),
      maxChangeSequence: pulled.maxChangeSequence,
    }
    setItems(result.items)
    setSummary(result.summary)
    setState(nextState)
    setSafeErrorMessage(safeMessage(nextState))
  }, [connection, currentLocalSignature, eligible, state])

  const confirmRebase = useCallback(() => {
    const preview = previewRef.current
    if (!eligible || !connection?.workspaceId || state !== 'rebase_ready' || !preview) return
    setState('saving')
    setSafeErrorMessage(null)
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    if (loaded.status !== 'ready' || loaded.metadata.version !== 4 || loaded.raw !== preview.metadataRaw) {
      setState('metadata_invalid')
      setSafeErrorMessage(safeMessage('metadata_invalid'))
      previewRef.current = null
      return
    }
    if (loaded.metadata.workspaceId !== connection.workspaceId || preview.workspaceId !== connection.workspaceId) {
      setState('workspace_mismatch')
      setSafeErrorMessage(safeMessage('workspace_mismatch'))
      previewRef.current = null
      return
    }
    if (loaded.metadata.baselineStatus !== 'mismatch' || loaded.metadata.pendingOperation !== null || loaded.metadata.pushBlock !== null) {
      const nextState: DayMemoBaselineRebaseState = loaded.metadata.pendingOperation !== null
        ? 'pending_operation_present' : loaded.metadata.pushBlock !== null ? 'push_blocked' : 'metadata_invalid'
      setState(nextState)
      setSafeErrorMessage(safeMessage(nextState))
      previewRef.current = null
      return
    }
    const currentSnapshot = readDayMemoStorageSnapshot(window.localStorage)
    if (currentSnapshot.status !== 'ready'
      || currentSnapshot.serialized !== preview.localStorageSerialized
      || localSignature(currentSnapshot.memos) !== preview.localSignature
      || latestLocalSignature.current !== preview.localSignature) {
      setState('local_state_mismatch')
      setSafeErrorMessage(safeMessage('local_state_mismatch'))
      previewRef.current = null
      return
    }
    const rechecked = classify(preview.remoteRecords, currentSnapshot.memos, preview.maxChangeSequence)
    if (previewState(rechecked.summary) !== 'rebase_ready') {
      setState('recovery_required')
      setSafeErrorMessage(safeMessage('recovery_required'))
      previewRef.current = null
      return
    }
    const localByDate = new Map(preview.localMemos.map((memo) => [memo.date, memo]))
    const baselines: DayMemoSyncMetadataV4['baselines'] = Object.fromEntries(preview.remoteRecords.map((record) => [record.entityId, {
      date: record.entityId,
      remoteRevision: record.revision,
      remoteChangeSequence: record.changeSequence,
      remoteUpdatedAt: record.payload!.updatedAt,
      baselineLocalUpdatedAt: localByDate.get(record.entityId)!.updatedAt,
      deletedAt: null,
    }]))
    const now = new Date().toISOString()
    const next: DayMemoSyncMetadataV4 = {
      ...loaded.metadata,
      baselines,
      lastPulledChangeSequence: preview.maxChangeSequence,
      baselineStatus: 'confirmed',
      baselineConfirmedAt: now,
      lastSuccessfulSyncAt: now,
    }
    const saved = replaceDayMemoSyncMetadataV2(window.localStorage, next, loaded.raw)
    previewRef.current = null
    setItems([])
    if (saved !== 'saved') {
      const nextState: DayMemoBaselineRebaseState = saved === 'readback_failed' ? 'readback_failed'
        : saved === 'rollback_failed' ? 'rollback_failed'
          : saved === 'metadata_invalid' ? 'metadata_invalid' : 'save_failed'
      setState(nextState)
      setSafeErrorMessage(safeMessage(nextState))
      return
    }
    setSummary(rechecked.summary)
    setState('completed')
  }, [connection, eligible, state])

  return {
    eligible: eligible && state !== 'unavailable',
    state,
    items,
    summary,
    safeErrorMessage,
    hasFreshPreview: previewRef.current !== null,
    checkBaselineDifference,
    confirmRebase,
    clearPreview,
  }
}
