import { useState } from 'react'
import { calendarEvents } from '../data/calendarData'
import type { CalendarEvent } from '../types/calendar'

export function useEvents() {
  const [events, setEvents] = useState<CalendarEvent[]>(() =>
    calendarEvents.map((event) => ({ ...event })),
  )

  const saveEvent = (event: CalendarEvent) => {
    setEvents((current) => {
      const exists = current.some((item) => item.id === event.id)
      return exists
        ? current.map((item) => (item.id === event.id ? event : item))
        : [...current, event]
    })
  }

  const deleteEvent = (eventId: string) => {
    setEvents((current) => current.filter((event) => event.id !== eventId))
  }

  return { events, saveEvent, deleteEvent }
}
