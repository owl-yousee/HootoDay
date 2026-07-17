import type { DailyAchievement } from '../types/achievement'
import type { DayMemo } from '../types/dayMemo'
import type { DailyConditionRecord, SleepRecord, WeightRecord } from '../types/health'
import type { RecordBrowserFilters, RecordBrowserItem, RecordBrowserKind } from '../types/recordBrowser'
import { addLocalDays, fromDateKey, toDateKey } from './date'

interface RecordBrowserSource {
  dayMemos: DayMemo[]
  dailyAchievements: DailyAchievement[]
  weightRecords: WeightRecord[]
  sleepRecords: SleepRecord[]
  conditionRecords: DailyConditionRecord[]
}

const KIND_LABELS: Record<RecordBrowserKind, string> = {
  dailyAchievement: '今日のできたこと',
  dayMemo: '日記・メモ',
  weightMemo: '体重メモ',
  sleepMemo: '睡眠メモ',
  menstrualNote: '生理・周期メモ',
  concerns: '気になること',
  conditionMemo: '体調メモ',
}

const KIND_ORDER: Record<RecordBrowserKind, number> = {
  dailyAchievement: 0,
  dayMemo: 1,
  weightMemo: 2,
  sleepMemo: 3,
  menstrualNote: 4,
  concerns: 5,
  conditionMemo: 6,
}

function createItem(date: string, kind: RecordBrowserKind, text: string): RecordBrowserItem | null {
  const normalizedText = text.trim()
  return normalizedText ? { id: `${kind}:${date}`, date, kind, label: KIND_LABELS[kind], text: normalizedText } : null
}

export function buildRecordBrowserItems(source: RecordBrowserSource): RecordBrowserItem[] {
  const items: Array<RecordBrowserItem | null> = [
    ...source.dayMemos.map((record) => createItem(record.date, 'dayMemo', record.content)),
    ...source.dailyAchievements.map((record) => createItem(record.date, 'dailyAchievement', record.text)),
    ...source.weightRecords.map((record) => createItem(record.date, 'weightMemo', record.memo)),
    ...source.sleepRecords.map((record) => createItem(record.date, 'sleepMemo', record.memo)),
    ...source.conditionRecords.flatMap((record) => [
      createItem(record.date, 'menstrualNote', record.menstrualNote),
      createItem(record.date, 'concerns', record.concerns),
      createItem(record.date, 'conditionMemo', record.memo),
    ]),
  ]
  return items.filter((item): item is RecordBrowserItem => item !== null)
}

export function normalizeRecordSearchText(value: string): string {
  return value.trim().toLocaleLowerCase()
}

export function getRecordBrowserDateRange(period: RecordBrowserFilters['period'], today: string): { start: string; end: string } | null {
  if (period === 'all' || period === 'custom') return null
  if (period === 'sevenDays') return { start: addLocalDays(today, -6) ?? today, end: today }
  if (period === 'thirtyDays') return { start: addLocalDays(today, -29) ?? today, end: today }
  const todayDate = fromDateKey(today)
  if (!todayDate) return null
  const start = new Date(todayDate.getFullYear(), todayDate.getMonth() - 5, 1)
  return { start: toDateKey(start), end: today }
}

function matchesKind(item: RecordBrowserItem, filter: RecordBrowserFilters['kind']): boolean {
  if (filter === 'all') return true
  if (filter === 'condition') return item.kind === 'menstrualNote' || item.kind === 'concerns' || item.kind === 'conditionMemo'
  return item.kind === filter
}

export function filterRecordBrowserItems(items: RecordBrowserItem[], filters: RecordBrowserFilters): RecordBrowserItem[] {
  const query = normalizeRecordSearchText(filters.query)
  const presetRange = getRecordBrowserDateRange(filters.period, filters.today)
  const range = filters.period === 'custom'
    ? { start: filters.customStartDate, end: filters.customEndDate }
    : presetRange

  return items
    .filter((item) => matchesKind(item, filters.kind))
    .filter((item) => !query || normalizeRecordSearchText(`${item.label}\n${item.text}`).includes(query))
    .filter((item) => !range || (item.date >= range.start && item.date <= range.end))
    .sort((left, right) => {
      const dateOrder = left.date.localeCompare(right.date) * (filters.sort === 'newest' ? -1 : 1)
      return dateOrder || KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
    })
}

export function getCustomDateRangeError(start: string, end: string): string {
  if (!start || !end) return '開始日と終了日を入力してください。'
  if (!fromDateKey(start) || !fromDateKey(end)) return '有効な日付を入力してください。'
  if (start > end) return '開始日は終了日以前にしてください。'
  return ''
}
