import { XIcon } from '@phosphor-icons/react/X'
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type SyntheticEvent,
} from 'react'
import type { DayMemo } from '../types/dayMemo'

interface DayMemoDialogProps {
  date: string
  weekday: string
  memo: DayMemo | null
  onSave: (memo: DayMemo) => void
  onDelete: (date: string) => void
  onClose: () => void
}

const MAX_CONTENT_LENGTH = 2000

export function DayMemoDialog({
  date,
  weekday,
  memo,
  onSave,
  onDelete,
  onClose,
}: DayMemoDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pendingInternalCloseEventsRef = useRef(0)
  const [content, setContent] = useState(memo?.content ?? '')
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

  const handleDialogClose = () => {
    if (pendingInternalCloseEventsRef.current > 0) {
      pendingInternalCloseEventsRef.current -= 1
      return
    }
    onClose()
  }

  const handleDialogCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault()
    closeDialog()
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedContent = content.trim()

    if (!trimmedContent) {
      setError('日記・メモの本文を入力してください。')
      return
    }

    onSave({
      date,
      content: trimmedContent,
      updatedAt: new Date().toISOString(),
    })
    closeDialog()
  }

  const handleDelete = () => {
    if (memo && window.confirm(`${date}の日記・メモを削除しますか？`)) {
      onDelete(date)
      closeDialog()
    }
  }

  const errorId = error ? 'day-memo-content-error' : undefined

  return (
    <dialog
      ref={dialogRef}
      className="day-memo-dialog"
      aria-labelledby="day-memo-dialog-title"
      onCancel={handleDialogCancel}
      onClose={handleDialogClose}
    >
      <form className="day-memo-panel" onSubmit={handleSubmit} noValidate>
        <header className="day-memo-header">
          <div>
            <p className="day-memo-eyebrow">Diary &amp; memo</p>
            <h2 id="day-memo-dialog-title">{memo ? '日記・メモを編集' : '日記・メモを書く'}</h2>
            <p className="day-memo-target-date">{date}（{weekday}）</p>
          </div>
          <button type="button" className="theme-close-button" onClick={closeDialog} aria-label="日記・メモ入力を閉じる">
            <XIcon size={20} weight="bold" aria-hidden="true" />
          </button>
        </header>

        <div className="form-field">
          <label htmlFor="day-memo-content">本文 <span className="required-label">必須・最大2000文字</span></label>
          <textarea
            id="day-memo-content"
            value={content}
            onChange={(event) => {
              setContent(event.target.value)
              if (error) setError('')
            }}
            maxLength={MAX_CONTENT_LENGTH}
            rows={10}
            required
            aria-invalid={Boolean(error)}
            aria-describedby={errorId}
          />
          <span className="character-count" aria-live="polite">{content.length}/{MAX_CONTENT_LENGTH}</span>
          {error && <p id="day-memo-content-error" className="form-error" role="alert">{error}</p>}
        </div>

        <div className="event-editor-actions">
          {memo && <button type="button" className="event-action-button danger" onClick={handleDelete}>メモを削除</button>}
          <span className="event-action-spacer" />
          <button type="button" className="event-action-button secondary" onClick={closeDialog}>キャンセル</button>
          <button type="submit" className="event-action-button primary">保存</button>
        </div>
      </form>
    </dialog>
  )
}
