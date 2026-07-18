import type { ExerciseType } from '../types/health'

export interface ExerciseTypeOption {
  value: ExerciseType
  label: string
  defaultMets: number
  defaultDurationMinutes: number | null
}

export const exerciseTypeOptions: ExerciseTypeOption[] = [
  { value: 'treadmill', label: 'ルームランナー', defaultMets: 3.5, defaultDurationMinutes: null },
  { value: 'exerciseBike', label: 'エアバイク', defaultMets: 5, defaultDurationMinutes: null },
  { value: 'beatSaber', label: 'ビートセイバー', defaultMets: 5, defaultDurationMinutes: null },
  { value: 'aeonShopping', label: 'イオンでお買い物', defaultMets: 2.8, defaultDurationMinutes: 60 },
  { value: 'stretching', label: 'ストレッチ', defaultMets: 2.3, defaultDurationMinutes: null },
  { value: 'other', label: 'その他', defaultMets: 3, defaultDurationMinutes: null },
]

export function getExerciseTypeOption(type: ExerciseType): ExerciseTypeOption {
  return exerciseTypeOptions.find((option) => option.value === type) ?? exerciseTypeOptions[0]
}

export function getExerciseDisplayName(type: ExerciseType, customName: string): string {
  return type === 'other' ? customName : getExerciseTypeOption(type).label
}
