import type { MealRecord } from '../types/health'
import { fromDateKey } from './date'

export const MEAL_RECORDS_STORAGE_KEY = 'hootoDay.mealRecords'
export const MEAL_RECORDS_STORAGE_VERSION = 1
export const MAX_MEAL_FIELD_LENGTH = 1000

interface MealStorageData {
  version: typeof MEAL_RECORDS_STORAGE_VERSION
  records: MealRecord[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeMealText(value: string): string {
  return value.trim()
}

export function hasMealContent(record: Pick<MealRecord, 'breakfast' | 'lunch' | 'dinner' | 'snacks'>): boolean {
  return [record.breakfast, record.lunch, record.dinner, record.snacks].some((value) => value.trim().length > 0)
}

function parseMealRecord(value: unknown): MealRecord | null {
  if (!isObject(value)) return null
  if (typeof value.date !== 'string' || fromDateKey(value.date) === null) return null
  if (typeof value.breakfast !== 'string' || typeof value.lunch !== 'string' || typeof value.dinner !== 'string' || typeof value.snacks !== 'string') return null
  if (typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) return null

  const record: MealRecord = {
    date: value.date,
    breakfast: normalizeMealText(value.breakfast),
    lunch: normalizeMealText(value.lunch),
    dinner: normalizeMealText(value.dinner),
    snacks: normalizeMealText(value.snacks),
    updatedAt: value.updatedAt,
  }
  if ([record.breakfast, record.lunch, record.dinner, record.snacks].some((text) => text.length > MAX_MEAL_FIELD_LENGTH)) return null
  return hasMealContent(record) ? record : null
}

function deduplicateMealRecords(values: unknown[]): MealRecord[] {
  const byDate = new Map<string, MealRecord>()
  values.forEach((value) => {
    const record = parseMealRecord(value)
    if (!record) return
    const current = byDate.get(record.date)
    if (!current || Date.parse(record.updatedAt) >= Date.parse(current.updatedAt)) byDate.set(record.date, record)
  })
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function loadStoredMealRecords(): MealRecord[] {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(MEAL_RECORDS_STORAGE_KEY)
  } catch {
    console.warn('食事記録の保存領域を読み込めませんでした。画面上の操作は継続します。')
    return []
  }
  if (raw === null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isObject(parsed) || parsed.version !== MEAL_RECORDS_STORAGE_VERSION || !Array.isArray(parsed.records)) return []
    return deduplicateMealRecords(parsed.records)
  } catch {
    return []
  }
}

export function saveStoredMealRecords(records: MealRecord[]): void {
  const data: MealStorageData = { version: MEAL_RECORDS_STORAGE_VERSION, records }
  try {
    window.localStorage.setItem(MEAL_RECORDS_STORAGE_KEY, JSON.stringify(data))
  } catch {
    console.warn('食事記録を保存できませんでした。画面上の操作は継続します。')
  }
}
