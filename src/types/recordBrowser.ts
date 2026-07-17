export type RecordBrowserKind =
  | 'dayMemo'
  | 'dailyAchievement'
  | 'weightMemo'
  | 'sleepMemo'
  | 'menstrualNote'
  | 'concerns'
  | 'conditionMemo'

export type RecordBrowserKindFilter = 'all' | 'dayMemo' | 'dailyAchievement' | 'weightMemo' | 'sleepMemo' | 'condition'
export type RecordBrowserPeriod = 'all' | 'sevenDays' | 'thirtyDays' | 'sixMonths' | 'custom'
export type RecordBrowserSort = 'newest' | 'oldest'

export interface RecordBrowserItem {
  id: string
  date: string
  kind: RecordBrowserKind
  label: string
  text: string
}

export interface RecordBrowserFilters {
  query: string
  kind: RecordBrowserKindFilter
  period: RecordBrowserPeriod
  sort: RecordBrowserSort
  customStartDate: string
  customEndDate: string
  today: string
}
