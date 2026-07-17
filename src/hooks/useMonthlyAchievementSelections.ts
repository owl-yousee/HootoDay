import { useEffect, useState } from 'react'
import type { MonthlyAchievementSelection } from '../types/achievement'
import {
  loadStoredMonthlyAchievementSelections,
  saveStoredMonthlyAchievementSelections,
} from '../utils/achievementStorage'

export function useMonthlyAchievementSelections() {
  const [monthlyAchievementSelections, setMonthlyAchievementSelections] = useState<MonthlyAchievementSelection[]>(loadStoredMonthlyAchievementSelections)

  useEffect(() => { saveStoredMonthlyAchievementSelections(monthlyAchievementSelections) }, [monthlyAchievementSelections])

  const saveMonthlyAchievementSelection = (selection: MonthlyAchievementSelection) => {
    setMonthlyAchievementSelections((current) => current.some((item) => item.month === selection.month)
      ? current.map((item) => item.month === selection.month ? selection : item)
      : [...current, selection])
  }

  const deleteMonthlyAchievementSelection = (month: string) => {
    setMonthlyAchievementSelections((current) => current.filter((selection) => selection.month !== month))
  }

  return {
    monthlyAchievementSelections,
    saveMonthlyAchievementSelection,
    deleteMonthlyAchievementSelection,
    replaceMonthlyAchievementSelections: setMonthlyAchievementSelections,
  }
}
