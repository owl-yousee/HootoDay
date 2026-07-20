import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoBaselineStatusV2, DayMemoSyncMetadataV3, DayMemoSyncMetadataV4 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import {
  loadDayMemoSyncMetadataAny,
  migrateDayMemoSyncMetadataToV3,
  replaceDayMemoSyncMetadataV2,
  type DayMemoSyncV2SaveResult,
} from '../utils/dayMemoSyncStorage'
import { pullAllDayMemoSyncRecords } from '../utils/dayMemoSyncPull'
import { isUuid } from '../utils/syncConnectionStorage'

export type DayMemoBaselineUiState =
  | 'unavailable'
  | 'idle'
  | 'confirming'
  | 'confirmed'
  | 'mismatch'
  | 'remote_empty'
  | 'recovery_required'
  | 'error'

export type DayMemoBaselineFailureReason =
  | 'metadata_v1_invalid'
  | 'migration_invalid'
  | 'migration_save_failed'
  | 'migration_readback_failed'
  | 'migration_rollback_failed'
  | 'confirming_save_failed'
  | 'pull_rpc_failed'
  | 'pull_validation_failed'
  | 'remote_local_mismatch'
  | 'baseline_metadata_invalid'
  | 'baseline_save_failed'
  | 'baseline_readback_failed'
  | 'local_state_mismatch'
  | 'pending_operation_present'
  | 'state_update_failed'
  | 'unexpected_failure'

export interface DayMemoBaselineSummary {
  remoteCount: number
  localCount: number
  matchingCount: number
  remoteOnlyCount: number
  localOnlyCount: number
  differentCount: number
  tombstoneCount: number
  lastPulledChangeSequence: number
  baselineConfirmedAt: string | null
}

interface UseDayMemoSyncBaselineInput {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
}

function localSignature(memos: DayMemo[]): string {
  return JSON.stringify(memos.map((memo) => [memo.date, memo.updatedAt, memo.content]).sort(([left], [right]) => left.localeCompare(right)))
}

function stateFromBaselineStatus(status: DayMemoBaselineStatusV2): DayMemoBaselineUiState {
  if (status === 'confirmed' || status === 'mismatch' || status === 'remote_empty' || status === 'recovery_required') return status
  return status === 'confirming' ? 'recovery_required' : 'idle'
}

function safeMessage(reason: DayMemoBaselineFailureReason | null, state?: DayMemoBaselineUiState): string | null {
  if (state === 'remote_empty') return '同期先は空です。通常アップロードはまだ開始できません。'
  switch (reason) {
    case 'metadata_v1_invalid': return '保存済みの同期設定を安全に読み取れませんでした。'
    case 'migration_invalid': return '同期設定の移行内容を安全に確認できませんでした。'
    case 'migration_save_failed':
    case 'migration_readback_failed':
    case 'migration_rollback_failed':
    case 'confirming_save_failed': return '同期設定をこの端末へ安全に保存できませんでした。'
    case 'pull_rpc_failed': return '同期先の確認に失敗しました。'
    case 'pull_validation_failed': return '同期先から受け取った結果を安全に確認できませんでした。'
    case 'remote_local_mismatch': return '同期先とこの端末のDayMemoが完全には一致しません。通常アップロードは開始できません。'
    case 'baseline_metadata_invalid': return '確認結果を安全な同期設定として保存できませんでした。'
    case 'baseline_save_failed':
    case 'baseline_readback_failed': return '確認結果をこの端末へ安全に保存できませんでした。'
    case 'local_state_mismatch': return 'DayMemoの保存状態が変化したため、確認を中止しました。'
    case 'pending_operation_present': return '未確認の同期操作があるため、baseline確認を開始できません。'
    case 'state_update_failed': return '確認済み状態を画面へ安全に反映できませんでした。保存済み状態を再確認してください。'
    case 'unexpected_failure': return '同期baselineを安全に確認できませんでした。自動で再試行せず、状態を確認してください。'
    default: return null
  }
}

function baselineSaveFailure(result: DayMemoSyncV2SaveResult): DayMemoBaselineFailureReason {
  if (result === 'metadata_invalid') return 'baseline_metadata_invalid'
  if (result === 'readback_failed' || result === 'rollback_failed') return 'baseline_readback_failed'
  return 'baseline_save_failed'
}

