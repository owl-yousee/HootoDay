import type { CalculationSex } from '../types/health'

export const MIN_BIRTH_DATE = '1900-01-01'

export function getLocalTodayKey(): string {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isValidLocalDateKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

export function calculateAge(birthDate: string, today = new Date()): number | null {
  if (!isValidLocalDateKey(birthDate)) return null
  const [year, month, day] = birthDate.split('-').map(Number)
  let age = today.getFullYear() - year
  if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) age -= 1
  return age >= 0 ? age : null
}

export function formatCalculationSex(value: CalculationSex | null): string {
  if (value === 'female') return '女性'
  if (value === 'male') return '男性'
  return '未設定'
}
