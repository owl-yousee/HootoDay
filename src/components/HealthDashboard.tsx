import { useState } from 'react'
import type { HealthProfile, SleepRecord, WeightRecord } from '../types/health'
import { toDateKey } from '../utils/date'
import { formatDurationMinutes } from '../utils/sleepMetrics'
import { HealthDateNavigator } from './HealthDateNavigator'
import { WeightDashboard } from './WeightDashboard'
import { SleepDashboard } from './SleepDashboard'

interface HealthDashboardProps {
  selectedDate: Date
  records: WeightRecord[]
  sleepRecords: SleepRecord[]
  profile: HealthProfile | null
  onPreviousDay: () => void
  onNextDay: () => void
  onToday: () => void
  onDateChange: (dateKey: string) => void
  onOpenWeight: () => void
  onOpenProfile: () => void
  onOpenSleep: () => void
}

const weekdayLabels = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日']
const upcomingItems = ['食事', '運動', '体調メモ']

export function HealthDashboard({
  selectedDate,
  records,
  sleepRecords,
  profile,
  onPreviousDay,
  onNextDay,
  onToday,
  onDateChange,
  onOpenWeight,
  onOpenProfile,
  onOpenSleep,
}: HealthDashboardProps) {
  const [activeSection, setActiveSection] = useState<'daily' | 'weight' | 'sleep'>('daily')
  const dateKey = toDateKey(selectedDate)
  const record = records.find((item) => item.date === dateKey) ?? null
  const sleepRecord = sleepRecords.find((item) => item.date === dateKey) ?? null

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
