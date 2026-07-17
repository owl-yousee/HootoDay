import type { CSSProperties } from 'react'
import { PencilSimpleIcon } from '@phosphor-icons/react/PencilSimple'
import { getEventCategoryDisplay } from '../data/eventCategoryDisplay'
import type { CalendarEvent } from '../types/calendar'
import type { DayMemo } from '../types/dayMemo'
import type { DailyHealthSummary } from '../utils/healthSummary'
import { toDateKey } from '../utils/date'
import { formatEventTime, sortCalendarEvents } from '../utils/event'
import { getDailyHealthSummaryLines } from '../utils/healthSummary'

interface DayDetailsProps {
  selectedDate: Date
  events: CalendarEvent[]
  memos: DayMemo[]
  healthSummary: DailyHealthSummary
  onAddEvent: () => void
  onEditEvent: (event: CalendarEvent) => void
  onOpenMemo: () => void
  onOpenHealth: () => void
}

const weekdayLabels = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日']

export function DayDetails({ selectedDate, events, memos, healthSummary, onAddEvent, onEditEvent, onOpenMemo, onOpenHealth }: DayDetailsProps) {
  const dateKey = toDateKey(selectedDate)
  const dayEvents = sortCalendarEvents(events.filter((event) => event.date === dateKey))
  const dayMemo = memos.find((memo) => memo.date === dateKey)
  const healthSummaryLines = getDailyHealthSummaryLines(healthSummary)

  return (
    <aside className="day-details" aria-live="polite" aria-label="選択日の詳細">
      <p className="detail-date-label">Selected day</p>
      <h3 className="detail-title">
        {selectedDate.getFullYear()}年{selectedDate.getMonth() + 1}月{selectedDate.getDate()}日
      </h3>
      <p className="detail-weekday">{weekdayLabels[selectedDate.getDay()]}</p>

      <section className="detail-section">
        <h4>この日の予定</h4>
        {dayEvents.length > 0 ? (
          <ul className="detail-event-list">
            {dayEvents.map((event) => {
              const categoryDisplay = getEventCategoryDisplay(event.category)
              const CategoryIcon = categoryDisplay.icon

              return (
                <li key={event.id} className="detail-event">
                  <span
                    className="detail-category-icon"
                    style={{ '--event-color': categoryDisplay.color } as CSSProperties}
                    aria-hidden="true"
                  >
                    <CategoryIcon size={20} weight="bold" />
                  </span>
                  <div className="detail-event-copy">
                    <strong>{event.title}</strong>
                    <span>{formatEventTime(event)}・{categoryDisplay.name}</span>
                    {event.memo && <small>{event.memo}</small>}
                  </div>
                  <button type="button" className="edit-event-button" onClick={() => onEditEvent(event)} aria-label={`${event.title}を編集`}>
                    <PencilSimpleIcon size={18} weight="bold" aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="empty-message">予定はありません</p>
        )}
      </section>

      <section className="detail-section">
        <h4>日記・メモ</h4>
        {dayMemo ? (
          <p className="memo-preview has-memo" aria-label="保存済みの日記・メモ">
            <span className="memo-preview-mark" aria-hidden="true">●</span>
            <span>{dayMemo.content}</span>
          </p>
        ) : (
          <p className="memo-status">メモはありません</p>
        )}
      </section>

      <section className="detail-section" aria-labelledby="selected-day-health-heading">
        <h4 id="selected-day-health-heading">健康記録</h4>
        {healthSummaryLines.length > 0 ? (
          <ul className="health-summary-list">
            {healthSummaryLines.map((line) => <li key={line}>{line}</li>)}
          </ul>
        ) : (
          <p className="empty-message">健康記録はありません</p>
        )}
        <button type="button" className="detail-button health-detail-button" onClick={onOpenHealth}>健康記録を開く</button>
      </section>

      <section className="detail-section">
        <div className="detail-actions">
          <button type="button" className="detail-button" onClick={onAddEvent}>予定を追加</button>
          <button type="button" className="detail-button secondary" onClick={onOpenMemo}>日記・メモを開く</button>
        </div>
      </section>
    </aside>
  )
}
