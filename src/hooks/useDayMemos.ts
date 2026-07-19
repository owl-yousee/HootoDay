import { useCallback, useEffect, useRef, useState } from 'react'
import type { DayMemo } from '../types/dayMemo'
import { loadStoredDayMemos, saveStoredDayMemos } from '../utils/dayMemoStorage'

export function useDayMemos() {
  const [dayMemos, setDayMemos] = useState<DayMemo[]>(loadStoredDayMemos)
  const skipNextAutomaticSave = useRef(false)

  useEffect(() => {
    if (skipNextAutomaticSave.current) {
      skipNextAutomaticSave.current = false
      return
    }
    saveStoredDayMemos(dayMemos)
  }, [dayMemos])

  const adoptVerifiedStoredDayMemos = useCallback((memos: DayMemo[]) => {
    skipNextAutomaticSave.current = true
    setDayMemos(memos.map((memo) => ({ ...memo })))
  }, [])

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

  return { dayMemos, saveDayMemo, deleteDayMemo, replaceDayMemos: setDayMemos, adoptVerifiedStoredDayMemos }
}
