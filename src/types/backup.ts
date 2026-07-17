import type { DailyAchievement, MonthlyAchievementSelection } from './achievement'
import type { CalendarEvent } from './calendar'
import type { DayMemo } from './dayMemo'
import type {
  DailyConditionRecord,
  ExerciseSession,
  HealthProfile,
  MealRecord,
  MealTemplate,
  SleepRecord,
  WeightRecord,
} from './health'
import type { ThemePreference } from './theme'

export interface HootoDayBackupData {
  theme: ThemePreference
  events: CalendarEvent[]
  dayMemos: DayMemo[]
  healthProfile: HealthProfile | null
  weightRecords: WeightRecord[]
  sleepRecords: SleepRecord[]
  mealRecords: MealRecord[]
  mealTemplates: MealTemplate[]
  exerciseSessions: ExerciseSession[]
  conditionRecords: DailyConditionRecord[]
  dailyAchievements: DailyAchievement[]
  monthlyAchievementSelections: MonthlyAchievementSelection[]
}

export interface HootoDayBackup {
  app: 'HootoDay'
  formatVersion: 1
  createdAt: string
  data: HootoDayBackupData
}

export interface BackupSummary {
  createdAt: string
  theme: ThemePreference
  events: number
  dayMemos: number
  hasHealthProfile: boolean
  weightRecords: number
  sleepRecords: number
  mealRecords: number
  mealTemplates: number
  exerciseSessions: number
  conditionRecords: number
  dailyAchievements: number
  monthlyAchievementSelections: number
}

export interface BackupValidationResult {
  backup: HootoDayBackup | null
  error: string | null
}
