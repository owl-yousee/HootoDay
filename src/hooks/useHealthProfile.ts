import { useEffect, useState } from 'react'
import type { HealthProfile } from '../types/health'
import { loadStoredHealthProfile, saveStoredHealthProfile } from '../utils/healthProfileStorage'

export function useHealthProfile() {
  const [healthProfile, setHealthProfile] = useState<HealthProfile | null>(loadStoredHealthProfile)

  useEffect(() => {
    saveStoredHealthProfile(healthProfile)
  }, [healthProfile])

  return {
    healthProfile,
    saveHealthProfile: setHealthProfile,
    deleteHealthProfile: () => setHealthProfile(null),
  }
}
