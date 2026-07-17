import type { AppliedTheme, ThemePreference } from '../types/theme'

export const THEME_STORAGE_KEY = 'hootoDay.theme'
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system'
export const DARK_MODE_QUERY = '(prefers-color-scheme: dark)'

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function readThemePreference(): ThemePreference {
  try {
    const savedValue = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(savedValue) ? savedValue : DEFAULT_THEME_PREFERENCE
  } catch {
    return DEFAULT_THEME_PREFERENCE
  }
}

export function resolveTheme(
  preference: ThemePreference,
  systemUsesDark: boolean,
): AppliedTheme {
  if (preference === 'system') {
    return systemUsesDark ? 'dark' : 'light'
  }

  return preference
}
