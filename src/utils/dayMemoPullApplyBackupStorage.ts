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
  | 'rollback_failed'

interface SaveBackupOptions {
  replaceExistingForSameWorkspace?: boolean
}

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
  options: SaveBackupOptions = {},
): DayMemoPullApplyBackupResult {
  if (!isUuid(workspaceId)
    || !memos.every(isStoredDayMemo)
    || new Set(memos.map((memo) => memo.date)).size !== memos.length) return 'data_invalid'

  try {
    const existingRaw = storage.getItem(DAY_MEMO_PULL_APPLY_BACKUP_KEY)
    if (existingRaw !== null) {
      const existing: unknown = JSON.parse(existingRaw)
      if (!isBackup(existing)) return 'existing_backup'
      if (existing.workspaceId !== workspaceId) return 'existing_backup'
      if (sameMemos(existing.memos, memos)) return 'reused'
      if (!options.replaceExistingForSameWorkspace) return 'existing_backup'
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
    if (readBack === null) {
      if (existingRaw === null) return 'readback_invalid'
      storage.setItem(DAY_MEMO_PULL_APPLY_BACKUP_KEY, existingRaw)
      return storage.getItem(DAY_MEMO_PULL_APPLY_BACKUP_KEY) === existingRaw ? 'readback_invalid' : 'rollback_failed'
    }
    let parsed: unknown = null
    try { parsed = JSON.parse(readBack) } catch { parsed = null }
    if (readBack === serialized && isBackup(parsed)) return 'saved'
    if (existingRaw === null) return 'readback_invalid'
    storage.setItem(DAY_MEMO_PULL_APPLY_BACKUP_KEY, existingRaw)
    return storage.getItem(DAY_MEMO_PULL_APPLY_BACKUP_KEY) === existingRaw ? 'readback_invalid' : 'rollback_failed'
  } catch {
    return 'storage_unavailable'
  }
}
