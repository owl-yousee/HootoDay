import { useEffect, useState } from 'react'
import type { ExerciseSession } from '../types/health'
import { loadStoredExerciseSessions, saveStoredExerciseSessions } from '../utils/exerciseStorage'

export function useExerciseSessions() {
  const [exerciseSessions, setExerciseSessions] = useState<ExerciseSession[]>(loadStoredExerciseSessions)

  useEffect(() => { saveStoredExerciseSessions(exerciseSessions) }, [exerciseSessions])

  const saveExerciseSession = (session: ExerciseSession) => {
    setExerciseSessions((current) => {
      const exists = current.some((item) => item.id === session.id)
      return exists
        ? current.map((item) => item.id === session.id ? session : item)
        : [...current, session]
    })
  }

  const deleteExerciseSession = (id: string) => {
    setExerciseSessions((current) => current.filter((session) => session.id !== id))
  }

  return { exerciseSessions, saveExerciseSession, deleteExerciseSession }
}
