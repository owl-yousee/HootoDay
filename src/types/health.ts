export interface WeightRecord {
  date: string
  weightKg: number
  memo: string
  updatedAt: string
}

export type CalculationSex = 'female' | 'male'

export interface HealthProfile {
  heightCm: number | null
  birthDate: string | null
  calculationSex: CalculationSex | null
  targetWeightKg: number | null
  updatedAt: string
}

export type SleepAwakening =
  | {
      id: string
      mode: 'point'
      startTime: string
      endTime: null
      estimatedMinutes: number
    }
  | {
      id: string
      mode: 'range'
      startTime: string
      endTime: string
      estimatedMinutes: null
    }

export interface SleepRecord {
  date: string
  bedtime: string
  wakeTime: string
  awakenings: SleepAwakening[]
  totalInBedMinutes: number
  awakeMinutes: number
  sleepMinutes: number
  memo: string
  updatedAt: string
}

export interface MealRecord {
  date: string
  breakfast: string
  lunch: string
  dinner: string
  snacks: string
  updatedAt: string
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snacks' | 'any'

export interface MealTemplate {
  id: string
  name: string
  mealType: MealType
  content: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type ExerciseType =
  | 'treadmill'
  | 'exerciseBike'
  | 'beatSaber'
  | 'stretching'
  | 'other'

export interface ExerciseSession {
  id: string
  date: string
  exerciseType: ExerciseType
  customName: string
  durationMinutes: number
  averageHeartRate: number | null
  mets: number
  weightKgUsed: number | null
  estimatedCaloriesKcal: number | null
  memo: string
  createdAt: string
  updatedAt: string
}

export type ConditionLevel = 'good' | 'normal' | 'poor' | 'unset'

export type BodyPartCondition = 'none' | 'mild' | 'painful' | 'severe' | 'unset'

export interface DailyConditionRecord {
  date: string
  overallCondition: ConditionLevel
  kneeCondition: BodyPartCondition
  lowerBackCondition: BodyPartCondition
  menstrualNote: string
  concerns: string
  memo: string
  updatedAt: string
}
