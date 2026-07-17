import {
  bodyPartConditionOptions,
  conditionLevelOptions,
  bodyPartConditionLabels,
  conditionLevelLabels,
} from '../data/conditionOptions'
import type { BodyPartCondition, ConditionLevel, DailyConditionRecord } from '../types/health'
import { addLocalDays, formatDateKeyJa, fromDateKey, toDateKey } from './date'

export type ConditionSummaryPeriod = 'week' | 'month' | 'halfYear' | 'year'
export type ConditionTrendTarget = 'overall' | 'knee' | 'lowerBack'
export type ConditionTrendValue = Exclude<ConditionLevel | BodyPartCondition, 'unset'>

export interface ConditionSummaryRange {
  startDate: string
  endDate: string
}

export interface ConditionStateCount<T extends string> {
  value: T
  label: string
  count: number
  percentage: number
}

export interface ConditionTrendSegment {
  value: ConditionTrendValue
  label: string
  count: number
}

export interface ConditionTrendPoint {
  key: string
  label: string
  accessibleLabel: string
  segments: ConditionTrendSegment[]
  total: number
}

export interface ConditionSummary {
  recordDays: number
  overallRecordedDays: number
  kneeRecordedDays: number
  lowerBackRecordedDays: number
  menstrualNoteDays: number
  concernsDays: number
  memoDays: number
  overallCounts: Array<ConditionStateCount<Exclude<ConditionLevel, 'unset'>>>
  kneeCounts: Array<ConditionStateCount<Exclude<BodyPartCondition, 'unset'>>>
  lowerBackCounts: Array<ConditionStateCount<Exclude<BodyPartCondition, 'unset'>>>
  records: DailyConditionRecord[]
}

function monthStart(date: Date): string {
  return toDateKey(new Date(date.getFullYear(), date.getMonth(), 1))
}

function monthEnd(date: Date): string {
  return toDateKey(new Date(date.getFullYear(), date.getMonth() + 1, 0))
}

export function getConditionSummaryRange(period: ConditionSummaryPeriod, baseDate: string): ConditionSummaryRange {
  const date = fromDateKey(baseDate) ?? new Date()
  if (period === 'week') {
    const dateKey = toDateKey(date)
    return { startDate: addLocalDays(dateKey, -6) ?? dateKey, endDate: dateKey }
  }
  if (period === 'month') return { startDate: monthStart(date), endDate: monthEnd(date) }
  if (period === 'halfYear') {
    return {
      startDate: toDateKey(new Date(date.getFullYear(), date.getMonth() - 5, 1)),
      endDate: monthEnd(date),
    }
  }
  return { startDate: `${date.getFullYear()}-01-01`, endDate: `${date.getFullYear()}-12-31` }
}

export function filterConditionRecordsByRange(
  records: DailyConditionRecord[],
  range: ConditionSummaryRange,
): DailyConditionRecord[] {
  return records
    .filter((record) => record.date >= range.startDate && record.date <= range.endDate)
    .map((record) => ({ ...record }))
}

function buildStateCounts<T extends string>(
  values: T[],
  definitions: Array<{ value: T; label: string }>,
): Array<ConditionStateCount<T>> {
  const denominator = values.length
  return definitions.map((definition) => {
    const count = values.filter((value) => value === definition.value).length
    return {
      ...definition,
      count,
      percentage: denominator === 0 ? 0 : Math.round((count / denominator) * 1000) / 10,
    }
  }).filter((item) => item.count > 0)
}

