import { useMemo, useState } from 'react'
import { bodyPartConditionLabels, conditionLevelLabels, getConditionTone } from '../data/conditionOptions'
import type { DailyConditionRecord } from '../types/health'
import { formatDateKeyJa, fromDateKey, toDateKey } from '../utils/date'
import {
  buildConditionSummary,
  buildConditionTrend,
  getConditionSummaryRange,
  type ConditionStateCount,
  type ConditionSummaryPeriod,
  type ConditionTrendTarget,
} from '../utils/conditionSummary'
import { ConditionTrendChart } from './ConditionTrendChart'

interface ConditionDashboardProps {
  records: DailyConditionRecord[]
  onOpenDaily: () => void
}

const periodOptions: Array<{ id: ConditionSummaryPeriod; label: string }> = [
  { id: 'week', label: '1週間' },
  { id: 'month', label: '1か月' },
  { id: 'halfYear', label: '半年' },
  { id: 'year', label: '1年' },
]

const targetOptions: Array<{ id: ConditionTrendTarget; label: string }> = [
  { id: 'overall', label: '全体' },
  { id: 'knee', label: '膝' },
  { id: 'lowerBack', label: '腰' },
]

function getInitialBaseDate(records: DailyConditionRecord[]): string {
  return records.length === 0
    ? toDateKey(new Date())
    : [...records].sort((left, right) => right.date.localeCompare(left.date))[0].date
}

