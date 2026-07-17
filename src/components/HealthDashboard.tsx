import { useState } from 'react'
import type { ExerciseSession, HealthProfile, MealRecord, SleepRecord, WeightRecord } from '../types/health'
import { getExerciseDisplayName } from '../data/exerciseTypes'
import { toDateKey } from '../utils/date'
import { calculateDailyExerciseSummary, formatExerciseDuration } from '../utils/exerciseMetrics'
import { formatDurationMinutes } from '../utils/sleepMetrics'
import { HealthDateNavigator } from './HealthDateNavigator'
import { WeightDashboard } from './WeightDashboard'
import { SleepDashboard } from './SleepDashboard'

interface HealthDashboardProps {
  selectedDate: Date
  records: WeightRecord[]
  sleepRecords: SleepRecord[]
  mealRecords: MealRecord[]
  exerciseSessions: ExerciseSession[]
  profile: HealthProfile | null
  onPreviousDay: () => void
  onNextDay: () => void
  onToday: () => void
  onDateChange: (dateKey: string) => void
  onOpenWeight: () => void
  onOpenProfile: () => void
  onOpenSleep: () => void
  onOpenMeal: () => void
  onOpenExercise: (session: ExerciseSession | null) => void
}

const weekdayLabels = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日']
const upcomingItems = ['体調メモ']

