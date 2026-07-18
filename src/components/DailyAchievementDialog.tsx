import { XIcon } from '@phosphor-icons/react/X'
import { useEffect, useRef, useState, type FormEvent, type SyntheticEvent } from 'react'
import type { DailyAchievement } from '../types/achievement'
import { DAILY_ACHIEVEMENT_MAX_LENGTH, normalizeDailyAchievementText } from '../utils/achievement'
import { fromDateKey } from '../utils/date'

interface DailyAchievementDialogProps {
  date: string
  achievement: DailyAchievement | null
  onSave: (record: DailyAchievement) => void
  onDelete: (date: string) => void
  onClose: () => void
}

function formatTargetDate(dateKey: string): string {
  const date = fromDateKey(dateKey)
  return date ? `${date.getMonth() + 1}月${date.getDate()}日` : dateKey
}

export function DailyAchievementDialog({ date, achievement, onSave, onDelete, onClose }: DailyAchievementDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pendingInternalCloseEventsRef = useRef(0)
  const [text, setText] = useState(achievement?.text ?? '')
  const [error, setError] = useState('')

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

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = normalizeDailyAchievementText(text)
    if (!normalized) {
      setError('できたことを入力してください。')
      return
    }
    if (normalized.length > DAILY_ACHIEVEMENT_MAX_LENGTH) {
      setError(`できたことは${DAILY_ACHIEVEMENT_MAX_LENGTH}文字以内で入力してください。`)
      return
    }
    onSave({ date, text: normalized, updatedAt: new Date().toISOString() })
    closeDialog()
  }

  const handleDelete = () => {
    if (achievement && window.confirm(`${formatTargetDate(date)}のできたことを削除しますか？`)) {
      onDelete(date)
      closeDialog()
    }
  }

  const describedBy = `daily-achievement-text-hint${error ? ' daily-achievement-text-error' : ''}`

  return (
    <dialog
      ref={dialogRef}
      className="achievement-dialog"
      aria-labelledby="daily-achievement-dialog-title"
      onCancel={handleCancel}
      onClose={handleClose}
    >
      <form className="achievement-panel" onSubmit={handleSubmit} noValidate>
        <header className="achievement-dialog-header">
          <div>
            <p className="achievement-eyebrow">Daily achievement</p>
            <h2 id="daily-achievement-dialog-title">{formatTargetDate(date)}のできたこと</h2>
            <p>小さな一歩も、その日の大切な記録です。</p>
          </div>
          <button type="button" className="theme-close-button" onClick={closeDialog} aria-label="できたこと入力を閉じる">
            <XIcon size={20} weight="bold" aria-hidden="true" />
          </button>
        </header>

        <div className="form-field">
          <label htmlFor="daily-achievement-text">今日のできたこと <span className="required-label">必須・最大{DAILY_ACHIEVEMENT_MAX_LENGTH}文字</span></label>
          <input
            id="daily-achievement-text"
            type="text"
            value={text}
            maxLength={DAILY_ACHIEVEMENT_MAX_LENGTH}
            placeholder="例：散歩に出かけられた"
            required
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            onChange={(event) => {
              setText(event.target.value)
              if (error) setError('')
            }}
          />
          <span id="daily-achievement-text-hint" className="achievement-input-hint">{DAILY_ACHIEVEMENT_MAX_LENGTH}文字以内の短い記録です。長文はその日のメモへ。</span>
          <span className={`character-count${text.length >= DAILY_ACHIEVEMENT_MAX_LENGTH ? ' is-limit' : ''}`} aria-live="polite">{text.length} / {DAILY_ACHIEVEMENT_MAX_LENGTH}</span>
          {error && <p id="daily-achievement-text-error" className="form-error" role="alert">{error}</p>}
        </div>

        <div className="event-editor-actions">
          {achievement && <button type="button" className="event-action-button danger" onClick={handleDelete}>削除</button>}
          <span className="event-action-spacer" />
          <button type="button" className="event-action-button secondary" onClick={closeDialog}>キャンセル</button>
          <button type="submit" className="event-action-button primary">保存</button>
        </div>
      </form>
    </dialog>
  )
}
