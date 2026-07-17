import type { SleepAwakening } from '../types/health'

export const MIN_SLEEP_WINDOW_MINUTES = 30
export const MAX_SLEEP_WINDOW_MINUTES = 18 * 60
export const MIN_POINT_AWAKENING_MINUTES = 5
export const MAX_POINT_AWAKENING_MINUTES = 180
export const DEFAULT_POINT_AWAKENING_MINUTES = 15

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/

export interface SleepSummary {
  totalInBedMinutes: number
  awakeMinutes: number
  sleepMinutes: number
}

export interface SleepCalculation {
  summary: SleepSummary | null
  error: string | null
}

interface NormalizedAwakening {
  mode: SleepAwakening['mode']
  start: number
  end: number | null
  minutes: number
}

export function isValidTime(value: string): boolean {
  return timePattern.test(value)
}

export function timeToMinutes(value: string): number | null {
  const match = timePattern.exec(value)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

export function calculateDurationAcrossMidnight(startTime: string, endTime: string): number | null {
  const start = timeToMinutes(startTime)
  const end = timeToMinutes(endTime)
  if (start === null || end === null || start === end) return null
  return end > start ? end - start : end + 1440 - start
}

export function normalizeTimeForSleepWindow(time: string, bedtime: string): number | null {
  const value = timeToMinutes(time)
  const base = timeToMinutes(bedtime)
  if (value === null || base === null) return null
  return value < base ? value + 1440 : value
}

function normalizeAwakening(awakening: SleepAwakening, bedtime: string): NormalizedAwakening | null {
  const start = normalizeTimeForSleepWindow(awakening.startTime, bedtime)
  if (start === null) return null
  if (awakening.mode === 'point') {
    return { mode: 'point', start, end: null, minutes: awakening.estimatedMinutes }
  }
  let end = normalizeTimeForSleepWindow(awakening.endTime, bedtime)
  if (end === null || awakening.startTime === awakening.endTime) return null
  if (end <= start) end += 1440
  return { mode: 'range', start, end, minutes: end - start }
}

export function calculateAwakeningMinutes(awakening: SleepAwakening): number | null {
  if (awakening.mode === 'point') return awakening.estimatedMinutes
  return calculateDurationAcrossMidnight(awakening.startTime, awakening.endTime)
}

export function calculateSleepSummary(
  bedtime: string,
  wakeTime: string,
  awakenings: SleepAwakening[],
): SleepCalculation {
  if (!isValidTime(bedtime) || !isValidTime(wakeTime)) {
    return { summary: null, error: '就寝時刻と起床時刻を入力してください。' }
  }
  if (bedtime === wakeTime) {
    return { summary: null, error: '就寝時刻と起床時刻を同じ時刻にはできません。' }
  }
  const totalInBedMinutes = calculateDurationAcrossMidnight(bedtime, wakeTime)
  const bedtimeMinutes = timeToMinutes(bedtime)
  if (totalInBedMinutes === null || bedtimeMinutes === null) {
    return { summary: null, error: '就寝・起床時刻を計算できません。' }
  }
  if (totalInBedMinutes < MIN_SLEEP_WINDOW_MINUTES) {
    return { summary: null, error: '総就床時間は30分以上にしてください。' }
  }
  if (totalInBedMinutes > MAX_SLEEP_WINDOW_MINUTES) {
    return { summary: null, error: '総就床時間は18時間以下にしてください。' }
  }
  const wakeAbsolute = bedtimeMinutes + totalInBedMinutes
  const normalized: NormalizedAwakening[] = []

  for (const awakening of awakenings) {
    if (!isValidTime(awakening.startTime)) {
      return { summary: null, error: '途中覚醒の時刻を入力してください。' }
    }
    if (awakening.mode === 'point' && (
      !Number.isInteger(awakening.estimatedMinutes) ||
      awakening.estimatedMinutes < MIN_POINT_AWAKENING_MINUTES ||
      awakening.estimatedMinutes > MAX_POINT_AWAKENING_MINUTES
    )) {
      return { summary: null, error: '時刻だけの途中覚醒は5～180分で入力してください。' }
    }
    if (awakening.mode === 'range' && !isValidTime(awakening.endTime)) {
      return { summary: null, error: '再入眠時刻を入力してください。' }
    }
    const item = normalizeAwakening(awakening, bedtime)
    if (!item || (item.mode === 'range' && item.minutes <= 0)) {
      return { summary: null, error: '途中覚醒の開始と終了を同じ時刻にはできません。' }
    }
    if (item.start <= bedtimeMinutes || item.start >= wakeAbsolute || (item.end !== null && item.end > wakeAbsolute)) {
      return { summary: null, error: '途中覚醒は就寝から起床までの範囲内で入力してください。' }
    }
    normalized.push(item)
  }

  for (let index = 0; index < normalized.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < normalized.length; otherIndex += 1) {
      const first = normalized[index]
      const second = normalized[otherIndex]
      if (first.mode === 'point' && second.mode === 'point' && first.start === second.start) {
        return { summary: null, error: '同じ時刻の途中覚醒が重複しています。' }
      }
      if (first.mode === 'range' && second.mode === 'range' && first.end !== null && second.end !== null && first.start < second.end && second.start < first.end) {
        return { summary: null, error: '途中覚醒の時間範囲が重複しています。' }
      }
      const point = first.mode === 'point' ? first : second.mode === 'point' ? second : null
      const range = first.mode === 'range' ? first : second.mode === 'range' ? second : null
      if (point && range && range.end !== null && point.start >= range.start && point.start <= range.end) {
        return { summary: null, error: '時刻だけの途中覚醒が時間範囲と重複しています。' }
      }
    }
  }

  const awakeMinutes = normalized.reduce((total, item) => total + item.minutes, 0)
  const sleepMinutes = totalInBedMinutes - awakeMinutes
  if (sleepMinutes <= 0) {
    return { summary: null, error: '途中覚醒時間は総就床時間より短くしてください。' }
  }
  return { summary: { totalInBedMinutes, awakeMinutes, sleepMinutes }, error: null }
}

export function formatDurationMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const remaining = minutes % 60
  if (hours === 0) return `${remaining}分`
  if (remaining === 0) return `${hours}時間`
  return `${hours}時間${remaining}分`
}
