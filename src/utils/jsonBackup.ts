import { eventCategories } from '../data/calendarData'
import { bodyPartConditionOptions, conditionLevelOptions } from '../data/conditionOptions'
import { exerciseTypeOptions } from '../data/exerciseTypes'
import type { CalendarEvent, EventCategory } from '../types/calendar'
import type {
  BackupSummary,
  BackupValidationResult,
  HootoDayBackup,
  HootoDayBackupData,
} from '../types/backup'
import type {
  BodyPartCondition,
  CalculationSex,
  ConditionLevel,
  ExerciseType,
  MealType,
  SleepAwakening,
} from '../types/health'
import type { ThemePreference } from '../types/theme'
import { ACHIEVEMENT_STORAGE_VERSION, DAILY_ACHIEVEMENTS_STORAGE_KEY, MONTHLY_ACHIEVEMENT_SELECTIONS_STORAGE_KEY } from './achievementStorage'
import { CONDITION_RECORDS_STORAGE_KEY, CONDITION_RECORDS_STORAGE_VERSION, MAX_CONDITION_MEMO_LENGTH, MAX_CONDITION_SHORT_TEXT_LENGTH, hasConditionContent } from './conditionStorage'
import { DAY_MEMOS_STORAGE_KEY, DAY_MEMOS_STORAGE_VERSION } from './dayMemoStorage'
import { fromDateKey } from './date'
import { EVENTS_STORAGE_KEY, EVENTS_STORAGE_VERSION } from './eventStorage'
import { EXERCISE_SESSIONS_STORAGE_KEY, EXERCISE_SESSIONS_STORAGE_VERSION, MAX_EXERCISE_MEMO_LENGTH, MAX_EXERCISE_NAME_LENGTH } from './exerciseStorage'
import { getLocalTodayKey, MIN_BIRTH_DATE } from './healthProfile'
import { HEALTH_PROFILE_STORAGE_KEY, HEALTH_PROFILE_STORAGE_VERSION, MAX_HEIGHT_CM, MAX_TARGET_WEIGHT_KG, MIN_HEIGHT_CM, MIN_TARGET_WEIGHT_KG } from './healthProfileStorage'
import { MAX_MEAL_FIELD_LENGTH, MEAL_RECORDS_STORAGE_KEY, MEAL_RECORDS_STORAGE_VERSION, hasMealContent } from './mealStorage'
import { MAX_MEAL_TEMPLATE_CONTENT_LENGTH, MAX_MEAL_TEMPLATE_NAME_LENGTH, MEAL_TEMPLATES_STORAGE_KEY, MEAL_TEMPLATES_STORAGE_VERSION } from './mealTemplateStorage'
import { MAX_SLEEP_MEMO_LENGTH, SLEEP_RECORDS_STORAGE_KEY, SLEEP_RECORDS_STORAGE_VERSION } from './sleepStorage'
import { calculateSleepSummary, isValidTime, MAX_POINT_AWAKENING_MINUTES, MIN_POINT_AWAKENING_MINUTES } from './sleepMetrics'
import { THEME_STORAGE_KEY, isThemePreference } from './theme'
import { MAX_WEIGHT_KG, MAX_WEIGHT_MEMO_LENGTH, MIN_WEIGHT_KG, WEIGHT_RECORDS_STORAGE_KEY, WEIGHT_RECORDS_STORAGE_VERSION } from './weightStorage'

export const HOOTODAY_BACKUP_FORMAT_VERSION = 1
export const MAX_BACKUP_FILE_SIZE = 10 * 1024 * 1024

export const BACKUP_STORAGE_KEYS = [
  THEME_STORAGE_KEY,
  EVENTS_STORAGE_KEY,
  DAY_MEMOS_STORAGE_KEY,
  HEALTH_PROFILE_STORAGE_KEY,
  WEIGHT_RECORDS_STORAGE_KEY,
  SLEEP_RECORDS_STORAGE_KEY,
  MEAL_RECORDS_STORAGE_KEY,
  MEAL_TEMPLATES_STORAGE_KEY,
  EXERCISE_SESSIONS_STORAGE_KEY,
  CONDITION_RECORDS_STORAGE_KEY,
  DAILY_ACHIEVEMENTS_STORAGE_KEY,
  MONTHLY_ACHIEVEMENT_SELECTIONS_STORAGE_KEY,
] as const

