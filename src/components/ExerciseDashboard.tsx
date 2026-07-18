import { useMemo, useState } from 'react'
import { getExerciseDisplayName } from '../data/exerciseTypes'
import type { ExerciseSession } from '../types/health'
import { formatDateKeyJa, fromDateKey, toDateKey } from '../utils/date'
import { formatExerciseDuration } from '../utils/exerciseMetrics'
import { groupExerciseSessionsByDateAndType, type ExerciseHistoryGroup } from '../utils/exerciseHistory'
import {
  buildExerciseSummary,
  getExerciseSummaryRange,
  type ExerciseSummaryPeriod,
} from '../utils/exerciseSummary'
import { ExerciseTrendChart } from './ExerciseTrendChart'

interface ExerciseDashboardProps {
  sessions: ExerciseSession[]
  onOpenDaily: () => void
  onEditSession: (session: ExerciseSession) => void
  onDeleteSession: (sessionId: string) => void
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

function formatRecordedTime(value: string): string | null {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}

interface ExerciseHistoryRecordProps {
  session: ExerciseSession
  onEdit: (session: ExerciseSession) => void
  onDelete: (session: ExerciseSession) => void
}

function ExerciseHistoryRecord({ session, onEdit, onDelete }: ExerciseHistoryRecordProps) {
  const label = getExerciseDisplayName(session.exerciseType, session.customName)
  const recordedTime = formatRecordedTime(session.createdAt)
  return (
    <li className="exercise-history-record">
      <div className="exercise-history-main"><strong>{label}</strong><span>{formatExerciseDuration(session.durationMinutes)}</span></div>
      <dl>
        <div><dt>METs</dt><dd>{formatMets(session.mets)}</dd></div>
        {session.averageHeartRate !== null && <div><dt>心拍数</dt><dd>{session.averageHeartRate} bpm</dd></div>}
        {session.estimatedCaloriesKcal !== null && <div><dt>推定消費</dt><dd>{session.estimatedCaloriesKcal} kcal</dd></div>}
        {recordedTime && <div><dt>記録時刻</dt><dd>{recordedTime}</dd></div>}
      </dl>
      {session.memo && <p>{session.memo}</p>}
      <div className="exercise-history-record-actions">
        <button type="button" className="health-secondary-button" onClick={() => onEdit(session)} aria-label={`${label}の記録を編集`}>編集</button>
        <button type="button" className="backup-danger-button" onClick={() => onDelete(session)} aria-label={`${label}の記録を削除`}>削除</button>
      </div>
    </li>
  )
}

interface ExerciseHistoryGroupCardProps {
  group: ExerciseHistoryGroup
  expanded: boolean
  onToggle: () => void
  onEdit: (session: ExerciseSession) => void
  onDelete: (session: ExerciseSession) => void
}

function ExerciseHistoryGroupCard({ group, expanded, onToggle, onEdit, onDelete }: ExerciseHistoryGroupCardProps) {
  if (group.count === 1) {
    return <ExerciseHistoryRecord session={group.records[0]} onEdit={onEdit} onDelete={onDelete} />
  }

  const regionId = `exercise-history-group-${group.groupId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  return (
    <li className={`exercise-history-group-card${expanded ? ' is-expanded' : ''}`}>
      <div className="exercise-history-group-heading">
        <div><strong>{group.label}</strong><span>{group.count}回</span></div>
        <dl>
          <div><dt>合計時間</dt><dd>{formatExerciseDuration(group.totalDurationMinutes)}</dd></div>
          <div><dt>推定消費</dt><dd>{group.totalEstimatedCaloriesKcal === null ? '計算データなし' : `${group.totalEstimatedCaloriesKcal} kcal`}</dd></div>
        </dl>
      </div>
      {group.calculatedCaloriesCount > 0 && group.calculatedCaloriesCount < group.count && (
        <p className="exercise-history-partial">計算可能な{group.calculatedCaloriesCount}回の推定値を合計しています。</p>
      )}
      <button type="button" className="exercise-history-toggle" aria-expanded={expanded} aria-controls={regionId} onClick={onToggle}>
        {expanded ? '個別記録を閉じる' : `${group.count}件の記録を見る`}
      </button>
      {expanded && (
        <ul id={regionId} className="exercise-history-record-list">
          {group.records.map((session) => <ExerciseHistoryRecord key={session.id} session={session} onEdit={onEdit} onDelete={onDelete} />)}
        </ul>
      )}
    </li>
  )
}

export function ExerciseDashboard({ sessions, onOpenDaily, onEditSession, onDeleteSession }: ExerciseDashboardProps) {
  const [period, setPeriod] = useState<ExerciseSummaryPeriod>('month')
  const [baseDate, setBaseDate] = useState(() => getInitialBaseDate(sessions))
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(() => new Set())
  const range = useMemo(() => getExerciseSummaryRange(period, baseDate), [period, baseDate])
  const summary = useMemo(() => buildExerciseSummary(sessions, range, period), [sessions, range, period])
  const periodLabel = periodOptions.find((option) => option.id === period)?.label ?? '1か月'
  const groupedSessions = useMemo(() => groupExerciseSessionsByDateAndType(summary.sessions), [summary.sessions])
  const toggleGroup = (groupId: string) => setExpandedGroupIds((current) => {
    const next = new Set(current)
    if (next.has(groupId)) next.delete(groupId)
    else next.add(groupId)
    return next
  })
  const deleteSession = (session: ExerciseSession) => {
    const label = getExerciseDisplayName(session.exerciseType, session.customName)
    if (window.confirm(`${label}の運動記録を削除しますか？`)) onDeleteSession(session.id)
  }

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
            {groupedSessions.map((dateGroup) => <section key={dateGroup.date} aria-labelledby={`exercise-history-${dateGroup.date}`}><h4 id={`exercise-history-${dateGroup.date}`}>{formatDateKeyJa(dateGroup.date)}</h4><ul>{dateGroup.groups.map((group) => (
              <ExerciseHistoryGroupCard
                key={group.groupId}
                group={group}
                expanded={expandedGroupIds.has(group.groupId)}
                onToggle={() => toggleGroup(group.groupId)}
                onEdit={onEditSession}
                onDelete={deleteSession}
              />
            ))}</ul></section>)}
          </div>
        </section>

        <p className="exercise-summary-note">保存済みの推定消費カロリーを端末内で集計しています。本人の振り返り用の推定値であり、運動評価や医療判断は行いません。</p>
      </>}
    </div>
  )
}
