import { useState } from 'react'
import { CaretLeftIcon } from '@phosphor-icons/react/CaretLeft'
import { CaretRightIcon } from '@phosphor-icons/react/CaretRight'
import type { HealthProfile, SleepRecord, WeightRecord } from '../types/health'
import { toDateKey } from '../utils/date'
import { calculateAge, formatCalculationSex } from '../utils/healthProfile'
import { formatDurationMinutes } from '../utils/sleepMetrics'
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
  const dateLabel = `${selectedDate.getFullYear()}年${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日`
  const age = profile?.birthDate ? calculateAge(profile.birthDate) : null

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
        <section className="health-date-card" aria-label="健康記録の日付選択">
        <div>
          <p className="health-date-label">選択中の日付</p>
          <h3>{dateLabel}</h3>
          <p>{weekdayLabels[selectedDate.getDay()]}</p>
        </div>
        <div className="health-date-controls">
          <button type="button" className="health-date-button icon-only" onClick={onPreviousDay} aria-label="前日の健康記録を表示">
            <CaretLeftIcon size={20} weight="bold" aria-hidden="true" />
          </button>
          <label className="health-date-input">
            <span>日付を選択</span>
            <input type="date" value={dateKey} onChange={(event) => onDateChange(event.target.value)} />
          </label>
          <button type="button" className="health-date-button icon-only" onClick={onNextDay} aria-label="次日の健康記録を表示">
            <CaretRightIcon size={20} weight="bold" aria-hidden="true" />
          </button>
          <button type="button" className="health-date-button" onClick={onToday} aria-label="今日の健康記録を表示">今日</button>
        </div>
        </section>

        <section className="health-profile-card" aria-labelledby="health-profile-heading">
        <div className="health-card-header">
          <div>
            <p className="health-card-kicker">Profile</p>
            <h3 id="health-profile-heading">健康プロフィール</h3>
          </div>
          {profile && <span className="health-card-status">本人用</span>}
        </div>
        {profile ? (
          <>
            <dl className="health-profile-list">
              {profile.heightCm !== null && <div><dt>身長</dt><dd>{profile.heightCm.toFixed(1)} cm</dd></div>}
              {profile.birthDate && <div><dt>生年月日</dt><dd>{profile.birthDate}{age !== null ? `（${age}歳）` : ''}</dd></div>}
              <div><dt>計算用の性別</dt><dd>{formatCalculationSex(profile.calculationSex)}</dd></div>
              {profile.targetWeightKg !== null && <div><dt>目標体重</dt><dd>{profile.targetWeightKg.toFixed(1)} kg</dd></div>}
            </dl>
            <button type="button" className="health-primary-button" onClick={onOpenProfile}>編集</button>
          </>
        ) : (
          <div className="health-profile-empty">
            <p>健康プロフィールは未設定です</p>
            <button type="button" className="health-primary-button" onClick={onOpenProfile}>設定する</button>
          </div>
        )}
        <p className="health-profile-note">身長・生年月日・計算用の性別・目標体重は、今後の体重集計や運動消費カロリーの概算に使用します。</p>
        </section>

        <div className="health-card-grid">
        <section className="weight-card">
          <div className="health-card-header">
            <div>
              <p className="health-card-kicker">Weight</p>
              <h3>体重</h3>
            </div>
            <span className="health-card-status">1日1件</span>
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
            <span className="health-card-status">1日1件</span>
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
