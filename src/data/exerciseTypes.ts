import type { ExerciseType } from '../types/health'

export interface ExerciseTypeOption {
  value: ExerciseType
  label: string
  defaultMets: number
}

export const exerciseTypeOptions: ExerciseTypeOption[] = [
  { value: 'treadmill', label: 'ルームランナー', defaultMets: 3.5 },
  { value: 'exerciseBike', label: 'エアバイク', defaultMets: 5 },
  { value: 'beatSaber', label: 'ビートセイバー', defaultMets: 5 },
  { value: 'stretching', label: 'ストレッチ', defaultMets: 2.3 },
  { value: 'other', label: 'その他', defaultMets: 3 },
]

export function getExerciseTypeOption(type: ExerciseType): ExerciseTypeOption {
  return exerciseTypeOptions.find((option) => option.value === type) ?? exerciseTypeOptions[0]
}

export function getExerciseDisplayName(type: ExerciseType, customName: string): string {
  return type === 'other' ? customName : getExerciseTypeOption(type).label
}