export function HealthDashboard({
  selectedDate,
  records,
  sleepRecords,
  mealRecords,
  exerciseSessions,
  profile,
  onPreviousDay,
  onNextDay,
  onToday,
  onDateChange,
  onOpenWeight,
  onOpenProfile,
  onOpenSleep,
  onOpenMeal,
  onOpenExercise,
}: HealthDashboardProps) {
  const [activeSection, setActiveSection] = useState<'daily' | 'weight' | 'sleep'>('daily')
  const dateKey = toDateKey(selectedDate)
  const record = records.find((item) => item.date === dateKey) ?? null
  const sleepRecord = sleepRecords.find((item) => item.date === dateKey) ?? null
  const mealRecord = mealRecords.find((item) => item.date === dateKey) ?? null
  const dailyExerciseSessions = exerciseSessions
    .filter((item) => item.date === dateKey)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  const exerciseSummary = calculateDailyExerciseSummary(dailyExerciseSessions)

  return (
    <div className="health-dashboard">
      <div className="content-heading health-heading">
        <div>
          <p className="eyebrow">Health log</p>
          <h2>健康記録</h2>
        </div>
        <p className="content-note">毎日の変化を、無理なく記録。</p>
      </div>

      <div className="health-view-tabs" role="group" aria-label="健康記録の表示切り替え">
        <button type="button" className={activeSection === 'daily' ? 'is-active' : ''} aria-pressed={activeSection === 'daily'} onClick={() => setActiveSection('daily')}>日付別記録</button>
        <button type="button" className={activeSection === 'weight' ? 'is-active' : ''} aria-pressed={activeSection === 'weight'} onClick={() => setActiveSection('weight')}>体重まとめ</button>
        <button type="button" className={activeSection === 'sleep' ? 'is-active' : ''} aria-pressed={activeSection === 'sleep'} onClick={() => setActiveSection('sleep')}>睡眠まとめ</button>
      </div>

      {activeSection === 'daily' ? <>
        <section className="health-date-toolbar" aria-label="健康記録の日付選択">
          <div><p className="health-date-label">共通選択日</p><strong>{selectedDate.getFullYear()}年{selectedDate.getMonth() + 1}月{selectedDate.getDate()}日</strong><span>{weekdayLabels[selectedDate.getDay()]}</span></div>
          <HealthDateNavigator date={selectedDate} onPreviousDay={onPreviousDay} onNextDay={onNextDay} onToday={onToday} onDateChange={onDateChange} showToday showDateInput label="健康記録" />
        </section>

        <div className="health-card-grid">
        <section className="weight-card">
          <div className="health-card-header">
            <div>
              <p className="health-card-kicker">Weight</p>
              <h3>体重</h3>
            </div>
            <HealthDateNavigator date={selectedDate} onPreviousDay={onPreviousDay} onNextDay={onNextDay} onToday={onToday} onDateChange={onDateChange} compact label="体重記録" />
          </div>

          {record ? (
            <div className="weight-record-summary">
              <p className="weight-value"><strong>{record.weightKg.toFixed(1)}</strong><span>kg</span></p>
              {record.memo && <p className="weight-memo">{record.memo}</p>}
              <button type="button" className="health-primary-button" onClick={onOpenWeight}>編集</button>
            </div>
          ) : (
            <div className="weight-empty-state">
              <p>この日の体重記録はありません</p>
              <button type="button" className="health-primary-button" onClick={onOpenWeight}>体重を記録</button>
            </div>
          )}

          <p className="health-future-note">最新体重、目標、期間平均、グラフは「体重まとめ」で確認できます。</p>
        </section>

        <section className="sleep-card">
          <div className="health-card-header">
            <div>
              <p className="health-card-kicker">Sleep</p>
              <h3>睡眠</h3>
            </div>
            <HealthDateNavigator date={selectedDate} onPreviousDay={onPreviousDay} onNextDay={onNextDay} onToday={onToday} onDateChange={onDateChange} compact label="睡眠記録" />
          </div>
          {sleepRecord ? (
            <div className="sleep-record-summary">
              <p className="sleep-value-label">実睡眠時間</p>
              <p className="sleep-value">{formatDurationMinutes(sleepRecord.sleepMinutes)}</p>
              <p className="sleep-time-line">就寝 {sleepRecord.bedtime} → 起床 {sleepRecord.wakeTime}</p>
              <p className="sleep-awakening-line">途中覚醒 {sleepRecord.awakenings.length}回・合計{formatDurationMinutes(sleepRecord.awakeMinutes)}</p>
              {sleepRecord.memo && <p className="sleep-card-memo">{sleepRecord.memo}</p>}
              <button type="button" className="health-primary-button" onClick={onOpenSleep}>編集</button>
            </div>
          ) : (
            <div className="weight-empty-state">
              <p>この日の睡眠記録はありません</p>
              <button type="button" className="health-primary-button" onClick={onOpenSleep}>睡眠を記録</button>
            </div>
          )}
        </section>

        <section className="meal-card">
          <div className="health-card-header">
            <div><p className="health-card-kicker">Meals</p><h3>食事</h3></div>
            <HealthDateNavigator date={selectedDate} onPreviousDay={onPreviousDay} onNextDay={onNextDay} onToday={onToday} onDateChange={onDateChange} compact label="食事記録" />
          </div>
          {mealRecord ? (
            <div className="meal-record-summary">
              {([
                ['breakfast', '朝食'], ['lunch', '昼食'], ['dinner', '夕食'], ['snacks', '間食'],
              ] as const).map(([key, label]) => mealRecord[key] && <div className="meal-summary-item" key={key}><h4>{label}</h4><p>{mealRecord[key]}</p></div>)}
              <button type="button" className="health-primary-button" onClick={onOpenMeal}>編集</button>
            </div>
          ) : (
            <div className="weight-empty-state"><p>この日の食事記録はありません</p><button type="button" className="health-primary-button" onClick={onOpenMeal}>食事を記録</button></div>
          )}
        </section>

        <section className="exercise-card">
          <div className="health-card-header">
            <div><p className="health-card-kicker">Exercise</p><h3>運動</h3></div>
            <HealthDateNavigator date={selectedDate} onPreviousDay={onPreviousDay} onNextDay={onNextDay} onToday={onToday} onDateChange={onDateChange} compact label="運動記録" />
          </div>
          {dailyExerciseSessions.length === 0 ? (
            <div className="weight-empty-state"><p>この日の運動記録はありません</p><button type="button" className="health-primary-button" onClick={() => onOpenExercise(null)}>運動を記録</button></div>
          ) : (
            <div className="exercise-record-summary">
              <div className="exercise-daily-totals" aria-label="この日の運動合計">
                <div><span>合計時間</span><strong>{formatExerciseDuration(exerciseSummary.totalDurationMinutes)}</strong></div>
                <div><span>推定消費</span><strong>{exerciseSummary.totalEstimatedCaloriesKcal === null ? '計算できません' : `${exerciseSummary.totalEstimatedCaloriesKcal} kcal`}</strong></div>
                <div><span>セッション</span><strong>{exerciseSummary.sessionCount}件</strong></div>
              </div>
              {exerciseSummary.calculatedCount > 0 && exerciseSummary.calculatedCount < exerciseSummary.sessionCount && <p className="exercise-partial-note">計算済みの{exerciseSummary.calculatedCount}件を合計しています。</p>}
              <div className="exercise-session-list">
                {dailyExerciseSessions.map((session) => (
                  <article className="exercise-session-item" key={session.id}>
                    <div><h4>{getExerciseDisplayName(session.exerciseType, session.customName)}</h4><p>{formatExerciseDuration(session.durationMinutes)}{session.averageHeartRate !== null ? ` / 心拍 ${session.averageHeartRate} bpm` : ''}{session.estimatedCaloriesKcal !== null ? ` / 推定 ${session.estimatedCaloriesKcal} kcal` : ''}</p>{session.memo && <p className="exercise-session-memo">{session.memo}</p>}</div>
                    <button type="button" className="health-secondary-button" onClick={() => onOpenExercise(session)} aria-label={`${getExerciseDisplayName(session.exerciseType, session.customName)}を編集`}>編集</button>
                  </article>
                ))}
              </div>
              <button type="button" className="health-primary-button" onClick={() => onOpenExercise(null)}>運動を追加</button>
              <p className="exercise-estimate-note">推定消費カロリーはMETs・体重・時間から算出した概算です。</p>
            </div>
          )}
        </section>

        <section className="upcoming-health-card">
          <p className="health-card-kicker">Coming later</p>
          <h3>今後追加予定</h3>
          <ul>
            {upcomingItems.map((item) => <li key={item}>{item}<span>未実装</span></li>)}
          </ul>
        </section>
        </div>
      </> : activeSection === 'weight' ? (
        <WeightDashboard records={records} profile={profile} onOpenProfile={onOpenProfile} />
      ) : (
        <SleepDashboard records={sleepRecords} />
      )}
    </div>
  )
}
