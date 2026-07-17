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
