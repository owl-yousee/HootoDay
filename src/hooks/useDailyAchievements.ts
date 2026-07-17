import { useEffect, useState } from 'react'
import type { DailyAchievement } from '../types/achievement'
import { loadStoredDailyAchievements, saveStoredDailyAchievements } from '../utils/achievementStorage'

export function useDailyAchievements() {
  const [dailyAchievements, setDailyAchievements] = useState<DailyAchievement[]>(loadStoredDailyAchievements)

  useEffect(() => { saveStoredDailyAchievements(dailyAchievements) }, [dailyAchievements])

  const saveDailyAchievement = (record: DailyAchievement) => {
    setDailyAchievements((current) => current.some((item) => item.date === record.date)
      ? current.map((item) => item.date === record.date ? record : item)
      : [...current, record])
  }

  const deleteDailyAchievement = (date: string) => {
    setDailyAchievements((current) => current.filter((record) => record.date !== date))
  }

  return { dailyAchievements, saveDailyAchievement, deleteDailyAchievement, replaceDailyAchievements: setDailyAchievements }
}
