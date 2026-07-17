import { useEffect, useState } from 'react'
import type { DayMemo } from '../types/dayMemo'
import { loadStoredDayMemos, saveStoredDayMemos } from '../utils/dayMemoStorage'

export function useDayMemos() {
  const [dayMemos, setDayMemos] = useState<DayMemo[]>(loadStoredDayMemos)

  useEffect(() => {
    saveStoredDayMemos(dayMemos)
  }, [dayMemos])

  const saveDayMemo = (memo: DayMemo) => {
    setDayMemos((current) => {
      const exists = current.some((item) => item.date === memo.date)
      return exists
        ? current.map((item) => (item.date === memo.date ? memo : item))
        : [...current, memo]
    })
  }

  const deleteDayMemo = (date: string) => {
    setDayMemos((current) => current.filter((memo) => memo.date !== date))
  }

  return { dayMemos, saveDayMemo, deleteDayMemo }
}
