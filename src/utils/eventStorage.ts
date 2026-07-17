import { eventCategories } from '../data/calendarData'
import type { CalendarEvent, EventCategory } from '../types/calendar'

export const EVENTS_STORAGE_KEY = 'hootoDay.events'
export const EVENTS_STORAGE_VERSION = 1

interface EventStorageData {
  version: typeof EVENTS_STORAGE_VERSION
  events: CalendarEvent[]
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEventCategory(value: unknown): value is EventCategory {
  return typeof value === 'string' && eventCategories.some((category) => category === value)
}

function isNullableTime(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && timePattern.test(value))
}

function isCalendarEvent(value: unknown): value is CalendarEvent {
  if (!isRecord(value)) return false

  return (
    typeof value.id === 'string' &&
    typeof value.date === 'string' &&
    datePattern.test(value.date) &&
    typeof value.title === 'string' &&
    isEventCategory(value.category) &&
    typeof value.isAllDay === 'boolean' &&
    isNullableTime(value.startTime) &&
    isNullableTime(value.endTime) &&
    typeof value.memo === 'string'
  )
}

function cloneEvents(events: CalendarEvent[]): CalendarEvent[] {
  return events.map((event) => ({ ...event }))
}

export function loadStoredEvents(fallbackEvents: CalendarEvent[]): CalendarEvent[] {
  let rawValue: string | null

  try {
    rawValue = window.localStorage.getItem(EVENTS_STORAGE_KEY)
  } catch {
    console.warn('予定データの保存領域を読み込めませんでした。画面上の操作は継続します。')
    return cloneEvents(fallbackEvents)
  }

  if (rawValue === null) return cloneEvents(fallbackEvents)

  try {
    const parsed: unknown = JSON.parse(rawValue)
    if (!isRecord(parsed) || parsed.version !== EVENTS_STORAGE_VERSION || !Array.isArray(parsed.events)) {
      return cloneEvents(fallbackEvents)
    }

    return parsed.events.filter(isCalendarEvent).map((event) => ({ ...event }))
  } catch {
    return cloneEvents(fallbackEvents)
  }
}

export function saveStoredEvents(events: CalendarEvent[]): void {
  const storageData: EventStorageData = {
    version: EVENTS_STORAGE_VERSION,
    events,
  }

  try {
    window.localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(storageData))
  } catch {
    console.warn('予定データを保存できませんでした。画面上の操作は継続します。')
  }
}