function formatPercentage(value: number): string {
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`
}

function StateSummary({ title, items, emptyText }: { title: string; items: Array<ConditionStateCount<string>>; emptyText: string }) {
  return <section className="condition-state-card"><h4>{title}</h4>{items.length === 0 ? <p>{emptyText}</p> : <ul>{items.map((item) => <li key={item.value}>
    <div><span className={`condition-state-dot is-${getConditionTone(item.value as Parameters<typeof getConditionTone>[0])}`} aria-hidden="true" /><strong>{item.label}</strong><span>{item.count}日・{formatPercentage(item.percentage)}</span></div>
    <div className="condition-state-progress" aria-hidden="true"><span className={`is-${getConditionTone(item.value as Parameters<typeof getConditionTone>[0])}`} style={{ width: `${item.percentage}%` }} /></div>
  </li>)}</ul>}</section>
}

export function ConditionDashboard({ records, onOpenDaily }: ConditionDashboardProps) {
  const [period, setPeriod] = useState<ConditionSummaryPeriod>('month')
  const [baseDate, setBaseDate] = useState(() => getInitialBaseDate(records))
  const [trendTarget, setTrendTarget] = useState<ConditionTrendTarget>('overall')
  const range = useMemo(() => getConditionSummaryRange(period, baseDate), [period, baseDate])
  const summary = useMemo(() => buildConditionSummary(records, range), [records, range])
  const trend = useMemo(() => buildConditionTrend(records, range, period, trendTarget), [records, range, period, trendTarget])
  const periodLabel = periodOptions.find((option) => option.id === period)?.label ?? '1か月'
  const targetLabel = targetOptions.find((option) => option.id === trendTarget)?.label ?? '全体'

  return (
    <div className="condition-dashboard">
      <div className="condition-summary-heading">
        <div><p className="health-card-kicker">Condition overview</p><h2>体調まとめ</h2></div>
        <p>保存済みの体調記録を、評価せずそのまま期間別に振り返ります。</p>
      </div>

      <section className="exercise-summary-controls" aria-labelledby="condition-period-heading">
        <div><h3 id="condition-period-heading">集計期間</h3><div className="exercise-summary-periods" aria-label="体調まとめの集計期間">{periodOptions.map((option) => <button key={option.id} type="button" className={period === option.id ? 'is-active' : ''} aria-pressed={period === option.id} onClick={() => setPeriod(option.id)}>{option.label}</button>)}</div></div>
        <label className="exercise-summary-date" htmlFor="condition-summary-base-date"><span>基準日</span><input id="condition-summary-base-date" type="date" value={baseDate} onChange={(event) => { if (fromDateKey(event.target.value)) setBaseDate(event.target.value) }} /></label>
        <p className="exercise-summary-range"><span>対象期間</span><strong>{formatDateKeyJa(range.startDate)} ～ {formatDateKeyJa(range.endDate)}</strong></p>
      </section>

      {summary.recordDays === 0 ? (
        <section className="condition-summary-empty" aria-labelledby="condition-empty-title"><p className="health-card-kicker">No records</p><h3 id="condition-empty-title">この期間の体調記録はありません</h3><p>日付別記録から体調を追加できます。</p><button type="button" className="health-primary-button" onClick={onOpenDaily}>日付別記録を開く</button></section>
      ) : <>
        <div className="condition-summary-metrics" aria-label="体調集計の概要">
          <article><span>記録日数</span><strong>{summary.recordDays}<small>日</small></strong></article>
          <article><span>全体の体調</span><strong>{summary.overallRecordedDays}<small>日</small></strong></article>
          <article><span>膝の記録</span><strong>{summary.kneeRecordedDays}<small>日</small></strong></article>
          <article><span>腰の記録</span><strong>{summary.lowerBackRecordedDays}<small>日</small></strong></article>
        </div>

        <section className="condition-breakdown-section" aria-labelledby="condition-breakdown-title"><div className="condition-summary-section-heading"><div><p className="health-card-kicker">Breakdown</p><h3 id="condition-breakdown-title">状態別の内訳</h3></div><p>保存時の選択肢順で表示</p></div><div className="condition-state-grid">
          <StateSummary title="全体の体調" items={summary.overallCounts} emptyText="この期間の全体の体調記録はありません" />
          <StateSummary title="膝" items={summary.kneeCounts} emptyText="この期間の膝記録はありません" />
          <StateSummary title="腰" items={summary.lowerBackCounts} emptyText="この期間の腰記録はありません" />
        </div></section>

        <section className="condition-trend-section" aria-labelledby="condition-trend-title"><div className="condition-summary-section-heading"><div><p className="health-card-kicker">Trend</p><h3 id="condition-trend-title">状態の推移</h3></div><p>{period === 'week' || period === 'month' ? '日ごとの記録' : '月ごとの状態件数'}</p></div><div className="condition-trend-targets" role="group" aria-label="推移の表示対象">{targetOptions.map((option) => <button key={option.id} type="button" className={trendTarget === option.id ? 'is-active' : ''} aria-pressed={trendTarget === option.id} onClick={() => setTrendTarget(option.id)}>{option.label}</button>)}</div><ConditionTrendChart points={trend} periodLabel={periodLabel} targetLabel={targetLabel} /></section>

        <section className="condition-note-counts" aria-labelledby="condition-note-count-title"><div className="condition-summary-section-heading"><div><p className="health-card-kicker">Notes</p><h3 id="condition-note-count-title">文章記録の日数</h3></div></div><div><article><span>生理・周期メモ</span><strong>{summary.menstrualNoteDays}日</strong></article><article><span>気になること</span><strong>{summary.concernsDays}日</strong></article><article><span>自由メモ</span><strong>{summary.memoDays}日</strong></article></div></section>

        <section className="condition-history-section" aria-labelledby="condition-history-title"><div className="condition-summary-section-heading"><div><p className="health-card-kicker">History</p><h3 id="condition-history-title">体調記録一覧</h3></div><p>{summary.recordDays}日・日付降順</p></div><ol className="condition-history-list">{summary.records.map((record) => <li key={record.date}><h4>{formatDateKeyJa(record.date)}</h4><dl>
          {record.overallCondition !== 'unset' && <div><dt>全体</dt><dd className={`condition-badge is-${getConditionTone(record.overallCondition)}`}>{conditionLevelLabels[record.overallCondition]}</dd></div>}
          {record.kneeCondition !== 'unset' && <div><dt>膝</dt><dd className={`condition-badge is-${getConditionTone(record.kneeCondition)}`}>{bodyPartConditionLabels[record.kneeCondition]}</dd></div>}
          {record.lowerBackCondition !== 'unset' && <div><dt>腰</dt><dd className={`condition-badge is-${getConditionTone(record.lowerBackCondition)}`}>{bodyPartConditionLabels[record.lowerBackCondition]}</dd></div>}
        </dl><div className="condition-history-notes">{record.menstrualNote && <div><strong>生理・周期メモ</strong><p>{record.menstrualNote}</p></div>}{record.concerns && <div><strong>気になること</strong><p>{record.concerns}</p></div>}{record.memo && <div><strong>自由メモ</strong><p>{record.memo}</p></div>}</div></li>)}</ol></section>

        <p className="condition-summary-note">この画面は本人の記録の振り返り用で、医療判断・診断・病名推定・緊急度判定は行いません。</p>
      </>}
    </div>
  )
}
