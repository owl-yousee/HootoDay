import { DesktopIcon } from '@phosphor-icons/react/Desktop'
import { MoonIcon } from '@phosphor-icons/react/Moon'
import { SunIcon } from '@phosphor-icons/react/Sun'
import { XIcon } from '@phosphor-icons/react/X'
import { useEffect, useRef, type MouseEvent, type SyntheticEvent } from 'react'
import type { SupabaseAuthState, SupabaseConfigurationState } from '../hooks/useSupabaseAuth'
import type { useDayMemoInitialUpload } from '../hooks/useDayMemoInitialUpload'
import { useSupabasePairing, useSupabasePairingJoin } from '../hooks/useSupabasePairing'
import type { ConnectAsMemberResult, SupabaseWorkspaceState } from '../hooks/useSupabaseWorkspace'
import type { HealthProfile } from '../types/health'
import type { SyncConnection } from '../types/sync'
import type { AppliedTheme, ThemePreference } from '../types/theme'
import { formatCalculationSex } from '../utils/healthProfile'

interface ThemeSettingsProps {
  preference: ThemePreference
  appliedTheme: AppliedTheme
  onChange: (preference: ThemePreference) => void
  profile: HealthProfile | null
  onOpenProfile: () => void
  onOpenDataManagement: () => void
  supabaseAuth: {
    configurationState: SupabaseConfigurationState
    authState: SupabaseAuthState
    isConfigured: boolean
    isSignedIn: boolean
    signInAnonymously: () => Promise<void>
    safeErrorMessage: string | null
  }
  supabaseWorkspace: {
    connection: SyncConnection | null
    workspaceState: SupabaseWorkspaceState
    workspaceConnected: boolean
    createWorkspace: () => Promise<void>
    connectAsMember: (workspaceId: string) => ConnectAsMemberResult
    safeErrorMessage: string | null
  }
  dayMemoInitialUpload: ReturnType<typeof useDayMemoInitialUpload>
  onClose: () => void
}

interface CloudSyncPresentation {
  label: string
  description: string
  tone: 'neutral' | 'success' | 'error'
}

