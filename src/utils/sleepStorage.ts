import type { SleepAwakening, SleepRecord } from '../types/health'
import { fromDateKey } from './date'
import { calculateSleepSummary, isValidTime, MAX_POINT_AWAKENING_MINUTES, MIN_POINT_AWAKENING_MINUTES } from './sleepMetrics'

export const SLEEP_RECORDS_STORAGE_KEY = 'hootoDay.sleepRecords'
export const SLEEP_RECORDS_STORAGE_VERSION = 1
export const MAX_SLEEP_MEMO_LENGTH = 500

interface SleepStorageData {
  version: typeof SLEEP_RECORDS_STORAGE_VERSION
  records: SleepRecord[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAwakening(value: unknown): value is SleepAwakening {
  if (!isObject(value) || typeof value.id !== 'string' || !value.id || !isValidTime(String(value.startTime))) return false
  if (value.mode === 'point') {
    return value.endTime === null && Number.isInteger(value.estimatedMinutes) && Number(value.estimatedMinutes) >= MIN_POINT_AWAKENING_MINUTES && Number(value.estimatedMinutes) <= MAX_POINT_AWAKENING_MINUTES
  }
  return value.mode === 'range' && isValidTime(String(value.endTime)) && value.estimatedMinutes === null
}

function normalizeRecord(value: unknown): SleepRecord | null {
  if (!isObject(value) || typeof value.date !== 'string' || !fromDateKey(value.date)) return null
  if (typeof value.bedtime !== 'string' || typeof value.wakeTime !== 'string' || !isValidTime(value.bedtime) || !isValidTime(value.wakeTime)) return null
  if (!Array.isArray(value.awakenings) || !value.awakenings.every(isAwakening)) return null
  if (typeof value.memo !== 'string' || value.memo.length > MAX_SLEEP_MEMO_LENGTH) return null
  if (typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) return null
  if (!Number.isFinite(value.totalInBedMinutes) || !Number.isFinite(value.awakeMinutes) || !Number.isFinite(value.sleepMinutes)) return null
  const calculation = calculateSleepSummary(value.bedtime, value.wakeTime, value.awakenings)
  if (!calculation.summary) return null
  return {
    date: value.date,
    bedtime: value.bedtime,
    wakeTime: value.wakeTime,
    awakenings: value.awakenings,
    ...calculation.summary,
    memo: value.memo.trim(),
    updatedAt: value.updatedAt,
  }
}

function deduplicate(records: SleepRecord[]): SleepRecord[] {
  const byDate = new Map<string, SleepRecord>()
  for (const record of records) {
    const current = byDate.get(record.date)
    if (!current || Date.parse(record.updatedAt) >= Date.parse(current.updatedAt)) byDate.set(record.date, record)
  }
  return [...byDate.values()]
}

export function loadStoredSleepRecords(): SleepRecord[] {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(SLEEP_RECORDS_STORAGE_KEY)
  } catch {
    console.warn('睡眠記録の保存領域を読み込めませんでした。画面上の操作は継続します。')
    return []
  }
  if (raw === null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isObject(parsed) || parsed.version !== SLEEP_RECORDS_STORAGE_VERSION || !Array.isArray(parsed.records)) return []
    return deduplicate(parsed.records.map(normalizeRecord).filter((record): record is SleepRecord => record !== null))
  } catch {
    return []
  }
}

export function saveStoredSleepRecords(records: SleepRecord[]): void {
  const data: SleepStorageData = { version: SLEEP_RECORDS_STORAGE_VERSION, records }
  try {
    window.localStorage.setItem(SLEEP_RECORDS_STORAGE_KEY, JSON.stringify(data))
  } catch {
    console.warn('睡眠記録を保存できませんでした。画面上の操作は継続します。')
  }
}