export interface StorageRestoreResult {
  success: boolean
  rollbackFailed: boolean
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoDateTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
}

function isFiniteNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function hasUniqueValues<T>(items: T[], getKey: (item: T) => string): boolean {
  return new Set(items.map(getKey)).size === items.length
}

function isNullableTime(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && isValidTime(value))
}

function isEventCategory(value: unknown): value is EventCategory {
  return typeof value === 'string' && eventCategories.some((category) => category === value)
}

function isCalendarEvent(value: unknown): value is HootoDayBackupData['events'][number] {
  if (!isObject(value) || typeof value.id !== 'string' || value.id.trim() === '' ||
    typeof value.date !== 'string' || !fromDateKey(value.date) ||
    typeof value.title !== 'string' || value.title.trim() === '' || value.title.length > 80 ||
    !isEventCategory(value.category) || typeof value.isAllDay !== 'boolean' ||
    !isNullableTime(value.startTime) || !isNullableTime(value.endTime) ||
    typeof value.memo !== 'string' || value.memo.length > 500) return false
  if (value.isAllDay) return value.startTime === null && value.endTime === null
  if (value.startTime === null) return false
  return value.endTime === null || value.endTime > value.startTime
}

function isDayMemo(value: unknown): value is HootoDayBackupData['dayMemos'][number] {
  return isObject(value) && typeof value.date === 'string' && Boolean(fromDateKey(value.date)) &&
    typeof value.content === 'string' && value.content.trim().length > 0 && value.content.length <= 2000 &&
    isIsoDateTime(value.updatedAt)
}

function isCalculationSex(value: unknown): value is CalculationSex | null {
  return value === null || value === 'female' || value === 'male'
}

function isHealthProfile(value: unknown): value is NonNullable<HootoDayBackupData['healthProfile']> {
  if (!isObject(value)) return false
  const height = value.heightCm
  const target = value.targetWeightKg
  const birthDate = value.birthDate
  const validHeight = height === null || isFiniteNumber(height, MIN_HEIGHT_CM, MAX_HEIGHT_CM)
  const validTarget = target === null || isFiniteNumber(target, MIN_TARGET_WEIGHT_KG, MAX_TARGET_WEIGHT_KG)
  const validBirthDate = birthDate === null || (typeof birthDate === 'string' && Boolean(fromDateKey(birthDate)) && birthDate >= MIN_BIRTH_DATE && birthDate <= getLocalTodayKey())
  return validHeight && validTarget && validBirthDate && isCalculationSex(value.calculationSex) &&
    isIsoDateTime(value.updatedAt) && (height !== null || target !== null || birthDate !== null || value.calculationSex !== null)
}

function isWeightRecord(value: unknown): value is HootoDayBackupData['weightRecords'][number] {
  return isObject(value) && typeof value.date === 'string' && Boolean(fromDateKey(value.date)) &&
    isFiniteNumber(value.weightKg, MIN_WEIGHT_KG, MAX_WEIGHT_KG) &&
    typeof value.memo === 'string' && value.memo.length <= MAX_WEIGHT_MEMO_LENGTH && isIsoDateTime(value.updatedAt)
}

function isSleepAwakening(value: unknown): value is SleepAwakening {
  if (!isObject(value) || typeof value.id !== 'string' || value.id.trim() === '' ||
    typeof value.startTime !== 'string' || !isValidTime(value.startTime)) return false
  if (value.mode === 'point') {
    return value.endTime === null && Number.isInteger(value.estimatedMinutes) &&
      Number(value.estimatedMinutes) >= MIN_POINT_AWAKENING_MINUTES && Number(value.estimatedMinutes) <= MAX_POINT_AWAKENING_MINUTES
  }
  return value.mode === 'range' && typeof value.endTime === 'string' && isValidTime(value.endTime) && value.estimatedMinutes === null
}

