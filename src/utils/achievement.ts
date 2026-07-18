export const DAILY_ACHIEVEMENT_MAX_LENGTH = 30

export function normalizeDailyAchievementText(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim()
}

export function isValidDailyAchievementInput(text: string): boolean {
  const normalized = normalizeDailyAchievementText(text)
  return normalized.length > 0 && normalized.length <= DAILY_ACHIEVEMENT_MAX_LENGTH
}
