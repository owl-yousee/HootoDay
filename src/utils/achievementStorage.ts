import type { DailyAchievement, MonthlyAchievementSelection } from '../types/achievement'
import { fromDateKey } from './date'

export const DAILY_ACHIEVEMENTS_STORAGE_KEY = 'hootoDay.dailyAchievements'
export const MONTHLY_ACHIEVEMENT_SELECTIONS_STORAGE_KEY = 'hootoDay.monthlyAchievementSelections'
export const ACHIEVEMENT_STORAGE_VERSION = 1

interface AchievementStorageData<T> {
  version: typeof ACHIEVEMENT_STORAGE_VERSION
  records: T[]
}

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasValidUpdatedAt(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isDailyAchievement(value: unknown): value is DailyAchievement {
  if (!isObject(value)) return false
  return typeof value.date === 'string' && fromDateKey(value.date) !== null &&
    typeof value.text === 'string' && value.text.trim().length > 0 && value.text.length <= 120 &&
    !/[\r\n]/.test(value.text) && hasValidUpdatedAt(value.updatedAt)
}

function isMonthlySelection(value: unknown): value is MonthlyAchievementSelection {
  if (!isObject(value)) return false
  return typeof value.month === 'string' && monthPattern.test(value.month) &&
    typeof value.selectedDate === 'string' && fromDateKey(value.selectedDate) !== null &&
    value.selectedDate.slice(0, 7) === value.month && hasValidUpdatedAt(value.updatedAt)
}

function deduplicateByKey<T extends { updatedAt: string }>(records: T[], getKey: (record: T) => string): T[] {
  const byKey = new Map<string, T>()
  for (const record of records) {
    const key = getKey(record)
    const current = byKey.get(key)
    if (!current || Date.parse(record.updatedAt) >= Date.parse(current.updatedAt)) byKey.set(key, record)
  }
  return [...byKey.values()]
}

function loadRecords<T>(key: string, guard: (value: unknown) => value is T, label: string): T[] {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(key)
  } catch {
    console.warn(`${label}の保存領域を読み込めませんでした。画面上の操作は継続します。`)
    return []
  }
  if (raw === null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isObject(parsed) || parsed.version !== ACHIEVEMENT_STORAGE_VERSION || !Array.isArray(parsed.records)) return []
    return parsed.records.filter(guard)
  } catch {
    return []
  }
}

function saveRecords<T>(key: string, records: T[], label: string): void {
  const data: AchievementStorageData<T> = { version: ACHIEVEMENT_STORAGE_VERSION, records }
  try {
    window.localStorage.setItem(key, JSON.stringify(data))
  } catch {
    console.warn(`${label}を保存できませんでした。画面上の操作は継続します。`)
  }
}

export function loadStoredDailyAchievements(): DailyAchievement[] {
  const records = loadRecords(DAILY_ACHIEVEMENTS_STORAGE_KEY, isDailyAchievement, '毎日のできたこと')
    .map((record) => ({ ...record, text: record.text.trim() }))
  return deduplicateByKey(records, (record) => record.date)
}

export function saveStoredDailyAchievements(records: DailyAchievement[]): void {
  saveRecords(DAILY_ACHIEVEMENTS_STORAGE_KEY, records, '毎日のできたこと')
}

export function loadStoredMonthlyAchievementSelections(): MonthlyAchievementSelection[] {
  return deduplicateByKey(
    loadRecords(MONTHLY_ACHIEVEMENT_SELECTIONS_STORAGE_KEY, isMonthlySelection, '月のベスト'),
    (record) => record.month,
  )
}

export function saveStoredMonthlyAchievementSelections(records: MonthlyAchievementSelection[]): void {
  saveRecords(MONTHLY_ACHIEVEMENT_SELECTIONS_STORAGE_KEY, records, '月のベスト')
}
