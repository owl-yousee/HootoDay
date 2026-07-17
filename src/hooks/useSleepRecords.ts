import { useEffect, useState } from 'react'
import type { SleepRecord } from '../types/health'
import { loadStoredSleepRecords, saveStoredSleepRecords } from '../utils/sleepStorage'

export function useSleepRecords() {
  const [sleepRecords, setSleepRecords] = useState<SleepRecord[]>(loadStoredSleepRecords)

  useEffect(() => {
    saveStoredSleepRecords(sleepRecords)
  }, [sleepRecords])

  const saveSleepRecord = (record: SleepRecord) => {
    setSleepRecords((current) => current.some((item) => item.date === record.date)
      ? current.map((item) => item.date === record.date ? record : item)
      : [...current, record])
  }

  const deleteSleepRecord = (date: string) => {
    setSleepRecords((current) => current.filter((record) => record.date !== date))
  }

  return { sleepRecords, saveSleepRecord, deleteSleepRecord }
}