function getCloudSyncPresentation(
  configurationState: SupabaseConfigurationState,
  authState: SupabaseAuthState,
  safeErrorMessage: string | null,
): CloudSyncPresentation {
  if (configurationState === 'missing') {
    return {
      label: '未設定',
      description: 'この端末ではクラウド同期の接続設定がありません。',
      tone: 'neutral',
    }
  }

  if (configurationState === 'partial') {
    return {
      label: '設定不足',
      description: '接続設定の一部が不足しています。',
      tone: 'error',
    }
  }

  if (configurationState === 'invalid_url') {
    return {
      label: '設定エラー',
      description: '接続先URLの設定を確認してください。',
      tone: 'error',
    }
  }

  if (authState === 'checking') {
    return { label: '確認中', description: '保存済みの認証状態を確認しています。', tone: 'neutral' }
  }

  if (authState === 'signing_in') {
    return { label: '接続中', description: '匿名認証を開始しています。', tone: 'neutral' }
  }

  if (authState === 'signed_in') {
    return {
      label: '接続済み',
      description: 'この端末の匿名認証が完了しています。',
      tone: 'success',
    }
  }

  if (authState === 'error') {
    return {
      label: '接続エラー',
      description: safeErrorMessage ?? '認証状態を確認できませんでした。',
      tone: 'error',
    }
  }

  return { label: '未接続', description: '匿名認証はまだ開始されていません。', tone: 'neutral' }
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
  supabaseAuth,
  supabaseWorkspace,
  dayMemoInitialUpload,
  onClose,
}: ThemeSettingsProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pendingInternalCloseEventsRef = useRef(0)
  const supabasePairing = useSupabasePairing({
    isConfigured: supabaseAuth.isConfigured,
    isSignedIn: supabaseAuth.isSignedIn,
    connection: supabaseWorkspace.connection,
  })
  const supabasePairingJoin = useSupabasePairingJoin({
    isConfigured: supabaseAuth.isConfigured,
    isSignedIn: supabaseAuth.isSignedIn,
    connection: supabaseWorkspace.connection,
    connectAsMember: supabaseWorkspace.connectAsMember,
  })

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

  const cloudSyncPresentation = getCloudSyncPresentation(
    supabaseAuth.configurationState,
    supabaseAuth.authState,
    supabaseAuth.safeErrorMessage,
  )
  const isAuthActionDisabled = !supabaseAuth.isConfigured
    || supabaseAuth.authState === 'checking'
    || supabaseAuth.authState === 'signing_in'
  const isWorkspaceCreationDisabled = supabaseWorkspace.workspaceState !== 'not_created'
  const pairingMinutes = Math.floor(supabasePairing.remainingSeconds / 60)
  const pairingSeconds = supabasePairing.remainingSeconds % 60

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

        <section className="settings-section cloud-sync-settings" aria-labelledby="settings-cloud-sync-heading">
          <div className="settings-section-heading">
            <div>
              <p className="theme-panel-eyebrow">Cloud sync</p>
              <h3 id="settings-cloud-sync-heading">クラウド同期</h3>
            </div>
            <span className={`cloud-sync-status is-${cloudSyncPresentation.tone}`}>
              {cloudSyncPresentation.label}
            </span>
          </div>
          <div className="cloud-sync-message" role="status" aria-live="polite" aria-atomic="true">
            <p>{cloudSyncPresentation.description}</p>
          </div>
          {supabaseAuth.isSignedIn ? (
            <div className="cloud-workspace-panel">
              {supabaseWorkspace.workspaceState === 'created' ? (
                <>
                  {supabaseWorkspace.connection?.workspaceRole === 'member' ? (
                    <>
                      <strong>workspaceへの参加が完了しました</strong>
                      <p>{supabasePairingJoin.joinedByRecovery
                        ? '既存の参加状態を確認し、このiPhoneの接続情報を復旧しました。DayMemo同期はまだ実装されていません。'
                        : 'この端末は子機・memberとして接続済みです。DayMemo同期はまだ実装されていません。'}</p>
                    </>
                  ) : (
                    <>
                      <strong>親機として接続済み</strong>
                      <p>同期先workspaceは作成済みです。pairingとデータ同期はまだ開始していません。</p>
                    </>
                  )}
                  {supabaseWorkspace.workspaceConnected
                    && supabaseWorkspace.connection?.workspaceRole === 'owner' ? (
                    <>
                    <div className="cloud-pairing-panel">
                      <h4>iPhoneを接続</h4>
                      {supabasePairing.pairingState === 'issued' && supabasePairing.pairingCode ? (
                        <>
                          <p className="cloud-pairing-code" aria-label="接続コード">
                            {supabasePairing.pairingCode}
                          </p>
                          <p className="cloud-pairing-remaining" role="timer">
                            残り {pairingMinutes}分{String(pairingSeconds).padStart(2, '0')}秒
                          </p>
                          <p>このコードは一時的なものです。接続するiPhone以外には共有しないでください。</p>
                          <p className="cloud-pairing-pending">iPhoneの参加はまだ完了していません。</p>
                        </>
                      ) : supabasePairing.pairingState === 'issuing' ? (
                        <>
                          <p>接続コードを発行しています。</p>
                          <button type="button" className="health-primary-button cloud-sync-button" disabled>
                            発行中…
                          </button>
                        </>
                      ) : supabasePairing.pairingState === 'recovery_required' ? (
                        <p role="alert">{supabasePairing.safeErrorMessage}</p>
                      ) : supabasePairing.pairingState === 'unavailable' ? null : (
                        <>
                          <p>{supabasePairing.pairingState === 'expired'
                            ? '接続コードの有効期限が切れました。必要な場合だけ再発行してください。'
                            : 'iPhoneで入力する10分間有効な接続コードを発行します。'}</p>
                          <button
                            type="button"
                            className="health-primary-button cloud-sync-button"
                            onClick={() => { void supabasePairing.issuePairingCode() }}
                          >
                            {supabasePairing.pairingState === 'expired' ? '接続コードを再発行' : '接続コードを発行'}
                          </button>
                        </>
                      )}
                    </div>
                    <div className="cloud-day-memo-upload-panel">
                      <h4>DayMemo初回アップロード</h4>
                      <p>親機から手動で開始します。本文はこの画面へ表示しません。</p>
                      <p><strong>{dayMemoInitialUpload.dayMemoCount}件</strong>のDayMemoがあります。</p>
                      {dayMemoInitialUpload.uploadState === 'idle' ? (
                        <button type="button" className="health-primary-button cloud-sync-button" onClick={() => { void dayMemoInitialUpload.previewInitialUpload() }}>
                          初回アップロードを確認
                        </button>
                      ) : null}
                      {dayMemoInitialUpload.uploadState === 'previewing' ? <p>同期先が空か確認しています…</p> : null}
                      {dayMemoInitialUpload.uploadState === 'preview_ready' ? (
                        <>
                          <p>同期先は空です。対象は{dayMemoInitialUpload.previewDates.length}件です。</p>
                          {dayMemoInitialUpload.previewDates.length > 0 ? (
                            <ul className="cloud-day-memo-dates">
                              {dayMemoInitialUpload.previewDates.map((date) => <li key={date}>{date}</li>)}
                            </ul>
                          ) : <p>アップロード対象はありません。削除操作は行いません。</p>}
                          <button type="button" className="health-primary-button cloud-sync-button" disabled={dayMemoInitialUpload.previewDates.length === 0} onClick={dayMemoInitialUpload.prepareInitialUpload}>
                            アップロードを準備
                          </button>
                        </>
                      ) : null}
                      {dayMemoInitialUpload.uploadState === 'preparing' ? <p>operation IDと進捗を安全に保存しています…</p> : null}
                      {dayMemoInitialUpload.uploadState === 'prepared' ? (
                        <>
                          <p>{dayMemoInitialUpload.counts.total}件の準備が完了しました。</p>
                          <button type="button" className="health-primary-button cloud-sync-button" onClick={() => { void dayMemoInitialUpload.uploadPending() }}>
                            初回アップロードを開始
                          </button>
                        </>
                      ) : null}
                      {dayMemoInitialUpload.uploadState === 'partially_completed' ? (
                        <button type="button" className="health-primary-button cloud-sync-button" onClick={() => { void dayMemoInitialUpload.uploadPending() }}>
                          未送信分を再開
                        </button>
                      ) : null}
                      {dayMemoInitialUpload.uploadState === 'uploading' ? <p>1件ずつアップロードしています。画面を閉じないでください。</p> : null}
                      {dayMemoInitialUpload.uploadState === 'completed' ? <p className="cloud-day-memo-success">初回アップロードが完了しました。iPhoneへの反映はまだ行われません。</p> : null}
                      {['remote_not_empty', 'response_unknown', 'conflict', 'push_blocked', 'recovery_required', 'error'].includes(dayMemoInitialUpload.uploadState) && dayMemoInitialUpload.safeErrorMessage ? (
                        <p className="cloud-pairing-error" role="alert">{dayMemoInitialUpload.safeErrorMessage}</p>
                      ) : null}
                      {dayMemoInitialUpload.uploadState === 'error' && !dayMemoInitialUpload.metadata?.pushBlock ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" onClick={() => { void dayMemoInitialUpload.previewInitialUpload() }}>
                          確認をやり直す
                        </button>
                      ) : null}
                      {dayMemoInitialUpload.metadata ? (
                        <p className="cloud-day-memo-progress">
                          成功 {dayMemoInitialUpload.counts.applied}件・未完了 {dayMemoInitialUpload.counts.pending}件・確認必要 {dayMemoInitialUpload.counts.needsConfirmation}件
                        </p>
                      ) : null}
                      <p className="cloud-sync-note">自動再試行はしません。delete・pull反映・通常更新・競合解決は未実装です。</p>
                    </div>
                    </>
                  ) : null}
                </>
              ) : supabaseWorkspace.workspaceState === 'creating' ? (
                <>
                  <strong>同期先を作成中</strong>
                  <p>完了するまでこの画面を閉じずにお待ちください。</p>
                  <button type="button" className="health-primary-button cloud-sync-button" disabled>
                    同期先を作成中…
                  </button>
                </>
              ) : supabaseWorkspace.workspaceState === 'not_created' ? (
                <>
                  <strong>同期先未作成</strong>
                  <p>この操作ではまだ予定やメモなどのデータは送信されません。</p>
                  <button
                    type="button"
                    className="health-primary-button cloud-sync-button"
                    onClick={() => { void supabaseWorkspace.createWorkspace() }}
                    disabled={isWorkspaceCreationDisabled}
                  >
                    このPCを親機として同期先を作成
                  </button>
                  <div className="cloud-pairing-join-panel">
                    <h4>iPhoneを接続する</h4>
                    <p>親機に表示された接続コードを入力して、既存workspaceへ子機として参加します。</p>
                    <label className="cloud-pairing-label" htmlFor="cloud-pairing-code-input">
                      接続コード
                    </label>
                    <input
                      id="cloud-pairing-code-input"
                      className="cloud-pairing-input"
                      type="text"
                      value={supabasePairingJoin.inputCode}
                      onChange={(event) => supabasePairingJoin.setInputCode(event.target.value)}
                      disabled={supabasePairingJoin.inputLocked}
                      maxLength={128}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      inputMode="text"
                      autoComplete="off"
                    />
                    {supabasePairingJoin.safeErrorMessage ? (
                      <p className="cloud-pairing-error" role="alert">
                        {supabasePairingJoin.safeErrorMessage}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      className="health-primary-button cloud-sync-button"
                      onClick={() => { void supabasePairingJoin.joinWorkspace() }}
                      disabled={!supabasePairingJoin.canSubmit}
                    >
                      {supabasePairingJoin.joinState === 'joining' ? '参加中…' : 'このiPhoneを接続'}
                    </button>
                    <div className={`cloud-pairing-recovery${supabasePairingJoin.recoveryRequired ? ' is-required' : ''}`}>
                      <p>{supabasePairingJoin.recoveryRequired
                        ? 'pairing処理が完了している可能性があります。接続コードを再送しないでください。'
                        : 'すでに参加操作を行った端末は、接続コードを再送せず参加状態を確認できます。'}</p>
                      <button
                        type="button"
                        className="cloud-pairing-recovery-button"
                        onClick={() => { void supabasePairingJoin.recoverMembership() }}
                        disabled={!supabasePairingJoin.canRecover}
                      >
                        {supabasePairingJoin.joinState === 'recovering'
                          ? '参加状態を確認中…'
                          : '参加状態を確認して復旧'}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <strong>{supabaseWorkspace.workspaceState === 'recovery_required' ? '同期先の確認が必要' : '同期先エラー'}</strong>
                  <p>{supabaseWorkspace.safeErrorMessage ?? '同期先情報を確認できませんでした。'}</p>
                </>
              )}
            </div>
          ) : supabaseAuth.isConfigured ? (
            <>
              <p className="cloud-sync-note">同期先を作成するには、先に匿名認証を完了してください。</p>
              <button
                type="button"
                className="health-primary-button cloud-sync-button"
                onClick={() => { void supabaseAuth.signInAnonymously() }}
                disabled={isAuthActionDisabled}
              >
                {supabaseAuth.authState === 'signing_in'
                  ? '接続中…'
                  : supabaseAuth.authState === 'error'
                    ? '匿名認証を再試行'
                    : '匿名認証を開始'}
              </button>
            </>
          ) : null}
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
