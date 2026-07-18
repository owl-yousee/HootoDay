import type { HootoDayBackupData } from '../types/backup'
import { BACKUP_STORAGE_KEYS, buildStorageValues, type StorageRestoreResult } from './jsonBackup'
import { THEME_STORAGE_KEY } from './theme'

type BackupStorageKey = (typeof BACKUP_STORAGE_KEYS)[number]
type FullResetStorageKey = Exclude<BackupStorageKey, typeof THEME_STORAGE_KEY>

export const FULL_DATA_RESET_STORAGE_KEYS = BACKUP_STORAGE_KEYS.filter(
  (key): key is FullResetStorageKey => key !== THEME_STORAGE_KEY,
)

export function createEmptyBackupData(theme: HootoDayBackupData['theme']): HootoDayBackupData {
  return {
    theme,
    events: [],
    dayMemos: [],
    healthProfile: null,
    weightRecords: [],
    sleepRecords: [],
    mealRecords: [],
    mealTemplates: [],
    exerciseSessions: [],
    conditionRecords: [],
    dailyAchievements: [],
    monthlyAchievementSelections: [],
    products: [],
    inventoryMovements: [],
    eventSalesRecords: [],
    boothSalesRecords: [],
  }
}

export function resetHootoDayDataStorage(
  storage: Storage,
  theme: HootoDayBackupData['theme'],
): StorageRestoreResult {
  const previous = new Map<FullResetStorageKey, string | null>()

  try {
    for (const key of FULL_DATA_RESET_STORAGE_KEYS) previous.set(key, storage.getItem(key))
  } catch {
    return { success: false, rollbackFailed: false }
  }

  const emptyValues = buildStorageValues(createEmptyBackupData(theme))

  try {
    for (const key of FULL_DATA_RESET_STORAGE_KEYS) storage.setItem(key, emptyValues[key])
    return { success: true, rollbackFailed: false }
  } catch {
    try {
      for (const key of FULL_DATA_RESET_STORAGE_KEYS) {
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
