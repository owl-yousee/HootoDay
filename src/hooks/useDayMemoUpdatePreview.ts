import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoRemoteBaselineV2, DayMemoSyncMetadataV2 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { loadDayMemoSyncMetadataAny } from '../utils/dayMemoSyncStorage'
import { fromDateKey } from '../utils/date'
import { isUuid } from '../utils/syncConnectionStorage'

export type DayMemoUpdatePreviewState =
  | 'unavailable'
  | 'idle'
  | 'checking'
  | 'preview_ready'
  | 'no_changes'
  | 'blocked'
  | 'baseline_not_confirmed'
  | 'pending_operation_present'
  | 'local_state_mismatch'
  | 'metadata_invalid'
  | 'workspace_mismatch'
  | 'recovery_required'
  | 'error'

export type DayMemoUpdateClassification =
  | 'unchanged'
  | 'modified_candidate'
  | 'local_only'
  | 'missing_local'
  | 'tombstone_baseline'
  | 'metadata_invalid'

export interface DayMemoUpdatePreviewItem {
  date: string
  classification: DayMemoUpdateClassification
  baseRevision: number | null
  baselineChangeSequence: number | null
  localUpdatedAt: string | null
}

export interface DayMemoUpdatePreviewSummary {
  modifiedCandidateCount: number
  unchangedCount: number
  localOnlyCount: number
  missingLocalCount: number
  tombstoneCount: number
  metadataInvalidCount: number
  baselineConfirmedAt: string
  lastPulledChangeSequence: number
}

export interface DayMemoUpdateUploadCandidateSnapshot {
  workspaceId: string
  baselineConfirmedAt: string
  lastPulledChangeSequence: number
  candidate: {
    date: string
    localUpdatedAt: string
    content: string
    baseRevision: number
    baselineChangeSequence: number
    baselineRemoteUpdatedAt: string
  }
  localStorageSerialized: string
  localMemos: DayMemo[]
  metadataRaw: string
}

