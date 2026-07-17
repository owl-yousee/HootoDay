import type { SleepRecord } from '../types/health'
import { addLocalDays, addLocalMonths, addLocalYears } from './date'

export type SleepPeriod = '7d' | '30d' | '6m' | '1y' | 'all'

export interface SleepRange {
  startDate: string | null
  endDate: string
}

export interface SleepPeriodStatistics {
  range: SleepRange
  count: number
  averageSleepMinutes: number | null
  averageInBedMinutes: number | null
  averageAwakeMinutes: number | null
  averageAwakeningCount: number | null
  averageBedtime: string | null
  averageWakeTime: string | null
  minimumSleepMinutes: number | null
  maximumSleepMinutes: number | null
  maximumAwakeMinutes: number | null
  maximumAwakeningCount: number | null
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function formatClockMinutes(value: number): string {
  const normalized = ((Math.round(value) % 1440) + 1440) % 1440
  const hours = Math.floor(normalized / 60)
  const minutes = normalized % 60
  return `${hours}:${String(minutes).padStart(2, '0')}`
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

export function calculateCircularAverageTime(values: string[]): string | null {
  if (values.length === 0) return null
  const coordinates = values.reduce((result, value) => {
    const angle = (timeToMinutes(value) / 1440) * Math.PI * 2
    return { x: result.x + Math.cos(angle), y: result.y + Math.sin(angle) }
  }, { x: 0, y: 0 })
  if (Math.hypot(coordinates.x, coordinates.y) < 0.000001) return null
  const angle = Math.atan2(coordinates.y, coordinates.x)
  const minutes = ((angle < 0 ? angle + Math.PI * 2 : angle) / (Math.PI * 2)) * 1440
  return formatClockMinutes(minutes)
}

export function getSortedSleepRecords(records: SleepRecord[]): SleepRecord[] {
  return [...records].sort((a, b) => a.date.localeCompare(b.date))
}

export function getLatestSleepRecord(records: SleepRecord[]): SleepRecord | null {
  return getSortedSleepRecords(records).at(-1) ?? null
}

export function getPreviousSleepRecord(records: SleepRecord[]): SleepRecord | null {
  const sorted = getSortedSleepRecords(records)
  return sorted.length >= 2 ? sorted[sorted.length - 2] : null
}

export function getSleepRange(period: SleepPeriod, baseDate: string): SleepRange {
  if (period === 'all') return { startDate: null, endDate: baseDate }
  const startDate = period === '7d'
    ? addLocalDays(baseDate, -6)
    : period === '30d'
      ? addLocalDays(baseDate, -29)
      : period === '6m'
        ? addLocalMonths(baseDate, -6)
        : addLocalYears(baseDate, -1)
  return { startDate, endDate: baseDate }
}

export function filterSleepRecordsByRange(records: SleepRecord[], range: SleepRange): SleepRecord[] {
  return getSortedSleepRecords(records).filter((record) => (
    record.date <= range.endDate && (range.startDate === null || record.date >= range.startDate)
  ))
}

export function calculateSleepPeriodStatistics(records: SleepRecord[], range: SleepRange): SleepPeriodStatistics {
  const target = filterSleepRecordsByRange(records, range)
  const sleepValues = target.map((record) => record.sleepMinutes)
  const awakeValues = target.map((record) => record.awakeMinutes)
  const awakeningCounts = target.map((record) => record.awakenings.length)
  const averageSleep = average(sleepValues)
  const averageInBed = average(target.map((record) => record.totalInBedMinutes))
  const averageAwake = average(awakeValues)
  const averageCount = average(awakeningCounts)

  return {
    range,
    count: target.length,
    averageSleepMinutes: averageSleep === null ? null : Math.round(averageSleep),
    averageInBedMinutes: averageInBed === null ? null : Math.round(averageInBed),
    averageAwakeMinutes: averageAwake === null ? null : Math.round(averageAwake),
    averageAwakeningCount: averageCount === null ? null : Math.round(averageCount * 10) / 10,
    averageBedtime: calculateCircularAverageTime(target.map((record) => record.bedtime)),
    averageWakeTime: calculateCircularAverageTime(target.map((record) => record.wakeTime)),
    minimumSleepMinutes: sleepValues.length ? Math.min(...sleepValues) : null,
    maximumSleepMinutes: sleepValues.length ? Math.max(...sleepValues) : null,
    maximumAwakeMinutes: awakeValues.length ? Math.max(...awakeValues) : null,
    maximumAwakeningCount: awakeningCounts.length ? Math.max(...awakeningCounts) : null,
  }
}

export function getLatestMemoSleepRecords(records: SleepRecord[], limit = 3): SleepRecord[] {
  return getSortedSleepRecords(records).filter((record) => record.memo.trim().length > 0).reverse().slice(0, limit)
}
