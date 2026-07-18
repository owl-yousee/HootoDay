import { useState } from 'react'
import type { SleepRecord } from '../types/health'
import { formatDateKeyJa } from '../utils/date'
import { getLocalTodayKey } from '../utils/healthProfile'
import { formatDurationMinutes } from '../utils/sleepMetrics'
import {
  calculateSleepPeriodStatistics,
  filterSleepRecordsByRange,
  getLatestMemoSleepRecords,
  getLatestSleepRecord,
  getPreviousSleepRecord,
  getSleepRange,
  type SleepPeriod,
} from '../utils/sleepStatistics'
import { SleepChart } from './SleepChart'

interface SleepDashboardProps {
  records: SleepRecord[]
}

const periodOptions: { id: SleepPeriod; label: string }[] = [
  { id: '7d', label: '7日' }, { id: '30d', label: '30日' }, { id: '6m', label: '6か月' }, { id: '1y', label: '1年' }, { id: 'all', label: '全期間' },
]

const averageOptions: { id: Exclude<SleepPeriod, 'all'>; label: string }[] = [
  { id: '7d', label: '7日平均' }, { id: '30d', label: '30日平均' }, { id: '6m', label: '6か月平均' }, { id: '1y', label: '1年平均' },
]

function differenceText(value: number | null): string {
  if (value === null) return '前回記録はありません'
  if (value === 0) return '前回と同じ'
  return `前回より${value > 0 ? '' : '−'}${formatDurationMinutes(Math.abs(value))}`
}

