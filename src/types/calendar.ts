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
  | '即売会'

export interface CalendarEvent {
  id: string
  date: string
  title: string
  category: EventCategory
  isAllDay: boolean
  startTime: string | null
  endTime: string | null
  memo: string
}
