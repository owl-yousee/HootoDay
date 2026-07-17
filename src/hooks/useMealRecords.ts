import { useEffect, useState } from 'react'
import type { MealRecord } from '../types/health'
import { loadStoredMealRecords, saveStoredMealRecords } from '../utils/mealStorage'

export function useMealRecords() {
  const [mealRecords, setMealRecords] = useState<MealRecord[]>(loadStoredMealRecords)

  useEffect(() => {
    saveStoredMealRecords(mealRecords)
  }, [mealRecords])

  const saveMealRecord = (record: MealRecord) => {
    setMealRecords((current) => current.some((item) => item.date === record.date)
      ? current.map((item) => item.date === record.date ? record : item)
      : [...current, record])
  }

  const deleteMealRecord = (date: string) => {
    setMealRecords((current) => current.filter((record) => record.date !== date))
  }

  return { mealRecords, saveMealRecord, deleteMealRecord }
}
