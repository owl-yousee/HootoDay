import { useEffect, useState } from 'react'
import type { WeightRecord } from '../types/health'
import { loadStoredWeightRecords, saveStoredWeightRecords } from '../utils/weightStorage'

export function useWeightRecords() {
  const [weightRecords, setWeightRecords] = useState<WeightRecord[]>(loadStoredWeightRecords)

  useEffect(() => {
    saveStoredWeightRecords(weightRecords)
  }, [weightRecords])

  const saveWeightRecord = (record: WeightRecord) => {
    setWeightRecords((current) => {
      const exists = current.some((item) => item.date === record.date)
      return exists
        ? current.map((item) => (item.date === record.date ? record : item))
        : [...current, record]
    })
  }

  const deleteWeightRecord = (date: string) => {
    setWeightRecords((current) => current.filter((record) => record.date !== date))
  }

  return { weightRecords, saveWeightRecord, deleteWeightRecord, replaceWeightRecords: setWeightRecords }
}