export function useDayMemoSyncBaseline({ dayMemos, isConfigured, isSignedIn, connection }: UseDayMemoSyncBaselineInput) {
  const [baselineState, setBaselineState] = useState<DayMemoBaselineUiState>('unavailable')
  const [metadata, setMetadata] = useState<DayMemoSyncMetadataV3 | DayMemoSyncMetadataV4 | null>(null)
  const [summary, setSummary] = useState<DayMemoBaselineSummary | null>(null)
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const [failureReason, setFailureReason] = useState<DayMemoBaselineFailureReason | null>(null)
  const generation = useRef(0)
  const currentLocalSignature = useMemo(() => localSignature(dayMemos), [dayMemos])
  const latestLocalSignature = useRef(currentLocalSignature)
  latestLocalSignature.current = currentLocalSignature

  const eligible = Boolean(
    isConfigured && isSignedIn && supabaseClient && connection
    && isUuid(connection.workspaceId) && isUuid(connection.deviceId)
    && connection.pairingStatus !== 'unpaired'
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member')),
  )

  useEffect(() => {
    generation.current += 1
    setSummary(null)
    setSafeErrorMessage(null)
    setFailureReason(null)
    if (!eligible || !connection?.workspaceId) {
      setMetadata(null)
      setBaselineState('unavailable')
      return
    }
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    if (loaded.status === 'ready' && loaded.metadata.workspaceId !== connection.workspaceId) {
      setMetadata(null)
      setBaselineState('recovery_required')
      setSafeErrorMessage('保存済み同期設定のworkspaceが現在の接続先と一致しません。')
      setFailureReason('migration_invalid')
      return
    }
    if (loaded.status === 'ready' && (loaded.metadata.version === 3 || loaded.metadata.version === 4)) {
      setMetadata(loaded.metadata)
      const restoredState = stateFromBaselineStatus(loaded.metadata.baselineStatus)
      setBaselineState(restoredState)
      if (restoredState === 'recovery_required') {
        setFailureReason('unexpected_failure')
        setSafeErrorMessage(safeMessage('unexpected_failure'))
      }
      return
    }
    if (loaded.status === 'metadata_invalid' || loaded.status === 'storage_unavailable') {
      setMetadata(null)
      setBaselineState('recovery_required')
      const reason: DayMemoBaselineFailureReason = loaded.status === 'metadata_invalid' ? 'metadata_v1_invalid' : 'migration_save_failed'
      setFailureReason(reason)
      setSafeErrorMessage(safeMessage(reason))
      return
    }
    setMetadata(null)
    setBaselineState('idle')
  }, [connection?.workspaceId, eligible])

  const confirmBaseline = useCallback(async () => {
    if (!eligible || !connection?.workspaceId || !supabaseClient || baselineState === 'confirming') return
    setSummary(null)
    setSafeErrorMessage(null)
    setFailureReason(null)
    setBaselineState('confirming')
    const requestGeneration = ++generation.current
    const requestLocalSignature = currentLocalSignature
    const localSnapshot = readDayMemoStorageSnapshot(window.localStorage)
    if (localSnapshot.status !== 'ready' || localSignature(localSnapshot.memos) !== requestLocalSignature) {
      setBaselineState('recovery_required')
      setFailureReason('local_state_mismatch')
      setSafeErrorMessage(safeMessage('local_state_mismatch'))
      return
    }

    const migration = migrateDayMemoSyncMetadataToV3(window.localStorage, connection.workspaceId, dayMemos)
    if (migration.status !== 'ready') {
      const reason: DayMemoBaselineFailureReason = migration.status === 'workspace_mismatch' ? 'migration_invalid' : migration.status
      setBaselineState('recovery_required')
      setFailureReason(reason)
      setSafeErrorMessage(safeMessage(reason))
      return
    }
    if (migration.metadata.pendingOperation !== null) {
      setBaselineState('recovery_required')
      setFailureReason('pending_operation_present')
      setSafeErrorMessage(safeMessage('pending_operation_present'))
      return
    }
    const confirming: DayMemoSyncMetadataV3 | DayMemoSyncMetadataV4 = {
      ...migration.metadata,
      baselineStatus: 'confirming',
      baselineConfirmedAt: null,
    }
    const confirmingSaveResult = replaceDayMemoSyncMetadataV2(window.localStorage, confirming, migration.raw)
    if (confirmingSaveResult !== 'saved') {
      setBaselineState('recovery_required')
      setFailureReason('confirming_save_failed')
      setSafeErrorMessage(safeMessage('confirming_save_failed'))
      return
    }
    setMetadata(confirming)
    const confirmingRaw = JSON.stringify(confirming)

    let pullResult
    try {
      pullResult = await pullAllDayMemoSyncRecords(
        supabaseClient,
        connection.workspaceId,
        () => generation.current === requestGeneration && latestLocalSignature.current === requestLocalSignature,
      )
    } catch {
      setBaselineState('error')
      setFailureReason('unexpected_failure')
      setSafeErrorMessage(safeMessage('unexpected_failure'))
      return
    }
    if (pullResult.status !== 'complete') {
      const reason: DayMemoBaselineFailureReason = pullResult.status === 'cancelled'
        ? 'local_state_mismatch'
        : pullResult.status === 'validation_error' || pullResult.status === 'limit_reached'
          ? 'pull_validation_failed'
          : 'pull_rpc_failed'
      setBaselineState(reason === 'local_state_mismatch' ? 'recovery_required' : 'error')
      setFailureReason(reason)
      setSafeErrorMessage(safeMessage(reason))
      return
    }
    const currentStorage = readDayMemoStorageSnapshot(window.localStorage)
    if (currentStorage.status !== 'ready'
      || currentStorage.serialized !== localSnapshot.serialized
      || localSignature(currentStorage.memos) !== requestLocalSignature) {
      setBaselineState('recovery_required')
      setFailureReason('local_state_mismatch')
      setSafeErrorMessage(safeMessage('local_state_mismatch'))
      return
    }

    const localByDate = new Map(dayMemos.map((memo) => [memo.date, memo]))
    const activeRecords = pullResult.records.filter((record) => record.deletedAt === null)
    const tombstoneCount = pullResult.records.length - activeRecords.length
    const remoteIds = new Set(activeRecords.map((record) => record.entityId))
    let matchingCount = 0
    let differentCount = 0
    for (const record of activeRecords) {
      const local = localByDate.get(record.entityId)
      if (local && record.payload && local.content === record.payload.content && local.updatedAt === record.payload.updatedAt) matchingCount += 1
      else if (local) differentCount += 1
    }
    const remoteOnlyCount = activeRecords.filter((record) => !localByDate.has(record.entityId)).length
    const localOnlyCount = dayMemos.filter((memo) => !remoteIds.has(memo.date)).length
    const counts = {
      remoteCount: activeRecords.length,
      localCount: dayMemos.length,
      matchingCount,
      remoteOnlyCount,
      localOnlyCount,
      differentCount,
      tombstoneCount,
      lastPulledChangeSequence: pullResult.maxChangeSequence,
    }
    const now = new Date().toISOString()
    let next: DayMemoSyncMetadataV3 | DayMemoSyncMetadataV4
    let nextState: DayMemoBaselineUiState
    if (pullResult.records.length === 0) {
      nextState = dayMemos.length === 0 ? 'remote_empty' : 'mismatch'
      next = {
        ...confirming,
        baselines: {},
        baselineStatus: nextState,
        baselineConfirmedAt: nextState === 'remote_empty' ? now : null,
        lastPulledChangeSequence: nextState === 'remote_empty' ? 0 : confirming.lastPulledChangeSequence,
        lastSuccessfulSyncAt: nextState === 'remote_empty' ? now : confirming.lastSuccessfulSyncAt,
      }
    } else if (tombstoneCount > 0 || remoteOnlyCount > 0 || localOnlyCount > 0 || differentCount > 0 || matchingCount !== dayMemos.length) {
      nextState = 'mismatch'
      next = { ...confirming, baselines: {}, baselineStatus: 'mismatch', baselineConfirmedAt: null }
    } else {
      const baselines = Object.fromEntries(activeRecords.map((record) => [record.entityId, {
        date: record.entityId,
        remoteRevision: record.revision,
        remoteChangeSequence: record.changeSequence,
        remoteUpdatedAt: record.payload!.updatedAt,
        baselineLocalUpdatedAt: localByDate.get(record.entityId)!.updatedAt,
        deletedAt: null,
      }]))
      nextState = 'confirmed'
      next = {
        ...confirming,
        baselines,
        lastPulledChangeSequence: pullResult.maxChangeSequence,
        baselineStatus: 'confirmed',
        baselineConfirmedAt: now,
        lastSuccessfulSyncAt: now,
      }
    }
    const baselineSaveResult = replaceDayMemoSyncMetadataV2(window.localStorage, next, confirmingRaw)
    if (baselineSaveResult !== 'saved') {
      setBaselineState('recovery_required')
      const reason = baselineSaveFailure(baselineSaveResult)
      setFailureReason(reason)
      setSafeErrorMessage(safeMessage(reason))
      return
    }
    setMetadata(next)
    setSummary({ ...counts, baselineConfirmedAt: next.baselineConfirmedAt })
    setBaselineState(nextState)
    const resultReason = nextState === 'mismatch' ? 'remote_local_mismatch' : null
    setFailureReason(resultReason)
    setSafeErrorMessage(safeMessage(resultReason, nextState))
  }, [baselineState, connection, currentLocalSignature, dayMemos, eligible])

  return {
    eligible,
    baselineState,
    metadata,
    summary,
    safeErrorMessage,
    failureReason,
    confirmBaseline,
  }
}
