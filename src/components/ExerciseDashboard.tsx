import { useMemo, useState } from 'react'
import { getExerciseDisplayName } from '../data/exerciseTypes'
import type { ExerciseSession } from '../types/health'
import { formatDateKeyJa, fromDateKey, toDateKey } from '../utils/date'
import { formatExerciseDuration } from '../utils/exerciseMetrics'
import {
  buildExerciseSummary,
  getExerciseSummaryRange,
  type ExerciseSummaryPeriod,
} from '../utils/exerciseSummary'
import { ExerciseTrendChart } from './ExerciseTrendChart'

interface ExerciseDashboardProps {
  sessions: ExerciseSession[]
  onOpenDaily: () => void
}

const periodOptions: Array<{ id: ExerciseSummaryPeriod; label: string }> = [
  { id: 'week', label: '1週間' },
  { id: 'month', label: '1か月' },
  { id: 'halfYear', label: '半年' },
  { id: 'year', label: '1年' },
]

function getInitialBaseDate(sessions: ExerciseSession[]): string {
  return sessions.length === 0
    ? toDateKey(new Date())
    : [...sessions].sort((left, right) => right.date.localeCompare(left.date))[0].date
}

function formatMets(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function ExerciseDashboard({ sessions, onOpenDaily }: ExerciseDashboardProps) {
  const [period, setPeriod] = useState<ExerciseSummaryPeriod>('month')
  const [baseDate, setBaseDate] = useState(() => getInitialBaseDate(sessions))
  const range = useMemo(() => getExerciseSummaryRange(period, baseDate), [period, baseDate])
  const summary = useMemo(() => buildExerciseSummary(sessions, range, period), [sessions, range, period])
  const periodLabel = periodOptions.find((option) => option.id === period)?.label ?? '1か月'
  const groupedSessions = useMemo(() => {
    const groups = new Map<string, ExerciseSession[]>()
    summary.sessions.forEach((session) => groups.set(session.date, [...(groups.get(session.date) ?? []), session]))
    return [...groups.entries()]
  }, [summary.sessions])

  return (
    <div className="exercise-dashboard">
      <div className="exercise-summary-heading">
        <div><p className="health-card-kicker">Exercise overview</p><h2>運動まとめ</h2></div>
        <p>保存済みの運動記録を、期間別・種類別に振り返ります。</p>
      </div>

      <section className="exercise-summary-controls" aria-labelledby="exercise-period-heading">
        <div>
          <h3 id="exercise-period-heading">集計期間</h3>
          <div className="exercise-summary-periods" aria-label="運動まとめの集計期間">
            {periodOptions.map((option) => <button key={option.id} type="button" className={period === option.id ? 'is-active' : ''} aria-pressed={period === option.id} onClick={() => setPeriod(option.id)}>{option.label}</button>)}
          </div>
        </div>
        <label className="exercise-summary-date" htmlFor="exercise-summary-base-date"><span>基準日</span><input id="exercise-summary-base-date" type="date" value={baseDate} onChange={(event) => { if (fromDateKey(event.target.value)) setBaseDate(event.target.value) }} /></label>
        <p className="exercise-summary-range"><span>対象期間</span><strong>{formatDateKeyJa(range.startDate)} ～ {formatDateKeyJa(range.endDate)}</strong></p>
      </section>

      {summary.sessionCount === 0 ? (
        <section className="exercise-summary-empty" aria-labelledby="exercise-empty-title">
          <p className="health-card-kicker">No records</p>
          <h3 id="exercise-empty-title">この期間の運動記録はありません</h3>
          <p>日付別記録から運動を追加できます。</p>
          <button type="button" className="health-primary-button" onClick={onOpenDaily}>日付別記録を開く</button>
        </section>
      ) : <>
        <div className="exercise-summary-metrics" aria-label="運動集計の概要">
          <article><span>合計回数</span><strong>{summary.sessionCount}<small>回</small></strong></article>
          <article><span>運動日数</span><strong>{summary.activeDays}<small>日</small></strong></article>
          <article><span>合計時間</span><strong>{formatExerciseDuration(summary.totalMinutes)}</strong></article>
          <article><span>推定消費カロリー</span><strong>{summary.totalCalories === null ? '計算データなし' : `${summary.totalCalories} kcal`}</strong>{summary.calculatedCaloriesCount > 0 && summary.calculatedCaloriesCount < summary.sessionCount && <small>計算可能な{summary.calculatedCaloriesCount}件の合計</small>}</article>
        </div>

        <section className="exercise-average-card" aria-labelledby="exercise-average-title">
          <div><p className="health-card-kicker">Frequency</p><h3 id="exercise-average-title">運動頻度</h3></div>
          <dl><div><dt>1回あたり平均時間</dt><dd>平均{summary.averageMinutesPerSession}分</dd></div><div><dt>1週間あたり平均運動日数</dt><dd>週平均{summary.averageActiveDaysPerWeek?.toFixed(1)}日</dd></div><div><dt>期間内</dt><dd>{summary.rangeDays}日中 {summary.activeDays}日</dd></div></dl>
        </section>

        <section className="exercise-trend-section" aria-labelledby="exercise-trend-title">
          <div className="exercise-summary-section-heading"><div><p className="health-card-kicker">Trend</p><h3 id="exercise-trend-title">日別・月別推移</h3></div><p>{period === 'week' || period === 'month' ? '日ごとの合計時間' : '月ごとの合計時間'}</p></div>
          <ExerciseTrendChart points={summary.trend} periodLabel={periodLabel} />
        </section>

        <section className="exercise-type-section" aria-labelledby="exercise-type-title">
          <div className="exercise-summary-section-heading"><div><p className="health-card-kicker">By type</p><h3 id="exercise-type-title">種類別集計</h3></div><p>合計時間の多い順</p></div>
          <ul className="exercise-type-summary-list">
            {summary.byType.map((item) => <li key={item.exerciseType}>
              <div className="exercise-type-summary-heading"><strong>{item.label}</strong><span>全体の{Math.round(item.percentageOfTime)}%</span></div>
              <div className="exercise-type-progress" aria-hidden="true"><span style={{ width: `${Math.min(100, item.percentageOfTime)}%` }} /></div>
              <dl><div><dt>回数</dt><dd>{item.sessionCount}回</dd></div><div><dt>合計時間</dt><dd>{formatExerciseDuration(item.totalMinutes)}</dd></div>{item.totalCalories !== null && <div><dt>推定消費</dt><dd>{item.totalCalories} kcal</dd></div>}</dl>
            </li>)}
          </ul>
        </section>

        <section className="exercise-history-section" aria-labelledby="exercise-history-title">
          <div className="exercise-summary-section-heading"><div><p className="health-card-kicker">History</p><h3 id="exercise-history-title">運動記録一覧</h3></div><p>{summary.sessionCount}件・日付降順</p></div>
          <div className="exercise-history-groups">
            {groupedSessions.map(([date, dateSessions]) => <section key={date} aria-labelledby={`exercise-history-${date}`}><h4 id={`exercise-history-${date}`}>{formatDateKeyJa(date)}</h4><ul>{dateSessions.map((session) => <li key={session.id}>
              <div className="exercise-history-main"><strong>{getExerciseDisplayName(session.exerciseType, session.customName)}</strong><span>{formatExerciseDuration(session.durationMinutes)}</span></div>
              <dl><div><dt>METs</dt><dd>{formatMets(session.mets)}</dd></div>{session.averageHeartRate !== null && <div><dt>心拍数</dt><dd>{session.averageHeartRate} bpm</dd></div>}{session.estimatedCaloriesKcal !== null && <div><dt>推定消費</dt><dd>{session.estimatedCaloriesKcal} kcal</dd></div>}</dl>
              {session.memo && <p>{session.memo}</p>}
            </li>)}</ul></section>)}
          </div>
        </section>

        <p className="exercise-summary-note">保存済みの推定消費カロリーを端末内で集計しています。本人の振り返り用の推定値であり、運動評価や医療判断は行いません。</p>
      </>}
    </div>
  )
}
