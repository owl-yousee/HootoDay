import { exerciseTypeOptions } from '../data/exerciseTypes'
import type { ExerciseSession, ExerciseType } from '../types/health'
import { fromDateKey } from './date'
import { normalizeExerciseDecimal } from './exerciseMetrics'

export const EXERCISE_SESSIONS_STORAGE_KEY = 'hootoDay.exerciseSessions'
export const EXERCISE_SESSIONS_STORAGE_VERSION = 1
export const MAX_EXERCISE_NAME_LENGTH = 50
export const MAX_EXERCISE_MEMO_LENGTH = 500

interface ExerciseStorageData {
  version: typeof EXERCISE_SESSIONS_STORAGE_VERSION
  sessions: ExerciseSession[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isExerciseType(value: unknown): value is ExerciseType {
  return typeof value === 'string' && exerciseTypeOptions.some((option) => option.value === value)
}

function isValidDateTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function parseSession(value: unknown): ExerciseSession | null {
  if (!isObject(value)) return null
  const customName = typeof value.customName === 'string' ? value.customName.trim() : ''
  const memo = typeof value.memo === 'string' ? value.memo.trim() : ''
  if (
    typeof value.id !== 'string' || !value.id.trim() ||
    typeof value.date !== 'string' || fromDateKey(value.date) === null ||
    !isExerciseType(value.exerciseType) ||
    customName.length > MAX_EXERCISE_NAME_LENGTH ||
    (value.exerciseType === 'other' && !customName) ||
    typeof value.durationMinutes !== 'number' || !Number.isInteger(value.durationMinutes) || value.durationMinutes < 1 || value.durationMinutes > 1440 ||
    !(value.averageHeartRate === null || (typeof value.averageHeartRate === 'number' && Number.isInteger(value.averageHeartRate) && value.averageHeartRate >= 30 && value.averageHeartRate <= 250)) ||
    typeof value.mets !== 'number' || !Number.isFinite(value.mets) || value.mets < 1 || value.mets > 20 ||
    !(value.weightKgUsed === null || (typeof value.weightKgUsed === 'number' && Number.isFinite(value.weightKgUsed) && value.weightKgUsed >= 20 && value.weightKgUsed <= 300)) ||
    !(value.estimatedCaloriesKcal === null || (typeof value.estimatedCaloriesKcal === 'number' && Number.isFinite(value.estimatedCaloriesKcal) && value.estimatedCaloriesKcal >= 0)) ||
    memo.length > MAX_EXERCISE_MEMO_LENGTH ||
    !isValidDateTime(value.createdAt) || !isValidDateTime(value.updatedAt)
  ) return null

  return {
    id: value.id.trim(),
    date: value.date,
    exerciseType: value.exerciseType,
    customName: value.exerciseType === 'other' ? customName : '',
    durationMinutes: value.durationMinutes,
    averageHeartRate: value.averageHeartRate,
    mets: normalizeExerciseDecimal(value.mets),
    weightKgUsed: value.weightKgUsed === null ? null : normalizeExerciseDecimal(value.weightKgUsed),
    estimatedCaloriesKcal: value.estimatedCaloriesKcal === null ? null : Math.round(value.estimatedCaloriesKcal),
    memo,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

function deduplicateSessions(sessions: ExerciseSession[]): ExerciseSession[] {
  const byId = new Map<string, { session: ExerciseSession; index: number }>()
  sessions.forEach((session, index) => {
    const current = byId.get(session.id)
    if (!current || Date.parse(session.updatedAt) > Date.parse(current.session.updatedAt) ||
      (Date.parse(session.updatedAt) === Date.parse(current.session.updatedAt) && index > current.index)) {
      byId.set(session.id, { session, index })
    }
  })
  return [...byId.values()].sort((left, right) => left.index - right.index).map(({ session }) => session)
}

export function loadStoredExerciseSessions(): ExerciseSession[] {
  try {
    const rawValue = window.localStorage.getItem(EXERCISE_SESSIONS_STORAGE_KEY)
    if (rawValue === null) return []
    const parsed: unknown = JSON.parse(rawValue)
    if (!isObject(parsed) || parsed.version !== EXERCISE_SESSIONS_STORAGE_VERSION || !Array.isArray(parsed.sessions)) return []
    return deduplicateSessions(parsed.sessions.map(parseSession).filter((item): item is ExerciseSession => item !== null))
  } catch {
    console.warn('運動記録の保存領域を読み込めませんでした。画面上の操作は継続します。')
    return []
  }
}

export function saveStoredExerciseSessions(sessions: ExerciseSession[]): void {
  const data: ExerciseStorageData = { version: EXERCISE_SESSIONS_STORAGE_VERSION, sessions }
  try {
    window.localStorage.setItem(EXERCISE_SESSIONS_STORAGE_KEY, JSON.stringify(data))
  } catch {
    console.warn('運動記録を保存できませんでした。画面上の操作は継続します。')
  }
}
