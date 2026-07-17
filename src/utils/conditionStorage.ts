import { bodyPartConditionOptions, conditionLevelOptions } from '../data/conditionOptions'
import type { BodyPartCondition, ConditionLevel, DailyConditionRecord } from '../types/health'
import { fromDateKey } from './date'

export const CONDITION_RECORDS_STORAGE_KEY = 'hootoDay.conditionRecords'
export const CONDITION_RECORDS_STORAGE_VERSION = 1
export const MAX_CONDITION_SHORT_TEXT_LENGTH = 500
export const MAX_CONDITION_MEMO_LENGTH = 1000

interface ConditionStorageData {
  version: typeof CONDITION_RECORDS_STORAGE_VERSION
  records: DailyConditionRecord[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isConditionLevel(value: unknown): value is ConditionLevel {
  return typeof value === 'string' && conditionLevelOptions.some((option) => option.value === value)
}

function isBodyPartCondition(value: unknown): value is BodyPartCondition {
  return typeof value === 'string' && bodyPartConditionOptions.some((option) => option.value === value)
}

export function normalizeConditionText(value: string): string {
  return value.trim()
}

export function hasConditionContent(record: Omit<DailyConditionRecord, 'date' | 'updatedAt'>): boolean {
  return record.overallCondition !== 'unset' || record.kneeCondition !== 'unset' ||
    record.lowerBackCondition !== 'unset' || Boolean(record.menstrualNote.trim()) ||
    Boolean(record.concerns.trim()) || Boolean(record.memo.trim())
}

function parseConditionRecord(value: unknown): DailyConditionRecord | null {
  if (!isObject(value) || typeof value.date !== 'string' || fromDateKey(value.date) === null ||
    !isConditionLevel(value.overallCondition) || !isBodyPartCondition(value.kneeCondition) ||
    !isBodyPartCondition(value.lowerBackCondition) || typeof value.menstrualNote !== 'string' ||
    typeof value.concerns !== 'string' || typeof value.memo !== 'string' ||
    typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) return null

  const record: DailyConditionRecord = {
    date: value.date,
    overallCondition: value.overallCondition,
    kneeCondition: value.kneeCondition,
    lowerBackCondition: value.lowerBackCondition,
    menstrualNote: normalizeConditionText(value.menstrualNote),
    concerns: normalizeConditionText(value.concerns),
    memo: normalizeConditionText(value.memo),
    updatedAt: value.updatedAt,
  }
  if (record.menstrualNote.length > MAX_CONDITION_SHORT_TEXT_LENGTH ||
    record.concerns.length > MAX_CONDITION_SHORT_TEXT_LENGTH || record.memo.length > MAX_CONDITION_MEMO_LENGTH ||
    !hasConditionContent(record)) return null
  return record
}

function deduplicateRecords(values: unknown[]): DailyConditionRecord[] {
  const byDate = new Map<string, DailyConditionRecord>()
  values.forEach((value) => {
    const record = parseConditionRecord(value)
    if (!record) return
    const current = byDate.get(record.date)
    if (!current || Date.parse(record.updatedAt) >= Date.parse(current.updatedAt)) byDate.set(record.date, record)
  })
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date))
}

export function loadStoredConditionRecords(): DailyConditionRecord[] {
  try {
    const rawValue = window.localStorage.getItem(CONDITION_RECORDS_STORAGE_KEY)
    if (rawValue === null) return []
    const parsed: unknown = JSON.parse(rawValue)
    if (!isObject(parsed) || parsed.version !== CONDITION_RECORDS_STORAGE_VERSION || !Array.isArray(parsed.records)) return []
    return deduplicateRecords(parsed.records)
  } catch {
    console.warn('体調記録の保存領域を読み込めませんでした。画面上の操作は継続します。')
    return []
  }
}

export function saveStoredConditionRecords(records: DailyConditionRecord[]): void {
  const data: ConditionStorageData = { version: CONDITION_RECORDS_STORAGE_VERSION, records }
  try {
    window.localStorage.setItem(CONDITION_RECORDS_STORAGE_KEY, JSON.stringify(data))
  } catch {
    console.warn('体調記録を保存できませんでした。画面上の操作は継続します。')
  }
}
