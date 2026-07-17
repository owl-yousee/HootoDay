import { bodyPartConditionLabels, conditionLevelLabels } from '../data/conditionOptions'
import type {
  DailyConditionRecord,
  ExerciseSession,
  MealRecord,
  SleepRecord,
  WeightRecord,
} from '../types/health'
import { calculateDailyExerciseSummary, formatExerciseDuration } from './exerciseMetrics'
import { formatDurationMinutes } from './sleepMetrics'

export interface DailyHealthSummary {
  date: string
  hasAnyRecord: boolean
  hasWeight: boolean
  hasSleep: boolean
  hasMeals: boolean
  hasExercise: boolean
  hasCondition: boolean
  weightRecord: WeightRecord | null
  sleepRecord: SleepRecord | null
  mealRecord: MealRecord | null
  exerciseSessions: ExerciseSession[]
  conditionRecord: DailyConditionRecord | null
}

export interface HealthSummarySource {
  weightRecords: WeightRecord[]
  sleepRecords: SleepRecord[]
  mealRecords: MealRecord[]
  exerciseSessions: ExerciseSession[]
  conditionRecords: DailyConditionRecord[]
}

export function getExerciseSessionsForDate(sessions: ExerciseSession[], date: string): ExerciseSession[] {
  return sessions.filter((session) => session.date === date)
}

export function getDailyHealthSummary(date: string, source: HealthSummarySource): DailyHealthSummary {
  const weightRecord = source.weightRecords.find((record) => record.date === date) ?? null
  const sleepRecord = source.sleepRecords.find((record) => record.date === date) ?? null
  const mealRecord = source.mealRecords.find((record) => record.date === date) ?? null
  const exerciseSessions = getExerciseSessionsForDate(source.exerciseSessions, date)
  const conditionRecord = source.conditionRecords.find((record) => record.date === date) ?? null
  const hasWeight = weightRecord !== null
  const hasSleep = sleepRecord !== null
  const hasMeals = mealRecord !== null
  const hasExercise = exerciseSessions.length > 0
  const hasCondition = conditionRecord !== null

  return {
    date,
    hasAnyRecord: hasWeight || hasSleep || hasMeals || hasExercise || hasCondition,
    hasWeight,
    hasSleep,
    hasMeals,
    hasExercise,
    hasCondition,
    weightRecord,
    sleepRecord,
    mealRecord,
    exerciseSessions,
    conditionRecord,
  }
}

export function getHealthRecordDates(source: HealthSummarySource): Set<string> {
  return new Set([
    ...source.weightRecords.map((record) => record.date),
    ...source.sleepRecords.map((record) => record.date),
    ...source.mealRecords.map((record) => record.date),
    ...source.exerciseSessions.map((session) => session.date),
    ...source.conditionRecords.map((record) => record.date),
  ])
}

export function getDailyHealthSummaryLines(summary: DailyHealthSummary): string[] {
  const lines: string[] = []
  if (summary.weightRecord) lines.push(`体重：${summary.weightRecord.weightKg.toFixed(1)} kg`)
  if (summary.sleepRecord) {
    let line = `睡眠：${formatDurationMinutes(summary.sleepRecord.sleepMinutes)}`
    if (summary.sleepRecord.awakenings.length > 0) {
      line += `（途中覚醒 ${summary.sleepRecord.awakenings.length}回・${formatDurationMinutes(summary.sleepRecord.awakeMinutes)}）`
    }
    lines.push(line)
  }
  if (summary.mealRecord) {
    const count = [summary.mealRecord.breakfast, summary.mealRecord.lunch, summary.mealRecord.dinner, summary.mealRecord.snacks]
      .filter((content) => content.trim().length > 0).length
    lines.push(`食事：${count}項目`)
  }
  if (summary.exerciseSessions.length > 0) {
    const exercise = calculateDailyExerciseSummary(summary.exerciseSessions)
    let line = `運動：${exercise.sessionCount}件・${formatExerciseDuration(exercise.totalDurationMinutes)}`
    if (exercise.totalEstimatedCaloriesKcal !== null) line += `・推定${exercise.totalEstimatedCaloriesKcal} kcal`
    lines.push(line)
  }
  if (summary.conditionRecord) {
    const condition = summary.conditionRecord
    if (condition.overallCondition !== 'unset') {
      lines.push(`体調：${conditionLevelLabels[condition.overallCondition]}`)
    } else {
      const parts = [
        condition.kneeCondition !== 'unset' ? `膝：${bodyPartConditionLabels[condition.kneeCondition]}` : '',
        condition.lowerBackCondition !== 'unset' ? `腰：${bodyPartConditionLabels[condition.lowerBackCondition]}` : '',
      ].filter(Boolean)
      lines.push(parts.length > 0 ? parts.slice(0, 2).join('・') : '体調：記録あり')
    }
  }
  return lines
}
