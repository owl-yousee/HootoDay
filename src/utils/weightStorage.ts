import type { WeightRecord } from '../types/health'

export const WEIGHT_RECORDS_STORAGE_KEY = 'hootoDay.weightRecords'
export const WEIGHT_RECORDS_STORAGE_VERSION = 1
export const MIN_WEIGHT_KG = 20
export const MAX_WEIGHT_KG = 300
export const MAX_WEIGHT_MEMO_LENGTH = 200

interface WeightStorageData {
  version: typeof WEIGHT_RECORDS_STORAGE_VERSION
  records: WeightRecord[]
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeWeight(weightKg: number): number {
  return Math.round((weightKg + Number.EPSILON) * 10) / 10
}

function isWeightRecord(value: unknown): value is WeightRecord {
  if (!isRecord(value)) return false

  return (
    typeof value.date === 'string' &&
    datePattern.test(value.date) &&
    typeof value.weightKg === 'number' &&
    Number.isFinite(value.weightKg) &&
    value.weightKg >= MIN_WEIGHT_KG &&
    value.weightKg <= MAX_WEIGHT_KG &&
    typeof value.memo === 'string' &&
    value.memo.length <= MAX_WEIGHT_MEMO_LENGTH &&
    typeof value.updatedAt === 'string' &&
    Number.isFinite(Date.parse(value.updatedAt))
  )
}

function deduplicateRecords(records: WeightRecord[]): WeightRecord[] {
  const byDate = new Map<string, WeightRecord>()

  for (const record of records) {
    const normalizedRecord = {
      ...record,
      weightKg: normalizeWeight(record.weightKg),
      memo: record.memo.trim(),
    }
    const current = byDate.get(record.date)
    if (!current || Date.parse(record.updatedAt) >= Date.parse(current.updatedAt)) {
      byDate.set(record.date, normalizedRecord)
    }
  }

  return [...byDate.values()]
}

export function loadStoredWeightRecords(): WeightRecord[] {
  let rawValue: string | null

  try {
    rawValue = window.localStorage.getItem(WEIGHT_RECORDS_STORAGE_KEY)
  } catch {
    console.warn('体重記録の保存領域を読み込めませんでした。画面上の操作は継続します。')
    return []
  }

  if (rawValue === null) return []

  try {
    const parsed: unknown = JSON.parse(rawValue)
    if (!isRecord(parsed) || parsed.version !== WEIGHT_RECORDS_STORAGE_VERSION || !Array.isArray(parsed.records)) {
      return []
    }
    return deduplicateRecords(parsed.records.filter(isWeightRecord))
  } catch {
    return []
  }
}

export function saveStoredWeightRecords(records: WeightRecord[]): void {
  const storageData: WeightStorageData = {
    version: WEIGHT_RECORDS_STORAGE_VERSION,
    records,
  }

  try {
    window.localStorage.setItem(WEIGHT_RECORDS_STORAGE_KEY, JSON.stringify(storageData))
  } catch {
    console.warn('体重記録を保存できませんでした。画面上の操作は継続します。')
  }
}
