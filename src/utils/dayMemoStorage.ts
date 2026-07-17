import type { DayMemo } from '../types/dayMemo'

export const DAY_MEMOS_STORAGE_KEY = 'hootoDay.dayMemos'
export const DAY_MEMOS_STORAGE_VERSION = 1

interface DayMemoStorageData {
  version: typeof DAY_MEMOS_STORAGE_VERSION
  memos: DayMemo[]
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDayMemo(value: unknown): value is DayMemo {
  if (!isRecord(value)) return false

  return (
    typeof value.date === 'string' &&
    datePattern.test(value.date) &&
    typeof value.content === 'string' &&
    value.content.trim().length > 0 &&
    value.content.length <= 2000 &&
    typeof value.updatedAt === 'string' &&
    Number.isFinite(Date.parse(value.updatedAt))
  )
}

function deduplicateMemos(memos: DayMemo[]): DayMemo[] {
  const byDate = new Map<string, DayMemo>()

  for (const memo of memos) {
    const current = byDate.get(memo.date)
    if (!current || Date.parse(memo.updatedAt) >= Date.parse(current.updatedAt)) {
      byDate.set(memo.date, { ...memo, content: memo.content.trim() })
    }
  }

  return [...byDate.values()]
}

export function loadStoredDayMemos(): DayMemo[] {
  let rawValue: string | null

  try {
    rawValue = window.localStorage.getItem(DAY_MEMOS_STORAGE_KEY)
  } catch {
    console.warn('日記・メモの保存領域を読み込めませんでした。画面上の操作は継続します。')
    return []
  }

  if (rawValue === null) return []

  try {
    const parsed: unknown = JSON.parse(rawValue)
    if (!isRecord(parsed) || parsed.version !== DAY_MEMOS_STORAGE_VERSION || !Array.isArray(parsed.memos)) {
      return []
    }

    return deduplicateMemos(parsed.memos.filter(isDayMemo))
  } catch {
    return []
  }
}

export function saveStoredDayMemos(memos: DayMemo[]): void {
  const storageData: DayMemoStorageData = {
    version: DAY_MEMOS_STORAGE_VERSION,
    memos,
  }

  try {
    window.localStorage.setItem(DAY_MEMOS_STORAGE_KEY, JSON.stringify(storageData))
  } catch {
    console.warn('日記・メモを保存できませんでした。画面上の操作は継続します。')
  }
}
