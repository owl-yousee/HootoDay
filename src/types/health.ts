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
