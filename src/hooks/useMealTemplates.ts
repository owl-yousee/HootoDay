import { useEffect, useState } from 'react'
import type { MealTemplate } from '../types/health'
import { loadStoredMealTemplates, saveStoredMealTemplates } from '../utils/mealTemplateStorage'

function normalizeOrder(templates: MealTemplate[]) {
  return templates.map((template, sortOrder) => ({ ...template, sortOrder }))
}

export function useMealTemplates() {
  const [mealTemplates, setMealTemplates] = useState<MealTemplate[]>(loadStoredMealTemplates)

  useEffect(() => { saveStoredMealTemplates(mealTemplates) }, [mealTemplates])

  const saveMealTemplate = (template: MealTemplate) => {
    setMealTemplates((current) => {
      const index = current.findIndex((item) => item.id === template.id)
      if (index < 0) return normalizeOrder([...current, { ...template, sortOrder: current.length }])
      return current.map((item) => item.id === template.id ? { ...template, sortOrder: item.sortOrder, createdAt: item.createdAt } : item)
    })
  }

  const deleteMealTemplate = (id: string) => {
    setMealTemplates((current) => normalizeOrder(current.filter((item) => item.id !== id)))
  }

  const moveMealTemplate = (id: string, direction: -1 | 1) => {
    setMealTemplates((current) => {
      const index = current.findIndex((item) => item.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return normalizeOrder(next)
    })
  }

  return { mealTemplates, saveMealTemplate, deleteMealTemplate, moveMealTemplate, replaceMealTemplates: setMealTemplates }
}
