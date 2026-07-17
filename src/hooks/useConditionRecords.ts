import { useEffect, useState } from 'react'
import type { DailyConditionRecord } from '../types/health'
import { loadStoredConditionRecords, saveStoredConditionRecords } from '../utils/conditionStorage'

export function useConditionRecords() {
  const [conditionRecords, setConditionRecords] = useState<DailyConditionRecord[]>(loadStoredConditionRecords)

  useEffect(() => { saveStoredConditionRecords(conditionRecords) }, [conditionRecords])

  const saveConditionRecord = (record: DailyConditionRecord) => {
    setConditionRecords((current) => current.some((item) => item.date === record.date)
      ? current.map((item) => item.date === record.date ? record : item)
      : [...current, record])
  }

  const deleteConditionRecord = (date: string) => {
    setConditionRecords((current) => current.filter((record) => record.date !== date))
  }

  return { conditionRecords, saveConditionRecord, deleteConditionRecord }
}
