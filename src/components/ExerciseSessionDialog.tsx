import { XIcon } from '@phosphor-icons/react/X'
import { useEffect, useMemo, useRef, useState, type FormEvent, type SyntheticEvent } from 'react'
import { exerciseTypeOptions, getExerciseTypeOption } from '../data/exerciseTypes'
import type { ExerciseSession, ExerciseType, WeightRecord } from '../types/health'
import {
  calculateEstimatedCalories,
  findWeightForExerciseDate,
  normalizeExerciseDecimal,
} from '../utils/exerciseMetrics'
import { MAX_EXERCISE_MEMO_LENGTH, MAX_EXERCISE_NAME_LENGTH } from '../utils/exerciseStorage'

interface ExerciseSessionDialogProps {
  date: string
  session: ExerciseSession | null
  weightRecords: WeightRecord[]
  onSave: (session: ExerciseSession) => void
  onDelete: (id: string) => void
  onClose: () => void
}

function createId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `exercise-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function ExerciseSessionDialog({
  date, session, weightRecords, onSave, onDelete, onClose,
}: ExerciseSessionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pendingInternalCloseEventsRef = useRef(0)
  const initialType = session?.exerciseType ?? 'treadmill'
  const initialWeight = session ? session.weightKgUsed : findWeightForExerciseDate(weightRecords, date)
  const [exerciseType, setExerciseType] = useState<ExerciseType>(initialType)
  const [customName, setCustomName] = useState(session?.customName ?? '')
  const [duration, setDuration] = useState(session ? String(session.durationMinutes) : '')
  const [heartRate, setHeartRate] = useState(session?.averageHeartRate === null || !session ? '' : String(session.averageHeartRate))
  const [mets, setMets] = useState(session ? session.mets.toFixed(1) : getExerciseTypeOption(initialType).defaultMets.toFixed(1))
  const [weight, setWeight] = useState(initialWeight === null ? '' : initialWeight.toFixed(1))
  const [memo, setMemo] = useState(session?.memo ?? '')
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

  const parsedDuration = Number(duration)
  const parsedMets = Number(mets)
  const parsedWeight = weight === '' ? null : Number(weight)
  const previewCalories = useMemo(
    () => calculateEstimatedCalories(parsedMets, parsedWeight, parsedDuration),
    [parsedDuration, parsedMets, parsedWeight],
  )

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

  const changeExerciseType = (nextType: ExerciseType) => {
    setExerciseType(nextType)
    setMets(getExerciseTypeOption(nextType).defaultMets.toFixed(1))
    if (nextType !== 'other') setCustomName('')
    setError('')
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsedHeartRate = heartRate === '' ? null : Number(heartRate)
    const normalizedCustomName = customName.trim()
    const normalizedMemo = memo.trim()

    if (exerciseType === 'other' && (!normalizedCustomName || normalizedCustomName.length > MAX_EXERCISE_NAME_LENGTH)) {
      setError(`その他の運動名を1～${MAX_EXERCISE_NAME_LENGTH}文字で入力してください。`)
      return
    }
    if (!Number.isInteger(parsedDuration) || parsedDuration < 1 || parsedDuration > 1440) {
      setError('運動時間を1～1440分の整数で入力してください。')
      return
    }
    if (parsedHeartRate !== null && (!Number.isInteger(parsedHeartRate) || parsedHeartRate < 30 || parsedHeartRate > 250)) {
      setError('平均心拍数を30～250 bpmの整数で入力してください。')
      return
    }
    if (!Number.isFinite(parsedMets) || parsedMets < 1 || parsedMets > 20) {
      setError('METsを1.0～20.0で入力してください。')
      return
    }
    if (parsedWeight !== null && (!Number.isFinite(parsedWeight) || parsedWeight < 20 || parsedWeight > 300)) {
      setError('計算に使用する体重を20.0～300.0kgで入力してください。')
      return
    }
    if (normalizedMemo.length > MAX_EXERCISE_MEMO_LENGTH) {
      setError(`メモは${MAX_EXERCISE_MEMO_LENGTH}文字以内で入力してください。`)
      return
    }

    const now = new Date().toISOString()
    const normalizedMets = normalizeExerciseDecimal(parsedMets)
    const normalizedWeight = parsedWeight === null ? null : normalizeExerciseDecimal(parsedWeight)
    onSave({
      id: session?.id ?? createId(), date, exerciseType,
      customName: exerciseType === 'other' ? normalizedCustomName : '',
      durationMinutes: parsedDuration,
      averageHeartRate: parsedHeartRate,
      mets: normalizedMets,
      weightKgUsed: normalizedWeight,
      estimatedCaloriesKcal: calculateEstimatedCalories(normalizedMets, normalizedWeight, parsedDuration),
      memo: normalizedMemo,
      createdAt: session?.createdAt ?? now,
      updatedAt: now,
    })
    closeDialog()
  }

  const handleDelete = () => {
    if (session && window.confirm(`${session.customName || getExerciseTypeOption(session.exerciseType).label}の運動記録を削除しますか？`)) {
      onDelete(session.id)
      closeDialog()
    }
  }

  const errorId = error ? 'exercise-session-error' : undefined
  const describedBy = (hintId: string) => errorId ? `${hintId} ${errorId}` : hintId

  return (
    <dialog ref={dialogRef} className="exercise-session-dialog" aria-labelledby="exercise-session-dialog-title" onCancel={handleCancel} onClose={handleClose}>
      <form className="exercise-session-panel" onSubmit={handleSubmit} noValidate>
        <header className="exercise-session-header">
          <div><p className="weight-record-eyebrow">Exercise</p><h2 id="exercise-session-dialog-title">{session ? '運動記録を編集' : '運動を記録'}</h2><p className="weight-record-target-date">{date}</p></div>
          <button type="button" className="theme-close-button" onClick={closeDialog} aria-label="運動入力を閉じる"><XIcon size={20} weight="bold" aria-hidden="true" /></button>
        </header>

        <div className="exercise-session-form">
          <div className="form-field form-field-wide">
            <label htmlFor="exercise-type">運動種類 <span className="required-label">必須</span></label>
            <select id="exercise-type" value={exerciseType} onChange={(event) => changeExerciseType(event.target.value as ExerciseType)}>
              {exerciseTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>

          {exerciseType === 'other' && <div className="form-field form-field-wide">
            <label htmlFor="exercise-custom-name">その他の運動名 <span className="required-label">必須</span></label>
            <input id="exercise-custom-name" value={customName} maxLength={MAX_EXERCISE_NAME_LENGTH} onChange={(event) => { setCustomName(event.target.value); setError('') }} aria-invalid={Boolean(error && !customName.trim())} aria-describedby={describedBy('exercise-name-hint')} placeholder="例：ラジオ体操、散歩、筋トレ" />
            <span id="exercise-name-hint" className="field-hint">最大{MAX_EXERCISE_NAME_LENGTH}文字</span>
          </div>}

          <div className="form-field">
            <label htmlFor="exercise-duration">運動時間（分） <span className="required-label">必須</span></label>
            <input id="exercise-duration" type="number" min="1" max="1440" step="1" inputMode="numeric" value={duration} onChange={(event) => { setDuration(event.target.value); setError('') }} aria-invalid={Boolean(error)} aria-describedby={describedBy('exercise-duration-hint')} />
            <span id="exercise-duration-hint" className="field-hint">1～1440分の整数</span>
          </div>

          <div className="form-field">
            <label htmlFor="exercise-heart-rate">平均心拍数（bpm） <span className="optional-label">任意</span></label>
            <input id="exercise-heart-rate" type="number" min="30" max="250" step="1" inputMode="numeric" value={heartRate} onChange={(event) => { setHeartRate(event.target.value); setError('') }} aria-invalid={Boolean(error)} aria-describedby={describedBy('exercise-heart-rate-hint')} />
            <span id="exercise-heart-rate-hint" className="field-hint">30～250。今回の推定計算には使用しません。</span>
          </div>

          <div className="form-field">
            <label htmlFor="exercise-mets">METs <span className="required-label">必須</span></label>
            <input id="exercise-mets" type="number" min="1" max="20" step="0.1" inputMode="decimal" value={mets} onChange={(event) => { setMets(event.target.value); setError('') }} aria-invalid={Boolean(error)} aria-describedby={describedBy('exercise-mets-hint')} />
            <span id="exercise-mets-hint" className="field-hint">初期値は概算です。運動強度に合わせて変更できます。</span>
          </div>

          <div className="form-field">
            <label htmlFor="exercise-weight">計算に使用する体重（kg） <span className="optional-label">任意</span></label>
            <input id="exercise-weight" type="number" min="20" max="300" step="0.1" inputMode="decimal" value={weight} onChange={(event) => { setWeight(event.target.value); setError('') }} aria-invalid={Boolean(error)} aria-describedby={describedBy('exercise-weight-hint')} />
            <span id="exercise-weight-hint" className="field-hint">同日または直前の体重を初期表示。手動変更できます。</span>
          </div>

          <section className="exercise-calorie-preview form-field-wide" aria-live="polite" aria-atomic="true">
            <p>推定消費カロリー</p>
            <strong>{previewCalories === null ? '計算できません' : `${previewCalories} kcal`}</strong>
            {previewCalories === null
              ? <span>{weight === '' ? '計算に使用する体重を入力してください' : '運動時間・METs・体重を正しく入力してください'}</span>
              : <span>METs {parsedMets.toFixed(1)} × 体重{parsedWeight?.toFixed(1)}kg × {parsedDuration}分</span>}
          </section>

          <div className="form-field form-field-wide">
            <label htmlFor="exercise-memo">メモ <span className="optional-label">任意</span></label>
            <textarea id="exercise-memo" rows={4} maxLength={MAX_EXERCISE_MEMO_LENGTH} value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="例：軽め、負荷3、膝の様子を見ながら" />
            <span className="character-count" aria-live="polite">{memo.length}/{MAX_EXERCISE_MEMO_LENGTH}</span>
          </div>
        </div>

        {error && <p id="exercise-session-error" className="form-error" role="alert">{error}</p>}
        <p className="exercise-estimate-note">推定消費カロリーはMETs・体重・時間から算出した概算です。実際の消費量は運動強度や個人差で異なり、医療機器・運動機器による測定値ではありません。</p>
        <div className="event-editor-actions">
          {session && <button type="button" className="event-action-button danger" onClick={handleDelete}>削除</button>}
          <span className="event-action-spacer" />
          <button type="button" className="event-action-button secondary" onClick={closeDialog}>キャンセル</button>
          <button type="submit" className="event-action-button primary">保存</button>
        </div>
      </form>
    </dialog>
  )
}