function isSleepRecord(value: unknown): value is HootoDayBackupData['sleepRecords'][number] {
  if (!isObject(value) || typeof value.date !== 'string' || !fromDateKey(value.date) ||
    typeof value.bedtime !== 'string' || !isValidTime(value.bedtime) ||
    typeof value.wakeTime !== 'string' || !isValidTime(value.wakeTime) ||
    !Array.isArray(value.awakenings) || !value.awakenings.every(isSleepAwakening) ||
    !hasUniqueValues(value.awakenings, (item) => item.id) ||
    typeof value.memo !== 'string' || value.memo.length > MAX_SLEEP_MEMO_LENGTH || !isIsoDateTime(value.updatedAt)) return false
  const calculation = calculateSleepSummary(value.bedtime, value.wakeTime, value.awakenings)
  return Boolean(calculation.summary) && value.totalInBedMinutes === calculation.summary?.totalInBedMinutes &&
    value.awakeMinutes === calculation.summary?.awakeMinutes && value.sleepMinutes === calculation.summary?.sleepMinutes
}

function isMealRecord(value: unknown): value is HootoDayBackupData['mealRecords'][number] {
  if (!isObject(value) || typeof value.date !== 'string' || !fromDateKey(value.date) ||
    typeof value.breakfast !== 'string' || typeof value.lunch !== 'string' ||
    typeof value.dinner !== 'string' || typeof value.snacks !== 'string' || !isIsoDateTime(value.updatedAt)) return false
  const fields = [value.breakfast, value.lunch, value.dinner, value.snacks]
  return fields.every((text) => text.length <= MAX_MEAL_FIELD_LENGTH) && hasMealContent({
    breakfast: value.breakfast, lunch: value.lunch, dinner: value.dinner, snacks: value.snacks,
  })
}

const mealTypes: MealType[] = ['breakfast', 'lunch', 'dinner', 'snacks', 'any']

function isMealTemplate(value: unknown): value is HootoDayBackupData['mealTemplates'][number] {
  return isObject(value) && typeof value.id === 'string' && value.id.trim() !== '' &&
    typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= MAX_MEAL_TEMPLATE_NAME_LENGTH &&
    typeof value.mealType === 'string' && mealTypes.includes(value.mealType as MealType) &&
    typeof value.content === 'string' && value.content.trim().length > 0 && value.content.length <= MAX_MEAL_TEMPLATE_CONTENT_LENGTH &&
    Number.isInteger(value.sortOrder) && Number(value.sortOrder) >= 0 && isIsoDateTime(value.createdAt) && isIsoDateTime(value.updatedAt)
}

function isExerciseType(value: unknown): value is ExerciseType {
  return typeof value === 'string' && exerciseTypeOptions.some((option) => option.value === value)
}

function isExerciseSession(value: unknown): value is HootoDayBackupData['exerciseSessions'][number] {
  if (!isObject(value) || typeof value.id !== 'string' || value.id.trim() === '' ||
    typeof value.date !== 'string' || !fromDateKey(value.date) || !isExerciseType(value.exerciseType) ||
    typeof value.customName !== 'string' || value.customName.length > MAX_EXERCISE_NAME_LENGTH ||
    (value.exerciseType === 'other' && value.customName.trim() === '') ||
    (value.exerciseType !== 'other' && value.customName !== '') ||
    !Number.isInteger(value.durationMinutes) || Number(value.durationMinutes) < 1 || Number(value.durationMinutes) > 1440 ||
    !(value.averageHeartRate === null || (Number.isInteger(value.averageHeartRate) && Number(value.averageHeartRate) >= 30 && Number(value.averageHeartRate) <= 250)) ||
    !isFiniteNumber(value.mets, 1, 20) ||
    !(value.weightKgUsed === null || isFiniteNumber(value.weightKgUsed, 20, 300)) ||
    !(value.estimatedCaloriesKcal === null || (Number.isInteger(value.estimatedCaloriesKcal) && Number(value.estimatedCaloriesKcal) >= 0)) ||
    typeof value.memo !== 'string' || value.memo.length > MAX_EXERCISE_MEMO_LENGTH ||
    !isIsoDateTime(value.createdAt) || !isIsoDateTime(value.updatedAt)) return false
  return true
}

