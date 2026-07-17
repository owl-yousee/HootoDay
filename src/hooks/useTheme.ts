import { useEffect, useState } from 'react'
import type { AppliedTheme, ThemePreference } from '../types/theme'
import {
  DARK_MODE_QUERY,
  readThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
} from '../utils/theme'

interface UseThemeResult {
  preference: ThemePreference
  appliedTheme: AppliedTheme
  setPreference: (preference: ThemePreference) => void
  replaceThemePreference: (preference: ThemePreference) => void
}

function getSystemUsesDark(): boolean {
  return window.matchMedia(DARK_MODE_QUERY).matches
}

export function useTheme(): UseThemeResult {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference)
  const [systemUsesDark, setSystemUsesDark] = useState(getSystemUsesDark)
  const appliedTheme = resolveTheme(preference, systemUsesDark)

  useEffect(() => {
    document.documentElement.dataset.theme = appliedTheme
    document.documentElement.style.colorScheme = appliedTheme

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference)
    } catch {
      // Storageが利用できない環境でも、現在のタブではテーマを適用する。
    }
  }, [appliedTheme, preference])

  useEffect(() => {
    if (preference !== 'system') {
      return undefined
    }

    const mediaQuery = window.matchMedia(DARK_MODE_QUERY)
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemUsesDark(event.matches)
    }

    setSystemUsesDark(mediaQuery.matches)
    mediaQuery.addEventListener('change', handleChange)

    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [preference])

  return { preference, appliedTheme, setPreference, replaceThemePreference: setPreference }
}
