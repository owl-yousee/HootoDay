import type { CalendarEvent } from '../types/calendar'

export function sortCalendarEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((left, right) => {
    if (left.isAllDay !== right.isAllDay) return left.isAllDay ? -1 : 1
    const timeOrder = (left.startTime ?? '').localeCompare(right.startTime ?? '')
    if (timeOrder !== 0) return timeOrder
    return left.id.localeCompare(right.id)
  })
}

export function createEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `event-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function formatEventTime(event: CalendarEvent): string {
  if (event.isAllDay) return '終日'
  if (event.endTime) return `${event.startTime}〜${event.endTime}`
  return event.startTime ?? '時刻未設定'
}
