import { useMemo, useState } from 'react'
import type { DailyAchievement } from '../types/achievement'
import type { DayMemo } from '../types/dayMemo'
import type { DailyConditionRecord, SleepRecord, WeightRecord } from '../types/health'
import type { RecordBrowserItem, RecordBrowserKindFilter, RecordBrowserPeriod, RecordBrowserSort } from '../types/recordBrowser'
import { formatDateKeyJa, fromDateKey, toDateKey } from '../utils/date'
import { buildRecordBrowserItems, filterRecordBrowserItems, getCustomDateRangeError } from '../utils/recordBrowser'

interface RecordsBrowserPageProps {
  dayMemos: DayMemo[]
  dailyAchievements: DailyAchievement[]
  weightRecords: WeightRecord[]
  sleepRecords: SleepRecord[]
  conditionRecords: DailyConditionRecord[]
  onOpenCalendar: (dateKey: string) => void
  onOpenHealth: (dateKey: string) => void
}

const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土']

function formatRecordDate(dateKey: string): string {
  const date = fromDateKey(dateKey)
  return date ? `${formatDateKeyJa(dateKey)}（${weekdayLabels[date.getDay()]}）` : dateKey
}

function shouldAllowExpansion(item: RecordBrowserItem): boolean {
  return item.text.length > 80 || item.text.split('\n').length > 5
}

