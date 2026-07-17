import type { CSSProperties } from 'react'
import { categoryColors } from '../data/calendarData'
import type { CalendarEvent, DayMemoIndicator } from '../types/calendar'
import { toDateKey } from '../utils/date'

interface DayDetailsProps {
  selectedDate: Date
  events: CalendarEvent[]
  memos: DayMemoIndicator[]
}

const weekdayLabels = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日']

export function DayDetails({ selectedDate, events, memos }: DayDetailsProps) {
  const dateKey = toDateKey(selectedDate)
  const dayEvents = events.filter((event) => event.date === dateKey)
  const hasMemo = memos.some((memo) => memo.date === dateKey && memo.hasMemo)

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
            {dayEvents.map((event) => (
              <li key={event.id} className="detail-event">
                <span
                  className="event-dot"
                  style={{ '--event-color': categoryColors[event.category] } as CSSProperties}
                  aria-hidden="true"
                />
                <div>
                  <strong>{event.title}</strong>
                  <span>{event.isAllDay ? '終日' : event.time ?? '時刻未設定'}・{event.category}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-message">予定はありません</p>
        )}
      </section>

      <section className="detail-section">
        <h4>日記・メモ</h4>
        <p className={`memo-status${hasMemo ? ' has-memo' : ''}`}>
          {hasMemo ? '● メモがあります' : 'メモはありません'}
        </p>
      </section>

      <section className="detail-section">
        <div className="detail-actions">
          <button type="button" className="detail-button">予定を追加</button>
          <button type="button" className="detail-button secondary">記録を開く</button>
        </div>
        <p className="phase-note">ボタンの機能は次のPhaseで実装予定です</p>
      </section>
    </aside>
  )
}
