import type { CalendarEvent } from '../types/calendar'
import { getEventCategoryDisplay } from '../data/eventCategoryDisplay'

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/

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
  const startTime = formatTimeForDisplay(event.startTime)
  if (event.endTime) return `${startTime}〜${formatTimeForDisplay(event.endTime)}`
  return startTime
}

export function formatTimeForDisplay(time: string | null): string {
  if (!time || !timePattern.test(time)) return '時刻未設定'
  const [hour, minute] = time.split(':')
  return minute === '00' ? `${Number(hour)}時` : time
}

export function getCalendarEventTitle(event: CalendarEvent): string {
  const display = getEventCategoryDisplay(event.category)
  return event.title === display.name ? display.shortName : event.title
}
