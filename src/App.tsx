import { useState } from 'react'
import { AppHeader } from './components/AppHeader'
import { Calendar } from './components/Calendar'
import { DayDetails } from './components/DayDetails'
import { DayMemoDialog } from './components/DayMemoDialog'
import { EventEditorDialog } from './components/EventEditorDialog'
import { ExerciseSessionDialog } from './components/ExerciseSessionDialog'
import { HealthDashboard } from './components/HealthDashboard'
import { HealthProfileDialog } from './components/HealthProfileDialog'
import { MealRecordDialog } from './components/MealRecordDialog'
import { Sidebar, type AppView } from './components/Sidebar'
import { SleepRecordDialog } from './components/SleepRecordDialog'
import { ThemeSettings } from './components/ThemeSettings'
import { WeightRecordDialog } from './components/WeightRecordDialog'
import { useDayMemos } from './hooks/useDayMemos'
import { useEvents } from './hooks/useEvents'
import { useExerciseSessions } from './hooks/useExerciseSessions'
import { useHealthProfile } from './hooks/useHealthProfile'
import { useMealRecords } from './hooks/useMealRecords'
import { useMealTemplates } from './hooks/useMealTemplates'
import { useSleepRecords } from './hooks/useSleepRecords'
import { useTheme } from './hooks/useTheme'
import { useWeightRecords } from './hooks/useWeightRecords'
import type { CalendarEvent } from './types/calendar'
import type { ExerciseSession } from './types/health'
import { fromDateKey, toDateKey } from './utils/date'
import './App.css'

const INITIAL_MONTH = new Date(2026, 6, 1)
const INITIAL_SELECTED_DATE = new Date(2026, 6, 17)