function isConditionLevel(value: unknown): value is ConditionLevel {
  return typeof value === 'string' && conditionLevelOptions.some((option) => option.value === value)
}

function isBodyPartCondition(value: unknown): value is BodyPartCondition {
  return typeof value === 'string' && bodyPartConditionOptions.some((option) => option.value === value)
}

function isConditionRecord(value: unknown): value is HootoDayBackupData['conditionRecords'][number] {
  if (!isObject(value) || typeof value.date !== 'string' || !fromDateKey(value.date) ||
    !isConditionLevel(value.overallCondition) || !isBodyPartCondition(value.kneeCondition) || !isBodyPartCondition(value.lowerBackCondition) ||
    typeof value.menstrualNote !== 'string' || value.menstrualNote.length > MAX_CONDITION_SHORT_TEXT_LENGTH ||
    typeof value.concerns !== 'string' || value.concerns.length > MAX_CONDITION_SHORT_TEXT_LENGTH ||
    typeof value.memo !== 'string' || value.memo.length > MAX_CONDITION_MEMO_LENGTH || !isIsoDateTime(value.updatedAt)) return false
  return hasConditionContent({
    overallCondition: value.overallCondition,
    kneeCondition: value.kneeCondition,
    lowerBackCondition: value.lowerBackCondition,
    menstrualNote: value.menstrualNote,
    concerns: value.concerns,
    memo: value.memo,
  })
}

function isDailyAchievement(value: unknown): value is HootoDayBackupData['dailyAchievements'][number] {
  return isObject(value) && typeof value.date === 'string' && Boolean(fromDateKey(value.date)) &&
    typeof value.text === 'string' && value.text.trim().length > 0 && value.text.length <= 120 && !/[\r\n]/.test(value.text) &&
    isIsoDateTime(value.updatedAt)
}

function isMonthlySelection(value: unknown): value is HootoDayBackupData['monthlyAchievementSelections'][number] {
  return isObject(value) && typeof value.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value.month) &&
    typeof value.selectedDate === 'string' && Boolean(fromDateKey(value.selectedDate)) && value.selectedDate.slice(0, 7) === value.month &&
    isIsoDateTime(value.updatedAt)
}

function hasRequiredDataKeys(data: Record<string, unknown>): boolean {
  return ['theme', 'events', 'dayMemos', 'healthProfile', 'weightRecords', 'sleepRecords', 'mealRecords', 'mealTemplates',
    'exerciseSessions', 'conditionRecords', 'dailyAchievements', 'monthlyAchievementSelections']
    .every((key) => Object.prototype.hasOwnProperty.call(data, key))
}

