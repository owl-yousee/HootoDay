export type EventCategory =
  | '収録'
  | 'ライブ'
  | 'リハ'
  | '配信'
  | '歌枠'
  | '歯医者'
  | '整体'
  | '通院'
  | 'おでかけ'
  | '映'
  | 'その他'

export interface CalendarEvent {
  id: string
  date: string
  title: string
  category: EventCategory
  time?: string
  isAllDay?: boolean
}

export interface DayMemoIndicator {
  date: string
  hasMemo: boolean
}
