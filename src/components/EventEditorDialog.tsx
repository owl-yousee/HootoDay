import { XIcon } from '@phosphor-icons/react/X'
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type SyntheticEvent,
} from 'react'
import { eventCategories } from '../data/calendarData'
import type { CalendarEvent, EventCategory } from '../types/calendar'
import { createEventId } from '../utils/event'

interface EventEditorDialogProps {
  initialDate: string
  event: CalendarEvent | null
  onSave: (event: CalendarEvent) => void
  onDelete: (eventId: string) => boolean
  onClose: () => void
}

interface FormErrors {
  title?: string
  date?: string
  startTime?: string
  endTime?: string
}

export function EventEditorDialog({
  initialDate,
  event,
  onSave,
  onDelete,
  onClose,
}: EventEditorDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pendingInternalCloseEventsRef = useRef(0)
  const [date, setDate] = useState(event?.date ?? initialDate)
  const [title, setTitle] = useState(event?.title ?? '')
  const [category, setCategory] = useState<EventCategory>(event?.category ?? '配信')
  const [isAllDay, setIsAllDay] = useState(event?.isAllDay ?? false)
  const [startTime, setStartTime] = useState(event?.startTime ?? '')
  const [endTime, setEndTime] = useState(event?.endTime ?? '')
  const [memo, setMemo] = useState(event?.memo ?? '')
  const [errors, setErrors] = useState<FormErrors>({})

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

  const handleDialogCancel = (cancelEvent: SyntheticEvent<HTMLDialogElement>) => {
    cancelEvent.preventDefault()
    closeDialog()
  }

  const validate = (): boolean => {
    const nextErrors: FormErrors = {}
    if (!title.trim()) nextErrors.title = '予定名を入力してください。'
    if (!date) nextErrors.date = '日付を入力してください。'
    if (!isAllDay && !startTime) nextErrors.startTime = '開始時刻を入力してください。'
    if (!isAllDay && endTime && startTime && endTime <= startTime) {
      nextErrors.endTime = '終了時刻は開始時刻より後にしてください。'
    }
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSubmit = (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault()
    if (!validate()) return

    onSave({
      id: event?.id ?? createEventId(),
      date,
      title: title.trim(),
      category,
      isAllDay,
      startTime: isAllDay ? null : startTime,
      endTime: isAllDay || !endTime ? null : endTime,
      memo: memo.trim(),
    })
    closeDialog()
  }

  const handleDelete = () => {
    if (event && window.confirm(`「${event.title}」を削除しますか？`)) {
      if (onDelete(event.id)) closeDialog()
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="event-editor-dialog"
      aria-labelledby="event-editor-title"
      onCancel={handleDialogCancel}
      onClose={handleDialogClose}
    >
      <form className="event-editor-panel" onSubmit={handleSubmit} noValidate>
        <div className="event-editor-header">
          <div>
            <p className="event-editor-eyebrow">Schedule</p>
            <h2 id="event-editor-title">{event ? '予定を編集' : '予定を追加'}</h2>
          </div>
          <button type="button" className="theme-close-button" onClick={closeDialog} aria-label="予定入力を閉じる">
            <XIcon size={20} weight="bold" aria-hidden="true" />
          </button>
        </div>

        <div className="event-form-grid">
          <div className="form-field">
            <label htmlFor="event-date">日付 <span className="required-label">必須</span></label>
            <input id="event-date" type="date" value={date} onChange={(input) => setDate(input.target.value)} required aria-invalid={Boolean(errors.date)} aria-describedby={errors.date ? 'event-date-error' : undefined} />
            {errors.date && <p id="event-date-error" className="form-error" role="alert">{errors.date}</p>}
          </div>

          <div className="form-field form-field-wide">
            <label htmlFor="event-title">予定名 <span className="required-label">必須</span></label>
            <input id="event-title" type="text" value={title} onChange={(input) => setTitle(input.target.value)} maxLength={80} required aria-invalid={Boolean(errors.title)} aria-describedby={errors.title ? 'event-title-error' : undefined} />
            {errors.title && <p id="event-title-error" className="form-error" role="alert">{errors.title}</p>}
          </div>

          <div className="form-field form-field-wide">
            <label htmlFor="event-category">カテゴリ</label>
            <select id="event-category" value={category} onChange={(input) => setCategory(input.target.value as EventCategory)}>
              {eventCategories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>

          <label className="all-day-control form-field-wide">
            <input type="checkbox" checked={isAllDay} onChange={(input) => setIsAllDay(input.target.checked)} />
            <span>終日予定</span>
          </label>

          <div className="form-field">
            <label htmlFor="event-start-time">開始時刻 {!isAllDay && <span className="required-label">必須</span>}</label>
            <input id="event-start-time" type="time" value={startTime} onChange={(input) => setStartTime(input.target.value)} disabled={isAllDay} required={!isAllDay} aria-invalid={Boolean(errors.startTime)} aria-describedby={errors.startTime ? 'event-start-error' : undefined} />
            {errors.startTime && <p id="event-start-error" className="form-error" role="alert">{errors.startTime}</p>}
          </div>

          <div className="form-field">
            <label htmlFor="event-end-time">終了時刻（任意）</label>
            <input id="event-end-time" type="time" value={endTime} onChange={(input) => setEndTime(input.target.value)} disabled={isAllDay} aria-invalid={Boolean(errors.endTime)} aria-describedby={errors.endTime ? 'event-end-error' : undefined} />
            {errors.endTime && <p id="event-end-error" className="form-error" role="alert">{errors.endTime}</p>}
          </div>

          <div className="form-field form-field-wide">
            <label htmlFor="event-memo">補足メモ（任意）</label>
            <textarea id="event-memo" value={memo} onChange={(input) => setMemo(input.target.value)} maxLength={500} rows={4} />
            <span className="character-count">{memo.length}/500</span>
          </div>
        </div>

        <div className="event-editor-actions">
          {event && <button type="button" className="event-action-button danger" onClick={handleDelete}>予定を削除</button>}
          <span className="event-action-spacer" />
          <button type="button" className="event-action-button secondary" onClick={closeDialog}>キャンセル</button>
          <button type="submit" className="event-action-button primary">保存</button>
        </div>
      </form>
    </dialog>
  )
}
