import { useEffect, useState } from 'react'
import type { DailyAchievement } from '../types/achievement'
import { isValidDailyAchievementInput, normalizeDailyAchievementText } from '../utils/achievement'
import { loadStoredDailyAchievements, saveStoredDailyAchievements } from '../utils/achievementStorage'

export function useDailyAchievements() {
  const [dailyAchievements, setDailyAchievements] = useState<DailyAchievement[]>(loadStoredDailyAchievements)

  useEffect(() => { saveStoredDailyAchievements(dailyAchievements) }, [dailyAchievements])

  const saveDailyAchievement = (record: DailyAchievement) => {
    if (!isValidDailyAchievementInput(record.text)) return false
    const normalizedRecord = { ...record, text: normalizeDailyAchievementText(record.text) }
    setDailyAchievements((current) => current.some((item) => item.date === record.date)
      ? current.map((item) => item.date === record.date ? normalizedRecord : item)
      : [...current, normalizedRecord])
    return true
  }

  const deleteDailyAchievement = (date: string) => {
    setDailyAchievements((current) => current.filter((record) => record.date !== date))
  }

  return { dailyAchievements, saveDailyAchievement, deleteDailyAchievement, replaceDailyAchievements: setDailyAchievements }
}
