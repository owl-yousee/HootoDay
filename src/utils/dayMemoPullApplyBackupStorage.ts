import type { DayMemo } from '../types/dayMemo'
import { isStoredDayMemo } from './dayMemoStorage'
import { isUuid } from './syncConnectionStorage'

export const DAY_MEMO_PULL_APPLY_BACKUP_KEY = 'hootoDay.dayMemoBeforePullApply'
const BACKUP_VERSION = 1

interface DayMemoPullApplyBackupV1 {
  version: typeof BACKUP_VERSION
  workspaceId: string
  createdAt: string
  applySource: 'day_memo_pull_preview'
  memos: DayMemo[]
}

export type DayMemoPullApplyBackupResult =
  | 'saved'
  | 'reused'
  | 'existing_backup'
  | 'data_invalid'
  | 'storage_unavailable'
  | 'readback_invalid'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBackup(value: unknown): value is DayMemoPullApplyBackupV1 {
  return isRecord(value)
    && value.version === BACKUP_VERSION
    && isUuid(value.workspaceId)
    && typeof value.createdAt === 'string'
    && Number.isFinite(Date.parse(value.createdAt))
    && value.applySource === 'day_memo_pull_preview'
    && Array.isArray(value.memos)
    && value.memos.every(isStoredDayMemo)
    && new Set(value.memos.map((memo) => memo.date)).size === value.memos.length
}

function sameMemos(left: DayMemo[], right: DayMemo[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function saveDayMemoPullApplyBackup(
  storage: Storage,
  workspaceId: string,
  memos: DayMemo[],
): DayMemoPullApplyBackupResult {
  if (!isUuid(workspaceId)
    || !memos.every(isStoredDayMemo)
    || new Set(memos.map((memo) => memo.date)).size !== memos.length) return 'data_invalid'

  try {
    const existingRaw = storage.getItem(DAY_MEMO_PULL_APPLY_BACKUP_KEY)
    if (existingRaw !== null) {
      const existing: unknown = JSON.parse(existingRaw)
      if (!isBackup(existing)) return 'existing_backup'
      return existing.workspaceId === workspaceId && sameMemos(existing.memos, memos)
        ? 'reused'
        : 'existing_backup'
    }

    const backup: DayMemoPullApplyBackupV1 = {
      version: BACKUP_VERSION,
      workspaceId,
      createdAt: new Date().toISOString(),
      applySource: 'day_memo_pull_preview',
      memos: memos.map((memo) => ({ ...memo })),
    }
    const serialized = JSON.stringify(backup)
    storage.setItem(DAY_MEMO_PULL_APPLY_BACKUP_KEY, serialized)
    const readBack = storage.getItem(DAY_MEMO_PULL_APPLY_BACKUP_KEY)
    if (readBack === null) return 'readback_invalid'
    const parsed: unknown = JSON.parse(readBack)
    return readBack === serialized && isBackup(parsed) ? 'saved' : 'readback_invalid'
  } catch {
    return 'storage_unavailable'
  }
}
