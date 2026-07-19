import type { DayMemo } from '../types/dayMemo'

export const DAY_MEMOS_STORAGE_KEY = 'hootoDay.dayMemos'
export const DAY_MEMOS_STORAGE_VERSION = 1

export interface DayMemoStorageData {
  version: typeof DAY_MEMOS_STORAGE_VERSION
  memos: DayMemo[]
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isStoredDayMemo(value: unknown): value is DayMemo {
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

    return deduplicateMemos(parsed.memos.filter(isStoredDayMemo))
  } catch {
    return []
  }
}

export type DayMemoStorageSnapshotResult =
  | { status: 'ready'; serialized: string; memos: DayMemo[] }
  | { status: 'storage_unavailable' | 'data_invalid'; serialized: null; memos: null }

export type DayMemoStorageReplaceResult =
  | 'saved'
  | 'data_invalid'
  | 'storage_unavailable'
  | 'readback_invalid'
  | 'rollback_failed'

function parseStrictStorageData(raw: string): DayMemoStorageData | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)
      || parsed.version !== DAY_MEMOS_STORAGE_VERSION
      || !Array.isArray(parsed.memos)
      || !parsed.memos.every(isStoredDayMemo)) return null
    const memos = parsed.memos.map((memo) => ({ ...memo }))
    if (new Set(memos.map((memo) => memo.date)).size !== memos.length) return null
    return { version: DAY_MEMOS_STORAGE_VERSION, memos }
  } catch {
    return null
  }
}

export function readDayMemoStorageSnapshot(storage: Storage): DayMemoStorageSnapshotResult {
  try {
    const raw = storage.getItem(DAY_MEMOS_STORAGE_KEY)
    if (raw === null) return { status: 'data_invalid', serialized: null, memos: null }
    const parsed = parseStrictStorageData(raw)
    return parsed
      ? { status: 'ready', serialized: raw, memos: parsed.memos }
      : { status: 'data_invalid', serialized: null, memos: null }
  } catch {
    return { status: 'storage_unavailable', serialized: null, memos: null }
  }
}

export function replaceStoredDayMemosVerified(
  storage: Storage,
  memos: DayMemo[],
  expectedCurrentSerialized: string,
): DayMemoStorageReplaceResult {
  if (!Array.isArray(memos)
    || !memos.every(isStoredDayMemo)
    || new Set(memos.map((memo) => memo.date)).size !== memos.length) return 'data_invalid'

  const next: DayMemoStorageData = {
    version: DAY_MEMOS_STORAGE_VERSION,
    memos: memos.map((memo) => ({ ...memo })),
  }
  const serialized = JSON.stringify(next)
  let currentRaw: string | null
  try {
    currentRaw = storage.getItem(DAY_MEMOS_STORAGE_KEY)
    if (currentRaw !== expectedCurrentSerialized) return 'data_invalid'
    storage.setItem(DAY_MEMOS_STORAGE_KEY, serialized)
    const readBack = storage.getItem(DAY_MEMOS_STORAGE_KEY)
    const parsed = readBack === null ? null : parseStrictStorageData(readBack)
    if (readBack === serialized && parsed !== null) return 'saved'
  } catch {
    currentRaw = expectedCurrentSerialized
  }

  try {
    storage.setItem(DAY_MEMOS_STORAGE_KEY, currentRaw ?? expectedCurrentSerialized)
    return storage.getItem(DAY_MEMOS_STORAGE_KEY) === expectedCurrentSerialized
      ? 'readback_invalid'
      : 'rollback_failed'
  } catch {
    return 'rollback_failed'
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
