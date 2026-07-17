import { CaretLeftIcon } from '@phosphor-icons/react/CaretLeft'
import { CaretRightIcon } from '@phosphor-icons/react/CaretRight'
import { toDateKey } from '../utils/date'

interface HealthDateNavigatorProps {
  date: Date
  onPreviousDay: () => void
  onNextDay: () => void
  onToday: () => void
  onDateChange: (dateKey: string) => void
  compact?: boolean
  showToday?: boolean
  showDateInput?: boolean
  label: string
}

function formatFullDate(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function formatCompactDate(date: Date): string {
  const today = new Date()
  return date.getFullYear() === today.getFullYear()
    ? `${date.getMonth() + 1}月${date.getDate()}日`
    : formatFullDate(date)
}

export function HealthDateNavigator({
  date,
  onPreviousDay,
  onNextDay,
  onToday,
  onDateChange,
  compact = false,
  showToday = false,
  showDateInput = false,
  label,
}: HealthDateNavigatorProps) {
  const dateKey = toDateKey(date)
  const fullDate = formatFullDate(date)

  return (
    <div className={`health-date-navigator${compact ? ' is-compact' : ''}`} aria-label={`${label}の日付操作`}>
      <button type="button" className="health-date-nav-button icon-only" onClick={onPreviousDay} aria-label={`${label}を前日に変更`}>
        <CaretLeftIcon size={compact ? 17 : 20} weight="bold" aria-hidden="true" />
      </button>
      {showDateInput ? (
        <label className="health-date-nav-input">
          <span className="visually-hidden">{label}の日付を選択</span>
          <input type="date" value={dateKey} onChange={(event) => onDateChange(event.target.value)} aria-label={`${label}の日付を選択`} />
        </label>
      ) : (
        <time className="health-date-nav-label" dateTime={dateKey} title={fullDate} aria-label={fullDate}>{formatCompactDate(date)}</time>
      )}
      <button type="button" className="health-date-nav-button icon-only" onClick={onNextDay} aria-label={`${label}を次日に変更`}>
        <CaretRightIcon size={compact ? 17 : 20} weight="bold" aria-hidden="true" />
      </button>
      {showToday && <button type="button" className="health-date-nav-button today" onClick={onToday} aria-label={`${label}を今日に変更`}>今日</button>}
    </div>
  )
}