function countText(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}回`
}

export function SleepDashboard({ records }: SleepDashboardProps) {
  const [period, setPeriod] = useState<SleepPeriod>('30d')
  const latest = getLatestSleepRecord(records)
  const previous = getPreviousSleepRecord(records)
  const baseDate = latest?.date ?? getLocalTodayKey()
  const selectedRange = getSleepRange(period, baseDate)
  const chartRecords = filterSleepRecordsByRange(records, selectedRange)
  const selectedStatistics = calculateSleepPeriodStatistics(records, selectedRange)
  const selectedPeriodLabel = periodOptions.find((option) => option.id === period)?.label ?? '30日'
  const memoRecords = getLatestMemoSleepRecords(records)
  const memoCount = records.filter((record) => record.memo.trim().length > 0).length

  return (
    <div className="sleep-dashboard">
      <div className="sleep-summary-heading">
        <div><p className="health-card-kicker">Sleep overview</p><h3>睡眠まとめ</h3></div>
        <p>集計基準：{formatDateKeyJa(baseDate)}</p>
      </div>

      <section className="sleep-latest-card" aria-labelledby="sleep-latest-heading">
        <div><p className="health-card-kicker">Latest</p><h3 id="sleep-latest-heading">最新の睡眠</h3></div>
        {latest ? <div className="sleep-latest-content">
          <div className="sleep-latest-primary"><strong>{formatDurationMinutes(latest.sleepMinutes)}</strong><span>{formatDateKeyJa(latest.date)}</span><span>{differenceText(previous ? latest.sleepMinutes - previous.sleepMinutes : null)}</span></div>
          <dl className="sleep-latest-details">
            <div><dt>就寝</dt><dd>{latest.bedtime}</dd></div><div><dt>起床</dt><dd>{latest.wakeTime}</dd></div>
            <div><dt>総就床時間</dt><dd>{formatDurationMinutes(latest.totalInBedMinutes)}</dd></div><div><dt>実睡眠時間</dt><dd>{formatDurationMinutes(latest.sleepMinutes)}</dd></div>
            <div><dt>途中覚醒</dt><dd>{latest.awakenings.length}回</dd></div><div><dt>覚醒合計</dt><dd>{formatDurationMinutes(latest.awakeMinutes)}</dd></div>
          </dl>
        </div> : <p className="sleep-empty-message">睡眠記録がありません。日付別記録から入力すると集計されます。</p>}
      </section>

      <section className="sleep-chart-section" aria-labelledby="sleep-chart-heading">
        <div className="sleep-section-heading"><div><p className="health-card-kicker">Chart</p><h3 id="sleep-chart-heading">実睡眠時間グラフ</h3></div><div className="sleep-period-controls" aria-label="睡眠グラフ期間">{periodOptions.map((option) => <button key={option.id} type="button" className={period === option.id ? 'is-active' : ''} aria-pressed={period === option.id} onClick={() => setPeriod(option.id)}>{option.label}</button>)}</div></div>
        <div className="sleep-chart-summary" aria-label="睡眠グラフの数値概要">
          <span>対象：{selectedPeriodLabel}</span><span>記録：{selectedStatistics.count}件</span>
          <span>平均：{selectedStatistics.averageSleepMinutes === null ? '—' : formatDurationMinutes(selectedStatistics.averageSleepMinutes)}</span>
          <span>最短：{selectedStatistics.minimumSleepMinutes === null ? '—' : formatDurationMinutes(selectedStatistics.minimumSleepMinutes)}</span>
          <span>最長：{selectedStatistics.maximumSleepMinutes === null ? '—' : formatDurationMinutes(selectedStatistics.maximumSleepMinutes)}</span>
          <span>最新：{latest ? formatDurationMinutes(latest.sleepMinutes) : '—'}</span>
        </div>
        <SleepChart records={chartRecords} periodLabel={selectedPeriodLabel} />
      </section>

      <section className="sleep-trend-card"><p className="health-card-kicker">Awakenings</p><h3>途中覚醒傾向</h3>{selectedStatistics.count === 0 ? <p>この期間の記録はありません</p> : <dl><div><dt>平均覚醒時間</dt><dd>{formatDurationMinutes(selectedStatistics.averageAwakeMinutes ?? 0)}</dd></div><div><dt>最大覚醒時間</dt><dd>{formatDurationMinutes(selectedStatistics.maximumAwakeMinutes ?? 0)}</dd></div><div><dt>平均回数</dt><dd>{countText(selectedStatistics.averageAwakeningCount)}</dd></div><div><dt>最大回数</dt><dd>{selectedStatistics.maximumAwakeningCount}回</dd></div></dl>}</section>

      <section className="sleep-average-section" aria-labelledby="sleep-average-heading">
        <div className="sleep-section-heading"><div><p className="health-card-kicker">Average</p><h3 id="sleep-average-heading">期間平均</h3></div><p>記録のない日は平均に含めません</p></div>
        <div className="sleep-average-grid">
          {averageOptions.map((option) => {
            const statistics = calculateSleepPeriodStatistics(records, getSleepRange(option.id, baseDate))
            return <article className="sleep-average-card" key={option.id}>
              <h4>{option.label}</h4>
              {statistics.count === 0 ? <strong>記録がありません</strong> : <>
                <strong>{formatDurationMinutes(statistics.averageSleepMinutes ?? 0)}</strong>
                <dl><div><dt>就床</dt><dd>{formatDurationMinutes(statistics.averageInBedMinutes ?? 0)}</dd></div><div><dt>覚醒</dt><dd>{formatDurationMinutes(statistics.averageAwakeMinutes ?? 0)}</dd></div><div><dt>覚醒回数</dt><dd>{countText(statistics.averageAwakeningCount)}</dd></div><div><dt>平均時刻</dt><dd>{statistics.averageBedtime} → {statistics.averageWakeTime}</dd></div></dl>
              </>}
              <small>記録{statistics.count}件・{statistics.range.startDate ? `${formatDateKeyJa(statistics.range.startDate)}〜` : ''}{formatDateKeyJa(statistics.range.endDate)}</small>
            </article>
          })}
        </div>
        <p className="sleep-average-method">平均就寝・起床時刻は、24時間を円として扱う円周平均で計算しています。深夜0時をまたぐ時刻も連続した時刻として集計します。</p>
      </section>

      <section className="sleep-memo-card"><p className="health-card-kicker">Notes</p><h3>メモ付き記録 <small>{memoCount}件</small></h3>{memoRecords.length === 0 ? <p>メモ付きの睡眠記録はありません</p> : <ul>{memoRecords.map((record) => <li key={record.date}><time dateTime={record.date}>{formatDateKeyJa(record.date)}</time><p>{record.memo}</p></li>)}</ul>}</section>

      <p className="sleep-medical-note">睡眠時間と途中覚醒は本人入力による概算記録です。医療機器による測定、医療診断、睡眠状態の評価を行うものではありません。</p>
    </div>
  )
}
