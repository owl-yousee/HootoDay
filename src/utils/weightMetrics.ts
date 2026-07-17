import type { WeightRecord } from '../types/health'
import { addLocalDays, addLocalMonths, addLocalYears, fromDateKey } from './date'

export type WeightPeriod = '7d' | '30d' | '6m' | '1y' | 'all'

export interface WeightRange {
  startDate: string | null
  endDate: string
}

export interface WeightAverage {
  averageKg: number | null
  count: number
  range: WeightRange
}

export function roundToOne(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10
}

export function calculateBmi(weightKg: number | null, heightCm: number | null): number | null {
  if (weightKg === null || heightCm === null || heightCm <= 0) return null
  const heightM = heightCm / 100
  return roundToOne(weightKg / (heightM * heightM))
}

export function calculateStandardWeight(heightCm: number | null): number | null {
  if (heightCm === null || heightCm <= 0) return null
  const heightM = heightCm / 100
  return roundToOne(heightM * heightM * 22)
}

export function calculateBeautyWeight(heightCm: number | null): number | null {
  if (heightCm === null || heightCm <= 0) return null
  const heightM = heightCm / 100
  return roundToOne(heightM * heightM * 20)
}

export function calculateWeightDifference(weightKg: number | null, referenceKg: number | null): number | null {
  if (weightKg === null || referenceKg === null) return null
  return roundToOne(weightKg - referenceKg)
}

export function getSortedWeightRecords(records: WeightRecord[]): WeightRecord[] {
  return [...records].sort((a, b) => a.date.localeCompare(b.date))
}

export function getLatestWeightRecord(records: WeightRecord[]): WeightRecord | null {
  return getSortedWeightRecords(records).at(-1) ?? null
}

export function getPreviousWeightRecord(records: WeightRecord[]): WeightRecord | null {
  const sorted = getSortedWeightRecords(records)
  return sorted.length >= 2 ? sorted[sorted.length - 2] : null
}

export function getWeightRange(period: WeightPeriod, baseDate: string): WeightRange {
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

export function filterWeightRecordsByRange(records: WeightRecord[], range: WeightRange): WeightRecord[] {
  return getSortedWeightRecords(records).filter((record) => (
    record.date <= range.endDate && (range.startDate === null || record.date >= range.startDate)
  ))
}

export function calculateAverageWeight(records: WeightRecord[], range: WeightRange): WeightAverage {
  const target = filterWeightRecordsByRange(records, range)
  if (target.length === 0) return { averageKg: null, count: 0, range }
  const total = target.reduce((sum, record) => sum + record.weightKg, 0)
  return { averageKg: roundToOne(total / target.length), count: target.length, range }
}

export function getBmiLabel(bmi: number | null): string | null {
  if (bmi === null) return null
  if (bmi < 18.5) return '低体重の範囲'
  if (bmi < 25) return '普通体重の範囲'
  return '肥満の範囲'
}

export function isValidMetricBaseDate(dateKey: string): boolean {
  return fromDateKey(dateKey) !== null
}
