import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { SyncConnection } from '../types/sync'
import { fromDateKey } from '../utils/date'
import { readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords } from '../utils/dayMemoSyncPull'
import { loadDayMemoSyncMetadataAny } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'

export type DayMemoLocalOnlyPreviewState =
  | 'unavailable'
  | 'idle'
  | 'checking'
  | 'preview_ready'
  | 'no_candidates'
  | 'baseline_not_confirmed'
  | 'pending_operation_present'
  | 'push_blocked'
  | 'local_state_mismatch'
  | 'metadata_invalid'
  | 'workspace_mismatch'
  | 'pull_failed'

export type DayMemoLocalOnlyClassification =
  | 'local_new_candidate'
  | 'remote_deleted_candidate'
  | 'unknown_local_only'

export interface DayMemoLocalOnlyPreviewItem {
  date: string
  classification: DayMemoLocalOnlyClassification
}

export interface DayMemoLocalOnlyPreviewSummary {
  candidateCount: number
  localNewCandidateCount: number
  remoteDeletedCandidateCount: number
  unknownLocalOnlyCount: number
}

interface UseDayMemoLocalOnlyPreviewInput {
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

function safeMessage(state: DayMemoLocalOnlyPreviewState): string | null {
  switch (state) {
    case 'baseline_not_confirmed': return '同期baselineが確認済みではないため、local-only候補を確認できません。'
    case 'pending_operation_present': return '未確認の同期操作があるため、local-only候補を確認できません。'
    case 'push_blocked': return 'アップロード禁止状態のため、local-only候補を確認できません。'
    case 'local_state_mismatch': return 'この端末のDayMemo保存状態が変化したため、確認を停止しました。'
    case 'metadata_invalid': return '同期metadataまたはDayMemoを安全に確認できませんでした。'
    case 'workspace_mismatch': return '保存済みの同期先と現在の同期先が一致しません。'
    case 'pull_failed': return '同期先の全件確認を完了できませんでした。候補は送信可能として扱いません。'
    default: return null
  }
}

function summarize(items: DayMemoLocalOnlyPreviewItem[]): DayMemoLocalOnlyPreviewSummary {
  return {
    candidateCount: items.length,
    localNewCandidateCount: items.filter((item) => item.classification === 'local_new_candidate').length,
    remoteDeletedCandidateCount: items.filter((item) => item.classification === 'remote_deleted_candidate').length,
    unknownLocalOnlyCount: items.filter((item) => item.classification === 'unknown_local_only').length,
  }
}

export function useDayMemoLocalOnlyPreview({ dayMemos, isConfigured, isSignedIn, connection }: UseDayMemoLocalOnlyPreviewInput) {
  const [previewState, setPreviewState] = useState<DayMemoLocalOnlyPreviewState>('unavailable')
  const [items, setItems] = useState<DayMemoLocalOnlyPreviewItem[]>([])
  const [summary, setSummary] = useState<DayMemoLocalOnlyPreviewSummary | null>(null)
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const runIdRef = useRef(0)
  const currentLocalSignature = useMemo(() => localSignature(dayMemos), [dayMemos])
  const eligible = isConfigured && isSignedIn && connectionIsEligible(connection)

  const discardPreview = useCallback(() => {
    runIdRef.current += 1
    setItems([])
    setSummary(null)
    setSafeErrorMessage(null)
    setPreviewState(eligible ? 'idle' : 'unavailable')
  }, [eligible])

  useEffect(() => {
    runIdRef.current += 1
    setItems([])
    setSummary(null)
    setSafeErrorMessage(null)
    if (!eligible || !connection?.workspaceId) {
      setPreviewState('unavailable')
      return
    }
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    if (loaded.status !== 'ready' || loaded.metadata.version !== 2) {
      setPreviewState('metadata_invalid')
      setSafeErrorMessage(safeMessage('metadata_invalid'))
    } else if (loaded.metadata.workspaceId !== connection.workspaceId) {
      setPreviewState('workspace_mismatch')
      setSafeErrorMessage(safeMessage('workspace_mismatch'))
    } else if (loaded.metadata.pendingOperation !== null) {
      setPreviewState('pending_operation_present')
      setSafeErrorMessage(safeMessage('pending_operation_present'))
    } else if (loaded.metadata.pushBlock !== null) {
      setPreviewState('push_blocked')
      setSafeErrorMessage(safeMessage('push_blocked'))
    } else if (loaded.metadata.baselineStatus !== 'confirmed') {
      setPreviewState('baseline_not_confirmed')
      setSafeErrorMessage(safeMessage('baseline_not_confirmed'))
    } else {
      setPreviewState('idle')
    }
  }, [connection?.workspaceId, currentLocalSignature, eligible])

  const previewLocalOnly = useCallback(async () => {
    if (!eligible || !connection?.workspaceId || !supabaseClient || previewState === 'checking') return
    const runId = runIdRef.current + 1
    runIdRef.current = runId
    setPreviewState('checking')
    setItems([])
    setSummary(null)
    setSafeErrorMessage(null)

    const fail = (state: DayMemoLocalOnlyPreviewState) => {
      if (runIdRef.current !== runId) return
      setPreviewState(state)
      setSafeErrorMessage(safeMessage(state))
    }

    try {
      const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
      if (loaded.status !== 'ready' || loaded.metadata.version !== 2) return fail('metadata_invalid')
      const metadata = loaded.metadata
      if (metadata.workspaceId !== connection.workspaceId) return fail('workspace_mismatch')
      if (metadata.pendingOperation !== null) return fail('pending_operation_present')
      if (metadata.pushBlock !== null) return fail('push_blocked')
      if (metadata.baselineStatus !== 'confirmed' || metadata.baselineConfirmedAt === null) return fail('baseline_not_confirmed')

      const stored = readDayMemoStorageSnapshot(window.localStorage)
      if (stored.status !== 'ready' || stored.memos.some((memo) => !isValidSyncLocalMemo(memo))) return fail('metadata_invalid')
      if (localSignature(stored.memos) !== currentLocalSignature) return fail('local_state_mismatch')

      const candidates = stored.memos
        .filter((memo) => metadata.baselines[memo.date] === undefined)
        .sort((left, right) => left.date.localeCompare(right.date))
      if (candidates.length === 0) {
        setItems([])
        setSummary(summarize([]))
        setPreviewState('no_candidates')
        return
      }

      const pull = await pullAllDayMemoSyncRecords(supabaseClient, connection.workspaceId, () => runIdRef.current === runId)
      if (runIdRef.current !== runId) return
      if (pull.status !== 'complete') {
        const unknownItems = candidates.map((memo) => ({ date: memo.date, classification: 'unknown_local_only' as const }))
        setItems(unknownItems)
        setSummary(summarize(unknownItems))
        return fail('pull_failed')
      }

      const remoteByDate = new Map(pull.records.map((record) => [record.entityId, record]))
      const classified = candidates.map((memo): DayMemoLocalOnlyPreviewItem => {
        const remote = remoteByDate.get(memo.date)
        if (!remote) return { date: memo.date, classification: 'local_new_candidate' }
        if (remote.deletedAt !== null) return { date: memo.date, classification: 'remote_deleted_candidate' }
        return { date: memo.date, classification: 'unknown_local_only' }
      })
      setItems(classified)
      setSummary(summarize(classified))
      setPreviewState('preview_ready')
    } catch {
      fail('pull_failed')
    }
  }, [connection?.workspaceId, currentLocalSignature, eligible, previewState])

  return {
    eligible,
    previewState,
    items,
    summary,
    safeErrorMessage,
    previewLocalOnly,
    discardPreview,
  }
}
