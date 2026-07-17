import { exerciseTypeOptions, getExerciseTypeOption } from '../data/exerciseTypes'
import type { ExerciseSession, ExerciseType } from '../types/health'
import { addLocalDays, formatDateKeyJa, fromDateKey, toDateKey } from './date'
import { formatExerciseDuration } from './exerciseMetrics'

export type ExerciseSummaryPeriod = 'week' | 'month' | 'halfYear' | 'year'

export interface ExerciseSummaryRange {
  startDate: string
  endDate: string
}

export interface ExerciseTypeSummary {
  exerciseType: ExerciseType
  label: string
  sessionCount: number
  totalMinutes: number
  totalCalories: number | null
  percentageOfTime: number
}

export interface ExerciseTrendPoint {
  key: string
  label: string
  accessibleLabel: string
  totalMinutes: number
}

export interface ExerciseSummary {
  sessionCount: number
  activeDays: number
  totalMinutes: number
  totalCalories: number | null
  calculatedCaloriesCount: number
  averageMinutesPerSession: number | null
  averageActiveDaysPerWeek: number | null
  byType: ExerciseTypeSummary[]
  trend: ExerciseTrendPoint[]
  sessions: ExerciseSession[]
  rangeDays: number
}

function monthStart(date: Date): string {
  return toDateKey(new Date(date.getFullYear(), date.getMonth(), 1))
}

function monthEnd(date: Date): string {
  return toDateKey(new Date(date.getFullYear(), date.getMonth() + 1, 0))
}

export function getExerciseSummaryRange(period: ExerciseSummaryPeriod, baseDate: string): ExerciseSummaryRange {
  const date = fromDateKey(baseDate) ?? new Date()
  if (period === 'week') {
    return { startDate: addLocalDays(toDateKey(date), -6) ?? toDateKey(date), endDate: toDateKey(date) }
  }
  if (period === 'month') return { startDate: monthStart(date), endDate: monthEnd(date) }
  if (period === 'halfYear') {
    return {
      startDate: toDateKey(new Date(date.getFullYear(), date.getMonth() - 5, 1)),
      endDate: monthEnd(date),
    }
  }
  return {
    startDate: `${date.getFullYear()}-01-01`,
    endDate: `${date.getFullYear()}-12-31`,
  }
}

export function filterExerciseSessionsByRange(
  sessions: ExerciseSession[],
  range: ExerciseSummaryRange,
): ExerciseSession[] {
  return sessions
    .filter((session) => session.date >= range.startDate && session.date <= range.endDate)
    .map((session) => ({ ...session }))
}

function getDateKeys(range: ExerciseSummaryRange): string[] {
  const keys: string[] = []
  let current: string | null = range.startDate
  while (current && current <= range.endDate) {
    keys.push(current)
    current = addLocalDays(current, 1)
  }
  return keys
}

function buildDailyTrend(sessions: ExerciseSession[], range: ExerciseSummaryRange): ExerciseTrendPoint[] {
  const totals = new Map<string, number>()
  sessions.forEach((session) => totals.set(session.date, (totals.get(session.date) ?? 0) + session.durationMinutes))
  return getDateKeys(range).map((date) => {
    const parsed = fromDateKey(date)
    const totalMinutes = totals.get(date) ?? 0
    return {
      key: date,
      label: parsed ? `${parsed.getMonth() + 1}/${parsed.getDate()}` : date,
      accessibleLabel: `${formatDateKeyJa(date)}、${formatExerciseDuration(totalMinutes)}`,
      totalMinutes,
    }
  })
}

function buildMonthlyTrend(sessions: ExerciseSession[], range: ExerciseSummaryRange): ExerciseTrendPoint[] {
  const start = fromDateKey(range.startDate)
  const end = fromDateKey(range.endDate)
  if (!start || !end) return []
  const totals = new Map<string, number>()
  sessions.forEach((session) => {
    const key = session.date.slice(0, 7)
    totals.set(key, (totals.get(key) ?? 0) + session.durationMinutes)
  })
  const points: ExerciseTrendPoint[] = []
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  const last = new Date(end.getFullYear(), end.getMonth(), 1)
  while (cursor <= last) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
    const totalMinutes = totals.get(key) ?? 0
    points.push({
      key,
      label: `${cursor.getMonth() + 1}月`,
      accessibleLabel: `${cursor.getFullYear()}年${cursor.getMonth() + 1}月、${formatExerciseDuration(totalMinutes)}`,
      totalMinutes,
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return points
}

function groupExerciseSessionsByType(sessions: ExerciseSession[], totalMinutes: number): ExerciseTypeSummary[] {
  const definitionOrder = new Map(exerciseTypeOptions.map((option, index) => [option.value, index]))
  const grouped = new Map<ExerciseType, ExerciseSession[]>()
  sessions.forEach((session) => grouped.set(session.exerciseType, [...(grouped.get(session.exerciseType) ?? []), session]))
  return [...grouped.entries()].map(([exerciseType, items]) => {
    const minutes = items.reduce((sum, item) => sum + item.durationMinutes, 0)
    const calorieItems = items.filter((item) => item.estimatedCaloriesKcal !== null)
    return {
      exerciseType,
      label: getExerciseTypeOption(exerciseType).label,
      sessionCount: items.length,
      totalMinutes: minutes,
      totalCalories: calorieItems.length === 0 ? null : calorieItems.reduce((sum, item) => sum + (item.estimatedCaloriesKcal ?? 0), 0),
      percentageOfTime: totalMinutes === 0 ? 0 : (minutes / totalMinutes) * 100,
    }
  }).sort((left, right) =>
    right.totalMinutes - left.totalMinutes ||
    right.sessionCount - left.sessionCount ||
    (definitionOrder.get(left.exerciseType) ?? 99) - (definitionOrder.get(right.exerciseType) ?? 99),
  )
}

export function buildExerciseSummary(
  allSessions: ExerciseSession[],
  range: ExerciseSummaryRange,
  period: ExerciseSummaryPeriod,
): ExerciseSummary {
  const sessions = filterExerciseSessionsByRange(allSessions, range)
  const totalMinutes = sessions.reduce((sum, session) => sum + session.durationMinutes, 0)
  const calorieSessions = sessions.filter((session) => session.estimatedCaloriesKcal !== null)
  const activeDays = new Set(sessions.map((session) => session.date)).size
  const rangeDays = getDateKeys(range).length
  return {
    sessionCount: sessions.length,
    activeDays,
    totalMinutes,
    totalCalories: calorieSessions.length === 0 ? null : calorieSessions.reduce((sum, session) => sum + (session.estimatedCaloriesKcal ?? 0), 0),
    calculatedCaloriesCount: calorieSessions.length,
    averageMinutesPerSession: sessions.length === 0 ? null : Math.round(totalMinutes / sessions.length),
    averageActiveDaysPerWeek: sessions.length === 0 || rangeDays === 0 ? null : activeDays / (rangeDays / 7),
    byType: groupExerciseSessionsByType(sessions, totalMinutes),
    trend: period === 'week' || period === 'month' ? buildDailyTrend(sessions, range) : buildMonthlyTrend(sessions, range),
    sessions: sessions.sort((left, right) => right.date.localeCompare(left.date) || left.createdAt.localeCompare(right.createdAt)),
    rangeDays,
  }
}
