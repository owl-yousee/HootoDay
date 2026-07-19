import { useMemo, useState } from 'react'
import { Calendar } from './components/Calendar'
import { DailyAchievementDialog } from './components/DailyAchievementDialog'
import { DayDetails } from './components/DayDetails'
import { DayMemoDialog } from './components/DayMemoDialog'
import { DailyConditionDialog } from './components/DailyConditionDialog'
import { EventEditorDialog } from './components/EventEditorDialog'
import { ExerciseSessionDialog } from './components/ExerciseSessionDialog'
import { HealthDashboard } from './components/HealthDashboard'
import { HealthExportPage } from './components/HealthExportPage'
import { HealthProfileDialog } from './components/HealthProfileDialog'
import { MealRecordDialog } from './components/MealRecordDialog'
import { MonthlyAchievementHighlight } from './components/MonthlyAchievementHighlight'
import { MonthlyAchievementsDialog } from './components/MonthlyAchievementsDialog'
import { MobileCalendarQuickAdd } from './components/MobileCalendarQuickAdd'
import { RecordsBrowserPage } from './components/RecordsBrowserPage'
import { InventoryPage } from './components/InventoryPage'
import { Sidebar, type AppView } from './components/Sidebar'
import { SleepRecordDialog } from './components/SleepRecordDialog'
import { ThemeSettings } from './components/ThemeSettings'
import { WeightRecordDialog } from './components/WeightRecordDialog'
import { useDayMemos } from './hooks/useDayMemos'
import { useDayMemoInitialUpload } from './hooks/useDayMemoInitialUpload'
import { useDayMemoLocalOnlyPreview } from './hooks/useDayMemoLocalOnlyPreview'
import { useDayMemoPullPreview } from './hooks/useDayMemoPullPreview'
import { useDayMemoBaselineRebase } from './hooks/useDayMemoBaselineRebase'
import { useDayMemoSyncBaseline } from './hooks/useDayMemoSyncBaseline'
import { useDayMemoUpdatePreview } from './hooks/useDayMemoUpdatePreview'
import { useDayMemoUpdateUpload } from './hooks/useDayMemoUpdateUpload'
import { useDailyAchievements } from './hooks/useDailyAchievements'
import { useConditionRecords } from './hooks/useConditionRecords'
import { useEvents } from './hooks/useEvents'
import { useExerciseSessions } from './hooks/useExerciseSessions'
import { useHealthProfile } from './hooks/useHealthProfile'
import { useMealRecords } from './hooks/useMealRecords'
import { useMealTemplates } from './hooks/useMealTemplates'
import { useMonthlyAchievementSelections } from './hooks/useMonthlyAchievementSelections'
import { useSleepRecords } from './hooks/useSleepRecords'
import { useSupabaseAuth } from './hooks/useSupabaseAuth'
import { useSupabaseWorkspace } from './hooks/useSupabaseWorkspace'
import { useTheme } from './hooks/useTheme'
import { useWeightRecords } from './hooks/useWeightRecords'
import { useInventory } from './hooks/useInventory'
import type { CalendarEvent } from './types/calendar'
import type { HootoDayBackupData } from './types/backup'
import type { ExerciseSession } from './types/health'
import { fromDateKey, toDateKey, toMonthKey } from './utils/date'
import { getDailyHealthSummary, getHealthRecordDates } from './utils/healthSummary'
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
  const [isConditionDialogOpen, setIsConditionDialogOpen] = useState(false)
  const [isDailyAchievementDialogOpen, setIsDailyAchievementDialogOpen] = useState(false)
  const [isMonthlyAchievementsDialogOpen, setIsMonthlyAchievementsDialogOpen] = useState(false)
  const [isMobileQuickAddOpen, setIsMobileQuickAddOpen] = useState(false)
  const [mobileEntryType, setMobileEntryType] = useState<'event' | 'memo' | null>(null)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [editingExerciseSession, setEditingExerciseSession] = useState<ExerciseSession | null>(null)
  const [inventoryEventId, setInventoryEventId] = useState<string | null>(null)
  const { events, saveEvent, deleteEvent, replaceEvents } = useEvents()
  const { dayMemos, saveDayMemo, deleteDayMemo, replaceDayMemos, adoptVerifiedStoredDayMemos } = useDayMemos()
  const { dailyAchievements, saveDailyAchievement, deleteDailyAchievement, replaceDailyAchievements } = useDailyAchievements()
  const {
    monthlyAchievementSelections,
    saveMonthlyAchievementSelection,
    deleteMonthlyAchievementSelection,
    replaceMonthlyAchievementSelections,
  } = useMonthlyAchievementSelections()
  const { preference, appliedTheme, setPreference, replaceThemePreference } = useTheme()
  const supabaseAuth = useSupabaseAuth()
  const supabaseWorkspace = useSupabaseWorkspace(supabaseAuth.isSignedIn)
  const dayMemoInitialUpload = useDayMemoInitialUpload({
    dayMemos,
    isConfigured: supabaseAuth.isConfigured,
    isSignedIn: supabaseAuth.isSignedIn,
    connection: supabaseWorkspace.connection,
  })
  const dayMemoPullPreview = useDayMemoPullPreview({
    dayMemos,
    isConfigured: supabaseAuth.isConfigured,
    isSignedIn: supabaseAuth.isSignedIn,
    connection: supabaseWorkspace.connection,
    adoptVerifiedStoredDayMemos,
  })
  const dayMemoSyncBaseline = useDayMemoSyncBaseline({
    dayMemos,
    isConfigured: supabaseAuth.isConfigured,
    isSignedIn: supabaseAuth.isSignedIn,
    connection: supabaseWorkspace.connection,
  })
  const dayMemoBaselineRebase = useDayMemoBaselineRebase({
    dayMemos,
    isConfigured: supabaseAuth.isConfigured,
    isSignedIn: supabaseAuth.isSignedIn,
    connection: supabaseWorkspace.connection,
  })
  const dayMemoUpdatePreview = useDayMemoUpdatePreview({
    dayMemos,
    isConfigured: supabaseAuth.isConfigured,
    isSignedIn: supabaseAuth.isSignedIn,
    connection: supabaseWorkspace.connection,
  })
  const dayMemoLocalOnlyPreview = useDayMemoLocalOnlyPreview({
    dayMemos,
    isConfigured: supabaseAuth.isConfigured,
    isSignedIn: supabaseAuth.isSignedIn,
    connection: supabaseWorkspace.connection,
  })
  const dayMemoUpdateUpload = useDayMemoUpdateUpload({
    dayMemos,
    isConfigured: supabaseAuth.isConfigured,
    isSignedIn: supabaseAuth.isSignedIn,
    connection: supabaseWorkspace.connection,
    getSingleCandidateSnapshot: dayMemoUpdatePreview.getSingleCandidateSnapshot,
    discardUpdatePreview: dayMemoUpdatePreview.discardPreview,
  })
  const { weightRecords, saveWeightRecord, deleteWeightRecord, replaceWeightRecords } = useWeightRecords()
  const { healthProfile, saveHealthProfile, deleteHealthProfile, replaceHealthProfile } = useHealthProfile()
  const { sleepRecords, saveSleepRecord, deleteSleepRecord, replaceSleepRecords } = useSleepRecords()
  const { mealRecords, saveMealRecord, deleteMealRecord, replaceMealRecords } = useMealRecords()
  const { mealTemplates, saveMealTemplate, deleteMealTemplate, moveMealTemplate, replaceMealTemplates } = useMealTemplates()
  const { exerciseSessions, saveExerciseSession, deleteExerciseSession, replaceExerciseSessions } = useExerciseSessions()
  const { conditionRecords, saveConditionRecord, deleteConditionRecord, replaceConditionRecords } = useConditionRecords()
  const inventory = useInventory()
  const healthSummarySource = useMemo(() => ({
    weightRecords,
    sleepRecords,
    mealRecords,
    exerciseSessions,
    conditionRecords,
  }), [weightRecords, sleepRecords, mealRecords, exerciseSessions, conditionRecords])
  const healthRecordDates = useMemo(() => getHealthRecordDates(healthSummarySource), [healthSummarySource])
  const selectedHealthSummary = useMemo(
    () => getDailyHealthSummary(toDateKey(selectedDate), healthSummarySource),
    [selectedDate, healthSummarySource],
  )
  const selectedDateKey = toDateKey(selectedDate)
  const selectedDateAchievement = dailyAchievements.find((record) => record.date === selectedDateKey) ?? null
  const displayedMonthKey = toMonthKey(displayMonth)
  const displayedMonthAchievements = useMemo(
    () => dailyAchievements.filter((record) => record.date.startsWith(`${displayedMonthKey}-`)),
    [dailyAchievements, displayedMonthKey],
  )
  const displayedMonthSelection = monthlyAchievementSelections.find((selection) => (
    selection.month === displayedMonthKey &&
    displayedMonthAchievements.some((record) => record.date === selection.selectedDate)
  )) ?? null
  const displayedMonthBest = displayedMonthSelection
    ? displayedMonthAchievements.find((record) => record.date === displayedMonthSelection.selectedDate) ?? null
    : null

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
    if (view !== 'calendar') setIsMobileQuickAddOpen(false)
    if (view === 'inventory') setInventoryEventId(null)
    if (view === 'calendar') {
      setDisplayMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1))
    }
  }

  const openNewEvent = () => {
    setMobileEntryType(null)
    setEditingEvent(null)
    setIsEventEditorOpen(true)
  }

  const openMobileEvent = () => {
    setMobileEntryType('event')
    setEditingEvent(null)
    setIsEventEditorOpen(true)
  }

  const openMobileMemo = () => {
    setMobileEntryType('memo')
    setIsDayMemoDialogOpen(true)
  }

  const restoreMobileQuickAddFocus = () => {
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('.mobile-calendar-add-trigger')?.focus()
    })
  }

  const openEventEditor = (event: CalendarEvent) => {
    setEditingEvent(event)
    setIsEventEditorOpen(true)
  }

  const deleteCalendarEvent = (eventId: string): boolean => {
    if (inventory.eventSalesRecords.some((record) => record.eventId === eventId)) {
      window.alert('この予定には販売記録があるため削除できません。先に販売・在庫画面で記録を確認してください。')
      return false
    }
    const referenced = inventory.products.filter((product) => product.firstSaleEventId === eventId)
    if (referenced.length && !window.confirm(`この予定は${referenced.length}件の商品の初売りイベントです。参照を解除して予定を削除しますか？`)) return false
    referenced.forEach((product) => inventory.saveProduct({ ...product, firstSaleEventId: null, updatedAt: new Date().toISOString() }))
    deleteEvent(eventId)
    return true
  }

  const openInventoryEvent = (eventId: string) => {
    setInventoryEventId(eventId)
    setActiveView('inventory')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openHealthProfileFromSettings = () => {
    setIsThemeSettingsOpen(false)
    setIsHealthProfileDialogOpen(true)
  }

  const openDataManagementFromSettings = () => {
    setIsThemeSettingsOpen(false)
    setActiveView('export')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openExerciseDialog = (session: ExerciseSession | null) => {
    if (session) {
      const sessionDate = fromDateKey(session.date)
      if (sessionDate) selectDate(sessionDate)
    }
    setEditingExerciseSession(session)
    setIsExerciseDialogOpen(true)
  }

  const openSelectedDateHealth = () => {
    setActiveView('health')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openRecordDate = (dateKey: string, view: 'calendar' | 'health') => {
    const date = fromDateKey(dateKey)
    if (!date) return
    selectDate(date)
    setActiveView(view)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const deleteAchievement = (date: string) => {
    deleteDailyAchievement(date)
    const month = date.slice(0, 7)
    if (monthlyAchievementSelections.some((selection) => selection.month === month && selection.selectedDate === date)) {
      deleteMonthlyAchievementSelection(month)
    }
  }

  const selectMonthlyBest = (date: string) => {
    if (!date.startsWith(`${displayedMonthKey}-`) || !displayedMonthAchievements.some((record) => record.date === date)) return
    saveMonthlyAchievementSelection({ month: displayedMonthKey, selectedDate: date, updatedAt: new Date().toISOString() })
    setIsMonthlyAchievementsDialogOpen(false)
  }

  const restoreBackupData = (data: HootoDayBackupData) => {
    replaceThemePreference(data.theme)
    replaceEvents(data.events)
    replaceDayMemos(data.dayMemos)
    replaceHealthProfile(data.healthProfile)
    replaceWeightRecords(data.weightRecords)
    replaceSleepRecords(data.sleepRecords)
    replaceMealRecords(data.mealRecords)
    replaceMealTemplates(data.mealTemplates)
    replaceExerciseSessions(data.exerciseSessions)
    replaceConditionRecords(data.conditionRecords)
    replaceDailyAchievements(data.dailyAchievements)
    replaceMonthlyAchievementSelections(data.monthlyAchievementSelections)
    inventory.replaceProducts(data.products)
    inventory.replaceInventoryMovements(data.inventoryMovements)
    inventory.replaceEventSalesRecords(data.eventSalesRecords)
    inventory.replaceBoothSalesRecords(data.boothSalesRecords)
  }

  const resetAllDataState = () => {
    replaceEvents([])
    replaceDayMemos([])
    replaceHealthProfile(null)
    replaceWeightRecords([])
    replaceSleepRecords([])
    replaceMealRecords([])
    replaceMealTemplates([])
    replaceExerciseSessions([])
    replaceConditionRecords([])
    replaceDailyAchievements([])
    replaceMonthlyAchievementSelections([])
    inventory.replaceProducts([])
    inventory.replaceInventoryMovements([])
    inventory.replaceEventSalesRecords([])
    inventory.replaceBoothSalesRecords([])
    setInventoryEventId(null)
    const today = new Date()
    setSelectedDate(today)
    setDisplayMonth(new Date(today.getFullYear(), today.getMonth(), 1))
  }

  return (
    <div className="app-shell">
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
              <MonthlyAchievementHighlight
                displayMonth={displayMonth}
                achievement={displayedMonthBest}
                onPreviousMonth={() => moveMonth(-1)}
                onNextMonth={() => moveMonth(1)}
                onToday={moveToToday}
                onOpen={() => setIsMonthlyAchievementsDialogOpen(true)}
              />
              <div className="calendar-layout">
                <Calendar displayMonth={displayMonth} selectedDate={selectedDate} events={events} memos={dayMemos} healthRecordDates={healthRecordDates} onSelectDate={selectDate} />
                <DayDetails selectedDate={selectedDate} events={events} memos={dayMemos} healthSummary={selectedHealthSummary} achievement={selectedDateAchievement} onAddEvent={openNewEvent} onEditEvent={openEventEditor} onOpenMemo={() => setIsDayMemoDialogOpen(true)} onOpenHealth={openSelectedDateHealth} onOpenAchievement={() => setIsDailyAchievementDialogOpen(true)} eventSales={inventory.eventSalesRecords} onOpenInventoryEvent={openInventoryEvent} />
              </div>
              <MobileCalendarQuickAdd
                dateLabel={`${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日`}
                isOpen={isMobileQuickAddOpen}
                onToggle={() => setIsMobileQuickAddOpen((current) => !current)}
                onClose={() => setIsMobileQuickAddOpen(false)}
                onAddEvent={openMobileEvent}
                onAddMemo={openMobileMemo}
              />
            </>
          ) : activeView === 'health' ? (
            <HealthDashboard
              selectedDate={selectedDate}
              records={weightRecords}
              sleepRecords={sleepRecords}
              mealRecords={mealRecords}
              exerciseSessions={exerciseSessions}
              conditionRecords={conditionRecords}
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
              onDeleteExercise={deleteExerciseSession}
              onOpenCondition={() => setIsConditionDialogOpen(true)}
            />
          ) : activeView === 'records' ? (
            <RecordsBrowserPage
              dayMemos={dayMemos}
              dailyAchievements={dailyAchievements}
              weightRecords={weightRecords}
              sleepRecords={sleepRecords}
              conditionRecords={conditionRecords}
              onOpenCalendar={(dateKey) => openRecordDate(dateKey, 'calendar')}
              onOpenHealth={(dateKey) => openRecordDate(dateKey, 'health')}
            />
          ) : activeView === 'inventory' ? (
            <InventoryPage products={inventory.products} movements={inventory.inventoryMovements} eventSales={inventory.eventSalesRecords} boothSales={inventory.boothSalesRecords} events={events} initialEventId={inventoryEventId} onSaveProduct={inventory.saveProduct} onAddMovement={inventory.addMovement} onSaveEvent={inventory.saveEventSale} onDeleteEvent={inventory.deleteEventSale} onSaveBooth={inventory.saveBoothSale} onSaveCalendarEvent={saveEvent} />
          ) : (
            <HealthExportPage
              initialDate={selectedDateKey}
              data={{
                dayMemos,
                dailyAchievements,
                monthlyAchievementSelections,
                weightRecords,
                sleepRecords,
                mealRecords,
                exerciseSessions,
                conditionRecords,
              }}
              backupData={{
                theme: preference,
                events,
                dayMemos,
                healthProfile,
                weightRecords,
                sleepRecords,
                mealRecords,
                mealTemplates,
                exerciseSessions,
                conditionRecords,
                dailyAchievements,
                monthlyAchievementSelections,
                products: inventory.products,
                inventoryMovements: inventory.inventoryMovements,
                eventSalesRecords: inventory.eventSalesRecords,
                boothSalesRecords: inventory.boothSalesRecords,
              }}
              onRestoreBackup={restoreBackupData}
              onFullDataReset={resetAllDataState}
              beforeRestore={() => dayMemoInitialUpload.guardLocalDataReplacement('json_restore')}
              beforeFullDataReset={() => dayMemoInitialUpload.guardLocalDataReplacement('full_reset')}
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
          onOpenDataManagement={openDataManagementFromSettings}
          supabaseAuth={supabaseAuth}
          supabaseWorkspace={supabaseWorkspace}
          dayMemoInitialUpload={dayMemoInitialUpload}
          dayMemoPullPreview={dayMemoPullPreview}
          dayMemoSyncBaseline={dayMemoSyncBaseline}
          dayMemoBaselineRebase={dayMemoBaselineRebase}
          dayMemoUpdatePreview={dayMemoUpdatePreview}
          dayMemoUpdateUpload={dayMemoUpdateUpload}
          dayMemoLocalOnlyPreview={dayMemoLocalOnlyPreview}
          onClose={() => setIsThemeSettingsOpen(false)}
        />
      )}

      {isEventEditorOpen && (
        <EventEditorDialog
          initialDate={toDateKey(selectedDate)}
          event={editingEvent}
          onSave={saveEvent}
          dayMemos={dayMemos}
          onSaveDayMemo={saveDayMemo}
          onDeleteDayMemo={deleteDayMemo}
          onDelete={deleteCalendarEvent}
          mobileSlide={mobileEntryType === 'event'}
          onClose={() => {
            const shouldRestoreFocus = mobileEntryType === 'event'
            setIsEventEditorOpen(false)
            setMobileEntryType(null)
            if (shouldRestoreFocus) restoreMobileQuickAddFocus()
          }}
        />
      )}

      {isDayMemoDialogOpen && (
        <DayMemoDialog
          date={toDateKey(selectedDate)}
          weekday={['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'][selectedDate.getDay()]}
          memo={dayMemos.find((memo) => memo.date === toDateKey(selectedDate)) ?? null}
          onSave={saveDayMemo}
          onDelete={deleteDayMemo}
          mobileSlide={mobileEntryType === 'memo'}
          onClose={() => {
            const shouldRestoreFocus = mobileEntryType === 'memo'
            setIsDayMemoDialogOpen(false)
            setMobileEntryType(null)
            if (shouldRestoreFocus) restoreMobileQuickAddFocus()
          }}
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

      {isConditionDialogOpen && (
        <DailyConditionDialog
          date={toDateKey(selectedDate)}
          record={conditionRecords.find((record) => record.date === toDateKey(selectedDate)) ?? null}
          onSave={saveConditionRecord}
          onDelete={deleteConditionRecord}
          onClose={() => setIsConditionDialogOpen(false)}
        />
      )}

      {isDailyAchievementDialogOpen && (
        <DailyAchievementDialog
          date={selectedDateKey}
          achievement={selectedDateAchievement}
          onSave={saveDailyAchievement}
          onDelete={deleteAchievement}
          onClose={() => setIsDailyAchievementDialogOpen(false)}
        />
      )}

      {isMonthlyAchievementsDialogOpen && (
        <MonthlyAchievementsDialog
          month={displayedMonthKey}
          achievements={displayedMonthAchievements}
          selection={displayedMonthSelection}
          onSelect={selectMonthlyBest}
          onClear={() => deleteMonthlyAchievementSelection(displayedMonthKey)}
          onClose={() => setIsMonthlyAchievementsDialogOpen(false)}
        />
      )}
    </div>
  )
}

export default App