export function buildConditionSummary(
  allRecords: DailyConditionRecord[],
  range: ConditionSummaryRange,
): ConditionSummary {
  const records = filterConditionRecordsByRange(allRecords, range)
    .sort((left, right) => right.date.localeCompare(left.date))
  const overall = records.map((record) => record.overallCondition).filter((value): value is Exclude<ConditionLevel, 'unset'> => value !== 'unset')
  const knees = records.map((record) => record.kneeCondition).filter((value): value is Exclude<BodyPartCondition, 'unset'> => value !== 'unset')
  const lowerBacks = records.map((record) => record.lowerBackCondition).filter((value): value is Exclude<BodyPartCondition, 'unset'> => value !== 'unset')
  const overallDefinitions = conditionLevelOptions.filter(
    (option): option is { value: Exclude<ConditionLevel, 'unset'>; label: string } => option.value !== 'unset',
  )
  const bodyDefinitions = bodyPartConditionOptions.filter(
    (option): option is { value: Exclude<BodyPartCondition, 'unset'>; label: string } => option.value !== 'unset',
  )

  return {
    recordDays: records.length,
    overallRecordedDays: overall.length,
    kneeRecordedDays: knees.length,
    lowerBackRecordedDays: lowerBacks.length,
    menstrualNoteDays: records.filter((record) => record.menstrualNote.trim().length > 0).length,
    concernsDays: records.filter((record) => record.concerns.trim().length > 0).length,
    memoDays: records.filter((record) => record.memo.trim().length > 0).length,
    overallCounts: buildStateCounts(overall, overallDefinitions),
    kneeCounts: buildStateCounts(knees, bodyDefinitions),
    lowerBackCounts: buildStateCounts(lowerBacks, bodyDefinitions),
    records,
  }
}

function getDateKeys(range: ConditionSummaryRange): string[] {
  const keys: string[] = []
  let current: string | null = range.startDate
  while (current && current <= range.endDate) {
    keys.push(current)
    current = addLocalDays(current, 1)
  }
  return keys
}

function getTrendValue(record: DailyConditionRecord, target: ConditionTrendTarget): ConditionTrendValue | null {
  const value = target === 'overall'
    ? record.overallCondition
    : target === 'knee'
      ? record.kneeCondition
      : record.lowerBackCondition
  return value === 'unset' ? null : value
}

function getTrendLabel(value: ConditionTrendValue): string {
  return value === 'good' || value === 'normal' || value === 'poor'
    ? conditionLevelLabels[value]
    : bodyPartConditionLabels[value]
}

function buildDailyTrend(
  records: DailyConditionRecord[],
  range: ConditionSummaryRange,
  target: ConditionTrendTarget,
): ConditionTrendPoint[] {
  const byDate = new Map(records.map((record) => [record.date, record]))
  return getDateKeys(range).map((date) => {
    const parsed = fromDateKey(date)
    const record = byDate.get(date)
    const value = record ? getTrendValue(record, target) : null
    const segments = value ? [{ value, label: getTrendLabel(value), count: 1 }] : []
    return {
      key: date,
      label: parsed ? `${parsed.getMonth() + 1}/${parsed.getDate()}` : date,
      accessibleLabel: `${formatDateKeyJa(date)}、${value ? getTrendLabel(value) : '記録なし'}`,
      segments,
      total: segments.length,
    }
  })
}

function buildMonthlyTrend(
  records: DailyConditionRecord[],
  range: ConditionSummaryRange,
  target: ConditionTrendTarget,
): ConditionTrendPoint[] {
  const start = fromDateKey(range.startDate)
  const end = fromDateKey(range.endDate)
  if (!start || !end) return []
  const points: ConditionTrendPoint[] = []
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  const last = new Date(end.getFullYear(), end.getMonth(), 1)
  while (cursor <= last) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
    const monthRecords = records.filter((record) => record.date.startsWith(key))
    const values = monthRecords.map((record) => getTrendValue(record, target)).filter((value): value is ConditionTrendValue => value !== null)
    const definitions: ConditionTrendValue[] = target === 'overall'
      ? ['good', 'normal', 'poor']
      : ['none', 'mild', 'painful', 'severe']
    const segments = definitions.map((value) => ({
      value,
      label: getTrendLabel(value),
      count: values.filter((item) => item === value).length,
    })).filter((segment) => segment.count > 0)
    const detail = segments.map((segment) => `${segment.label}${segment.count}日`).join('、')
    points.push({
      key,
      label: `${cursor.getMonth() + 1}月`,
      accessibleLabel: `${cursor.getFullYear()}年${cursor.getMonth() + 1}月、${detail || '記録なし'}`,
      segments,
      total: values.length,
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return points
}

export function buildConditionTrend(
  allRecords: DailyConditionRecord[],
  range: ConditionSummaryRange,
  period: ConditionSummaryPeriod,
  target: ConditionTrendTarget,
): ConditionTrendPoint[] {
  const records = filterConditionRecordsByRange(allRecords, range)
  return period === 'week' || period === 'month'
    ? buildDailyTrend(records, range, target)
    : buildMonthlyTrend(records, range, target)
}
