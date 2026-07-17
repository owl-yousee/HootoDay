import { CaretLeftIcon } from '@phosphor-icons/react/CaretLeft'
import { CaretRightIcon } from '@phosphor-icons/react/CaretRight'

interface AppHeaderProps {
  displayMonth: Date
  onPreviousMonth: () => void
  onNextMonth: () => void
  onToday: () => void
}

export function AppHeader({
  displayMonth,
  onPreviousMonth,
  onNextMonth,
  onToday,
}: AppHeaderProps) {
  const monthLabel = `${displayMonth.getFullYear()}年${displayMonth.getMonth() + 1}月`

  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">H</span>
        <h1>HootoDay</h1>
      </div>
      <div className="month-controls" aria-label="表示月の操作">
        <button
          type="button"
          className="control-button"
          onClick={onPreviousMonth}
          aria-label="前月を表示"
        >
          <CaretLeftIcon size={22} weight="bold" aria-hidden="true" />
        </button>
        <p className="month-title" aria-live="polite">{monthLabel}</p>
        <button
          type="button"
          className="control-button"
          onClick={onNextMonth}
          aria-label="次月を表示"
        >
          <CaretRightIcon size={22} weight="bold" aria-hidden="true" />
        </button>
      </div>
      <button type="button" className="today-button" onClick={onToday} aria-label="今日を表示">
        今日
      </button>
    </header>
  )
}
