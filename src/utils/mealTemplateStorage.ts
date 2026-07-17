import type { MealTemplate, MealType } from '../types/health'

export const MEAL_TEMPLATES_STORAGE_KEY = 'hootoDay.mealTemplates'
export const MEAL_TEMPLATES_STORAGE_VERSION = 1
export const MAX_MEAL_TEMPLATE_NAME_LENGTH = 50
export const MAX_MEAL_TEMPLATE_CONTENT_LENGTH = 1000

const mealTypes: MealType[] = ['breakfast', 'lunch', 'dinner', 'snacks', 'any']

export const mealTypeLabels: Record<MealType, string> = {
  breakfast: '朝食', lunch: '昼食', dinner: '夕食', snacks: '間食', any: 'どこでも使用',
}

export function normalizeMealTemplateText(value: string) {
  return value.trim()
}

function isValidDateTime(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Date.parse(value))
}

function parseTemplate(value: unknown): MealTemplate | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const name = typeof candidate.name === 'string' ? normalizeMealTemplateText(candidate.name) : ''
  const content = typeof candidate.content === 'string' ? normalizeMealTemplateText(candidate.content) : ''
  if (
    typeof candidate.id !== 'string' || candidate.id.trim() === '' ||
    name.length < 1 || name.length > MAX_MEAL_TEMPLATE_NAME_LENGTH ||
    typeof candidate.mealType !== 'string' || !mealTypes.includes(candidate.mealType as MealType) ||
    content.length < 1 || content.length > MAX_MEAL_TEMPLATE_CONTENT_LENGTH ||
    typeof candidate.sortOrder !== 'number' || !Number.isInteger(candidate.sortOrder) || candidate.sortOrder < 0 ||
    !isValidDateTime(candidate.createdAt) || !isValidDateTime(candidate.updatedAt)
  ) return null

  return {
    id: candidate.id.trim(), name, mealType: candidate.mealType as MealType, content,
    sortOrder: candidate.sortOrder, createdAt: candidate.createdAt, updatedAt: candidate.updatedAt,
  }
}

function normalizeTemplates(templates: MealTemplate[]) {
  const unique = new Map<string, { template: MealTemplate; index: number }>()
  templates.forEach((template, index) => {
    const current = unique.get(template.id)
    if (!current || Date.parse(template.updatedAt) >= Date.parse(current.template.updatedAt)) {
      unique.set(template.id, { template, index })
    }
  })
  return [...unique.values()]
    .sort((a, b) => a.template.sortOrder - b.template.sortOrder || a.index - b.index)
    .map(({ template }, sortOrder) => ({ ...template, sortOrder }))
}

export function loadStoredMealTemplates(): MealTemplate[] {
  try {
    const raw = localStorage.getItem(MEAL_TEMPLATES_STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return []
    const wrapper = parsed as Record<string, unknown>
    if (wrapper.version !== MEAL_TEMPLATES_STORAGE_VERSION || !Array.isArray(wrapper.templates)) return []
    return normalizeTemplates(wrapper.templates.map(parseTemplate).filter((item): item is MealTemplate => item !== null))
  } catch {
    console.warn('食事定型メニューの読み込みに失敗しました。')
    return []
  }
}

export function saveStoredMealTemplates(templates: MealTemplate[]) {
  try {
    localStorage.setItem(MEAL_TEMPLATES_STORAGE_KEY, JSON.stringify({
      version: MEAL_TEMPLATES_STORAGE_VERSION,
      templates: normalizeTemplates(templates),
    }))
  } catch {
    console.warn('食事定型メニューの保存に失敗しました。')
  }
}
