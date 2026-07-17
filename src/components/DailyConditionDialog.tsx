import { XIcon } from '@phosphor-icons/react/X'
import { useEffect, useRef, useState, type FormEvent, type SyntheticEvent } from 'react'
import { bodyPartConditionOptions, conditionLevelOptions } from '../data/conditionOptions'
import type { BodyPartCondition, ConditionLevel, DailyConditionRecord } from '../types/health'
import {
  hasConditionContent,
  MAX_CONDITION_MEMO_LENGTH,
  MAX_CONDITION_SHORT_TEXT_LENGTH,
  normalizeConditionText,
} from '../utils/conditionStorage'

interface DailyConditionDialogProps {
  date: string
  record: DailyConditionRecord | null
  onSave: (record: DailyConditionRecord) => void
  onDelete: (date: string) => void
  onClose: () => void
}

export function DailyConditionDialog({ date, record, onSave, onDelete, onClose }: DailyConditionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pendingInternalCloseEventsRef = useRef(0)
  const [overallCondition, setOverallCondition] = useState<ConditionLevel>(record?.overallCondition ?? 'unset')
  const [kneeCondition, setKneeCondition] = useState<BodyPartCondition>(record?.kneeCondition ?? 'unset')
  const [lowerBackCondition, setLowerBackCondition] = useState<BodyPartCondition>(record?.lowerBackCondition ?? 'unset')
  const [menstrualNote, setMenstrualNote] = useState(record?.menstrualNote ?? '')
  const [concerns, setConcerns] = useState(record?.concerns ?? '')
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

  const closeDialog = () => { if (dialogRef.current?.open) dialogRef.current.close() }
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
  const clearError = () => { if (error) setError('') }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = {
      overallCondition,
      kneeCondition,
      lowerBackCondition,
      menstrualNote: normalizeConditionText(menstrualNote),
      concerns: normalizeConditionText(concerns),
      memo: normalizeConditionText(memo),
    }
    if (!hasConditionContent(normalized)) {
      setError('少なくとも1つの状態またはメモを入力してください。')
      return
    }
    onSave({ date, ...normalized, updatedAt: new Date().toISOString() })
    closeDialog()
  }

  const handleDelete = () => {
    if (record && window.confirm(`${date}の体調記録を削除しますか？`)) {
      onDelete(date)
      closeDialog()
    }
  }

  const errorId = error ? 'daily-condition-error' : undefined

  return (
    <dialog ref={dialogRef} className="daily-condition-dialog" aria-labelledby="daily-condition-dialog-title" onCancel={handleCancel} onClose={handleClose}>
      <form className="daily-condition-panel" onSubmit={handleSubmit} noValidate>
        <header className="daily-condition-header">
          <div><p className="weight-record-eyebrow">Condition</p><h2 id="daily-condition-dialog-title">{record ? '体調記録を編集' : '体調を記録'}</h2><p className="weight-record-target-date">{date}</p></div>
          <button type="button" className="theme-close-button" onClick={closeDialog} aria-label="体調入力を閉じる"><XIcon size={20} weight="bold" aria-hidden="true" /></button>
        </header>

        <div className="daily-condition-form">
          <div className="form-field">
            <label htmlFor="overall-condition">全体の体調 <span className="optional-label">任意</span></label>
            <select id="overall-condition" value={overallCondition} onChange={(event) => { setOverallCondition(event.target.value as ConditionLevel); clearError() }} aria-invalid={Boolean(error)} aria-describedby={errorId}>
              {conditionLevelOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="knee-condition">膝 <span className="optional-label">任意</span></label>
            <select id="knee-condition" value={kneeCondition} onChange={(event) => { setKneeCondition(event.target.value as BodyPartCondition); clearError() }} aria-invalid={Boolean(error)} aria-describedby={errorId}>
              {bodyPartConditionOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="lower-back-condition">腰 <span className="optional-label">任意</span></label>
            <select id="lower-back-condition" value={lowerBackCondition} onChange={(event) => { setLowerBackCondition(event.target.value as BodyPartCondition); clearError() }} aria-invalid={Boolean(error)} aria-describedby={errorId}>
              {bodyPartConditionOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </div>

          <div className="form-field form-field-wide">
            <label htmlFor="menstrual-note">生理・周期メモ <span className="optional-label">任意</span></label>
            <textarea id="menstrual-note" rows={3} maxLength={MAX_CONDITION_SHORT_TEXT_LENGTH} value={menstrualNote} onChange={(event) => { setMenstrualNote(event.target.value); clearError() }} aria-invalid={Boolean(error)} aria-describedby={errorId} placeholder="例：生理開始、量が少ない、周期が遅れている" />
            <span className="character-count" aria-live="polite">{menstrualNote.length}/{MAX_CONDITION_SHORT_TEXT_LENGTH}</span>
          </div>
          <div className="form-field form-field-wide">
            <label htmlFor="condition-concerns">気になること <span className="optional-label">任意</span></label>
            <textarea id="condition-concerns" rows={3} maxLength={MAX_CONDITION_SHORT_TEXT_LENGTH} value={concerns} onChange={(event) => { setConcerns(event.target.value); clearError() }} aria-invalid={Boolean(error)} aria-describedby={errorId} placeholder="例：頭痛、眠気、のどの違和感、声の調子" />
            <span className="character-count" aria-live="polite">{concerns.length}/{MAX_CONDITION_SHORT_TEXT_LENGTH}</span>
          </div>
          <div className="form-field form-field-wide">
            <label htmlFor="condition-memo">自由メモ <span className="optional-label">任意</span></label>
            <textarea id="condition-memo" rows={5} maxLength={MAX_CONDITION_MEMO_LENGTH} value={memo} onChange={(event) => { setMemo(event.target.value); clearError() }} aria-invalid={Boolean(error)} aria-describedby={errorId} />
            <span className="character-count" aria-live="polite">{memo.length}/{MAX_CONDITION_MEMO_LENGTH}</span>
          </div>
        </div>

        {error && <p id="daily-condition-error" className="form-error" role="alert">{error}</p>}
        <p className="condition-privacy-note">本人の振り返り用記録です。症状の自動評価、病名推定、医療緊急度の判定は行いません。</p>
        <div className="event-editor-actions">
          {record && <button type="button" className="event-action-button danger" onClick={handleDelete}>削除</button>}
          <span className="event-action-spacer" />
          <button type="button" className="event-action-button secondary" onClick={closeDialog}>キャンセル</button>
          <button type="submit" className="event-action-button primary">保存</button>
        </div>
      </form>
    </dialog>
  )
}
