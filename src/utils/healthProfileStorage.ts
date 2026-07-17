import type { HealthProfile } from '../types/health'
import { getLocalTodayKey, isValidLocalDateKey, MIN_BIRTH_DATE } from './healthProfile'

export const HEALTH_PROFILE_STORAGE_KEY = 'hootoDay.healthProfile'
export const HEALTH_PROFILE_STORAGE_VERSION = 1
export const MIN_HEIGHT_CM = 50
export const MAX_HEIGHT_CM = 250
export const MIN_TARGET_WEIGHT_KG = 20
export const MAX_TARGET_WEIGHT_KG = 300

interface HealthProfileStorageData {
  version: typeof HEALTH_PROFILE_STORAGE_VERSION
  profile: HealthProfile | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeHealthNumber(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10
}

function isNullableNumberInRange(value: unknown, min: number, max: number): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max)
}

function isHealthProfile(value: unknown): value is HealthProfile {
  if (!isRecord(value)) return false
  const birthDateIsValid = value.birthDate === null || (
    typeof value.birthDate === 'string' &&
    isValidLocalDateKey(value.birthDate) &&
    value.birthDate >= MIN_BIRTH_DATE &&
    value.birthDate <= getLocalTodayKey()
  )
  return isNullableNumberInRange(value.heightCm, MIN_HEIGHT_CM, MAX_HEIGHT_CM) &&
    birthDateIsValid &&
    (value.calculationSex === null || value.calculationSex === 'female' || value.calculationSex === 'male') &&
    isNullableNumberInRange(value.targetWeightKg, MIN_TARGET_WEIGHT_KG, MAX_TARGET_WEIGHT_KG) &&
    typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt))
}

function normalizeProfile(profile: HealthProfile): HealthProfile {
  return {
    ...profile,
    heightCm: profile.heightCm === null ? null : normalizeHealthNumber(profile.heightCm),
    targetWeightKg: profile.targetWeightKg === null ? null : normalizeHealthNumber(profile.targetWeightKg),
  }
}

export function loadStoredHealthProfile(): HealthProfile | null {
  try {
    const rawValue = window.localStorage.getItem(HEALTH_PROFILE_STORAGE_KEY)
    if (rawValue === null) return null
    const parsed: unknown = JSON.parse(rawValue)
    if (!isRecord(parsed) || parsed.version !== HEALTH_PROFILE_STORAGE_VERSION) return null
    if (parsed.profile === null) return null
    return isHealthProfile(parsed.profile) ? normalizeProfile(parsed.profile) : null
  } catch {
    console.warn('健康プロフィールの保存領域を読み込めませんでした。画面上の操作は継続します。')
    return null
  }
}

export function saveStoredHealthProfile(profile: HealthProfile | null): void {
  const data: HealthProfileStorageData = { version: HEALTH_PROFILE_STORAGE_VERSION, profile }
  try {
    window.localStorage.setItem(HEALTH_PROFILE_STORAGE_KEY, JSON.stringify(data))
  } catch {
    console.warn('健康プロフィールを保存できませんでした。画面上の操作は継続します。')
  }
}
