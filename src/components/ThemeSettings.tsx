import { DesktopIcon } from '@phosphor-icons/react/Desktop'
import { MoonIcon } from '@phosphor-icons/react/Moon'
import { SunIcon } from '@phosphor-icons/react/Sun'
import { XIcon } from '@phosphor-icons/react/X'
import { useEffect, useRef, type MouseEvent, type SyntheticEvent } from 'react'
import type { HealthProfile } from '../types/health'
import type { AppliedTheme, ThemePreference } from '../types/theme'
import { formatCalculationSex } from '../utils/healthProfile'

interface ThemeSettingsProps {
  preference: ThemePreference
  appliedTheme: AppliedTheme
  onChange: (preference: ThemePreference) => void
  profile: HealthProfile | null
  onOpenProfile: () => void
  onOpenDataManagement: () => void
  onClose: () => void
}

const themeOptions = [
  { value: 'light', label: 'ライト', description: '明るい配色', icon: SunIcon },
  { value: 'dark', label: 'ダーク', description: '暗い配色', icon: MoonIcon },
  {
    value: 'system',
    label: '端末設定に合わせる',
    description: 'OS・ブラウザ設定に連動',
    icon: DesktopIcon,
  },
] satisfies Array<{
  value: ThemePreference
  label: string
  description: string
  icon: typeof SunIcon
}>

export function ThemeSettings({
  preference,
  appliedTheme,
  onChange,
  profile,
  onOpenProfile,
  onOpenDataManagement,
  onClose,
}: ThemeSettingsProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pendingInternalCloseEventsRef = useRef(0)

  useEffect(() => {
    const dialog = dialogRef.current

    if (dialog && !dialog.open) {
      dialog.showModal()
    }

    return () => {
      if (dialog?.open) {
        pendingInternalCloseEventsRef.current += 1
        dialog.close()
      }
    }
  }, [])

  const closeDialog = () => {
    const dialog = dialogRef.current

    if (dialog?.open) {
      dialog.close()
    }
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

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) {
      closeDialog()
    }
  }

  const openProfile = () => {
    onOpenProfile()
  }

  return (
    <dialog
      ref={dialogRef}
      className="theme-dialog"
      aria-labelledby="settings-title"
      onCancel={handleDialogCancel}
      onClose={handleDialogClose}
      onClick={handleBackdropClick}
    >
      <div className="theme-panel">
        <div className="theme-panel-header">
          <div>
            <p className="theme-panel-eyebrow">Settings</p>
            <h2 id="settings-title">設定</h2>
          </div>
          <button
            type="button"
            className="theme-close-button"
            onClick={closeDialog}
            aria-label="設定を閉じる"
          >
            <XIcon size={20} weight="bold" aria-hidden="true" />
          </button>
        </div>

        <section className="settings-section" aria-labelledby="settings-theme-heading">
          <h3 id="settings-theme-heading">テーマ</h3>
          <fieldset className="theme-options">
          <legend className="visually-hidden">表示テーマを選択</legend>
          {themeOptions.map((option) => {
            const Icon = option.icon
            const isSelected = preference === option.value

            return (
              <label
                key={option.value}
                className={`theme-option${isSelected ? ' is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name="theme-preference"
                  value={option.value}
                  checked={isSelected}
                  onChange={() => onChange(option.value)}
                />
                <span className="theme-option-icon" aria-hidden="true">
                  <Icon size={22} weight={isSelected ? 'bold' : 'regular'} />
                </span>
                <span className="theme-option-copy">
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
                <span className="theme-radio-mark" aria-hidden="true" />
              </label>
            )
          })}
          </fieldset>

          <p className="applied-theme-note">現在の表示：{appliedTheme === 'dark' ? 'ダーク' : 'ライト'}</p>
        </section>

        <section className="settings-section health-profile-settings" aria-labelledby="settings-profile-heading">
          <div className="settings-section-heading">
            <div><p className="theme-panel-eyebrow">Health profile</p><h3 id="settings-profile-heading">健康プロフィール</h3></div>
            <span className="health-card-status">本人用</span>
          </div>
          {profile ? (
            <dl className="settings-profile-summary">
              <div><dt>生年月日</dt><dd>{profile.birthDate ?? '未設定'}</dd></div>
              <div><dt>身長</dt><dd>{profile.heightCm === null ? '未設定' : `${profile.heightCm.toFixed(1)} cm`}</dd></div>
              <div><dt>計算用の性別</dt><dd>{formatCalculationSex(profile.calculationSex)}</dd></div>
              <div><dt>目標体重</dt><dd>{profile.targetWeightKg === null ? '未設定' : `${profile.targetWeightKg.toFixed(1)} kg`}</dd></div>
            </dl>
          ) : <p className="settings-profile-empty">健康プロフィールは未設定です</p>}
          <button type="button" className="health-primary-button" onClick={openProfile} aria-label={profile ? '健康プロフィールを編集' : '健康プロフィールを設定'}>{profile ? '編集' : '設定する'}</button>
          <p className="settings-profile-note">BMIや目標体重などの概算計算に使用します。保存内容は設定画面以外へ不要に表示しません。</p>
        </section>

        <section className="settings-section settings-data-management" aria-labelledby="settings-data-heading">
          <p className="theme-panel-eyebrow">Data management</p>
          <h3 id="settings-data-heading">データ管理</h3>
          <p className="settings-data-note">バックアップ・復元・出力・初期化を行います。</p>
          <button
            type="button"
            className="health-primary-button settings-data-button"
            onClick={onOpenDataManagement}
            aria-label="出力・バックアップを開く"
          >
            出力・バックアップを開く
          </button>
        </section>
      </div>
    </dialog>
  )
}