function validateData(value: unknown): value is HootoDayBackupData {
  if (!isObject(value) || !hasRequiredDataKeys(value) || typeof value.theme !== 'string' || !isThemePreference(value.theme) ||
    !Array.isArray(value.events) || !value.events.every(isCalendarEvent) || !hasUniqueValues(value.events, (item: CalendarEvent) => item.id) ||
    !Array.isArray(value.dayMemos) || !value.dayMemos.every(isDayMemo) || !hasUniqueValues(value.dayMemos, (item) => item.date) ||
    !(value.healthProfile === null || isHealthProfile(value.healthProfile)) ||
    !Array.isArray(value.weightRecords) || !value.weightRecords.every(isWeightRecord) || !hasUniqueValues(value.weightRecords, (item) => item.date) ||
    !Array.isArray(value.sleepRecords) || !value.sleepRecords.every(isSleepRecord) || !hasUniqueValues(value.sleepRecords, (item) => item.date) ||
    !Array.isArray(value.mealRecords) || !value.mealRecords.every(isMealRecord) || !hasUniqueValues(value.mealRecords, (item) => item.date) ||
    !Array.isArray(value.mealTemplates) || !value.mealTemplates.every(isMealTemplate) || !hasUniqueValues(value.mealTemplates, (item) => item.id) ||
    !Array.isArray(value.exerciseSessions) || !value.exerciseSessions.every(isExerciseSession) || !hasUniqueValues(value.exerciseSessions, (item) => item.id) ||
    !Array.isArray(value.conditionRecords) || !value.conditionRecords.every(isConditionRecord) || !hasUniqueValues(value.conditionRecords, (item) => item.date) ||
    !Array.isArray(value.dailyAchievements) || !value.dailyAchievements.every(isDailyAchievement) || !hasUniqueValues(value.dailyAchievements, (item) => item.date) ||
    !Array.isArray(value.monthlyAchievementSelections) || !value.monthlyAchievementSelections.every(isMonthlySelection) ||
    !hasUniqueValues(value.monthlyAchievementSelections, (item) => item.month)) return false

  const achievementDates = new Set(value.dailyAchievements.map((item) => item.date))
  if (!value.monthlyAchievementSelections.every((selection) => achievementDates.has(selection.selectedDate))) return false
  const orders = value.mealTemplates.map((item) => item.sortOrder).sort((a, b) => a - b)
  return orders.every((order, index) => order === index)
}

export function createHootoDayBackup(data: HootoDayBackupData, createdAt = new Date().toISOString()): HootoDayBackup {
  return {
    app: 'HootoDay',
    formatVersion: HOOTODAY_BACKUP_FORMAT_VERSION,
    createdAt,
    data: {
      theme: data.theme,
      events: data.events.map((item) => ({ ...item })),
      dayMemos: data.dayMemos.map((item) => ({ ...item })),
      healthProfile: data.healthProfile ? { ...data.healthProfile } : null,
      weightRecords: data.weightRecords.map((item) => ({ ...item })),
      sleepRecords: data.sleepRecords.map((item) => ({ ...item, awakenings: item.awakenings.map((awakening) => ({ ...awakening })) })),
      mealRecords: data.mealRecords.map((item) => ({ ...item })),
      mealTemplates: data.mealTemplates.map((item) => ({ ...item })),
      exerciseSessions: data.exerciseSessions.map((item) => ({ ...item })),
      conditionRecords: data.conditionRecords.map((item) => ({ ...item })),
      dailyAchievements: data.dailyAchievements.map((item) => ({ ...item })),
      monthlyAchievementSelections: data.monthlyAchievementSelections.map((item) => ({ ...item })),
    },
  }
}

export function serializeHootoDayBackup(backup: HootoDayBackup): string {
  return JSON.stringify(backup, null, 2)
}