function App() {
  const [activeView, setActiveView] = useState<AppView>('calendar')
  const [displayMonth, setDisplayMonth] = useState(INITIAL_MONTH)
  const [selectedDate, setSelectedDate] = useState(INITIAL_SELECTED_DATE)
  const [isThemeSettingsOpen, setIsThemeSettingsOpen] = useState(false)
  const [isEventEditorOpen, setIsEventEditorOpen] = useState(false)
  const [isDayMemoDialogOpen, setIsDayMemoDialogOpen] = useState(false)
  const [isWeightDialogOpen, setIsWeightDialogOpen] = useState(false)
  const [isHealthProfileDialogOpen, setIsHealthProfileDialogOpen] = useState(false)
  const [isSleepDialogOpen, setIsSleepDialogOpen] = useState(false)
  const [isMealDialogOpen, setIsMealDialogOpen] = useState(false)
  const [isExerciseDialogOpen, setIsExerciseDialogOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [editingExerciseSession, setEditingExerciseSession] = useState<ExerciseSession | null>(null)
  const { events, saveEvent, deleteEvent } = useEvents()
  const { dayMemos, saveDayMemo, deleteDayMemo } = useDayMemos()
  const { preference, appliedTheme, setPreference } = useTheme()
  const { weightRecords, saveWeightRecord, deleteWeightRecord } = useWeightRecords()
  const { healthProfile, saveHealthProfile, deleteHealthProfile } = useHealthProfile()
  const { sleepRecords, saveSleepRecord, deleteSleepRecord } = useSleepRecords()
  const { mealRecords, saveMealRecord, deleteMealRecord } = useMealRecords()
  const { mealTemplates, saveMealTemplate, deleteMealTemplate, moveMealTemplate } = useMealTemplates()
  const { exerciseSessions, saveExerciseSession, deleteExerciseSession } = useExerciseSessions()

  const selectDate = (date: Date) => {
    setSelectedDate(date)
    setDisplayMonth(new Date(date.getFullYear(), date.getMonth(), 1))
  }

  const moveMonth = (amount: number) => {
    setDisplayMonth(
      (current) => new Date(current.getFullYear(), current.getMonth() + amount, 1),
    )
  }

  const moveToToday = () => {
    const today = new Date()
    selectDate(today)
  }

  const moveSelectedDay = (amount: number) => {
    const date = new Date(selectedDate)
    date.setDate(date.getDate() + amount)
    selectDate(date)
  }

  const changeSelectedDate = (dateKey: string) => {
    const date = fromDateKey(dateKey)
    if (date) selectDate(date)
  }

  const changeView = (view: AppView) => {
    setActiveView(view)
    if (view === 'calendar') {
      setDisplayMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1))
    }
  }

  const openNewEvent = () => {
    setEditingEvent(null)
    setIsEventEditorOpen(true)
  }

  const openEventEditor = (event: CalendarEvent) => {
    setEditingEvent(event)
    setIsEventEditorOpen(true)
  }

  const openHealthProfileFromSettings = () => {
    setIsThemeSettingsOpen(false)
    setIsHealthProfileDialogOpen(true)
  }

  const openExerciseDialog = (session: ExerciseSession | null) => {
    setEditingExerciseSession(session)
    setIsExerciseDialogOpen(true)
  }

  return (
    <div className="app-shell">
      <AppHeader
        isCalendarView={activeView === 'calendar'}
        displayMonth={displayMonth}
        onPreviousMonth={() => moveMonth(-1)}
        onNextMonth={() => moveMonth(1)}
        onToday={moveToToday}
      />

      <div className="app-body">
        <Sidebar
          activeView={activeView}
          isSettingsOpen={isThemeSettingsOpen}
          onViewChange={changeView}
          onSettingsClick={() => setIsThemeSettingsOpen((current) => !current)}
        />
        <main className="main-content">
          {activeView === 'calendar' ? (
            <>
              <div className="content-heading">
                <div><p className="eyebrow">My calendar</p><h2>月間カレンダー</h2></div>
                <p className="content-note">予定と毎日の記録を、ひと目で。</p>
              </div>
              <div className="calendar-layout">
                <Calendar displayMonth={displayMonth} selectedDate={selectedDate} events={events} memos={dayMemos} onSelectDate={selectDate} />
                <DayDetails selectedDate={selectedDate} events={events} memos={dayMemos} onAddEvent={openNewEvent} onEditEvent={openEventEditor} onOpenMemo={() => setIsDayMemoDialogOpen(true)} />
              </div>
            </>
          ) : (
            <HealthDashboard
              selectedDate={selectedDate}
              records={weightRecords}
              sleepRecords={sleepRecords}
              mealRecords={mealRecords}
              exerciseSessions={exerciseSessions}
              profile={healthProfile}
              onPreviousDay={() => moveSelectedDay(-1)}
              onNextDay={() => moveSelectedDay(1)}
              onToday={moveToToday}
              onDateChange={changeSelectedDate}
              onOpenWeight={() => setIsWeightDialogOpen(true)}
              onOpenProfile={() => setIsHealthProfileDialogOpen(true)}
              onOpenSleep={() => setIsSleepDialogOpen(true)}
              onOpenMeal={() => setIsMealDialogOpen(true)}
              onOpenExercise={openExerciseDialog}
            />
          )}
        </main>
      </div>

      {isThemeSettingsOpen && (
        <ThemeSettings
          preference={preference}
          appliedTheme={appliedTheme}
          onChange={setPreference}
          profile={healthProfile}
          onOpenProfile={openHealthProfileFromSettings}
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

      {isDayMemoDialogOpen && (
        <DayMemoDialog
          date={toDateKey(selectedDate)}
          weekday={['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'][selectedDate.getDay()]}
          memo={dayMemos.find((memo) => memo.date === toDateKey(selectedDate)) ?? null}
          onSave={saveDayMemo}
          onDelete={deleteDayMemo}
          onClose={() => setIsDayMemoDialogOpen(false)}
        />
      )}

      {isWeightDialogOpen && (
        <WeightRecordDialog
          date={toDateKey(selectedDate)}
          record={weightRecords.find((record) => record.date === toDateKey(selectedDate)) ?? null}
          onSave={saveWeightRecord}
          onDelete={deleteWeightRecord}
          onClose={() => setIsWeightDialogOpen(false)}
        />
      )}

      {isHealthProfileDialogOpen && (
        <HealthProfileDialog
          profile={healthProfile}
          onSave={saveHealthProfile}
          onDelete={deleteHealthProfile}
          onClose={() => setIsHealthProfileDialogOpen(false)}
        />
      )}

      {isSleepDialogOpen && (
        <SleepRecordDialog
          date={toDateKey(selectedDate)}
          record={sleepRecords.find((record) => record.date === toDateKey(selectedDate)) ?? null}
          onSave={saveSleepRecord}
          onDelete={deleteSleepRecord}
          onClose={() => setIsSleepDialogOpen(false)}
        />
      )}

      {isMealDialogOpen && (
        <MealRecordDialog
          date={toDateKey(selectedDate)}
          record={mealRecords.find((record) => record.date === toDateKey(selectedDate)) ?? null}
          templates={mealTemplates}
          onSaveTemplate={saveMealTemplate}
          onDeleteTemplate={deleteMealTemplate}
          onMoveTemplate={moveMealTemplate}
          onSave={saveMealRecord}
          onDelete={deleteMealRecord}
          onClose={() => setIsMealDialogOpen(false)}
        />
      )}

      {isExerciseDialogOpen && (
        <ExerciseSessionDialog
          date={toDateKey(selectedDate)}
          session={editingExerciseSession}
          weightRecords={weightRecords}
          onSave={saveExerciseSession}
          onDelete={deleteExerciseSession}
          onClose={() => {
            setIsExerciseDialogOpen(false)
            setEditingExerciseSession(null)
          }}
        />
      )}
    </div>
  )
}

export default App
