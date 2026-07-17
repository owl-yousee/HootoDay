import type {
  CalendarEvent,
  DayMemoIndicator,
  EventCategory,
} from '../types/calendar'

export const calendarEvents: CalendarEvent[] = [
  { id: 'event-0703', date: '2026-07-03', time: '11:30', title: '歯医者', category: '歯医者' },
  { id: 'event-0708', date: '2026-07-08', time: '20:00', title: '歌枠', category: '歌枠' },
  { id: 'event-0712', date: '2026-07-12', isAllDay: true, title: 'おでかけ', category: 'おでかけ' },
  { id: 'event-0717-1', date: '2026-07-17', time: '12:00', title: '整体', category: '整体' },
  { id: 'event-0717-2', date: '2026-07-17', time: '21:00', title: '配信', category: '配信' },
  { id: 'event-0724', date: '2026-07-24', title: '収録', category: '収録' },
  { id: 'event-0729', date: '2026-07-29', time: '19:00', title: 'ライブ', category: 'ライブ' },
]

export const memoIndicators: DayMemoIndicator[] = [
  { date: '2026-07-05', hasMemo: true },
  { date: '2026-07-17', hasMemo: true },
  { date: '2026-07-23', hasMemo: true },
]

export const categoryColors: Record<EventCategory, string> = {
  収録: '#c65a4e',
  ライブ: '#d76645',
  リハ: '#6f8a77',
  配信: '#e17a2b',
  歌枠: '#ec9142',
  歯医者: '#348783',
  整体: '#4f9460',
  通院: '#43867f',
  おでかけ: '#d79b3d',
  映: '#5f7b71',
  その他: '#7b817c',
}