function localTimestamp(date: Date): string {
  const part = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}_${part(date.getHours())}-${part(date.getMinutes())}-${part(date.getSeconds())}`
}

export function buildBackupFilename(date = new Date(), beforeRestore = false): string {
  return `HootoDay_${beforeRestore ? 'before_restore' : 'backup'}_${localTimestamp(date)}.json`
}

export function downloadBackupJson(content: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function parseHootoDayBackup(content: string): BackupValidationResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return { backup: null, error: 'JSONとして読み込めないバックアップです。' }
  }
  if (!isObject(parsed) || parsed.app !== 'HootoDay') return { backup: null, error: 'HootoDayのバックアップファイルではありません。' }
  if (parsed.formatVersion !== HOOTODAY_BACKUP_FORMAT_VERSION) return { backup: null, error: 'このバックアップ形式には対応していません。' }
  if (!isIsoDateTime(parsed.createdAt) || !validateData(parsed.data)) {
    return { backup: null, error: 'バックアップ内容が不正または不足しています。' }
  }
  return { backup: parsed as unknown as HootoDayBackup, error: null }
}

export function getBackupSummary(backup: HootoDayBackup): BackupSummary {
  return {
    createdAt: backup.createdAt,
    theme: backup.data.theme,
    events: backup.data.events.length,
    dayMemos: backup.data.dayMemos.length,
    hasHealthProfile: backup.data.healthProfile !== null,
    weightRecords: backup.data.weightRecords.length,
    sleepRecords: backup.data.sleepRecords.length,
    mealRecords: backup.data.mealRecords.length,
    mealTemplates: backup.data.mealTemplates.length,
    exerciseSessions: backup.data.exerciseSessions.length,
    conditionRecords: backup.data.conditionRecords.length,
    dailyAchievements: backup.data.dailyAchievements.length,
    monthlyAchievementSelections: backup.data.monthlyAchievementSelections.length,
  }
}

export function buildStorageValues(data: HootoDayBackupData): Record<(typeof BACKUP_STORAGE_KEYS)[number], string> {
  return {
    [THEME_STORAGE_KEY]: data.theme,
    [EVENTS_STORAGE_KEY]: JSON.stringify({ version: EVENTS_STORAGE_VERSION, events: data.events }),
    [DAY_MEMOS_STORAGE_KEY]: JSON.stringify({ version: DAY_MEMOS_STORAGE_VERSION, memos: data.dayMemos }),
    [HEALTH_PROFILE_STORAGE_KEY]: JSON.stringify({ version: HEALTH_PROFILE_STORAGE_VERSION, profile: data.healthProfile }),
    [WEIGHT_RECORDS_STORAGE_KEY]: JSON.stringify({ version: WEIGHT_RECORDS_STORAGE_VERSION, records: data.weightRecords }),
    [SLEEP_RECORDS_STORAGE_KEY]: JSON.stringify({ version: SLEEP_RECORDS_STORAGE_VERSION, records: data.sleepRecords }),
    [MEAL_RECORDS_STORAGE_KEY]: JSON.stringify({ version: MEAL_RECORDS_STORAGE_VERSION, records: data.mealRecords }),
    [MEAL_TEMPLATES_STORAGE_KEY]: JSON.stringify({ version: MEAL_TEMPLATES_STORAGE_VERSION, templates: data.mealTemplates }),
    [EXERCISE_SESSIONS_STORAGE_KEY]: JSON.stringify({ version: EXERCISE_SESSIONS_STORAGE_VERSION, sessions: data.exerciseSessions }),
    [CONDITION_RECORDS_STORAGE_KEY]: JSON.stringify({ version: CONDITION_RECORDS_STORAGE_VERSION, records: data.conditionRecords }),
    [DAILY_ACHIEVEMENTS_STORAGE_KEY]: JSON.stringify({ version: ACHIEVEMENT_STORAGE_VERSION, records: data.dailyAchievements }),
    [MONTHLY_ACHIEVEMENT_SELECTIONS_STORAGE_KEY]: JSON.stringify({ version: ACHIEVEMENT_STORAGE_VERSION, records: data.monthlyAchievementSelections }),
  }
}

export function restoreBackupToStorage(storage: Storage, data: HootoDayBackupData): StorageRestoreResult {
  const previous = new Map<string, string | null>()
  try {
    for (const key of BACKUP_STORAGE_KEYS) previous.set(key, storage.getItem(key))
  } catch {
    return { success: false, rollbackFailed: false }
  }
  const next = buildStorageValues(data)
  try {
    for (const key of BACKUP_STORAGE_KEYS) storage.setItem(key, next[key])
    return { success: true, rollbackFailed: false }
  } catch {
    try {
      for (const key of BACKUP_STORAGE_KEYS) {
        const value = previous.get(key)
        if (value === null || value === undefined) storage.removeItem(key)
        else storage.setItem(key, value)
      }
      return { success: false, rollbackFailed: false }
    } catch {
      return { success: false, rollbackFailed: true }
    }
  }
}

export const backupThemeLabels: Record<ThemePreference, string> = {
  system: '端末設定に合わせる',
  light: 'ライト',
  dark: 'ダーク',
}
