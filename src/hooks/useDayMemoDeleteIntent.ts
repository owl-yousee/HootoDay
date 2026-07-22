import { useCallback, useState } from 'react'
import type { DayMemo } from '../types/dayMemo'
import type { SyncConnection } from '../types/sync'
import { readDayMemoStorageSnapshot, replaceStoredDayMemosVerified } from '../utils/dayMemoStorage'
import { isDayMemoSyncMetadataV3, isDayMemoSyncMetadataV5, loadDayMemoSyncMetadataAny, replaceDayMemoSyncMetadataV2 } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import { useDayMemoNormalDeletePreparationCheck } from './useDayMemoNormalDeletePreparationCheck'
import type { DayMemoPullPreviewItem, DayMemoPullPreviewState, DayMemoPullPreviewSummary, DayMemoSyncMetadataV5 } from '../types/dayMemoSync'

export type DayMemoDeleteIntentState = 'idle' | 'saving' | 'completed' | 'unavailable' | 'error' | 'recovery_required'
export type DayMemoDeleteMode = 'local_delete' | 'sync_delete_ready' | 'sync_delete_blocked'
  | 'v5_delete_check' | 'v5_delete_ready' | 'v5_delete_blocked'

export interface DayMemoV5DeleteDiagnostic {
  classification: string
  metadataVersion: number | null
  baselineConfirmed: boolean
  pendingAbsent: boolean
  pushBlockClear: boolean
  intentCount: number
  differencesConfirmedAbsent: boolean
  targetBaselineConfirmed: boolean
  localStateMatched: boolean
}

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  adoptVerifiedStoredDayMemos: (memos: DayMemo[]) => void
  reactMetadata: DayMemoSyncMetadataV5 | null
  normalPullState: DayMemoPullPreviewState
  normalPullSummary: DayMemoPullPreviewSummary | null
  normalPullItems: DayMemoPullPreviewItem[]
}

function signature(memos: DayMemo[]): string {
  return JSON.stringify(memos.map((memo) => [memo.date, memo.updatedAt, memo.content]).sort(([a], [b]) => a.localeCompare(b)))
}

