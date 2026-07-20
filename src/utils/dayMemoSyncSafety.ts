import type { DayMemoSyncAnyLoadResult } from './dayMemoSyncStorage'
import { loadDayMemoSyncMetadataAny } from './dayMemoSyncStorage'
import { isUuid } from './syncConnectionStorage'

export type DayMemoSyncSafetyState =
  | 'normal'
  | 'conflict'
  | 'response_unknown'
  | 'recovery_required'
  | 'pending_operation'
  | 'metadata_invalid'

export interface DayMemoSyncSafety {
  state: DayMemoSyncSafetyState
  canStartUpload: boolean
  hasPendingOperation: boolean
  message: string
}

const MESSAGES: Record<DayMemoSyncSafetyState, string> = {
  normal: '同期状態は確認済みです。送信は明示操作時だけ行います。',
  conflict: '同期先との競合が発生しました。確認が必要です。',
  response_unknown: '同期結果を確認できませんでした。再送せず確認してください。',
  recovery_required: '同期状態の復旧が必要です。',
  pending_operation: '未完了の同期処理があります。',
  metadata_invalid: '同期設定を安全に確認できません。',
}

function result(state: DayMemoSyncSafetyState, hasPendingOperation = false): DayMemoSyncSafety {
  return {
    state,
    canStartUpload: state === 'normal',
    hasPendingOperation,
    message: MESSAGES[state],
  }
}

export function classifyDayMemoSyncSafety(
  loaded: DayMemoSyncAnyLoadResult,
  workspaceId: string | null,
): DayMemoSyncSafety {
  if (!workspaceId || !isUuid(workspaceId) || loaded.status !== 'ready' || loaded.metadata.version !== 3) {
    return result('metadata_invalid')
  }
  const metadata = loaded.metadata
  if (metadata.workspaceId !== workspaceId) return result('metadata_invalid')

  if (Object.keys(metadata.localDeleteIntents).length > 0) return result('pending_operation', true)

  const pending = metadata.pendingOperation
  if (pending !== null) {
    if (pending.status === 'conflict') return result('conflict', true)
    if (pending.status === 'response_unknown' || pending.status === 'sending') return result('response_unknown', true)
    if (pending.status === 'recovery_required') return result('recovery_required', true)
    return result('pending_operation', true)
  }
  if (metadata.pushBlock !== null || metadata.baselineStatus !== 'confirmed' || metadata.baselineConfirmedAt === null) {
    return result('recovery_required')
  }
  return result('normal')
}

export function inspectDayMemoSyncSafety(storage: Storage, workspaceId: string | null): DayMemoSyncSafety {
  return classifyDayMemoSyncSafety(loadDayMemoSyncMetadataAny(storage), workspaceId)
}
