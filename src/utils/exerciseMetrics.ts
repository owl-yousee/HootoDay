import type { ExerciseSession, WeightRecord } from '../types/health'

export function normalizeExerciseDecimal(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10
}

export function findWeightForExerciseDate(records: WeightRecord[], date: string): number | null {
  const record = records
    .filter((item) => item.date <= date)
    .sort((left, right) => right.date.localeCompare(left.date))[0]
  return record?.weightKg ?? null
}

export function calculateEstimatedCalories(
  mets: number,
  weightKg: number | null,
  durationMinutes: number,
): number | null {
  if (
    !Number.isFinite(mets) || mets < 1 || mets > 20 ||
    weightKg === null || !Number.isFinite(weightKg) || weightKg < 20 || weightKg > 300 ||
    !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440
  ) return null
  return Math.round(mets * weightKg * (durationMinutes / 60))
}

export function formatExerciseDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours === 0) return `${remainder}分`
  return remainder === 0 ? `${hours}時間` : `${hours}時間${remainder}分`
}

export function calculateDailyExerciseSummary(sessions: ExerciseSession[]) {
  const calculatedSessions = sessions.filter((session) => session.estimatedCaloriesKcal !== null)
  return {
    sessionCount: sessions.length,
    totalDurationMinutes: sessions.reduce((sum, session) => sum + session.durationMinutes, 0),
    calculatedCount: calculatedSessions.length,
    totalEstimatedCaloriesKcal: calculatedSessions.length === 0
      ? null
      : calculatedSessions.reduce((sum, session) => sum + (session.estimatedCaloriesKcal ?? 0), 0),
  }
}