export function RecordsBrowserPage({ dayMemos, dailyAchievements, weightRecords, sleepRecords, conditionRecords, onOpenCalendar, onOpenHealth }: RecordsBrowserPageProps) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<RecordBrowserKindFilter>('all')
  const [period, setPeriod] = useState<RecordBrowserPeriod>('all')
  const [sort, setSort] = useState<RecordBrowserSort>('newest')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const today = toDateKey(new Date())
  const allItems = useMemo(() => buildRecordBrowserItems({ dayMemos, dailyAchievements, weightRecords, sleepRecords, conditionRecords }), [dayMemos, dailyAchievements, weightRecords, sleepRecords, conditionRecords])
  const customDateError = period === 'custom' ? getCustomDateRangeError(customStartDate, customEndDate) : ''
  const filteredItems = useMemo(() => customDateError ? [] : filterRecordBrowserItems(allItems, { query, kind, period, sort, customStartDate, customEndDate, today }), [allItems, query, kind, period, sort, customStartDate, customEndDate, today, customDateError])
  const groups = useMemo(() => {
    const result: Array<{ date: string; items: RecordBrowserItem[] }> = []
    filteredItems.forEach((item) => {
      const current = result[result.length - 1]
      if (current?.date === item.date) current.items.push(item)
      else result.push({ date: item.date, items: [item] })
    })
    return result
  }, [filteredItems])

  const resetFilters = () => {
    setQuery('')
    setKind('all')
    setPeriod('all')
    setSort('newest')
    setCustomStartDate('')
    setCustomEndDate('')
    setExpandedIds(new Set())
  }

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="records-browser">
      <header className="content-heading records-browser-heading">
        <div><p className="eyebrow">Records</p><h1>記録を見る</h1></div>
        <p className="content-note">日記や健康メモを、日付やキーワードから探せます。</p>
      </header>

      <section className="records-filter-panel" aria-labelledby="records-filter-title">
        <div className="records-filter-title-row"><h2 id="records-filter-title">検索・絞り込み</h2><span>読み取り専用</span></div>
        <div className="records-filter-grid">
          <label className="records-filter-field records-keyword-field">キーワード<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="記録の本文を検索" /></label>
          <label className="records-filter-field">記録種類<select value={kind} onChange={(event) => setKind(event.target.value as RecordBrowserKindFilter)}><option value="all">すべて</option><option value="dayMemo">日記・メモ</option><option value="dailyAchievement">今日のできたこと</option><option value="weightMemo">体重メモ</option><option value="sleepMemo">睡眠メモ</option><option value="condition">体調関連</option></select></label>
          <label className="records-filter-field">期間<select value={period} onChange={(event) => setPeriod(event.target.value as RecordBrowserPeriod)}><option value="all">すべて</option><option value="sevenDays">過去7日</option><option value="thirtyDays">過去30日</option><option value="sixMonths">過去半年</option><option value="custom">期間指定</option></select></label>
          <label className="records-filter-field">並び順<select value={sort} onChange={(event) => setSort(event.target.value as RecordBrowserSort)}><option value="newest">新しい順</option><option value="oldest">古い順</option></select></label>
        </div>
        {period === 'custom' && (
          <div className="records-custom-period" aria-describedby={customDateError ? 'records-date-error' : undefined}>
            <label>開始日<input type="date" value={customStartDate} onChange={(event) => setCustomStartDate(event.target.value)} aria-invalid={Boolean(customDateError)} aria-describedby={customDateError ? 'records-date-error' : undefined} /></label>
            <label>終了日<input type="date" value={customEndDate} onChange={(event) => setCustomEndDate(event.target.value)} aria-invalid={Boolean(customDateError)} aria-describedby={customDateError ? 'records-date-error' : undefined} /></label>
            {customDateError && <p id="records-date-error" className="records-filter-error" role="alert">{customDateError}</p>}
          </div>
        )}
        <button type="button" className="records-reset-button" onClick={resetFilters}>検索条件をリセット</button>
      </section>

      <p className="records-result-count" aria-live="polite">{allItems.length === 0 ? '検索対象の記録は0件です' : customDateError ? '期間指定を確認してください' : filteredItems.length ? `全${allItems.length}件中${filteredItems.length}件の記録` : '該当する記録はありません'}</p>

      {allItems.length === 0 ? (
        <section className="records-empty-state"><h2>まだ検索できる記録がありません</h2><p>日記や健康メモを保存すると、ここから見返せます。</p><div><button type="button" onClick={() => onOpenCalendar(today)}>カレンダーを開く</button><button type="button" onClick={() => onOpenHealth(today)}>日付別健康記録を開く</button></div></section>
      ) : customDateError ? (
        <section className="records-empty-state records-filter-invalid"><h2>期間指定を確認してください</h2><p>開始日と終了日を正しく入力すると検索結果を表示します。</p></section>
      ) : filteredItems.length === 0 ? (
        <section className="records-empty-state"><h2>該当する記録はありません</h2><p>キーワードや期間を変更してみてください。</p><button type="button" onClick={resetFilters}>検索条件をリセット</button></section>
      ) : (
        <div className="records-result-list">
          {groups.map((group) => <section className="records-date-group" key={group.date} aria-labelledby={`records-date-${group.date}`}><h2 id={`records-date-${group.date}`}>{formatRecordDate(group.date)}</h2><div className="records-date-items">{group.items.map((item) => {
            const expanded = expandedIds.has(item.id)
            const expandable = shouldAllowExpansion(item)
            const contentId = `record-content-${item.id}`
            const isHealth = item.kind !== 'dayMemo' && item.kind !== 'dailyAchievement'
            const destinationLabel = isHealth ? '健康記録を見る' : item.kind === 'dayMemo' ? '日記・メモを見る' : 'カレンダーを見る'
            return <article className={`record-browser-item${expanded ? ' is-expanded' : ''}`} key={item.id}><div className="record-browser-item-header"><span>{item.label}</span></div><p id={contentId} className={`record-browser-text${expanded ? ' is-expanded' : ''}`}>{item.text}</p><div className="record-browser-actions">{expandable && <button type="button" className="record-text-toggle" aria-expanded={expanded} aria-controls={contentId} onClick={() => toggleExpanded(item.id)}>{expanded ? '閉じる' : '全文を見る'}</button>}<button type="button" className="record-destination-button" aria-label={`${formatDateKeyJa(item.date)}の${destinationLabel}`} onClick={() => isHealth ? onOpenHealth(item.date) : onOpenCalendar(item.date)}>{destinationLabel}</button></div></article>
          })}</div></section>)}
        </div>
      )}
    </div>
  )
}