interface UseDayMemoUpdatePreviewInput {
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

function classify(
  metadata: DayMemoSyncMetadataV2,
  localMemos: DayMemo[],
): { items: DayMemoUpdatePreviewItem[]; summary: Omit<DayMemoUpdatePreviewSummary, 'baselineConfirmedAt' | 'lastPulledChangeSequence'> } {
  const localByDate = new Map(localMemos.map((memo) => [memo.date, memo]))
  const items: DayMemoUpdatePreviewItem[] = []

  for (const [date, baseline] of Object.entries(metadata.baselines).sort(([left], [right]) => left.localeCompare(right))) {
    const local = localByDate.get(date)
    let classification: DayMemoUpdateClassification
    if (!baselineIsUsable(baseline, date)) classification = 'metadata_invalid'
    else if (baseline.deletedAt !== null) classification = 'tombstone_baseline'
    else if (!local) classification = 'missing_local'
    else if (!isValidSyncLocalMemo(local)) classification = 'metadata_invalid'
    else if (local.updatedAt === baseline.baselineLocalUpdatedAt) classification = 'unchanged'
    else classification = 'modified_candidate'
    items.push({
      date,
      classification,
      baseRevision: baseline.remoteRevision,
      baselineChangeSequence: baseline.remoteChangeSequence,
      localUpdatedAt: local?.updatedAt ?? null,
    })
    localByDate.delete(date)
  }

  for (const memo of [...localByDate.values()].sort((left, right) => left.date.localeCompare(right.date))) {
    items.push({
      date: memo.date,
      classification: isValidSyncLocalMemo(memo) ? 'local_only' : 'metadata_invalid',
      baseRevision: null,
      baselineChangeSequence: null,
      localUpdatedAt: memo.updatedAt,
    })
  }
  items.sort((left, right) => left.date.localeCompare(right.date))
  return {
    items,
    summary: {
      modifiedCandidateCount: items.filter((item) => item.classification === 'modified_candidate').length,
      unchangedCount: items.filter((item) => item.classification === 'unchanged').length,
      localOnlyCount: items.filter((item) => item.classification === 'local_only').length,
      missingLocalCount: items.filter((item) => item.classification === 'missing_local').length,
      tombstoneCount: items.filter((item) => item.classification === 'tombstone_baseline').length,
      metadataInvalidCount: items.filter((item) => item.classification === 'metadata_invalid').length,
    },
  }
}

function baselineIsUsable(baseline: DayMemoRemoteBaselineV2, expectedDate: string): boolean {
  return baseline.date === expectedDate
    && Number.isSafeInteger(baseline.remoteRevision)
    && baseline.remoteRevision >= 1
    && Number.isSafeInteger(baseline.remoteChangeSequence)
    && baseline.remoteChangeSequence >= 1
    && isIsoDateTime(baseline.remoteUpdatedAt)
    && (baseline.baselineLocalUpdatedAt === null || isIsoDateTime(baseline.baselineLocalUpdatedAt))
    && (baseline.deletedAt === null || isIsoDateTime(baseline.deletedAt))
    && (baseline.deletedAt !== null || baseline.baselineLocalUpdatedAt !== null)
}

function messageForState(state: DayMemoUpdatePreviewState): string | null {
  switch (state) {
    case 'blocked': return 'アップロード禁止状態が継続しているため、更新候補を確認できません。'
    case 'baseline_not_confirmed': return '先に同期baselineを確認してください。'
    case 'pending_operation_present': return '未確認の同期操作があるため、新しい更新候補を確認できません。'
    case 'local_state_mismatch': return 'DayMemoの保存状態が変化したため、確認を中止しました。'
    case 'metadata_invalid': return '保存済みの同期設定またはDayMemoを安全に確認できませんでした。'
    case 'workspace_mismatch': return '保存済み同期設定のworkspaceが現在の接続先と一致しません。'
    case 'recovery_required': return '更新候補を安全に確認できませんでした。自動で再試行していません。'
    case 'error': return '更新候補の確認に失敗しました。DayMemoは変更していません。'
    default: return null
  }
}

export function useDayMemoUpdatePreview({ dayMemos, isConfigured, isSignedIn, connection }: UseDayMemoUpdatePreviewInput) {
  const [previewState, setPreviewState] = useState<DayMemoUpdatePreviewState>('unavailable')
  const [items, setItems] = useState<DayMemoUpdatePreviewItem[]>([])
  const [summary, setSummary] = useState<DayMemoUpdatePreviewSummary | null>(null)
  const [previewSnapshot, setPreviewSnapshot] = useState<DayMemoUpdateUploadCandidateSnapshot | null>(null)
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const currentLocalSignature = useMemo(() => localSignature(dayMemos), [dayMemos])
  const eligible = isConfigured && isSignedIn && connectionIsEligible(connection)

  const discardPreview = useCallback(() => {
    setItems([])
    setSummary(null)
    setPreviewSnapshot(null)
    setSafeErrorMessage(null)
    setPreviewState(eligible ? 'idle' : 'unavailable')
  }, [eligible])

  useEffect(() => {
    setItems([])
    setSummary(null)
    setPreviewSnapshot(null)
    setSafeErrorMessage(null)
    if (!eligible || !connection?.workspaceId) {
      setPreviewState('unavailable')
      return
    }
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    if (loaded.status !== 'ready' || loaded.metadata.version !== 2) {
      const state = loaded.status === 'metadata_invalid' || loaded.status === 'storage_unavailable' ? 'metadata_invalid' : 'baseline_not_confirmed'
      setPreviewState(state)
      setSafeErrorMessage(messageForState(state))
      return
    }
    if (loaded.metadata.workspaceId !== connection.workspaceId) {
      setPreviewState('workspace_mismatch')
      setSafeErrorMessage(messageForState('workspace_mismatch'))
      return
    }
    if (loaded.metadata.pendingOperation !== null) {
      setPreviewState('pending_operation_present')
      setSafeErrorMessage(messageForState('pending_operation_present'))
      return
    }
    if (loaded.metadata.pushBlock !== null) {
      setPreviewState('blocked')
      setSafeErrorMessage(messageForState('blocked'))
      return
    }
    if (loaded.metadata.baselineStatus !== 'confirmed') {
      setPreviewState('baseline_not_confirmed')
      setSafeErrorMessage(messageForState('baseline_not_confirmed'))
      return
    }
    setPreviewState('idle')
  }, [connection?.workspaceId, currentLocalSignature, eligible])

  const checkForUpdates = useCallback(() => {
    if (!eligible || !connection?.workspaceId || previewState === 'checking') return
    setPreviewState('checking')
    setItems([])
    setSummary(null)
    setPreviewSnapshot(null)
    setSafeErrorMessage(null)
    try {
      const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
      if (loaded.status !== 'ready' || loaded.metadata.version !== 2) {
        const state = loaded.status === 'metadata_invalid' || loaded.status === 'storage_unavailable' ? 'metadata_invalid' : 'baseline_not_confirmed'
        setPreviewState(state)
        setSafeErrorMessage(messageForState(state))
        return
      }
      const metadata = loaded.metadata
      if (metadata.workspaceId !== connection.workspaceId) {
        setPreviewState('workspace_mismatch')
        setSafeErrorMessage(messageForState('workspace_mismatch'))
        return
      }
      if (metadata.pendingOperation !== null) {
        setPreviewState('pending_operation_present')
        setSafeErrorMessage(messageForState('pending_operation_present'))
        return
      }
      if (metadata.pushBlock !== null) {
        setPreviewState('blocked')
        setSafeErrorMessage(messageForState('blocked'))
        return
      }
      if (metadata.baselineStatus !== 'confirmed' || metadata.baselineConfirmedAt === null) {
        setPreviewState('baseline_not_confirmed')
        setSafeErrorMessage(messageForState('baseline_not_confirmed'))
        return
      }
      const stored = readDayMemoStorageSnapshot(window.localStorage)
      if (stored.status !== 'ready') {
        setPreviewState('metadata_invalid')
        setSafeErrorMessage(messageForState('metadata_invalid'))
        return
      }
      if (localSignature(stored.memos) !== currentLocalSignature) {
        setPreviewState('local_state_mismatch')
        setSafeErrorMessage(messageForState('local_state_mismatch'))
        return
      }
      const result = classify(metadata, stored.memos)
      const completeSummary: DayMemoUpdatePreviewSummary = {
        ...result.summary,
        baselineConfirmedAt: metadata.baselineConfirmedAt,
        lastPulledChangeSequence: metadata.lastPulledChangeSequence,
      }
      if (completeSummary.metadataInvalidCount > 0) {
        setItems(result.items)
        setSummary(completeSummary)
        setPreviewState('metadata_invalid')
        setSafeErrorMessage(messageForState('metadata_invalid'))
        return
      }
      const candidates = result.items.filter((item) => item.classification === 'modified_candidate').map((item) => {
        const memo = stored.memos.find((candidate) => candidate.date === item.date)!
        const baseline = metadata.baselines[item.date]
        return {
          date: item.date,
          localUpdatedAt: memo.updatedAt,
          baseRevision: item.baseRevision!,
          content: memo.content,
          baselineChangeSequence: item.baselineChangeSequence!,
          baselineRemoteUpdatedAt: baseline.remoteUpdatedAt,
        }
      })
      setPreviewSnapshot(candidates.length === 1 ? {
        workspaceId: metadata.workspaceId,
        baselineConfirmedAt: metadata.baselineConfirmedAt,
        lastPulledChangeSequence: metadata.lastPulledChangeSequence,
        candidate: { ...candidates[0] },
        localStorageSerialized: stored.serialized,
        localMemos: stored.memos.map((memo) => ({ ...memo })),
        metadataRaw: loaded.raw,
      } : null)
      setItems(result.items)
      setSummary(completeSummary)
      setPreviewState(candidates.length > 0 ? 'preview_ready' : 'no_changes')
    } catch {
      setPreviewState('error')
      setSafeErrorMessage(messageForState('error'))
    }
  }, [connection?.workspaceId, currentLocalSignature, eligible, previewState])

  const getSingleCandidateSnapshot = useCallback((): DayMemoUpdateUploadCandidateSnapshot | null => {
    if (previewState !== 'preview_ready'
      || summary?.modifiedCandidateCount !== 1
      || summary.localOnlyCount !== 0
      || summary.missingLocalCount !== 0
      || summary.tombstoneCount !== 0
      || summary.metadataInvalidCount !== 0
      || !previewSnapshot) return null
    return {
      ...previewSnapshot,
      candidate: { ...previewSnapshot.candidate },
      localMemos: previewSnapshot.localMemos.map((memo) => ({ ...memo })),
    }
  }, [previewSnapshot, previewState, summary])

  return {
    eligible,
    previewState,
    items,
    summary,
    hasFreshSnapshot: previewSnapshot !== null,
    safeErrorMessage,
    checkForUpdates,
    discardPreview,
    getSingleCandidateSnapshot,
  }
}
