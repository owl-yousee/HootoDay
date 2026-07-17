import type { DailyAchievement, MonthlyAchievementSelection } from './achievement'
import type { DayMemo } from './dayMemo'
import type {
  DailyConditionRecord,
  ExerciseSession,
  MealRecord,
  SleepRecord,
  WeightRecord,
} from './health'

export type HealthExportFormat = 'txt' | 'markdown'

export type HealthExportPeriod = 'day' | 'week' | 'halfMonth' | 'month' | 'custom'

export interface HealthExportData {
  dayMemos: DayMemo[]
  dailyAchievements: DailyAchievement[]
  monthlyAchievementSelections: MonthlyAchievementSelection[]
  weightRecords: WeightRecord[]
  sleepRecords: SleepRecord[]
  mealRecords: MealRecord[]
  exerciseSessions: ExerciseSession[]
  conditionRecords: DailyConditionRecord[]
}

export interface HealthExportDateRange {
  startDate: string
  endDate: string
}

export interface DailyHealthExportRecord {
  date: string
  dayMemo: DayMemo | null
  achievement: DailyAchievement | null
  weight: WeightRecord | null
  sleep: SleepRecord | null
  meal: MealRecord | null
  exercises: ExerciseSession[]
  condition: DailyConditionRecord | null
}

export interface MonthlyBestExportRecord {
  month: string
  selectedDate: string
  text: string
}
