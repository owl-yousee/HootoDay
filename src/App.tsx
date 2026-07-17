import { useState } from 'react'
import { AppHeader } from './components/AppHeader'
import { Calendar } from './components/Calendar'
import { DayDetails } from './components/DayDetails'
import { EventEditorDialog } from './components/EventEditorDialog'
import { Sidebar } from './components/Sidebar'
import { ThemeSettings } from './components/ThemeSettings'
import { memoIndicators } from './data/calendarData'
import { useEvents } from './hooks/useEvents'
import { useTheme } from './hooks/useTheme'
import type { CalendarEvent } from './types/calendar'
import { toDateKey } from './utils/date'
import './App.css'

const INITIAL_MONTH = new Date(2026, 6, 1)
const INITIAL_SELECTED_DATE = new Date(2026, 6, 17)

function App() {
  const [displayMonth, setDisplayMonth] = useState(INITIAL_MONTH)
  const [selectedDate, setSelectedDate] = useState(INITIAL_SELECTED_DATE)
  const [isThemeSettingsOpen, setIsThemeSettingsOpen] = useState(false)
  const [isEventEditorOpen, setIsEventEditorOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const { events, saveEvent, deleteEvent } = useEvents()
  const { preference, appliedTheme, setPreference } = useTheme()

  const moveMonth = (amount: number) => {
    setDisplayMonth(
      (current) => new Date(current.getFullYear(), current.getMonth() + amount, 1),
    )
  }

  const moveToToday = () => {
    const today = new Date()
    setDisplayMonth(new Date(today.getFullYear(), today.getMonth(), 1))
    setSelectedDate(today)
  }

  const openNewEvent = () => {
    setEditingEvent(null)
    setIsEventEditorOpen(true)
  }

  const openEventEditor = (event: CalendarEvent) => {
    setEditingEvent(event)
    setIsEventEditorOpen(true)
  }

  return (
    <div className="app-shell">
      <AppHeader
        displayMonth={displayMonth}
        onPreviousMonth={() => moveMonth(-1)}
        onNextMonth={() => moveMonth(1)}
        onToday={moveToToday}
      />

      <div className="app-body">
        <Sidebar
          isSettingsOpen={isThemeSettingsOpen}
          onSettingsClick={() => setIsThemeSettingsOpen((current) => !current)}
        />
        <main className="main-content">
          <div className="content-heading">
            <div>
              <p className="eyebrow">My calendar</p>
              <h2>月間カレンダー</h2>
            </div>
            <p className="content-note">予定と毎日の記録を、ひと目で。</p>
          </div>

          <div className="calendar-layout">
            <Calendar
              displayMonth={displayMonth}
              selectedDate={selectedDate}
              events={events}
              memos={memoIndicators}
              onSelectDate={setSelectedDate}
            />
            <DayDetails
              selectedDate={selectedDate}
              events={events}
              memos={memoIndicators}
              onAddEvent={openNewEvent}
              onEditEvent={openEventEditor}
            />
          </div>
        </main>
      </div>

      {isThemeSettingsOpen && (
        <ThemeSettings
          preference={preference}
          appliedTheme={appliedTheme}
          onChange={setPreference}
          onClose={() => setIsThemeSettingsOpen(false)}
        />
      )}

      {isEventEditorOpen && (
        <EventEditorDialog
          initialDate={toDateKey(selectedDate)}
          event={editingEvent}
          onSave={saveEvent}
          onDelete={deleteEvent}
          onClose={() => setIsEventEditorOpen(false)}
        />
      )}
    </div>
  )
}

export default App
