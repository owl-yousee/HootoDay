import type {
  CalendarEvent,
  DayMemoIndicator,
} from '../types/calendar'
export { eventCategories } from './eventCategoryDisplay'

export const calendarEvents: CalendarEvent[] = [
  { id: 'event-0703', date: '2026-07-03', title: '歯医者', category: '歯医者', isAllDay: false, startTime: '11:30', endTime: null, memo: '' },
  { id: 'event-0708', date: '2026-07-08', title: '歌枠', category: '歌枠', isAllDay: false, startTime: '20:00', endTime: null, memo: '' },
  { id: 'event-0712', date: '2026-07-12', title: 'おでかけ', category: 'おでかけ', isAllDay: true, startTime: null, endTime: null, memo: '' },
  { id: 'event-0717-1', date: '2026-07-17', title: '整体', category: '整体', isAllDay: false, startTime: '12:00', endTime: null, memo: '' },
  { id: 'event-0717-2', date: '2026-07-17', title: '配信', category: '配信', isAllDay: false, startTime: '21:00', endTime: null, memo: '' },
  { id: 'event-0724', date: '2026-07-24', title: '収録', category: '収録', isAllDay: true, startTime: null, endTime: null, memo: '' },
  { id: 'event-0729', date: '2026-07-29', title: 'ライブ', category: 'ライブ', isAllDay: false, startTime: '19:00', endTime: null, memo: '' },
]

export const memoIndicators: DayMemoIndicator[] = [
  { date: '2026-07-05', hasMemo: true },
  { date: '2026-07-17', hasMemo: true },
  { date: '2026-07-23', hasMemo: true },
]
