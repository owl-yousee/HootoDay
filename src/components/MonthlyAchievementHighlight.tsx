import { CrownIcon } from '@phosphor-icons/react/Crown'
import { CaretCircleLeftIcon } from '@phosphor-icons/react/CaretCircleLeft'
import { CaretCircleRightIcon } from '@phosphor-icons/react/CaretCircleRight'
import type { DailyAchievement } from '../types/achievement'
import { fromDateKey } from '../utils/date'

interface MonthlyAchievementHighlightProps {
  displayMonth: Date
  achievement: DailyAchievement | null
  onPreviousMonth: () => void
  onNextMonth: () => void
  onToday: () => void
  onOpen: () => void
}

function formatDay(dateKey: string): string {
  const date = fromDateKey(dateKey)
  return date ? `${date.getMonth() + 1}月${date.getDate()}日` : dateKey
}

export function MonthlyAchievementHighlight({ displayMonth, achievement, onPreviousMonth, onNextMonth, onToday, onOpen }: MonthlyAchievementHighlightProps) {
  const monthLabel = `${displayMonth.getFullYear()}年${displayMonth.getMonth() + 1}月`
  return (
    <section className="calendar-achievement-header" aria-label="カレンダーの表示月と今月のベスト">
      <div className="calendar-primary-controls">
        <div className="calendar-month-selector" aria-label="表示月の操作">
          <button type="button" className="control-button" onClick={onPreviousMonth} aria-label="前月を表示">
            <CaretCircleLeftIcon size={29} weight="regular" aria-hidden="true" />
          </button>
          <h1 aria-live="polite" aria-label={monthLabel}>
            <span className="calendar-month-label-full">{monthLabel}</span>
            <span className="calendar-month-label-mobile" aria-hidden="true">{displayMonth.getFullYear()}/{displayMonth.getMonth() + 1}</span>
          </h1>
          <button type="button" className="control-button" onClick={onNextMonth} aria-label="次月を表示">
            <CaretCircleRightIcon size={29} weight="regular" aria-hidden="true" />
          </button>
        </div>
        <button type="button" className="calendar-today-button" onClick={onToday} aria-label="今日へ移動">
          今日
        </button>
      </div>
      {achievement ? (
        <button
          type="button"
          className="monthly-best-compact-button"
          aria-label={`${monthLabel}の月のベスト：${achievement.text}。確認・変更`}
          title={achievement.text}
          onClick={onOpen}
        >
          <span className="monthly-best-kind" aria-hidden="true">月のベスト</span>
          <CrownIcon className="monthly-crown" size={18} weight="fill" aria-hidden="true" />
          <span className="monthly-best-compact-text">{achievement.text}</span>
          <time dateTime={achievement.date}>{formatDay(achievement.date)}</time>
        </button>
      ) : (
        <button
          type="button"
          className="monthly-achievement-open-button"
          onClick={onOpen}
          aria-label="今月のできたこと一覧を開く"
        >
          <span className="monthly-achievement-full-label">今月のできたことを見る</span>
          <span className="monthly-achievement-mobile-label" aria-hidden="true">今月一覧</span>
        </button>
      )}
    </section>
  )
}
