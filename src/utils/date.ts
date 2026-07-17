export function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function toMonthKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export function formatMonthKeyJa(monthKey: string): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(monthKey)
  return match ? `${Number(match[1])}年${Number(match[2])}月` : monthKey
}

export function fromDateKey(dateKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, month, day)

  return toDateKey(date) === dateKey ? date : null
}

export function addLocalDays(dateKey: string, amount: number): string | null {
  const date = fromDateKey(dateKey)
  if (!date) return null
  date.setDate(date.getDate() + amount)
  return toDateKey(date)
}

export function addLocalMonths(dateKey: string, amount: number): string | null {
  const date = fromDateKey(dateKey)
  if (!date) return null
  const targetDay = date.getDate()
  date.setDate(1)
  date.setMonth(date.getMonth() + amount)
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(targetDay, lastDay))
  return toDateKey(date)
}

export function addLocalYears(dateKey: string, amount: number): string | null {
  const date = fromDateKey(dateKey)
  if (!date) return null
  const month = date.getMonth()
  const day = date.getDate()
  const targetYear = date.getFullYear() + amount
  const lastDay = new Date(targetYear, month + 1, 0).getDate()
  return toDateKey(new Date(targetYear, month, Math.min(day, lastDay)))
}

export function formatDateKeyJa(dateKey: string): string {
  const date = fromDateKey(dateKey)
  return date ? `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日` : dateKey
}
