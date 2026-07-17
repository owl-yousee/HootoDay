import { XIcon } from '@phosphor-icons/react/X'
import { useEffect, useRef, useState, type FormEvent, type SyntheticEvent } from 'react'
import type { CalculationSex, HealthProfile } from '../types/health'
import { getLocalTodayKey, isValidLocalDateKey, MIN_BIRTH_DATE } from '../utils/healthProfile'
import {
  MAX_HEIGHT_CM,
  MAX_TARGET_WEIGHT_KG,
  MIN_HEIGHT_CM,
  MIN_TARGET_WEIGHT_KG,
  normalizeHealthNumber,
} from '../utils/healthProfileStorage'

interface HealthProfileDialogProps {
  profile: HealthProfile | null
  onSave: (profile: HealthProfile) => void
  onDelete: () => void
  onClose: () => void
}

interface ProfileErrors {
  form?: string
  height?: string
  birthDate?: string
  targetWeight?: string
}

export function HealthProfileDialog({ profile, onSave, onDelete, onClose }: HealthProfileDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pendingInternalCloseEventsRef = useRef(0)
  const [height, setHeight] = useState(profile?.heightCm?.toFixed(1) ?? '')
  const [birthDate, setBirthDate] = useState(profile?.birthDate ?? '')
  const [calculationSex, setCalculationSex] = useState<CalculationSex | ''>(profile?.calculationSex ?? '')
  const [targetWeight, setTargetWeight] = useState(profile?.targetWeightKg?.toFixed(1) ?? '')
  const [errors, setErrors] = useState<ProfileErrors>({})

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
    const nextErrors: ProfileErrors = {}
    const parsedHeight = height === '' ? null : Number(height)
    const parsedTargetWeight = targetWeight === '' ? null : Number(targetWeight)

    if (parsedHeight !== null && (!Number.isFinite(parsedHeight) || parsedHeight < MIN_HEIGHT_CM || parsedHeight > MAX_HEIGHT_CM)) {
      nextErrors.height = `身長は${MIN_HEIGHT_CM.toFixed(1)}cm以上${MAX_HEIGHT_CM.toFixed(1)}cm以下で入力してください。`
    }
    if (birthDate && (!isValidLocalDateKey(birthDate) || birthDate < MIN_BIRTH_DATE || birthDate > getLocalTodayKey())) {
      nextErrors.birthDate = `${MIN_BIRTH_DATE}から今日までの日付を入力してください。`
    }
    if (parsedTargetWeight !== null && (!Number.isFinite(parsedTargetWeight) || parsedTargetWeight < MIN_TARGET_WEIGHT_KG || parsedTargetWeight > MAX_TARGET_WEIGHT_KG)) {
      nextErrors.targetWeight = `目標体重は${MIN_TARGET_WEIGHT_KG.toFixed(1)}kg以上${MAX_TARGET_WEIGHT_KG.toFixed(1)}kg以下で入力してください。`
    }
    if (parsedHeight === null && !birthDate && !calculationSex && parsedTargetWeight === null) {
      nextErrors.form = '少なくとも1項目を入力してください。全項目を未設定にする場合はプロフィールを削除してください。'
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    onSave({
      heightCm: parsedHeight === null ? null : normalizeHealthNumber(parsedHeight),
      birthDate: birthDate || null,
      calculationSex: calculationSex || null,
      targetWeightKg: parsedTargetWeight === null ? null : normalizeHealthNumber(parsedTargetWeight),
      updatedAt: new Date().toISOString(),
    })
    closeDialog()
  }

  const handleDelete = () => {
    if (profile && window.confirm('健康プロフィールを削除しますか？体重記録は削除されません。')) {
      onDelete()
      closeDialog()
    }
  }

  return (
    <dialog ref={dialogRef} className="health-profile-dialog" aria-labelledby="health-profile-dialog-title" onCancel={handleCancel} onClose={handleDialogClose}>
      <form className="health-profile-panel" onSubmit={handleSubmit} noValidate>
        <header className="weight-record-header">
          <div>
            <p className="weight-record-eyebrow">Health profile</p>
            <h2 id="health-profile-dialog-title">健康プロフィール</h2>
          </div>
          <button type="button" className="theme-close-button" onClick={closeDialog} aria-label="健康プロフィールを閉じる">
            <XIcon size={20} weight="bold" aria-hidden="true" />
          </button>
        </header>

        <div className="health-profile-form">
          {errors.form && <p id="profile-form-error" className="form-error profile-form-error" role="alert">{errors.form}</p>}
          <div className="form-field">
            <label htmlFor="profile-height">身長（cm）</label>
            <div className="weight-input-row">
              <input id="profile-height" type="number" min={MIN_HEIGHT_CM} max={MAX_HEIGHT_CM} step="0.1" inputMode="decimal" value={height} onChange={(event) => { setHeight(event.target.value); setErrors({}) }} aria-invalid={Boolean(errors.height)} aria-describedby={errors.height ? 'profile-height-hint profile-height-error' : 'profile-height-hint'} />
              <span className="weight-unit" aria-hidden="true">cm</span>
            </div>
            <span id="profile-height-hint" className="field-hint">50.0～250.0 cm、小数第1位に正規化します。</span>
            {errors.height && <p id="profile-height-error" className="form-error" role="alert">{errors.height}</p>}
          </div>

          <div className="form-field">
            <label htmlFor="profile-birth-date">生年月日</label>
            <input id="profile-birth-date" type="date" min={MIN_BIRTH_DATE} max={getLocalTodayKey()} value={birthDate} onChange={(event) => { setBirthDate(event.target.value); setErrors({}) }} aria-invalid={Boolean(errors.birthDate)} aria-describedby={errors.birthDate ? 'profile-birth-hint profile-birth-error' : 'profile-birth-hint'} />
            <span id="profile-birth-hint" className="field-hint">年齢は保存せず、生年月日から表示時に計算します。</span>
            {errors.birthDate && <p id="profile-birth-error" className="form-error" role="alert">{errors.birthDate}</p>}
          </div>

          <div className="form-field">
            <label htmlFor="profile-sex">計算用の性別</label>
            <select id="profile-sex" value={calculationSex} onChange={(event) => { setCalculationSex(event.target.value as CalculationSex | ''); setErrors({}) }} aria-describedby="profile-sex-hint">
              <option value="">未設定</option>
              <option value="female">女性</option>
              <option value="male">男性</option>
            </select>
            <span id="profile-sex-hint" className="field-hint">将来の概算計算にのみ使用し、医療的判断には使用しません。</span>
          </div>

          <div className="form-field">
            <label htmlFor="profile-target-weight">目標体重（kg）</label>
            <div className="weight-input-row">
              <input id="profile-target-weight" type="number" min={MIN_TARGET_WEIGHT_KG} max={MAX_TARGET_WEIGHT_KG} step="0.1" inputMode="decimal" value={targetWeight} onChange={(event) => { setTargetWeight(event.target.value); setErrors({}) }} aria-invalid={Boolean(errors.targetWeight)} aria-describedby={errors.targetWeight ? 'profile-target-hint profile-target-error' : 'profile-target-hint'} />
              <span className="weight-unit" aria-hidden="true">kg</span>
            </div>
            <span id="profile-target-hint" className="field-hint">20.0～300.0 kg、小数第1位に正規化します。</span>
            {errors.targetWeight && <p id="profile-target-error" className="form-error" role="alert">{errors.targetWeight}</p>}
          </div>
        </div>

        <div className="event-editor-actions">
          {profile && <button type="button" className="event-action-button danger" onClick={handleDelete}>プロフィールを削除</button>}
          <span className="event-action-spacer" />
          <button type="button" className="event-action-button secondary" onClick={closeDialog}>キャンセル</button>
          <button type="submit" className="event-action-button primary">保存</button>
        </div>
      </form>
    </dialog>
  )
}
