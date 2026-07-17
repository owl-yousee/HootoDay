import { XIcon } from '@phosphor-icons/react/X'
import { useEffect, useRef, useState, type FormEvent, type SyntheticEvent } from 'react'
import type { MealRecord } from '../types/health'
import { hasMealContent, MAX_MEAL_FIELD_LENGTH, normalizeMealText } from '../utils/mealStorage'

interface MealRecordDialogProps {
  date: string
  record: MealRecord | null
  onSave: (record: MealRecord) => void
  onDelete: (date: string) => void
  onClose: () => void
}

type MealField = 'breakfast' | 'lunch' | 'dinner' | 'snacks'

const fields: Array<{ id: MealField; label: string; placeholder: string }> = [
  { id: 'breakfast', label: '朝食', placeholder: '例：ご飯\n味噌汁\n卵焼き' },
  { id: 'lunch', label: '昼食', placeholder: '例：サンドイッチ' },
  { id: 'dinner', label: '夕食', placeholder: '例：鶏肉と野菜の炒め物' },
  { id: 'snacks', label: '間食', placeholder: '例：ヨーグルト' },
]

export function MealRecordDialog({ date, record, onSave, onDelete, onClose }: MealRecordDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pendingInternalCloseEventsRef = useRef(0)
  const [values, setValues] = useState<Record<MealField, string>>({
    breakfast: record?.breakfast ?? '', lunch: record?.lunch ?? '', dinner: record?.dinner ?? '', snacks: record?.snacks ?? '',
  })
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

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault()
    closeDialog()
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = {
      breakfast: normalizeMealText(values.breakfast), lunch: normalizeMealText(values.lunch),
      dinner: normalizeMealText(values.dinner), snacks: normalizeMealText(values.snacks),
    }
    if (!hasMealContent(normalized)) {
      setError('朝食、昼食、夕食、間食のうち、少なくとも1項目を入力してください。全項目を空欄にする場合は削除してください。')
      return
    }
    onSave({ date, ...normalized, updatedAt: new Date().toISOString() })
    closeDialog()
  }

  const handleDelete = () => {
    if (record && window.confirm(`${date}の食事記録を削除しますか？`)) {
      onDelete(date)
      closeDialog()
    }
  }

  return (
    <dialog ref={dialogRef} className="meal-record-dialog" aria-labelledby="meal-record-dialog-title" onCancel={handleCancel} onClose={handleDialogClose}>
      <form className="meal-record-panel" onSubmit={handleSubmit} noValidate>
        <header className="weight-record-header">
          <div><p className="weight-record-eyebrow">Meals</p><h2 id="meal-record-dialog-title">{record ? '食事記録を編集' : '食事を記録'}</h2><p className="weight-record-target-date">{date}</p></div>
          <button type="button" className="theme-close-button" onClick={closeDialog} aria-label="食事入力を閉じる"><XIcon size={20} weight="bold" aria-hidden="true" /></button>
        </header>

        {error && <p id="meal-record-error" className="form-error meal-form-error" role="alert">{error}</p>}
        <div className="meal-record-form">
          {fields.map((field) => (
            <div className="form-field meal-form-field" key={field.id}>
              <label htmlFor={`meal-${field.id}`}>{field.label}（任意）</label>
              <textarea id={`meal-${field.id}`} value={values[field.id]} onChange={(event) => { setValues((current) => ({ ...current, [field.id]: event.target.value })); if (error) setError('') }} maxLength={MAX_MEAL_FIELD_LENGTH} rows={4} placeholder={field.placeholder} aria-invalid={Boolean(error)} aria-describedby={`meal-${field.id}-hint${error ? ' meal-record-error' : ''}`} />
              <span id={`meal-${field.id}-hint`} className="field-hint">改行できます。最大{MAX_MEAL_FIELD_LENGTH}文字。</span>
              <span className="character-count" aria-live="polite">{values[field.id].length}/{MAX_MEAL_FIELD_LENGTH}</span>
            </div>
          ))}
        </div>

        <div className="event-editor-actions">
          {record && <button type="button" className="event-action-button danger" onClick={handleDelete}>食事記録を削除</button>}
          <span className="event-action-spacer" />
          <button type="button" className="event-action-button secondary" onClick={closeDialog}>キャンセル</button>
          <button type="submit" className="event-action-button primary">保存</button>
        </div>
      </form>
    </dialog>
  )
}