function connectionIsEligible(connection: SyncConnection | null): boolean {
  return Boolean(connection && isUuid(connection.workspaceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}

function baselineStatusAllowsLocalDelete(status: string): boolean {
  return status === 'confirmed' || status === 'remote_empty'
}

export function useDayMemoDeleteIntent({
  dayMemos,
  isConfigured,
  isSignedIn,
  connection,
  adoptVerifiedStoredDayMemos,
  reactMetadata,
  normalPullState,
  normalPullSummary,
  normalPullItems,
}: Input) {
  const [state, setState] = useState<DayMemoDeleteIntentState>('idle')
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const eligible = isConfigured && isSignedIn && connectionIsEligible(connection)
  const normalDeletePreparation = useDayMemoNormalDeletePreparationCheck({
    dayMemos,
    isConfigured,
    isSignedIn,
    connection,
    reactMetadata,
    normalPullState,
    normalPullSummary,
    normalPullItems,
  })

  const canRecordIntentForDate = useCallback((date: string): boolean => {
    if (!eligible || !connection?.workspaceId || state === 'saving') return false
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const stored = readDayMemoStorageSnapshot(window.localStorage)
    if (loaded.status !== 'ready' || loaded.metadata.version !== 3 || loaded.metadata.workspaceId !== connection.workspaceId
      || loaded.metadata.baselineStatus !== 'confirmed' || loaded.metadata.pendingOperation !== null || loaded.metadata.pushBlock !== null
      || loaded.metadata.localDeleteIntents[date] !== undefined || stored.status !== 'ready'
      || signature(stored.memos) !== signature(dayMemos)) return false
    const baseline = loaded.metadata.baselines[date]
    const memo = stored.memos.find((item) => item.date === date)
    return Boolean(baseline && baseline.deletedAt === null && baseline.baselineLocalUpdatedAt === memo?.updatedAt
      && baseline.remoteRevision >= 1 && baseline.remoteChangeSequence >= 1)
  }, [connection?.workspaceId, dayMemos, eligible, state])

  const requiresSynchronizedDelete = useCallback((date: string): boolean => {
    if (!eligible || !connection?.workspaceId) return false
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    if (loaded.status !== 'ready' || loaded.metadata.version !== 3
      || loaded.metadata.workspaceId !== connection.workspaceId) return true
    if (!baselineStatusAllowsLocalDelete(loaded.metadata.baselineStatus)
      || loaded.metadata.pendingOperation !== null || loaded.metadata.pushBlock !== null) return true
    return loaded.metadata.baselines[date] !== undefined
  }, [connection?.workspaceId, eligible])

  const getDeleteModeForDate = useCallback((date: string): DayMemoDeleteMode => {
    if (!eligible || !connection?.workspaceId) return 'local_delete'
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    if (loaded.status !== 'ready') return 'sync_delete_blocked'
    if (isDayMemoSyncMetadataV5(loaded.metadata)) {
      const metadata = loaded.metadata
      if (metadata.workspaceId !== connection.workspaceId || !reactMetadata
        || JSON.stringify(metadata) !== JSON.stringify(reactMetadata)
        || metadata.baselineStatus !== 'confirmed' || metadata.baselineConfirmedAt === null
        || metadata.pendingOperation !== null || metadata.pushBlock !== null
        || Object.keys(metadata.localDeleteIntents).length !== 0) return 'v5_delete_blocked'
      const baseline = metadata.baselines[date]
      if (!baseline) return 'local_delete'
      if (baseline.deletedAt !== null || baseline.baselineLocalUpdatedAt === null) return 'v5_delete_blocked'
      const preparationResult = normalDeletePreparation.result
      if (!preparationResult || preparationResult.date !== date) return 'v5_delete_check'
      return preparationResult.ready && preparationResult.classification === 'normal_delete_preparation_ready'
        ? 'v5_delete_ready' : 'v5_delete_blocked'
    }
    if (loaded.metadata.version !== 3 || loaded.metadata.workspaceId !== connection.workspaceId) return 'sync_delete_blocked'
    if (!baselineStatusAllowsLocalDelete(loaded.metadata.baselineStatus)
      || loaded.metadata.pendingOperation !== null || loaded.metadata.pushBlock !== null) return 'sync_delete_blocked'
    if (loaded.metadata.baselines[date] === undefined) return 'local_delete'
    return canRecordIntentForDate(date) ? 'sync_delete_ready' : 'sync_delete_blocked'
  }, [canRecordIntentForDate, connection?.workspaceId, eligible, normalDeletePreparation.result, reactMetadata])

  const getV5DeleteDiagnostic = useCallback((date: string): DayMemoV5DeleteDiagnostic | null => {
    const preparationResult = normalDeletePreparation.result
    if (!preparationResult || preparationResult.date !== date || preparationResult.ready) return null
    return {
      classification: preparationResult.classification,
      metadataVersion: preparationResult.metadataVersion,
      baselineConfirmed: preparationResult.baselineConfirmed,
      pendingAbsent: preparationResult.pendingAbsent,
      pushBlockClear: preparationResult.pushBlockClear,
      intentCount: preparationResult.intentCount,
      differencesConfirmedAbsent: preparationResult.differencesConfirmedAbsent,
      targetBaselineConfirmed: preparationResult.targetBaselineConfirmed,
      localStateMatched: preparationResult.localStateMatched,
    }
  }, [normalDeletePreparation.result])

  const recordIntentAndDeleteLocal = useCallback((date: string): boolean => {
    if (!canRecordIntentForDate(date) || !connection?.workspaceId) return false
    setState('saving')
    setSafeErrorMessage(null)
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const stored = readDayMemoStorageSnapshot(window.localStorage)
    if (loaded.status !== 'ready' || loaded.metadata.version !== 3 || stored.status !== 'ready'
      || loaded.metadata.workspaceId !== connection.workspaceId || signature(stored.memos) !== signature(dayMemos)) {
      setState('error')
      setSafeErrorMessage('削除前の保存状態を安全に確認できませんでした。DayMemoは変更していません。')
      return false
    }
    const baseline = loaded.metadata.baselines[date]
    const memo = stored.memos.find((item) => item.date === date)
    if (!baseline || baseline.deletedAt !== null || baseline.baselineLocalUpdatedAt !== memo?.updatedAt
      || loaded.metadata.localDeleteIntents[date] !== undefined || loaded.metadata.pendingOperation !== null || loaded.metadata.pushBlock !== null) {
      setState('error')
      setSafeErrorMessage('削除候補の条件が変化したため停止しました。')
      return false
    }
    const createdAt = new Date().toISOString()
    const nextMetadata = {
      ...loaded.metadata,
      localDeleteIntents: {
        ...loaded.metadata.localDeleteIntents,
        [date]: {
          date,
          baselineRevision: baseline.remoteRevision,
          baselineChangeSequence: baseline.remoteChangeSequence,
          deletedLocalUpdatedAt: memo.updatedAt,
          createdAt,
          status: 'intent_recorded' as const,
        },
      },
    }
    if (!isDayMemoSyncMetadataV3(nextMetadata)) {
      setState('error')
      setSafeErrorMessage('削除意図を安全なmetadataとして検証できませんでした。')
      return false
    }
    const metadataSave = replaceDayMemoSyncMetadataV2(window.localStorage, nextMetadata, loaded.raw)
    if (metadataSave !== 'saved') {
      setState(metadataSave === 'rollback_failed' ? 'recovery_required' : 'error')
      setSafeErrorMessage('削除意図を安全に保存できませんでした。DayMemoは変更していません。')
      return false
    }
    const nextMemos = stored.memos.filter((item) => item.date !== date)
    const memoSave = replaceStoredDayMemosVerified(window.localStorage, nextMemos, stored.serialized)
    if (memoSave !== 'saved') {
      const metadataRollback = replaceDayMemoSyncMetadataV2(window.localStorage, loaded.metadata, JSON.stringify(nextMetadata))
      const recoveryRequired = memoSave === 'rollback_failed' || metadataRollback !== 'saved'
      setState(recoveryRequired ? 'recovery_required' : 'error')
      setSafeErrorMessage(recoveryRequired
        ? '削除処理のrollbackを確認できませんでした。同期操作を行わず確認してください。'
        : 'DayMemoを保存できなかったため、削除意図を元へ戻しました。')
      return false
    }
    adoptVerifiedStoredDayMemos(nextMemos)
    setState('completed')
    return true
  }, [adoptVerifiedStoredDayMemos, canRecordIntentForDate, connection?.workspaceId, dayMemos])

  return {
    eligible,
    state,
    safeErrorMessage,
    canRecordIntentForDate,
    requiresSynchronizedDelete,
    getDeleteModeForDate,
    getV5DeleteDiagnostic,
    recordIntentAndDeleteLocal,
    normalDeletePreparation,
    getNormalV5DeletePreparationInput: normalDeletePreparation.getV5DeletePreparationInput,
  }
}
