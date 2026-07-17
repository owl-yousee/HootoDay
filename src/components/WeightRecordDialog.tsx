import { XIcon } from '@phosphor-icons/react/X'
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type SyntheticEvent,
} from 'react'
import type { WeightRecord } from '../types/health'
import {
  MAX_WEIGHT_KG,
  MAX_WEIGHT_MEMO_LENGTH,
  MIN_WEIGHT_KG,
  normalizeWeight,
} from '../utils/weightStorage'

interface WeightRecordDialogProps {
  date: string
  record: WeightRecord | null
  onSave: (record: WeightRecord) => void
  onDelete: (date: string) => void
  onClose: () => void
}

export function WeightRecordDialog({
  date,
  record,
  onSave,
  onDelete,
  onClose,
}: WeightRecordDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pendingInternalCloseEventsRef = useRef(0)
  const [weight, setWeight] = useState(record ? record.weightKg.toFixed(1) : '')
  const [memo, setMemo] = useState(record?.memo ?? '')
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
    const parsedWeight = Number(weight)

    if (!weight || !Number.isFinite(parsedWeight)) {
      setError('体重を入力してください。')
      return
    }
    if (parsedWeight < MIN_WEIGHT_KG || parsedWeight > MAX_WEIGHT_KG) {
      setError(`体重は${MIN_WEIGHT_KG}kg以上${MAX_WEIGHT_KG}kg以下で入力してください。`)
      return
    }

    onSave({
      date,
      weightKg: normalizeWeight(parsedWeight),
      memo: memo.trim(),
      updatedAt: new Date().toISOString(),
    })
    closeDialog()
  }

  const handleDelete = () => {
    if (record && window.confirm(`${date}の体重記録を削除しますか？`)) {
      onDelete(date)
      closeDialog()
    }
  }

  const errorId = error ? 'weight-record-error' : undefined

  return (
    <dialog
      ref={dialogRef}
      className="weight-record-dialog"
      aria-labelledby="weight-record-dialog-title"
      onCancel={handleDialogCancel}
      onClose={handleDialogClose}
    >
      <form className="weight-record-panel" onSubmit={handleSubmit} noValidate>
        <header className="weight-record-header">
          <div>
            <p className="weight-record-eyebrow">Weight</p>
            <h2 id="weight-record-dialog-title">{record ? '体重記録を編集' : '体重を記録'}</h2>
            <p className="weight-record-target-date">{date}</p>
          </div>
          <button type="button" className="theme-close-button" onClick={closeDialog} aria-label="体重入力を閉じる">
            <XIcon size={20} weight="bold" aria-hidden="true" />
          </button>
        </header>

        <div className="weight-record-form">
          <div className="form-field">
            <label htmlFor="weight-kg">体重（kg） <span className="required-label">必須</span></label>
            <div className="weight-input-row">
              <input
                id="weight-kg"
                type="number"
                min={MIN_WEIGHT_KG}
                max={MAX_WEIGHT_KG}
                step="0.1"
                inputMode="decimal"
                value={weight}
                onChange={(event) => {
                  setWeight(event.target.value)
                  if (error) setError('')
                }}
                required
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `weight-range-hint ${errorId}` : 'weight-range-hint'}
              />
              <span className="weight-unit" aria-hidden="true">kg</span>
            </div>
            <span id="weight-range-hint" className="field-hint">
              20.0～300.0 kg、小数第1位に正規化します。
            </span>
            {error && <p id="weight-record-error" className="form-error" role="alert">{error}</p>}
          </div>

          <div className="form-field">
            <label htmlFor="weight-memo">メモ（任意）</label>
            <textarea
              id="weight-memo"
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              maxLength={MAX_WEIGHT_MEMO_LENGTH}
              rows={4}
              placeholder="例：朝、入浴後、夕食前"
            />
            <span className="character-count" aria-live="polite">{memo.length}/{MAX_WEIGHT_MEMO_LENGTH}</span>
          </div>
        </div>

        <div className="event-editor-actions">
          {record && <button type="button" className="event-action-button danger" onClick={handleDelete}>体重記録を削除</button>}
          <span className="event-action-spacer" />
          <button type="button" className="event-action-button secondary" onClick={closeDialog}>キャンセル</button>
          <button type="submit" className="event-action-button primary">保存</button>
        </div>
      </form>
    </dialog>
  )
}
