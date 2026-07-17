import { CrownIcon } from '@phosphor-icons/react/Crown'
import { XIcon } from '@phosphor-icons/react/X'
import { useEffect, useRef, type SyntheticEvent } from 'react'
import type { DailyAchievement, MonthlyAchievementSelection } from '../types/achievement'
import { formatMonthKeyJa, fromDateKey } from '../utils/date'

interface MonthlyAchievementsDialogProps {
  month: string
  achievements: DailyAchievement[]
  selection: MonthlyAchievementSelection | null
  onSelect: (date: string) => void
  onClear: () => void
  onClose: () => void
}

function formatDay(dateKey: string): string {
  const date = fromDateKey(dateKey)
  return date ? `${date.getMonth() + 1}月${date.getDate()}日` : dateKey
}

export function MonthlyAchievementsDialog({ month, achievements, selection, onSelect, onClear, onClose }: MonthlyAchievementsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pendingInternalCloseEventsRef = useRef(0)
  const sortedAchievements = [...achievements].sort((left, right) => left.date.localeCompare(right.date))

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (dialog?.open) {
        pendingInternalCloseEventsRef.current += 1
        dialog.close()
      }
    }
  }, [])

  const closeDialog = () => {
    if (dialogRef.current?.open) dialogRef.current.close()
  }

  const handleClose = () => {
    if (pendingInternalCloseEventsRef.current > 0) {
      pendingInternalCloseEventsRef.current -= 1
      return
    }
    onClose()
  }

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault()
    closeDialog()
  }

  return (
    <dialog
      ref={dialogRef}
      className="monthly-achievements-dialog"
      aria-labelledby="monthly-achievements-title"
      onCancel={handleCancel}
      onClose={handleClose}
    >
      <section className="monthly-achievements-panel">
        <header className="achievement-dialog-header">
          <div>
            <p className="achievement-eyebrow">Monthly achievements</p>
            <h2 id="monthly-achievements-title">{formatMonthKeyJa(month)}のできたこと</h2>
            <p>その月にできたことから、いちばん頑張った記録を選べます。</p>
          </div>
          <button type="button" className="theme-close-button" onClick={closeDialog} aria-label="月のできたこと一覧を閉じる">
            <XIcon size={20} weight="bold" aria-hidden="true" />
          </button>
        </header>

        {sortedAchievements.length > 0 ? (
          <ul className="monthly-achievement-list">
            {sortedAchievements.map((achievement) => {
              const isSelected = selection?.selectedDate === achievement.date
              return (
                <li key={achievement.date} className={isSelected ? 'is-selected' : ''}>
                  <div className="monthly-achievement-copy">
                    <time dateTime={achievement.date}>{formatDay(achievement.date)}</time>
                    <p>{achievement.text}</p>
                  </div>
                  {isSelected ? (
                    <div className="monthly-achievement-selection">
                      <span className="monthly-best-label"><CrownIcon size={18} weight="fill" aria-hidden="true" />今月のベスト</span>
                      <button type="button" className="achievement-list-button secondary" onClick={onClear}>選択を解除</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="achievement-list-button"
                      aria-label={`${formatDay(achievement.date)}のできたことを今月のベストに選ぶ`}
                      aria-pressed="false"
                      onClick={() => onSelect(achievement.date)}
                    >
                      この記録を選ぶ
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="monthly-achievement-empty">この月のできたことはまだありません</p>
        )}
      </section>
    </dialog>
  )
}
