import { getExerciseDisplayName, getExerciseTypeOption } from '../data/exerciseTypes'
import type { ExerciseSession, ExerciseType } from '../types/health'

export interface ExerciseHistoryGroup {
  groupId: string
  date: string
  exerciseType: ExerciseType
  label: string
  records: ExerciseSession[]
  count: number
  totalDurationMinutes: number
  totalEstimatedCaloriesKcal: number | null
  calculatedCaloriesCount: number
}

export interface ExerciseHistoryDateGroup {
  date: string
  groups: ExerciseHistoryGroup[]
}

export function groupExerciseSessionsByDateAndType(
  sessions: ExerciseSession[],
): ExerciseHistoryDateGroup[] {
  const dateGroups = new Map<string, Map<ExerciseType, ExerciseSession[]>>()

  sessions.forEach((session) => {
    const typeGroups = dateGroups.get(session.date) ?? new Map<ExerciseType, ExerciseSession[]>()
    const records = typeGroups.get(session.exerciseType) ?? []
    typeGroups.set(session.exerciseType, [...records, session])
    dateGroups.set(session.date, typeGroups)
  })

  return [...dateGroups.entries()].map(([date, typeGroups]) => ({
    date,
    groups: [...typeGroups.entries()].map(([exerciseType, records]) => {
      const calorieRecords = records.filter((record) => record.estimatedCaloriesKcal !== null)
      return {
        groupId: `${date}::${exerciseType}`,
        date,
        exerciseType,
        label: records.length === 1
          ? getExerciseDisplayName(exerciseType, records[0].customName)
          : getExerciseTypeOption(exerciseType).label,
        records,
        count: records.length,
        totalDurationMinutes: records.reduce((total, record) => total + record.durationMinutes, 0),
        totalEstimatedCaloriesKcal: calorieRecords.length === 0
          ? null
          : calorieRecords.reduce((total, record) => total + (record.estimatedCaloriesKcal ?? 0), 0),
        calculatedCaloriesCount: calorieRecords.length,
      }
    }),
  }))
}
