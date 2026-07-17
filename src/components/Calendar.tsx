import type { CSSProperties } from 'react'
import { PencilSimpleIcon } from '@phosphor-icons/react/PencilSimple'
import { HeartbeatIcon } from '@phosphor-icons/react/Heartbeat'
import { getEventCategoryDisplay } from '../data/eventCategoryDisplay'
import type { CalendarEvent } from '../types/calendar'
import type { DayMemo } from '../types/dayMemo'
import { toDateKey } from '../utils/date'
import { formatTimeForDisplay, getCalendarEventTitle, sortCalendarEvents } from '../utils/event'

interface CalendarProps {
  displayMonth: Date
  selectedDate: Date
  events: CalendarEvent[]
  memos: DayMemo[]
  healthRecordDates: Set<string>
  onSelectDate: (date: Date) => void
}

const weekdays = ['日', '月', '火', '水', '木', '金', '土']

function isSameDate(left: Date, right: Date): boolean {
  return toDateKey(left) === toDateKey(right)
}

function getCalendarDays(displayMonth: Date): Date[] {
  const firstDay = new Date(displayMonth.getFullYear(), displayMonth.getMonth(), 1)
  const gridStart = new Date(firstDay)
  gridStart.setDate(firstDay.getDate() - firstDay.getDay())

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + index)
    return date
  })
}

export function Calendar({
  displayMonth,
  selectedDate,
  events,
  memos,
  healthRecordDates,
  onSelectDate,
}: CalendarProps) {
  const today = new Date()
  const days = getCalendarDays(displayMonth)

  return (
    <section className="calendar-card" aria-label={`${displayMonth.getFullYear()}年${displayMonth.getMonth() + 1}月のカレンダー`}>
      <div className="weekday-row" aria-hidden="true">
        {weekdays.map((weekday, index) => (
          <div
            key={weekday}
            className={`weekday${index === 0 ? ' sunday' : ''}${index === 6 ? ' saturday' : ''}`}
          >
            {weekday}
          </div>
        ))}
      </div>
      <div className="calendar-grid">
        {days.map((date) => {
          const dateKey = toDateKey(date)
          const dayEvents = sortCalendarEvents(events.filter((event) => event.date === dateKey))
          const hasMemo = memos.some((memo) => memo.date === dateKey && memo.content.trim().length > 0)
          const hasHealthRecord = healthRecordDates.has(dateKey)
          const isOutside = date.getMonth() !== displayMonth.getMonth()
          const isSelected = isSameDate(date, selectedDate)
          const isToday = isSameDate(date, today)
          const weekday = date.getDay()
          const stateDescription = [
            isToday ? '今日' : '',
            isSelected ? '選択中' : '',
            dayEvents.length > 0 ? `予定${dayEvents.length}件` : '予定なし',
            hasMemo ? 'メモあり' : '',
            hasHealthRecord ? '健康記録あり' : '',
          ].filter(Boolean).join('、')

          return (
            <button
              key={dateKey}
              type="button"
              className={`calendar-day${weekday === 0 ? ' sunday' : ''}${weekday === 6 ? ' saturday' : ''}${isOutside ? ' is-outside' : ''}${isSelected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}`}
              onClick={() => onSelectDate(date)}
              aria-label={`${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日、${stateDescription}`}
              aria-pressed={isSelected}
            >
              <span className="day-topline">
                <span className="day-number">{date.getDate()}</span>
                {(hasHealthRecord || hasMemo) && (
                  <span className="day-indicators" aria-hidden="true">
                    {hasHealthRecord && (
                      <span className="health-record-indicator" title="健康記録あり" aria-hidden="true">
                        <HeartbeatIcon size={13} weight="bold" aria-hidden="true" />
                      </span>
                    )}
                    {hasMemo && (
                      <span className="memo-indicator" title="メモあり" aria-hidden="true">
                        <PencilSimpleIcon size={13} weight="bold" aria-hidden="true" />
                      </span>
                    )}
                  </span>
                )}
              </span>
              <span className="event-list-compact" aria-hidden="true">
                {dayEvents.slice(0, 2).map((event) => {
                  const categoryDisplay = getEventCategoryDisplay(event.category)
                  const CategoryIcon = categoryDisplay.icon
                  const displayedTitle = getCalendarEventTitle(event)
                  const displayedTime = event.isAllDay ? '終日' : formatTimeForDisplay(event.startTime)

                  return (
                    <span
                      key={event.id}
                      className="event-chip"
                      style={{ '--event-color': categoryDisplay.color } as CSSProperties}
                      title={`${categoryDisplay.name}・${displayedTime}・${event.title}`}
                    >
                      <CategoryIcon className="event-category-icon" size={14} weight="bold" aria-hidden="true" />
                      <span className="event-time">{displayedTime}</span>
                      <span className="event-title-compact">{displayedTitle}</span>
                    </span>
                  )
                })}
                {dayEvents.length > 2 && <span className="more-events">ほか{dayEvents.length - 2}件</span>}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
