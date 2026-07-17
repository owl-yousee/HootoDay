import type { BodyPartCondition, ConditionLevel } from '../types/health'

export const conditionLevelOptions: Array<{ value: ConditionLevel; label: string }> = [
  { value: 'unset', label: '未設定' },
  { value: 'good', label: '良い' },
  { value: 'normal', label: '普通' },
  { value: 'poor', label: '悪い' },
]

export const bodyPartConditionOptions: Array<{ value: BodyPartCondition; label: string }> = [
  { value: 'unset', label: '未設定' },
  { value: 'none', label: '問題なし' },
  { value: 'mild', label: '少し気になる' },
  { value: 'painful', label: '痛い' },
  { value: 'severe', label: '強く痛い' },
]

export const conditionLevelLabels: Record<ConditionLevel, string> = Object.fromEntries(
  conditionLevelOptions.map((option) => [option.value, option.label]),
) as Record<ConditionLevel, string>

export const bodyPartConditionLabels: Record<BodyPartCondition, string> = Object.fromEntries(
  bodyPartConditionOptions.map((option) => [option.value, option.label]),
) as Record<BodyPartCondition, string>

export function getConditionTone(value: ConditionLevel | BodyPartCondition): 'positive' | 'neutral' | 'caution' | 'danger' {
  if (value === 'good' || value === 'none') return 'positive'
  if (value === 'mild') return 'caution'
  if (value === 'poor' || value === 'painful' || value === 'severe') return 'danger'
  return 'neutral'
}
