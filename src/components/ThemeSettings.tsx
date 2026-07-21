import { DesktopIcon } from '@phosphor-icons/react/Desktop'
import { MoonIcon } from '@phosphor-icons/react/Moon'
import { SunIcon } from '@phosphor-icons/react/Sun'
import { XIcon } from '@phosphor-icons/react/X'
import { useEffect, useRef, type MouseEvent, type SyntheticEvent } from 'react'
import { DayMemoBodyMismatchComparison } from './DayMemoBodyMismatchComparison'
import type { SupabaseAuthState, SupabaseConfigurationState } from '../hooks/useSupabaseAuth'
import type { useDayMemoInitialUpload } from '../hooks/useDayMemoInitialUpload'
import type { useDayMemoLocalOnlyPreview } from '../hooks/useDayMemoLocalOnlyPreview'
import type { useDayMemoLocalOnlyUpload } from '../hooks/useDayMemoLocalOnlyUpload'
import type { useDayMemoPullPreview } from '../hooks/useDayMemoPullPreview'
import type { useDayMemoBaselineRebase } from '../hooks/useDayMemoBaselineRebase'
import type { useDayMemoSyncBaseline } from '../hooks/useDayMemoSyncBaseline'
import type { useDayMemoSyncRecoveryCheck } from '../hooks/useDayMemoSyncRecoveryCheck'
import type { useDayMemoSyncRecoveryApply } from '../hooks/useDayMemoSyncRecoveryApply'
import type { useDayMemoConflictPreview } from '../hooks/useDayMemoConflictPreview'
import type { useDayMemoRemoteAdoptionPreflight } from '../hooks/useDayMemoRemoteAdoptionPreflight'
import type { useDayMemoRemoteActiveAdoption } from '../hooks/useDayMemoRemoteActiveAdoption'
import type { useDayMemoRemoteTombstoneAdoption } from '../hooks/useDayMemoRemoteTombstoneAdoption'
import type { useDayMemoRemoteAdoptionVerification } from '../hooks/useDayMemoRemoteAdoptionVerification'
import type { useDayMemoLocalOperationPreparationCheck } from '../hooks/useDayMemoLocalOperationPreparationCheck'
import type { useDayMemoLocalOperationPreparation } from '../hooks/useDayMemoLocalOperationPreparation'
import type { useDayMemoLocalOperationRemoteCheck } from '../hooks/useDayMemoLocalOperationRemoteCheck'
import type { useDayMemoLocalOperationSend } from '../hooks/useDayMemoLocalOperationSend'
import type { useDayMemoNormalDifferenceRecoveryPlan } from '../hooks/useDayMemoNormalDifferenceRecoveryPlan'
import type { useDayMemoNormalDifferenceRecoveryCheckpointCheck } from '../hooks/useDayMemoNormalDifferenceRecoveryCheckpointCheck'
import type { useDayMemoNormalDifferenceRecoveryCheckpointSave } from '../hooks/useDayMemoNormalDifferenceRecoveryCheckpointSave'
import type { useDayMemoNormalBodyMismatchCandidate } from '../hooks/useDayMemoNormalBodyMismatchCandidate'
import type { useDayMemoNormalBodyMismatchLocalPreparation } from '../hooks/useDayMemoNormalBodyMismatchLocalPreparation'
import type { useDayMemoBodyMismatchRecoveryPreflight } from '../hooks/useDayMemoBodyMismatchRecoveryPreflight'
import type { useDayMemoBodyMismatchRecoverySend } from '../hooks/useDayMemoBodyMismatchRecoverySend'
import type { useDayMemoSavedOperationResultRead } from '../hooks/useDayMemoSavedOperationResultRead'
import type { useDayMemoMetadataV4Migration } from '../hooks/useDayMemoMetadataV4Migration'
import type { useDayMemoMetadataV5Migration } from '../hooks/useDayMemoMetadataV5Migration'
import type { useDayMemoSyncMetadataMigration } from '../hooks/useDayMemoSyncMetadataMigration'
import type { useDayMemoDeleteIntent } from '../hooks/useDayMemoDeleteIntent'
import type { useDayMemoDeletePreview } from '../hooks/useDayMemoDeletePreview'
import type { useDayMemoTombstonePreview } from '../hooks/useDayMemoTombstonePreview'
import type { useDayMemoTombstoneApply } from '../hooks/useDayMemoTombstoneApply'
import type { useDayMemoResurrectionPreview } from '../hooks/useDayMemoResurrectionPreview'
import type { useDayMemoResurrectionUpload } from '../hooks/useDayMemoResurrectionUpload'
import type { useDayMemoDeleteUpload } from '../hooks/useDayMemoDeleteUpload'
import type { useDayMemoUpdatePreview } from '../hooks/useDayMemoUpdatePreview'
import type { useDayMemoUpdateUpload } from '../hooks/useDayMemoUpdateUpload'
import { useSupabasePairing, useSupabasePairingJoin } from '../hooks/useSupabasePairing'
import type { ConnectAsMemberResult, SupabaseWorkspaceState } from '../hooks/useSupabaseWorkspace'
import type { HealthProfile } from '../types/health'
import type { SyncConnection } from '../types/sync'
import type { DayMemoSyncSafety } from '../utils/dayMemoSyncSafety'
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
  dayMemoPullPreview: ReturnType<typeof useDayMemoPullPreview>
  dayMemoNormalDifferenceRecoveryPlan: ReturnType<typeof useDayMemoNormalDifferenceRecoveryPlan>
  dayMemoNormalDifferenceRecoveryCheckpointCheck: ReturnType<typeof useDayMemoNormalDifferenceRecoveryCheckpointCheck>
  dayMemoNormalDifferenceRecoveryCheckpointSave: ReturnType<typeof useDayMemoNormalDifferenceRecoveryCheckpointSave>
  dayMemoNormalBodyMismatchCandidate: ReturnType<typeof useDayMemoNormalBodyMismatchCandidate>
  dayMemoNormalBodyMismatchLocalPreparation: ReturnType<typeof useDayMemoNormalBodyMismatchLocalPreparation>
  dayMemoBodyMismatchRecoveryPreflight: ReturnType<typeof useDayMemoBodyMismatchRecoveryPreflight>
  dayMemoBodyMismatchRecoverySend: ReturnType<typeof useDayMemoBodyMismatchRecoverySend>
  dayMemoSavedOperationResultRead: ReturnType<typeof useDayMemoSavedOperationResultRead>
  dayMemoSyncBaseline: ReturnType<typeof useDayMemoSyncBaseline>
  dayMemoBaselineRebase: ReturnType<typeof useDayMemoBaselineRebase>
  dayMemoUpdatePreview: ReturnType<typeof useDayMemoUpdatePreview>
  dayMemoUpdateUpload: ReturnType<typeof useDayMemoUpdateUpload>
  dayMemoLocalOnlyPreview: ReturnType<typeof useDayMemoLocalOnlyPreview>
  dayMemoLocalOnlyUpload: ReturnType<typeof useDayMemoLocalOnlyUpload>
  dayMemoSyncSafety: DayMemoSyncSafety
  dayMemoSyncRecoveryCheck: ReturnType<typeof useDayMemoSyncRecoveryCheck>
  dayMemoConflictPreview: ReturnType<typeof useDayMemoConflictPreview>
  dayMemoRemoteAdoptionPreflight: ReturnType<typeof useDayMemoRemoteAdoptionPreflight>
  dayMemoRemoteActiveAdoption: ReturnType<typeof useDayMemoRemoteActiveAdoption>
  dayMemoRemoteTombstoneAdoption: ReturnType<typeof useDayMemoRemoteTombstoneAdoption>
  dayMemoRemoteAdoptionVerification: ReturnType<typeof useDayMemoRemoteAdoptionVerification>
  dayMemoLocalOperationPreparationCheck: ReturnType<typeof useDayMemoLocalOperationPreparationCheck>
  dayMemoLocalOperationPreparation: ReturnType<typeof useDayMemoLocalOperationPreparation>
  dayMemoLocalOperationRemoteCheck: ReturnType<typeof useDayMemoLocalOperationRemoteCheck>
  dayMemoLocalOperationSend: ReturnType<typeof useDayMemoLocalOperationSend>
  dayMemoMetadataV4Migration: ReturnType<typeof useDayMemoMetadataV4Migration>
  dayMemoMetadataV5Migration: ReturnType<typeof useDayMemoMetadataV5Migration>
  onOpenPreparedDayMemo: (date: string) => void
  dayMemoSyncRecoveryApply: ReturnType<typeof useDayMemoSyncRecoveryApply>
  dayMemoSyncMetadataMigration: ReturnType<typeof useDayMemoSyncMetadataMigration>
  dayMemoDeleteIntent: ReturnType<typeof useDayMemoDeleteIntent>
  dayMemoDeletePreview: ReturnType<typeof useDayMemoDeletePreview>
  dayMemoTombstonePreview: ReturnType<typeof useDayMemoTombstonePreview>
  dayMemoTombstoneApply: ReturnType<typeof useDayMemoTombstoneApply>
  dayMemoResurrectionPreview: ReturnType<typeof useDayMemoResurrectionPreview>
  dayMemoResurrectionUpload: ReturnType<typeof useDayMemoResurrectionUpload>
  dayMemoDeleteUpload: ReturnType<typeof useDayMemoDeleteUpload>
  onClose: () => void
}

interface CloudSyncPresentation {
  label: string
  description: string
  tone: 'neutral' | 'success' | 'error'
}

const BASELINE_STATE_LABELS: Record<ReturnType<typeof useDayMemoSyncBaseline>['baselineState'], string> = {
  unavailable: '利用不可',
  idle: '未確認',
  confirming: '確認中',
  confirmed: '確認済み',
  mismatch: '不一致',
  remote_empty: '同期先が空',
  recovery_required: '確認が必要',
  error: '確認失敗',
}

const CONFLICT_CLASSIFICATION_LABELS: Record<ReturnType<typeof useDayMemoConflictPreview>['items'][number]['classification'], string> = {
  local_update_remote_deleted: '端末で更新中・同期先で削除済み',
  local_delete_remote_updated: '端末で削除準備中・同期先で更新済み',
  resurrection_remote_updated: '端末で復活準備中・同期先で更新済み',
  resurrection_newer_tombstone: '端末で復活準備中・同期先に新しい削除状態',
  local_create_remote_changed: '端末で新規作成準備中・同期先に同じ日付あり',
  remote_state_unknown: '同期先状態を確認不能',
  pending_metadata_mismatch: '未完了処理と同期設定が不整合',
}

const CONFLICT_OPERATION_LABELS: Record<ReturnType<typeof useDayMemoConflictPreview>['items'][number]['localOperation'], string> = {
  update: '更新',
  delete: '削除',
  resurrection: '復活',
  create: '新規作成',
  unknown: '確認不能',
}

const CONFLICT_REMOTE_STATE_LABELS: Record<ReturnType<typeof useDayMemoConflictPreview>['items'][number]['remoteState'], string> = {
  active: '通常レコード',
  deleted: '削除済み',
  unknown: '確認不能',
}

const REMOTE_ADOPTION_PREFLIGHT_LABELS: Record<NonNullable<ReturnType<typeof useDayMemoRemoteAdoptionPreflight>['result']>['classification'], string> = {
  ready_remote_active: '同期先の通常状態を採用可能',
  ready_remote_tombstone: '同期先の削除状態を採用可能',
  blocked_snapshot_changed: '確認後に端末または同期設定が変化',
  blocked_remote_changed: '確認後に同期先状態が変化',
  blocked_other_mismatch: '対象外に未処理の不一致あり',
  blocked_invalid_remote: '同期先状態を安全に検証不能',
  blocked_unknown: '最終確認を完了不能',
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

const pullComparisonLabels = {
  remote_only: '同期先のみ',
  local_only: 'この端末のみ',
  same: '内容一致',
  different: '内容相違',
  remote_tombstone_local_exists: '同期先は削除済み・端末にあり',
  remote_tombstone_local_missing: '同期先は削除済み・端末になし',
} as const

const updateClassificationLabels = {
  unchanged: '変更なし',
  modified_candidate: '既存DayMemoの更新候補',
  local_only: 'この端末のみ（今回対象外）',
  missing_local: 'この端末に存在しない（削除処理は未実装）',
  tombstone_baseline: '同期先で削除済み（今回対象外）',
  metadata_invalid: '同期情報の確認が必要',
} as const

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
  dayMemoPullPreview,
  dayMemoNormalDifferenceRecoveryPlan,
  dayMemoNormalDifferenceRecoveryCheckpointCheck,
  dayMemoNormalDifferenceRecoveryCheckpointSave,
  dayMemoNormalBodyMismatchCandidate,
  dayMemoNormalBodyMismatchLocalPreparation,
  dayMemoBodyMismatchRecoveryPreflight,
  dayMemoBodyMismatchRecoverySend,
  dayMemoSavedOperationResultRead,
  dayMemoSyncBaseline,
  dayMemoBaselineRebase,
  dayMemoUpdatePreview,
  dayMemoUpdateUpload,
  dayMemoLocalOnlyPreview,
  dayMemoLocalOnlyUpload,
  dayMemoSyncSafety,
  dayMemoSyncRecoveryCheck,
  dayMemoConflictPreview,
  dayMemoRemoteAdoptionPreflight,
  dayMemoRemoteActiveAdoption,
  dayMemoRemoteTombstoneAdoption,
  dayMemoRemoteAdoptionVerification,
  dayMemoLocalOperationPreparationCheck,
  dayMemoLocalOperationPreparation,
  dayMemoLocalOperationRemoteCheck,
  dayMemoLocalOperationSend,
  dayMemoMetadataV4Migration,
  dayMemoMetadataV5Migration,
  onOpenPreparedDayMemo,
  dayMemoSyncRecoveryApply,
  dayMemoSyncMetadataMigration,
  dayMemoDeleteIntent,
  dayMemoDeletePreview,
  dayMemoTombstonePreview,
  dayMemoTombstoneApply,
  dayMemoResurrectionPreview,
  dayMemoResurrectionUpload,
  dayMemoDeleteUpload,
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
                  <div className={`cloud-day-memo-safety-panel is-${dayMemoSyncSafety.state}`} role={dayMemoSyncSafety.state === 'normal' ? 'status' : 'alert'}>
                    <h4>DayMemo同期の安全状態</h4>
                    <strong>{dayMemoSyncSafety.state === 'normal' ? '通常'
                      : dayMemoSyncSafety.state === 'conflict' ? '競合'
                        : dayMemoSyncSafety.state === 'response_unknown' ? '結果確認待ち'
                          : dayMemoSyncSafety.state === 'pending_operation' ? '未完了処理あり'
                            : dayMemoSyncSafety.state === 'metadata_invalid' ? '設定確認が必要'
                              : '復旧が必要'}</strong>
                    <p>{dayMemoSyncSafety.message}</p>
                    {dayMemoSyncSafety.state !== 'normal' ? (
                      <p className="cloud-sync-note">状態を確認するまで新しい送信を開始しません。自動送信・自動再試行・自動修復は行いません。</p>
                    ) : null}
                  </div>
                  {dayMemoSyncRecoveryCheck.conflictSummary ? (
                    <div className="cloud-day-memo-conflict-summary" role="alert">
                      <h4>同期先との競合があります</h4>
                      <p><strong>確認が必要です。</strong>この画面では競合を解決せず、同期先とこの端末を変更しません。</p>
                      <ul className="cloud-day-memo-preview-summary">
                        <li>対象日付：{dayMemoSyncRecoveryCheck.conflictSummary.date}</li>
                        <li>状態：{dayMemoSyncRecoveryCheck.conflictSummary.status === 'conflict_detected' ? '競合を確認' : '競合状態'}</li>
                        <li>端末の基準revision：{dayMemoSyncRecoveryCheck.conflictSummary.localRevision}</li>
                        <li>同期先revision：{dayMemoSyncRecoveryCheck.conflictSummary.remoteRevision ?? '未確認'}</li>
                        <li>端末の基準change sequence：{dayMemoSyncRecoveryCheck.conflictSummary.localChangeSequence}</li>
                        <li>同期先change sequence：{dayMemoSyncRecoveryCheck.conflictSummary.remoteChangeSequence ?? '未確認'}</li>
                        <li>{dayMemoSyncRecoveryCheck.conflictSummary.status === 'conflict_detected' ? '競合確認時刻' : '操作準備時刻'}：{new Date(dayMemoSyncRecoveryCheck.conflictSummary.recordedAt).toLocaleString('ja-JP')}</li>
                      </ul>
                      <p className="cloud-sync-note">pending operationとoperation IDを保持します。自動マージ、上書き、再送、取消しは行いません。</p>
                      <p className="cloud-sync-note">同期先を再確認する場合は、下の読み取り専用「同期先の状態を確認」を使用してください。</p>
                    </div>
                  ) : null}
                  {dayMemoConflictPreview.eligible ? (
                    <div className="cloud-day-memo-conflict-summary" role="region" aria-labelledby="day-memo-conflict-preview-heading">
                      <h4 id="day-memo-conflict-preview-heading">DayMemo競合状態の確認</h4>
                      <p>競合内容を読み取り専用で確認します。確認しても解決、再送、metadata更新は行いません。</p>
                      {dayMemoConflictPreview.state === 'idle' ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" onClick={() => { void dayMemoConflictPreview.checkConflicts() }}>
                          競合状態を確認
                        </button>
                      ) : null}
                      {dayMemoConflictPreview.state === 'checking' ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" disabled>競合状態を確認中…</button>
                      ) : null}
                      {dayMemoConflictPreview.state === 'checked' ? (
                        <div role="status">
                          <p><strong>競合確認結果：{dayMemoConflictPreview.conflictCount}件</strong></p>
                          <ul className="cloud-day-memo-preview-items">
                            {dayMemoConflictPreview.items.map((item) => (
                              <li key={`${item.date}-${item.classification}`}>
                                <strong>{item.date}</strong>
                                <span>分類：{CONFLICT_CLASSIFICATION_LABELS[item.classification]}</span>
                                <span>この端末の操作：{CONFLICT_OPERATION_LABELS[item.localOperation]}</span>
                                <span>base revision：{item.baseRevision}</span>
                                <span>同期先revision：{item.remoteRevision ?? '確認不能'}</span>
                                <span>base change sequence：{item.baseChangeSequence}</span>
                                <span>同期先change sequence：{item.remoteChangeSequence ?? '確認不能'}</span>
                                <span>同期先状態：{CONFLICT_REMOTE_STATE_LABELS[item.remoteState]}</span>
                                <span>未完了処理状態：{item.pendingStatus === 'intent_recorded' ? '削除意図あり' : item.pendingStatus}</span>
                                <small>確認日時：{new Date(item.checkedAt).toLocaleString('ja-JP')}</small>
                                {item.classification !== 'remote_state_unknown'
                                  && item.classification !== 'pending_metadata_mismatch'
                                  && item.remoteState !== 'unknown' ? (
                                    <label>
                                      <input
                                        type="radio"
                                        name="day-memo-remote-adoption-candidate"
                                        value={item.date}
                                        checked={dayMemoRemoteAdoptionPreflight.selectedDate === item.date}
                                        onChange={() => dayMemoRemoteAdoptionPreflight.selectCandidate(item.date)}
                                        disabled={!dayMemoRemoteAdoptionPreflight.eligible
                                          || dayMemoRemoteAdoptionPreflight.state === 'checking'
                                          || dayMemoRemoteActiveAdoption.state === 'applying'
                                          || dayMemoRemoteTombstoneAdoption.state === 'applying'}
                                      />
                                      この競合をremote採用候補にする
                                    </label>
                                  ) : null}
                              </li>
                            ))}
                          </ul>
                          <p className="cloud-sync-note">競合を保持したまま安全停止します。後続Phaseまで解決、採用、merge、retryは行いません。</p>
                          <button type="button" className="health-secondary-button cloud-sync-button" onClick={dayMemoConflictPreview.discardPreview}>
                            確認結果を破棄
                          </button>
                        </div>
                      ) : null}
                      {dayMemoConflictPreview.safeErrorMessage ? <p className="cloud-pairing-error" role="alert">{dayMemoConflictPreview.safeErrorMessage}</p> : null}
                      {dayMemoRemoteAdoptionPreflight.selectedDate ? (
                        <div className="cloud-day-memo-apply-confirmation">
                          <h4>remote採用の最終確認</h4>
                          <p>選択対象日付：{dayMemoRemoteAdoptionPreflight.selectedDate}</p>
                          <p>同期先と端末の状態を読み取り専用で再確認します。まだDayMemoや同期情報は変更しません。</p>
                          {dayMemoRemoteAdoptionPreflight.state === 'selected' ? (
                            <button type="button" className="health-secondary-button cloud-sync-button" onClick={() => { void dayMemoRemoteAdoptionPreflight.runPreflight() }}>
                              同期先の状態を最終確認
                            </button>
                          ) : null}
                          {dayMemoRemoteAdoptionPreflight.state === 'checking' ? (
                            <button type="button" className="health-secondary-button cloud-sync-button" disabled>最終確認中…</button>
                          ) : null}
                          {dayMemoRemoteAdoptionPreflight.result ? (
                            <div role="status">
                              <p><strong>preflight結果：{REMOTE_ADOPTION_PREFLIGHT_LABELS[dayMemoRemoteAdoptionPreflight.result.classification]}</strong></p>
                              <ul className="cloud-day-memo-preview-summary">
                                <li>対象日付：{dayMemoRemoteAdoptionPreflight.result.date}</li>
                                <li>競合分類：{CONFLICT_CLASSIFICATION_LABELS[dayMemoRemoteAdoptionPreflight.result.conflictClassification]}</li>
                                <li>この端末の操作：{CONFLICT_OPERATION_LABELS[dayMemoRemoteAdoptionPreflight.result.localOperation]}</li>
                                <li>同期先状態：{CONFLICT_REMOTE_STATE_LABELS[dayMemoRemoteAdoptionPreflight.result.remoteState]}</li>
                                <li>base revision：{dayMemoRemoteAdoptionPreflight.result.baseRevision}</li>
                                <li>同期先revision：{dayMemoRemoteAdoptionPreflight.result.remoteRevision}</li>
                                <li>baseline change sequence：{dayMemoRemoteAdoptionPreflight.result.baselineChangeSequence}</li>
                                <li>同期先change sequence：{dayMemoRemoteAdoptionPreflight.result.remoteChangeSequence}</li>
                                <li>対象外不一致：{dayMemoRemoteAdoptionPreflight.result.otherMismatchCount}件</li>
                                <li>確認日時：{new Date(dayMemoRemoteAdoptionPreflight.result.checkedAt).toLocaleString('ja-JP')}</li>
                              </ul>
                              <p>{dayMemoRemoteAdoptionPreflight.result.localEffect === 'replace'
                                ? 'この端末の同日DayMemoは同期先の内容へ置き換わります。他の日付は変更されません。'
                                : dayMemoRemoteAdoptionPreflight.result.localEffect === 'add'
                                  ? '同期先のDayMemoがこの端末へ追加されます。他の日付は変更されません。'
                                  : dayMemoRemoteAdoptionPreflight.result.localEffect === 'delete'
                                    ? 'この端末の同日DayMemoは削除されます。他の日付は変更されません。'
                                    : 'この端末には対象DayMemoがないため、同期情報だけを同期先の削除状態へ合わせる予定です。'}</p>
                              <p className="cloud-sync-note">採用完了時には対象pendingとlocalDeleteIntentを解消する予定ですが、このPhaseでは変更しません。</p>
                              <p className="cloud-sync-note">{dayMemoRemoteAdoptionPreflight.result.classification === 'ready_remote_active'
                                ? '次のPhaseで同期先の内容をこの端末へ反映できます。'
                                : dayMemoRemoteAdoptionPreflight.result.classification === 'ready_remote_tombstone'
                                  ? '次のPhaseで同期先の削除状態をこの端末へ反映できます。'
                                  : '状態が変化したため、競合確認からやり直してください。'}</p>
                            </div>
                          ) : null}
                          {dayMemoRemoteAdoptionPreflight.safeErrorMessage ? <p className="cloud-pairing-error" role="alert">{dayMemoRemoteAdoptionPreflight.safeErrorMessage}</p> : null}
                          {dayMemoRemoteActiveAdoption.canApply && dayMemoRemoteAdoptionPreflight.result?.classification === 'ready_remote_active' ? (
                            <div className="cloud-day-memo-apply-confirmation" role="alert">
                              <strong>同期先の内容をこの端末へ明示反映します</strong>
                              <p>対象日付：{dayMemoRemoteAdoptionPreflight.result.date}</p>
                              <p>{dayMemoRemoteAdoptionPreflight.result.localEffect === 'replace'
                                ? 'この端末の同日DayMemoは同期先の内容へ置き換わります。'
                                : '同期先のDayMemoがこの端末へ追加されます。'}</p>
                              <p>他の日付と同期先の内容は変更しません。この端末側の未完了操作は採用完了後に解消されます。</p>
                              <p className="cloud-sync-note">自動同期ではありません。本文はこの画面へ表示しません。</p>
                              <button type="button" className="health-primary-button cloud-sync-button" onClick={() => { void dayMemoRemoteActiveAdoption.applyRemoteActive() }}>
                                同期先の内容をこの端末へ反映
                              </button>
                            </div>
                          ) : dayMemoRemoteTombstoneAdoption.canApply && dayMemoRemoteAdoptionPreflight.result?.classification === 'ready_remote_tombstone' ? (
                            <div className="cloud-day-memo-apply-confirmation" role="alert">
                              <strong>同期先の削除状態をこの端末へ明示反映します</strong>
                              <p>対象日付：{dayMemoRemoteAdoptionPreflight.result.date}</p>
                              <p>{dayMemoRemoteAdoptionPreflight.result.localEffect === 'delete'
                                ? 'この端末の同日DayMemoは削除されます。'
                                : 'この端末には対象DayMemoがないため、同期情報だけを同期先の削除状態へ合わせます。'}</p>
                              <p>他の日付と同期先の状態は変更しません。この端末側の未完了操作は採用完了後に解消されます。</p>
                              <p className="cloud-sync-note">自動同期ではありません。本文はこの画面へ表示しません。</p>
                              <button type="button" className="health-primary-button cloud-sync-button" onClick={() => { void dayMemoRemoteTombstoneAdoption.applyRemoteTombstone() }}>
                                同期先の削除状態をこの端末へ反映
                              </button>
                            </div>
                          ) : null}
                          {dayMemoRemoteActiveAdoption.state === 'applying' ? (
                            <button type="button" className="health-primary-button cloud-sync-button" disabled>同期先の内容を反映中…</button>
                          ) : null}
                          {dayMemoRemoteActiveAdoption.safeErrorMessage ? <p className="cloud-pairing-error" role="alert">{dayMemoRemoteActiveAdoption.safeErrorMessage}</p> : null}
                          {dayMemoRemoteTombstoneAdoption.state === 'applying' ? (
                            <button type="button" className="health-primary-button cloud-sync-button" disabled>同期先の削除状態を反映中…</button>
                          ) : null}
                          {dayMemoRemoteTombstoneAdoption.safeErrorMessage ? <p className="cloud-pairing-error" role="alert">{dayMemoRemoteTombstoneAdoption.safeErrorMessage}</p> : null}
                          <button type="button" className="health-secondary-button cloud-sync-button" onClick={dayMemoRemoteAdoptionPreflight.discard} disabled={dayMemoRemoteAdoptionPreflight.state === 'checking' || dayMemoRemoteActiveAdoption.state === 'applying' || dayMemoRemoteTombstoneAdoption.state === 'applying'}>
                            remote採用確認を破棄
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {dayMemoRemoteActiveAdoption.state === 'completed' && dayMemoRemoteActiveAdoption.result ? (
                    <div className="cloud-day-memo-success" role="status">
                      <h4>remote active採用完了</h4>
                      <ul className="cloud-day-memo-preview-summary">
                        <li>対象日付：{dayMemoRemoteActiveAdoption.result.date}</li>
                        <li>revision：{dayMemoRemoteActiveAdoption.result.remoteRevision}</li>
                        <li>change sequence：{dayMemoRemoteActiveAdoption.result.remoteChangeSequence}</li>
                        <li>端末反映：{dayMemoRemoteActiveAdoption.result.localEffect === 'replace' ? '同日DayMemoを置換' : 'DayMemoを追加'}</li>
                        <li>pending：解消済み</li>
                        <li>削除意図：{dayMemoRemoteActiveAdoption.result.intentResolved ? '解消済み' : '対象なし'}</li>
                      </ul>
                      <p>他の日付と同期先は変更していません。自動同期ではありません。</p>
                    </div>
                  ) : null}
                  {dayMemoRemoteTombstoneAdoption.state === 'completed' && dayMemoRemoteTombstoneAdoption.result ? (
                    <div className="cloud-day-memo-success" role="status">
                      <h4>remote tombstone採用完了</h4>
                      <ul className="cloud-day-memo-preview-summary">
                        <li>対象日付：{dayMemoRemoteTombstoneAdoption.result.date}</li>
                        <li>revision：{dayMemoRemoteTombstoneAdoption.result.remoteRevision}</li>
                        <li>change sequence：{dayMemoRemoteTombstoneAdoption.result.remoteChangeSequence}</li>
                        <li>端末反映：{dayMemoRemoteTombstoneAdoption.result.localEffect === 'delete' ? '同日DayMemoを削除' : 'metadataのみ更新'}</li>
                        <li>pending：解消済み</li>
                        <li>削除意図：{dayMemoRemoteTombstoneAdoption.result.intentResolved ? '解消済み' : '対象なし'}</li>
                      </ul>
                      <p>他の日付と同期先は変更していません。自動同期ではありません。</p>
                    </div>
                  ) : null}
                  {dayMemoRemoteAdoptionVerification.eligible ? (
                    <div className="cloud-day-memo-recovery-check-panel" role="region" aria-labelledby="day-memo-adoption-verification-heading">
                      <h4 id="day-memo-adoption-verification-heading">remote採用後の総合確認</h4>
                      <p>local DayMemo、同期情報、同期先を読み取り専用で確認します。自動修復・再送・metadata更新は行いません。</p>
                      {dayMemoRemoteAdoptionVerification.state === 'idle' ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" onClick={() => { void dayMemoRemoteAdoptionVerification.verify() }}>
                          remote採用後の状態を確認
                        </button>
                      ) : null}
                      {dayMemoRemoteAdoptionVerification.state === 'checking' ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" disabled>remote採用後の状態を確認中…</button>
                      ) : null}
                      {dayMemoRemoteAdoptionVerification.result ? (
                        <div role="status">
                          <p><strong>安全判定：{dayMemoRemoteAdoptionVerification.result.classification}</strong></p>
                          <ul className="cloud-day-memo-preview-summary">
                            <li>確認範囲：{dayMemoRemoteAdoptionVerification.result.scope === 'adoption_target' ? '採用対象1件と端末全体' : '端末全体（採用対象は推測しません）'}</li>
                            <li>採用種類：{dayMemoRemoteAdoptionVerification.result.adoptionKind === 'remote_active'
                              ? 'remote active'
                              : dayMemoRemoteAdoptionVerification.result.adoptionKind === 'remote_tombstone'
                                ? 'remote tombstone'
                                : dayMemoRemoteAdoptionVerification.result.adoptionKind === 'metadata_only_tombstone'
                                  ? 'metadata-only tombstone'
                                  : '全体整合確認'}</li>
                            {dayMemoRemoteAdoptionVerification.result.date ? <li>対象日付：{dayMemoRemoteAdoptionVerification.result.date}</li> : null}
                            {dayMemoRemoteAdoptionVerification.result.remoteRevision !== null ? <li>remote revision：{dayMemoRemoteAdoptionVerification.result.remoteRevision}</li> : null}
                            {dayMemoRemoteAdoptionVerification.result.remoteChangeSequence !== null ? <li>remote change sequence：{dayMemoRemoteAdoptionVerification.result.remoteChangeSequence}</li> : null}
                            <li>local状態：{dayMemoRemoteAdoptionVerification.result.localState}</li>
                            <li>baseline状態：{dayMemoRemoteAdoptionVerification.result.baselineState}</li>
                            <li>pending：{dayMemoRemoteAdoptionVerification.result.pendingResolved ? '解消済み' : '残存または確認不能'}</li>
                            <li>対象intent：{dayMemoRemoteAdoptionVerification.result.targetIntentResolved ? '解消済み' : '残存または確認不能'}</li>
                            <li>他intent：{dayMemoRemoteAdoptionVerification.result.otherIntentCount}件</li>
                            <li>cursor：{dayMemoRemoteAdoptionVerification.result.cursorValid ? '確認済み' : '不整合または確認不能'}</li>
                            <li>対象外不一致：{dayMemoRemoteAdoptionVerification.result.outside.total}件</li>
                            <li>remote-only：{dayMemoRemoteAdoptionVerification.result.outside.remoteOnly}件</li>
                            <li>local-only：{dayMemoRemoteAdoptionVerification.result.outside.localOnly}件</li>
                            <li>本文不一致：{dayMemoRemoteAdoptionVerification.result.outside.contentMismatch}件</li>
                            <li>updatedAt不一致：{dayMemoRemoteAdoptionVerification.result.outside.updatedAtMismatch}件</li>
                            <li>active/tombstone不一致：{dayMemoRemoteAdoptionVerification.result.outside.stateMismatch}件</li>
                            <li>baseline欠落：{dayMemoRemoteAdoptionVerification.result.outside.baselineMissing}件</li>
                            <li>revision系譜不一致：{dayMemoRemoteAdoptionVerification.result.outside.revisionMismatch}件</li>
                            <li>確認日時：{new Date(dayMemoRemoteAdoptionVerification.result.checkedAt).toLocaleString('ja-JP')}</li>
                          </ul>
                          <p>{dayMemoRemoteAdoptionVerification.result.nextAction}</p>
                          <button type="button" className="health-secondary-button cloud-sync-button" onClick={dayMemoRemoteAdoptionVerification.discard}>
                            採用後確認結果を破棄
                          </button>
                        </div>
                      ) : null}
                      {dayMemoRemoteAdoptionVerification.safeErrorMessage ? <p className="cloud-pairing-error" role="alert">{dayMemoRemoteAdoptionVerification.safeErrorMessage}</p> : null}
                    </div>
                  ) : null}
                  {dayMemoMetadataV4Migration.eligible ? (
                    <div className="cloud-day-memo-recovery-check-panel" role="region" aria-labelledby="day-memo-v4-migration-heading">
                      <h4 id="day-memo-v4-migration-heading">DayMemo同期metadata v4</h4>
                      <p>自動では移行しません。現在状態を読み取り専用で確認してから、明示操作で移行します。</p>
                      <button type="button" className="health-secondary-button cloud-sync-button" onClick={dayMemoMetadataV4Migration.check}>
                        metadata v4への移行条件を確認
                      </button>
                      {dayMemoMetadataV4Migration.result ? (
                        <div role="status">
                          <ul className="cloud-day-memo-preview-summary">
                            <li>現在version：{dayMemoMetadataV4Migration.result.sourceVersion ?? '確認不能'}</li>
                            <li>移行先version：4</li>
                            <li>migration：{dayMemoMetadataV4Migration.result.ready ? 'ready' : dayMemoMetadataV4Migration.result.classification}</li>
                            <li>pending：{dayMemoMetadataV4Migration.result.pendingCount}件</li>
                            <li>delete pending：{dayMemoMetadataV4Migration.result.deletePendingCount}件</li>
                            <li>localDeleteIntent：{dayMemoMetadataV4Migration.result.hasDeleteIntent ? 'あり' : 'なし'}</li>
                            <li>operation対応：{dayMemoMetadataV4Migration.result.operationResolvable ? '一意' : '確認不能'}</li>
                            <li>対象日：{dayMemoMetadataV4Migration.result.targetMatches ? '一致' : '確認不能'}</li>
                            <li>baseline系譜：{dayMemoMetadataV4Migration.result.baselineMatches ? '一致' : '確認不能'}</li>
                            <li>workspace binding：{dayMemoMetadataV4Migration.result.workspaceValid ? '一致' : '確認不能'}</li>
                            <li>validator：{dayMemoMetadataV4Migration.result.metadataValid ? '正常' : '確認不能'}</li>
                            <li>永続変更：{dayMemoMetadataV4Migration.result.persistentChanged ? 'あり' : 'なし'}</li>
                            <li>rollback：{dayMemoMetadataV4Migration.result.rollbackAttempted ? '実施' : 'なし'}</li>
                            <li>確認日時：{new Date(dayMemoMetadataV4Migration.result.checkedAt).toLocaleString('ja-JP')}</li>
                          </ul>
                          <p>{dayMemoMetadataV4Migration.result.nextAction}</p>
                          {dayMemoMetadataV4Migration.result.ready ? (
                            <button type="button" className="health-primary-button cloud-sync-button" onClick={dayMemoMetadataV4Migration.migrate}>
                              metadata v4へ移行
                            </button>
                          ) : null}
                          <button type="button" className="health-secondary-button cloud-sync-button" onClick={dayMemoMetadataV4Migration.discard}>
                            migration結果を破棄
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {dayMemoMetadataV5Migration.eligible ? (
                    <div className="cloud-day-memo-recovery-check-panel" role="region" aria-labelledby="day-memo-v5-migration-heading">
                      <h4 id="day-memo-v5-migration-heading">DayMemo同期metadata v5</h4>
                      <p>自動では移行しません。現在状態を読み取り専用で確認してから、別の明示操作で移行します。</p>
                      <button type="button" className="health-secondary-button cloud-sync-button" onClick={dayMemoMetadataV5Migration.check}>
                        metadata v5への移行条件を確認
                      </button>
                      {dayMemoMetadataV5Migration.result ? (
                        <div role="status">
                          <ul className="cloud-day-memo-preview-summary">
                            <li>現在version：{dayMemoMetadataV5Migration.result.sourceVersion ?? '確認不能'}</li>
                            <li>移行先version：{dayMemoMetadataV5Migration.result.targetVersion}</li>
                            <li>判定：{dayMemoMetadataV5Migration.result.classification}</li>
                            <li>pending：{dayMemoMetadataV5Migration.result.pendingCount}件</li>
                            <li>pending種別：{dayMemoMetadataV5Migration.result.pendingKind}</li>
                            <li>pending移行：{dayMemoMetadataV5Migration.result.pendingMigrationPossible ? '可能' : '確認不能'}</li>
                            <li>workspace binding：{dayMemoMetadataV5Migration.result.workspaceValid ? '一致' : '確認不能'}</li>
                            <li>validator：{dayMemoMetadataV5Migration.result.metadataValid ? '正常' : '確認不能'}</li>
                            <li>永続変更：{dayMemoMetadataV5Migration.result.persistentChanged ? 'あり' : 'なし'}</li>
                            <li>read-back：{dayMemoMetadataV5Migration.result.readBackSucceeded ? '確認済み' : '未実施'}</li>
                            <li>rollback：{dayMemoMetadataV5Migration.result.rollbackAttempted ? (dayMemoMetadataV5Migration.result.rollbackSucceeded ? '成功' : '確認不能') : 'なし'}</li>
                            <li>確認日時：{new Date(dayMemoMetadataV5Migration.result.checkedAt).toLocaleString('ja-JP')}</li>
                          </ul>
                          <p>{dayMemoMetadataV5Migration.result.nextAction}</p>
                          {dayMemoMetadataV5Migration.result.ready ? (
                            <button type="button" className="health-primary-button cloud-sync-button" onClick={dayMemoMetadataV5Migration.migrate}>
                              metadata v5へ移行
                            </button>
                          ) : null}
                          <button type="button" className="health-secondary-button cloud-sync-button" onClick={dayMemoMetadataV5Migration.discard}>
                            migration確認結果を破棄
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {dayMemoLocalOperationPreparationCheck.eligible ? (
                    <div className="cloud-day-memo-recovery-check-panel" role="region" aria-labelledby="day-memo-local-operation-preparation-heading">
                      <h4 id="day-memo-local-operation-preparation-heading">新しいlocal操作の準備条件</h4>
                      <p>remote採用後の確認結果と現在の端末状態を読み取り専用で比較します。編集・保存・削除は開始しません。</p>
                      <fieldset className="cloud-day-memo-preview-options">
                        <legend>判定するlocal操作</legend>
                        {([
                          ['local_edit_prepare', 'local編集の準備'],
                          ['local_save_prepare', 'local保存へ進む前提確認'],
                          ['local_delete_prepare', 'local削除の準備'],
                        ] as const).map(([value, label]) => (
                          <label key={value}>
                            <input
                              type="radio"
                              name="day-memo-local-operation-preparation-kind"
                              value={value}
                              checked={dayMemoLocalOperationPreparationCheck.operationKind === value}
                              onChange={() => dayMemoLocalOperationPreparationCheck.setOperationKind(value)}
                            />
                            {label}
                          </label>
                        ))}
                      </fieldset>
                      <button type="button" className="health-secondary-button cloud-sync-button" onClick={dayMemoLocalOperationPreparationCheck.check}>
                        新しいlocal操作の準備条件を確認
                      </button>
                      {dayMemoLocalOperationPreparationCheck.result ? (
                        <div role="status">
                          <p><strong>{dayMemoLocalOperationPreparationCheck.result.ready ? '準備可能' : '準備不可'}</strong></p>
                          <ul className="cloud-day-memo-preview-summary">
                            <li>対象日付：{dayMemoLocalOperationPreparationCheck.result.date ?? '特定なし'}</li>
                            <li>採用種類：{dayMemoLocalOperationPreparationCheck.result.adoptionKind}</li>
                            <li>local操作：{dayMemoLocalOperationPreparationCheck.result.operationKind}</li>
                            <li>safety分類：{dayMemoLocalOperationPreparationCheck.result.classification}</li>
                            <li>metadata validator：{dayMemoLocalOperationPreparationCheck.result.metadataValid ? '正常' : '確認不能'}</li>
                            <li>workspace binding：{dayMemoLocalOperationPreparationCheck.result.workspaceValid ? '一致' : '確認不能'}</li>
                            <li>pushBlock：{dayMemoLocalOperationPreparationCheck.result.pushBlockClear ? 'なし' : 'あり／確認不能'}</li>
                            <li>対象pending：{dayMemoLocalOperationPreparationCheck.result.targetPendingClear ? 'なし' : '残存'}</li>
                            <li>対象localDeleteIntent：{dayMemoLocalOperationPreparationCheck.result.targetIntentClear ? 'なし' : '残存'}</li>
                            <li>他pending：{dayMemoLocalOperationPreparationCheck.result.otherPendingCount}件</li>
                            <li>他localDeleteIntent：{dayMemoLocalOperationPreparationCheck.result.otherIntentCount}件</li>
                            <li>cursor：{dayMemoLocalOperationPreparationCheck.result.cursorValid ? '確認済み' : '不整合／確認不能'}</li>
                            <li>対象外不一致：{dayMemoLocalOperationPreparationCheck.result.outsideMismatchCount}件</li>
                            <li>採用後確認結果：{dayMemoLocalOperationPreparationCheck.result.verificationFresh ? '現在状態と一致' : '古い／確認不能'}</li>
                            <li>確認日時：{new Date(dayMemoLocalOperationPreparationCheck.result.checkedAt).toLocaleString('ja-JP')}</li>
                          </ul>
                          <p>{dayMemoLocalOperationPreparationCheck.result.nextAction}</p>
                          <button type="button" className="health-secondary-button cloud-sync-button" onClick={dayMemoLocalOperationPreparationCheck.discard}>
                            準備確認結果を破棄
                          </button>
                        </div>
                      ) : null}
                      <p className="cloud-sync-note">自動pull、自動retry、pending・intent・operation ID作成は行いません。</p>
                    </div>
                  ) : null}
                  {dayMemoLocalOperationPreparationCheck.result?.ready || dayMemoLocalOperationPreparation.result ? (
                    <div className="cloud-day-memo-recovery-check-panel" role="region" aria-labelledby="day-memo-local-operation-persistent-preparation-heading">
                      <h4 id="day-memo-local-operation-persistent-preparation-heading">新しいlocal操作を永続的に準備</h4>
                      <p>対象日付：{dayMemoLocalOperationPreparationCheck.result?.date ?? dayMemoLocalOperationPreparation.result?.date ?? '特定なし'}</p>
                      <p>操作種類：{dayMemoLocalOperationPreparationCheck.result?.operationKind ?? dayMemoLocalOperationPreparation.result?.operationKind}</p>
                      <p>準備条件：{dayMemoLocalOperationPreparationCheck.result?.ready ? 'local_operation_prepare_ready' : '永続準備後'}</p>
                      {dayMemoLocalOperationPreparationCheck.result?.operationKind === 'local_edit_prepare' ? (
                        <>
                          <p>編集開始用のoperationは作成しません。編集UIへの専用接続は今後のPhaseで行います。</p>
                          <button type="button" className="health-secondary-button cloud-sync-button" onClick={dayMemoLocalOperationPreparation.prepareEdit}>
                            編集準備を確認
                          </button>
                        </>
                      ) : null}
                      {dayMemoLocalOperationPreparationCheck.result?.operationKind === 'local_save_prepare'
                        && dayMemoLocalOperationPreparationCheck.result.date ? (
                          <>
                            <p>DayMemo編集画面で保存を明示した時に、local保存とupload pendingを一度だけ準備します。</p>
                            <button
                              type="button"
                              className="health-secondary-button cloud-sync-button"
                              onClick={() => onOpenPreparedDayMemo(dayMemoLocalOperationPreparationCheck.result!.date!)}
                            >
                              保存操作を新しく準備
                            </button>
                          </>
                        ) : null}
                      {dayMemoLocalOperationPreparationCheck.result?.operationKind === 'local_delete_prepare'
                        && dayMemoLocalOperationPreparationCheck.result.date ? (
                          <button
                            type="button"
                            className="health-secondary-button cloud-sync-button"
                            onClick={() => { void dayMemoLocalOperationPreparation.prepareDelete(dayMemoLocalOperationPreparationCheck.result!.date!) }}
                          >
                            削除操作を新しく準備
                          </button>
                        ) : null}
                      {dayMemoLocalOperationPreparation.result ? (
                        <div role="status">
                          <p><strong>{dayMemoLocalOperationPreparation.result.succeeded ? '永続準備完了' : '永続準備停止'}</strong></p>
                          <ul className="cloud-day-memo-preview-summary">
                            <li>対象日付：{dayMemoLocalOperationPreparation.result.date ?? '特定なし'}</li>
                            <li>操作種類：{dayMemoLocalOperationPreparation.result.operationKind}</li>
                            <li>safety分類：{dayMemoLocalOperationPreparation.result.classification}</li>
                            <li>operation ID：{dayMemoLocalOperationPreparation.result.operationIdGenerated ? '生成済み' : '未生成'}</li>
                            <li>pending：{dayMemoLocalOperationPreparation.result.pendingCreated ? '作成済み' : '未作成'}</li>
                            <li>localDeleteIntent：{dayMemoLocalOperationPreparation.result.localDeleteIntentCreated ? '作成済み' : '未作成'}</li>
                            <li>DayMemo：{dayMemoLocalOperationPreparation.result.dayMemoChanged ? '変更あり' : '変更なし'}</li>
                            <li>remote送信：未実施</li>
                            <li>確認日時：{new Date(dayMemoLocalOperationPreparation.result.checkedAt).toLocaleString('ja-JP')}</li>
                          </ul>
                          <p>{dayMemoLocalOperationPreparation.result.nextAction}</p>
                          <button type="button" className="health-secondary-button cloud-sync-button" onClick={dayMemoLocalOperationPreparation.discard}>
                            準備結果を破棄
                          </button>
                        </div>
                      ) : null}
                      <p className="cloud-sync-note">準備後も自動送信しません。永続準備の取消は今回実装していません。</p>
                    </div>
                  ) : null}
                  {dayMemoLocalOperationRemoteCheck.eligible || dayMemoLocalOperationRemoteCheck.result ? (
                    <div className="cloud-day-memo-recovery-check-panel" role="region" aria-labelledby="day-memo-local-operation-remote-check-heading">
                      <h4 id="day-memo-local-operation-remote-check-heading">準備済み操作のremote送信条件</h4>
                      <p>準備済み1件について、同期先がbaselineから変化していないかを読み取り専用で確認します。この確認では送信しません。</p>
                      {dayMemoLocalOperationRemoteCheck.state === 'checking' ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" disabled>remote送信条件を確認中…</button>
                      ) : dayMemoLocalOperationRemoteCheck.preparedKind === 'upsert' ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" onClick={() => { void dayMemoLocalOperationRemoteCheck.checkRemote('upsert') }}>
                          保存操作のremote送信条件を確認
                        </button>
                      ) : dayMemoLocalOperationRemoteCheck.preparedKind === 'delete' ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" onClick={() => { void dayMemoLocalOperationRemoteCheck.checkRemote('delete') }}>
                          削除操作のremote送信条件を確認
                        </button>
                      ) : null}
                      {dayMemoLocalOperationRemoteCheck.result ? (
                        <div role="status">
                          <p><strong>{dayMemoLocalOperationRemoteCheck.result.sendable ? '送信条件を確認済み' : '安全停止'}</strong></p>
                          <ul className="cloud-day-memo-preview-summary">
                            <li>対象日付：{dayMemoLocalOperationRemoteCheck.result.date ?? '確認不能'}</li>
                            <li>操作種類：{dayMemoLocalOperationRemoteCheck.result.operationKind ?? '確認不能'}</li>
                            <li>判定：{dayMemoLocalOperationRemoteCheck.result.classification}</li>
                            <li>remote状態：{dayMemoLocalOperationRemoteCheck.result.remoteState}</li>
                            <li>baseline revision：{dayMemoLocalOperationRemoteCheck.result.baselineRevision ?? '確認不能'}</li>
                            <li>remote revision：{dayMemoLocalOperationRemoteCheck.result.remoteRevision ?? '確認不能'}</li>
                            <li>baseline change sequence：{dayMemoLocalOperationRemoteCheck.result.baselineChangeSequence ?? '確認不能'}</li>
                            <li>remote change sequence：{dayMemoLocalOperationRemoteCheck.result.remoteChangeSequence ?? '確認不能'}</li>
                            <li>remote不変：{dayMemoLocalOperationRemoteCheck.result.remoteUnchanged ? '確認済み' : '未確認'}</li>
                            <li>operation照合：{dayMemoLocalOperationRemoteCheck.result.operationMatch === 'unavailable' ? 'pull契約では確認不可' : dayMemoLocalOperationRemoteCheck.result.operationMatch}</li>
                            <li>RPC送信：未実施</li>
                            <li>確認日時：{new Date(dayMemoLocalOperationRemoteCheck.result.checkedAt).toLocaleString('ja-JP')}</li>
                          </ul>
                          <p>{dayMemoLocalOperationRemoteCheck.result.nextAction}</p>
                          {dayMemoLocalOperationRemoteCheck.result.sendable && dayMemoLocalOperationRemoteCheck.result.operationKind === 'upsert' ? (
                            <button type="button" className="health-secondary-button cloud-sync-button" disabled={!dayMemoLocalOperationSend.canSend} onClick={() => { void dayMemoLocalOperationSend.send('upsert') }}>
                              準備済みの保存操作を送信
                            </button>
                          ) : dayMemoLocalOperationRemoteCheck.result.sendable && dayMemoLocalOperationRemoteCheck.result.operationKind === 'delete' ? (
                            <button type="button" className="health-secondary-button cloud-sync-button" disabled={!dayMemoLocalOperationSend.canSend} onClick={() => { void dayMemoLocalOperationSend.send('delete') }}>
                              準備済みの削除操作を送信
                            </button>
                          ) : null}
                          <button type="button" className="health-secondary-button cloud-sync-button" disabled={dayMemoLocalOperationSend.sending} onClick={dayMemoLocalOperationRemoteCheck.discard}>
                            remote確認結果を破棄
                          </button>
                        </div>
                      ) : null}
                      <p className="cloud-sync-note">結果はこの画面のメモリ内だけに保持します。後続の送信Phaseでもremoteを再確認します。</p>
                      {dayMemoLocalOperationSend.result ? (
                        <div role="status">
                          <p><strong>{dayMemoLocalOperationSend.result.succeeded ? '送信完了' : '送信停止'}</strong></p>
                          <ul className="cloud-day-memo-preview-summary">
                            <li>対象日付：{dayMemoLocalOperationSend.result.date ?? '確認不能'}</li>
                            <li>操作種類：{dayMemoLocalOperationSend.result.operationKind ?? '確認不能'}</li>
                            <li>判定：{dayMemoLocalOperationSend.result.classification}</li>
                            <li>snapshot：{dayMemoLocalOperationSend.result.snapshotFresh ? '有効' : '無効'}</li>
                            <li>送信直前remote確認：{dayMemoLocalOperationSend.result.remoteRechecked ? '実施' : '未実施'}</li>
                            <li>RPC実行：{dayMemoLocalOperationSend.result.rpcCalled ? '1回' : 'なし'}</li>
                            <li>RPC成功結果検証：{dayMemoLocalOperationSend.result.rpcResultValidated ? '確認済み' : '未確認'}</li>
                            <li>baseline更新：{dayMemoLocalOperationSend.result.baselineUpdated ? '完了' : 'なし'}</li>
                            <li>cursor更新：{dayMemoLocalOperationSend.result.cursorUpdated ? '完了' : 'なし'}</li>
                            <li>pending解消：{dayMemoLocalOperationSend.result.pendingCleared ? '完了' : '維持'}</li>
                            <li>delete intent解消：{dayMemoLocalOperationSend.result.intentCleared ? '完了' : '維持または対象外'}</li>
                            <li>復旧確認：{dayMemoLocalOperationSend.result.recoveryRequired ? '必要' : '不要'}</li>
                            <li>確認日時：{new Date(dayMemoLocalOperationSend.result.checkedAt).toLocaleString('ja-JP')}</li>
                          </ul>
                          <p>{dayMemoLocalOperationSend.result.nextAction}</p>
                          <button type="button" className="health-secondary-button cloud-sync-button" onClick={dayMemoLocalOperationSend.discard}>
                            送信結果を破棄
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {dayMemoSyncRecoveryCheck.eligible ? (
                    <div className="cloud-day-memo-recovery-check-panel">
                      <h4>未完了同期の確認</h4>
                      <p>同期先の現在状態を読み取り専用で確認します。確認だけでは再送・復旧・metadata更新を行いません。</p>
                      {dayMemoSyncRecoveryCheck.state === 'idle' ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" onClick={() => { void dayMemoSyncRecoveryCheck.checkRemote() }}>
                          同期先の状態を確認
                        </button>
                      ) : null}
                      {dayMemoSyncRecoveryCheck.state === 'checking' ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" disabled>確認中…</button>
                      ) : null}
                      {dayMemoSyncRecoveryCheck.result ? (
                        <div role="status">
                          <p>対象日付：{dayMemoSyncRecoveryCheck.result.date}</p>
                          <p>{dayMemoSyncRecoveryCheck.result.classification === 'remote_applied'
                            ? '同期先へ反映済みの可能性があります。'
                            : dayMemoSyncRecoveryCheck.result.classification === 'remote_not_applied'
                              ? '同期先へ未反映の可能性があります。'
                              : dayMemoSyncRecoveryCheck.result.classification === 'conflict_detected'
                                ? '同期先に別の変更があり、競合を確認しました。'
                                : '同期先の状態を安全に判定できませんでした。'}</p>
                          {dayMemoSyncRecoveryCheck.result.classification === 'remote_applied' ? (
                            <>
                              <ul className="cloud-day-memo-preview-summary">
                                <li>revision：{dayMemoSyncRecoveryCheck.result.remoteRevision}</li>
                                <li>change sequence：{dayMemoSyncRecoveryCheck.result.remoteChangeSequence}</li>
                              </ul>
                              <p>同期先への反映は完了していると確認できました。再送せず、この端末の同期情報だけを復旧できます。</p>
                              <p className="cloud-sync-note">local DayMemo本文とSupabaseは変更しません。</p>
                              {dayMemoSyncRecoveryApply.canRecover ? (
                                <button type="button" className="health-secondary-button cloud-sync-button" onClick={dayMemoSyncRecoveryApply.recoverMetadata}>
                                  この端末の同期情報を復旧
                                </button>
                              ) : null}
                            </>
                          ) : dayMemoSyncRecoveryCheck.result.classification === 'remote_not_applied' ? (
                            <p className="cloud-sync-note">未反映の可能性がありますが、今回は再送しません。</p>
                          ) : dayMemoSyncRecoveryCheck.result.classification === 'conflict_detected' ? (
                            <p className="cloud-sync-note">競合解決は行わず、pending operationを保持します。</p>
                          ) : (
                            <p className="cloud-sync-note">推測で復旧せず、再確認または後続Phaseを待ちます。</p>
                          )}
                          {dayMemoSyncRecoveryApply.state === 'recovering' ? <button type="button" className="health-secondary-button cloud-sync-button" disabled>復旧中…</button> : null}
                          <p className="cloud-sync-note">pending operationは保持しています。自動再送・自動復旧は行いません。</p>
                          <button type="button" className="health-secondary-button cloud-sync-button" onClick={dayMemoSyncRecoveryCheck.discardResult}>
                            確認結果を破棄
                          </button>
                        </div>
                      ) : null}
                      {dayMemoSyncRecoveryCheck.safeErrorMessage ? <p className="cloud-pairing-error" role="alert">{dayMemoSyncRecoveryCheck.safeErrorMessage}</p> : null}
                      {dayMemoSyncRecoveryApply.state === 'completed' ? (
                        <div className="cloud-day-memo-success" role="status">
                          <p>この端末の同期情報を復旧しました。</p>
                          <p>対象日付：{dayMemoSyncRecoveryApply.completedDate}</p>
                          <p>再送とlocal DayMemoの変更は行っていません。</p>
                        </div>
                      ) : null}
                      {dayMemoSyncRecoveryApply.safeErrorMessage ? <p className="cloud-pairing-error" role="alert">{dayMemoSyncRecoveryApply.safeErrorMessage}</p> : null}
                    </div>
                  ) : null}
                  {dayMemoSyncMetadataMigration.eligible ? (
                    <div className="cloud-day-memo-baseline-panel">
                      <h4>DayMemo同期metadata</h4>
                      <p>metadata version：{dayMemoSyncMetadataMigration.metadataVersion ?? '旧version'}</p>
                      <p>version 3は互換読み取り、version 4はpendingと削除意図のoperation対応を永続検証する正規形式です。</p>
                      {dayMemoSyncMetadataMigration.state === 'needs_migration' ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" onClick={dayMemoSyncMetadataMigration.migrate}>
                          同期metadataをversion 3へ更新
                        </button>
                      ) : null}
                      {dayMemoSyncMetadataMigration.state === 'migrating' ? <button type="button" className="health-secondary-button cloud-sync-button" disabled>metadataを更新中…</button> : null}
                      {dayMemoSyncMetadataMigration.state === 'completed' ? <p className="cloud-day-memo-success" role="status">metadataを読み取り可能です。</p> : null}
                      {dayMemoSyncMetadataMigration.safeErrorMessage ? <p className="cloud-pairing-error" role="alert">{dayMemoSyncMetadataMigration.safeErrorMessage}</p> : null}
                      <p className="cloud-sync-note">DayMemo本文とSupabaseデータは変更しません。delete送信とtombstone反映は未実装です。</p>
                    </div>
                  ) : null}
                  {dayMemoSyncBaseline.eligible ? (
                    <div className="cloud-day-memo-baseline-panel">
                      <h4>通常同期の準備</h4>
                      <p>同期先の全DayMemoとこの端末を比較し、通常更新に必要なbaselineだけを保存します。DayMemo本文は表示せず、Supabaseへの書き込みも行いません。</p>
                      <p>baseline状態：{BASELINE_STATE_LABELS[dayMemoSyncBaseline.baselineState]}</p>
                      <button
                        type="button"
                        className="health-secondary-button cloud-sync-button"
                        disabled={dayMemoSyncBaseline.baselineState === 'confirming'}
                        onClick={() => { void dayMemoSyncBaseline.confirmBaseline() }}
                      >
                        {dayMemoSyncBaseline.baselineState === 'confirming' ? '同期状態を確認中…' : '同期状態を確認'}
                      </button>
                      {dayMemoSyncBaseline.summary ? (
                        <ul className="cloud-day-memo-preview-summary">
                          <li>同期先：{dayMemoSyncBaseline.summary.remoteCount}件</li>
                          <li>この端末：{dayMemoSyncBaseline.summary.localCount}件</li>
                          <li>内容一致：{dayMemoSyncBaseline.summary.matchingCount}件</li>
                          <li>同期先のみ：{dayMemoSyncBaseline.summary.remoteOnlyCount}件</li>
                          <li>この端末のみ：{dayMemoSyncBaseline.summary.localOnlyCount}件</li>
                          <li>内容相違：{dayMemoSyncBaseline.summary.differentCount}件</li>
                          <li>削除済み：{dayMemoSyncBaseline.summary.tombstoneCount}件</li>
                          <li>baseline確認済み：{dayMemoSyncBaseline.baselineState === 'confirmed' ? dayMemoSyncBaseline.summary.matchingCount : 0}件</li>
                          <li>cursor：{dayMemoSyncBaseline.summary.lastPulledChangeSequence}</li>
                        </ul>
                      ) : null}
                      {dayMemoSyncBaseline.baselineState === 'confirmed' ? (
                        <p className="cloud-day-memo-success" role="status">baselineを確認して保存しました。通常アップロードはまだ未実装です。</p>
                      ) : null}
                      {dayMemoSyncBaseline.metadata?.pushBlock ? (
                        <p className="cloud-sync-note">同期確認は完了しても、アップロード禁止状態は継続しています。</p>
                      ) : null}
                      {dayMemoSyncBaseline.safeErrorMessage ? <p className="cloud-pairing-error" role="alert">{dayMemoSyncBaseline.safeErrorMessage}</p> : null}
                      <p className="cloud-sync-note">自動同期・自動再試行・upsert・deleteは行いません。</p>
                    </div>
                  ) : null}
                  {dayMemoNormalDifferenceRecoveryPlan.eligible ? (
                    <div className="cloud-day-memo-baseline-panel" role="region" aria-labelledby="day-memo-normal-difference-plan-heading">
                      <h4 id="day-memo-normal-difference-plan-heading">通常同期差異の復旧計画</h4>
                      <p>通常同期の差異を読み取り専用で分類し、1件ずつ復旧する順序を確認します。同期readyへの変更や自動修復は行いません。</p>
                      <button type="button" className="health-secondary-button cloud-sync-button" disabled={dayMemoNormalDifferenceRecoveryPlan.checking} onClick={() => { void dayMemoNormalDifferenceRecoveryPlan.check() }}>
                        {dayMemoNormalDifferenceRecoveryPlan.checking ? '復旧計画を確認中…' : '通常同期差異の復旧計画を確認'}
                      </button>
                      {dayMemoNormalDifferenceRecoveryPlan.result ? (
                        <div role="status">
                          <p><strong>safety分類：{dayMemoNormalDifferenceRecoveryPlan.result.safety}</strong></p>
                          <ul className="cloud-day-memo-preview-summary">
                            <li>metadata version：{dayMemoNormalDifferenceRecoveryPlan.result.metadataVersion ?? '確認不能'}</li>
                            <li>workspace binding：{dayMemoNormalDifferenceRecoveryPlan.result.workspaceBound ? '一致' : '不一致または確認不能'}</li>
                            <li>validator：{dayMemoNormalDifferenceRecoveryPlan.result.metadataValid ? '正常' : '確認不能'}</li>
                            <li>pending：{dayMemoNormalDifferenceRecoveryPlan.result.pendingCount}件</li>
                            <li>localDeleteIntent：{dayMemoNormalDifferenceRecoveryPlan.result.intentCount}件</li>
                            <li>pushBlock：{dayMemoNormalDifferenceRecoveryPlan.result.pushBlocked ? 'あり' : 'なし'}</li>
                            <li>remote／local／baseline：{dayMemoNormalDifferenceRecoveryPlan.result.remoteCount}／{dayMemoNormalDifferenceRecoveryPlan.result.localCount}／{dayMemoNormalDifferenceRecoveryPlan.result.baselineCount}件</li>
                            <li>cursor：{dayMemoNormalDifferenceRecoveryPlan.result.cursor ?? '確認不能'}（{dayMemoNormalDifferenceRecoveryPlan.result.cursorValid ? '有効' : '不整合または確認不能'}）</li>
                            <li>完全一致・baseline確認済み：{dayMemoNormalDifferenceRecoveryPlan.result.counts.exact_match_baseline_confirmed}件</li>
                            <li>完全一致・baseline欠落：{dayMemoNormalDifferenceRecoveryPlan.result.counts.exact_match_baseline_missing}件</li>
                            <li>本文一致・更新日時相違：{dayMemoNormalDifferenceRecoveryPlan.result.counts.exact_body_timestamp_mismatch}件</li>
                            <li>本文相違：{dayMemoNormalDifferenceRecoveryPlan.result.counts.body_mismatch}件</li>
                            <li>local-only：{dayMemoNormalDifferenceRecoveryPlan.result.counts.local_only}件</li>
                            <li>remote-only active：{dayMemoNormalDifferenceRecoveryPlan.result.counts.remote_only_active}件</li>
                            <li>remote-only tombstone：{dayMemoNormalDifferenceRecoveryPlan.result.counts.remote_only_tombstone}件</li>
                            <li>revision／状態不整合：{dayMemoNormalDifferenceRecoveryPlan.result.lineageOrStateMismatchCount}件</li>
                            <li>部分baseline補完：{dayMemoNormalDifferenceRecoveryPlan.result.partialBaselineSupported ? '設計上可能' : '対象なしまたは未対応'}</li>
                            <li>1件ずつ復旧：{dayMemoNormalDifferenceRecoveryPlan.result.oneByOneRecoveryPossible ? '可能' : '安全条件未達'}</li>
                            <li>確認日時：{new Date(dayMemoNormalDifferenceRecoveryPlan.result.checkedAt).toLocaleString('ja-JP')}</li>
                          </ul>
                          {dayMemoNormalDifferenceRecoveryPlan.result.items.length > 0 ? (
                            <ul className="cloud-day-memo-preview-items">
                              {dayMemoNormalDifferenceRecoveryPlan.result.items.map((item) => (
                                <li key={`${item.date}-${item.classification}`}>
                                  <strong>{item.date}</strong>
                                  <span>分類：{item.classification}</span>
                                  <span>local：{item.localExists ? 'あり' : 'なし'}</span>
                                  <span>remote：{item.remoteState}</span>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          <p><strong>推奨復旧順序</strong></p>
                          <ol>{dayMemoNormalDifferenceRecoveryPlan.result.recommendedOrder.map((step) => <li key={step}>{step}</li>)}</ol>
                          <p>{dayMemoNormalDifferenceRecoveryPlan.result.nextAction}</p>
                          <p className="cloud-sync-note">確認結果はReact stateだけに保持します。metadata、baseline、cursor、DayMemo、pending、intent、remoteは変更しません。RPC送信も行いません。</p>
                          <button type="button" className="health-secondary-button cloud-sync-button" onClick={dayMemoNormalDifferenceRecoveryPlan.discard}>復旧計画結果を破棄</button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {dayMemoNormalDifferenceRecoveryCheckpointCheck.eligible ? (
                    <div className="cloud-day-memo-baseline-panel" role="region" aria-labelledby="day-memo-normal-difference-checkpoint-heading">
                      <h4 id="day-memo-normal-difference-checkpoint-heading">通常同期差異の復旧checkpoint</h4>
                      <p>未解決差異を残したまま、完全一致baselineと観測済みcursorを同一checkpointとして表現できるか読み取り専用で確認します。</p>
                      <button type="button" className="health-secondary-button cloud-sync-button" disabled={dayMemoNormalDifferenceRecoveryCheckpointCheck.checking || dayMemoNormalDifferenceRecoveryCheckpointSave.saving} onClick={() => { void dayMemoNormalDifferenceRecoveryCheckpointCheck.check() }}>
                        {dayMemoNormalDifferenceRecoveryCheckpointCheck.checking ? 'checkpointを確認中…' : '復旧checkpointの安全条件を確認'}
                      </button>
                      {dayMemoNormalDifferenceRecoveryCheckpointCheck.result ? (
                        <div role="status">
                          <p><strong>safety分類：{dayMemoNormalDifferenceRecoveryCheckpointCheck.result.safety}</strong></p>
                          <ul className="cloud-day-memo-preview-summary">
                            <li>metadata cursor：{dayMemoNormalDifferenceRecoveryCheckpointCheck.result.metadataCursor ?? '確認不能'}</li>
                            <li>full pull最大sequence：{dayMemoNormalDifferenceRecoveryCheckpointCheck.result.fullPullMaxSequence ?? '確認不能'}</li>
                            <li>cursor差分：{dayMemoNormalDifferenceRecoveryCheckpointCheck.result.cursorDifference ?? '確認不能'}</li>
                            <li>remote／local／baseline：{dayMemoNormalDifferenceRecoveryCheckpointCheck.result.remoteCount}／{dayMemoNormalDifferenceRecoveryCheckpointCheck.result.localCount}／{dayMemoNormalDifferenceRecoveryCheckpointCheck.result.baselineCount}件</li>
                            <li>完全一致baseline候補：{dayMemoNormalDifferenceRecoveryCheckpointCheck.result.exactBaselineCandidateCount}件</li>
                            <li>未解決差異：{dayMemoNormalDifferenceRecoveryCheckpointCheck.result.unresolvedCount}件</li>
                            <li>本文一致・更新日時相違：{dayMemoNormalDifferenceRecoveryCheckpointCheck.result.unresolvedCounts.exact_body_timestamp_mismatch}件</li>
                            <li>本文相違：{dayMemoNormalDifferenceRecoveryCheckpointCheck.result.unresolvedCounts.body_mismatch}件</li>
                            <li>local-only：{dayMemoNormalDifferenceRecoveryCheckpointCheck.result.unresolvedCounts.local_only}件</li>
                            <li>remote-only active：{dayMemoNormalDifferenceRecoveryCheckpointCheck.result.unresolvedCounts.remote_only_active}件</li>
                            <li>remote-only tombstone：{dayMemoNormalDifferenceRecoveryCheckpointCheck.result.unresolvedCounts.remote_only_tombstone}件</li>
                            <li>候補baseline：{dayMemoNormalDifferenceRecoveryCheckpointCheck.result.candidateBaselineCount}件</li>
                            <li>候補baselineStatus：{dayMemoNormalDifferenceRecoveryCheckpointCheck.result.candidateBaselineStatus ?? '候補なし'}</li>
                            <li>候補baselineConfirmedAt：{dayMemoNormalDifferenceRecoveryCheckpointCheck.result.candidateBaselineConfirmedAtNull ? 'null' : '候補なし'}</li>
                            <li>候補cursor：{dayMemoNormalDifferenceRecoveryCheckpointCheck.result.candidateCursor ?? '候補なし'}</li>
                            <li>validator：{dayMemoNormalDifferenceRecoveryCheckpointCheck.result.metadataValidatorPassed ? '正常' : '未確認または失敗'}</li>
                            <li>未解決差異の再構築：{dayMemoNormalDifferenceRecoveryCheckpointCheck.result.unresolvedReconstructable ? '可能' : '未確認または不可'}</li>
                            <li>仮適用後baseline確認済み：{dayMemoNormalDifferenceRecoveryCheckpointCheck.result.reclassifiedCounts.exact_match_baseline_confirmed}件</li>
                            {dayMemoNormalDifferenceRecoveryCheckpointCheck.result.safety === 'normal_difference_checkpoint_unresolved_ready' ? <li>新しいcheckpoint保存：不要</li> : null}
                            <li>仮適用後の通常同期ready：いいえ</li>
                            <li>後続Phaseで1件ずつ復旧：{dayMemoNormalDifferenceRecoveryCheckpointCheck.result.oneByOneRecoveryPossible ? '可能' : '安全条件未達'}</li>
                            <li>永続変更：なし</li>
                            <li>RPC送信：なし</li>
                            <li>確認日時：{new Date(dayMemoNormalDifferenceRecoveryCheckpointCheck.result.checkedAt).toLocaleString('ja-JP')}</li>
                          </ul>
                          {dayMemoNormalDifferenceRecoveryCheckpointCheck.result.unresolvedDates.length ? (
                            <ul className="cloud-day-memo-preview-items">
                              {dayMemoNormalDifferenceRecoveryCheckpointCheck.result.unresolvedDates.map((date) => <li key={date}><strong>{date}</strong></li>)}
                            </ul>
                          ) : null}
                          <p>{dayMemoNormalDifferenceRecoveryCheckpointCheck.result.nextAction}</p>
                          <p className="cloud-sync-note">checkpoint readyは通常同期readyではありません。cursor候補は完全一致baselineと一体で、未解決差異はrecovery_requiredのまま維持します。</p>
                          <button type="button" className="health-secondary-button cloud-sync-button" disabled={!dayMemoNormalDifferenceRecoveryCheckpointSave.canSave} onClick={() => { void dayMemoNormalDifferenceRecoveryCheckpointSave.save() }}>
                            {dayMemoNormalDifferenceRecoveryCheckpointSave.saving ? 'checkpointを保存中…' : '復旧checkpointを保存'}
                          </button>
                          <button type="button" className="health-secondary-button cloud-sync-button" disabled={dayMemoNormalDifferenceRecoveryCheckpointSave.saving} onClick={dayMemoNormalDifferenceRecoveryCheckpointCheck.discard}>checkpoint確認結果を破棄</button>
                        </div>
                      ) : null}
                      {dayMemoNormalDifferenceRecoveryCheckpointSave.result ? (
                        <div role="status">
                          <p><strong>保存結果：{dayMemoNormalDifferenceRecoveryCheckpointSave.result.safety}</strong></p>
                          <ul className="cloud-day-memo-preview-summary">
                            <li>保存前cursor：{dayMemoNormalDifferenceRecoveryCheckpointSave.result.beforeCursor ?? '確認不能'}</li>
                            <li>保存後cursor：{dayMemoNormalDifferenceRecoveryCheckpointSave.result.afterCursor ?? '未保存'}</li>
                            <li>追加baseline：{dayMemoNormalDifferenceRecoveryCheckpointSave.result.addedBaselineCount}件</li>
                            <li>保存後baseline：{dayMemoNormalDifferenceRecoveryCheckpointSave.result.afterBaselineCount}件</li>
                            <li>baselineStatus：{dayMemoNormalDifferenceRecoveryCheckpointSave.result.baselineStatus ?? '確認不能'}</li>
                            <li>未解決差異：{dayMemoNormalDifferenceRecoveryCheckpointSave.result.unresolvedCount}件</li>
                            <li>未解決差異の再構築：{dayMemoNormalDifferenceRecoveryCheckpointSave.result.unresolvedReconstructable ? '可能' : '不可または未確認'}</li>
                            <li>通常同期ready：いいえ</li>
                            <li>validator：{dayMemoNormalDifferenceRecoveryCheckpointSave.result.validatorPassed ? '正常' : '未確認または失敗'}</li>
                            <li>read-back：{dayMemoNormalDifferenceRecoveryCheckpointSave.result.readBackSucceeded ? '成功' : '未実施または失敗'}</li>
                            <li>rollback：{dayMemoNormalDifferenceRecoveryCheckpointSave.result.rollbackAttempted ? (dayMemoNormalDifferenceRecoveryCheckpointSave.result.rollbackSucceeded ? '成功' : '失敗') : '未実施'}</li>
                            <li>metadata永続変更：{dayMemoNormalDifferenceRecoveryCheckpointSave.result.metadataSaved ? 'あり' : 'なし'}</li>
                            <li>RPC送信：なし</li>
                            <li>確認日時：{new Date(dayMemoNormalDifferenceRecoveryCheckpointSave.result.checkedAt).toLocaleString('ja-JP')}</li>
                          </ul>
                          <p>{dayMemoNormalDifferenceRecoveryCheckpointSave.result.nextAction}</p>
                          <button type="button" className="health-secondary-button cloud-sync-button" disabled={dayMemoNormalDifferenceRecoveryCheckpointSave.saving} onClick={dayMemoNormalDifferenceRecoveryCheckpointSave.discard}>checkpoint保存結果を破棄</button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <DayMemoBodyMismatchComparison candidate={dayMemoNormalBodyMismatchCandidate}
                    disabled={dayMemoNormalBodyMismatchLocalPreparation.preparing} />
                  {dayMemoNormalBodyMismatchLocalPreparation.eligible || dayMemoNormalBodyMismatchLocalPreparation.result ? (
                    <div className="cloud-day-memo-baseline-panel" role="region" aria-labelledby="day-memo-body-mismatch-local-prepare-heading">
                      <h4 id="day-memo-body-mismatch-local-prepare-heading">本文相違local候補のrecovery準備</h4>
                      <p>local候補を同期先へ上書きするためのpendingだけを準備します。この段階ではSupabaseへ送信せず、DayMemo・baseline・cursorは変更しません。</p>
                      {dayMemoNormalBodyMismatchLocalPreparation.eligible ? (
                        <button type="button" className="health-primary-button cloud-sync-button" disabled={dayMemoNormalBodyMismatchLocalPreparation.preparing}
                          onClick={() => { void dayMemoNormalBodyMismatchLocalPreparation.prepare() }}>
                          {dayMemoNormalBodyMismatchLocalPreparation.preparing ? 'local候補を再確認中…' : 'local候補をrecovery操作として準備'}
                        </button>
                      ) : null}
                      {dayMemoNormalBodyMismatchLocalPreparation.result ? (
                        <div role="status">
                          <p><strong>safety：{dayMemoNormalBodyMismatchLocalPreparation.result.safety}</strong></p>
                          <ul className="cloud-day-memo-preview-summary">
                            <li>対象日：{dayMemoNormalBodyMismatchLocalPreparation.result.date ?? '確認不能'}</li><li>採用候補：local</li>
                            <li>candidate確認：{dayMemoNormalBodyMismatchLocalPreparation.result.candidateFresh ? '確認済み' : '未確認'}</li>
                            <li>remote再確認：{dayMemoNormalBodyMismatchLocalPreparation.result.remoteRechecked ? '確認済み' : '未確認'}</li>
                            <li>operation ID：{dayMemoNormalBodyMismatchLocalPreparation.result.operationIdGenerated ? '生成済み（実値は非表示）' : '未生成'}</li>
                            <li>recovery pending：{dayMemoNormalBodyMismatchLocalPreparation.result.pendingCreated ? '作成済み' : '未作成'}</li>
                            <li>operation mode：{dayMemoNormalBodyMismatchLocalPreparation.result.operationMode ?? 'なし'}</li>
                            <li>DayMemo変更：なし</li><li>baseline・cursor変更：なし</li>
                            <li>baselineStatus：{dayMemoNormalBodyMismatchLocalPreparation.result.baselineStatus ?? '確認不能'}</li>
                            <li>metadata保存：{dayMemoNormalBodyMismatchLocalPreparation.result.metadataSaved ? '成功' : 'なし／失敗'}</li>
                            <li>read-back：{dayMemoNormalBodyMismatchLocalPreparation.result.readBackSucceeded ? '成功' : '未成功'}</li>
                            <li>rollback：{dayMemoNormalBodyMismatchLocalPreparation.result.rollbackAttempted ? (dayMemoNormalBodyMismatchLocalPreparation.result.rollbackSucceeded ? '成功' : '失敗') : '未実行'}</li>
                            <li>RPC送信：なし</li><li>通常同期ready：いいえ</li>
                            <li>確認日時：{new Date(dayMemoNormalBodyMismatchLocalPreparation.result.checkedAt).toLocaleString('ja-JP')}</li>
                          </ul>
                          <p>{dayMemoNormalBodyMismatchLocalPreparation.result.nextAction}</p>
                          <button type="button" className="health-secondary-button cloud-sync-button" disabled={dayMemoNormalBodyMismatchLocalPreparation.preparing}
                            onClick={dayMemoNormalBodyMismatchLocalPreparation.discard}>local準備結果を破棄</button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {dayMemoBodyMismatchRecoveryPreflight.eligible || dayMemoBodyMismatchRecoveryPreflight.result ? (
                    <div className="cloud-day-memo-baseline-panel" role="region" aria-labelledby="day-memo-recovery-preflight-heading">
                      <h4 id="day-memo-recovery-preflight-heading">prepared recoveryの送信前確認</h4>
                      <p>prepared recovery pendingと同期先remoteを読み取り専用で再確認します。この段階では送信も永続状態の変更も行いません。</p>
                      {dayMemoBodyMismatchRecoveryPreflight.eligible ? (
                        <button type="button" className="health-secondary-button cloud-sync-button"
                          disabled={dayMemoBodyMismatchRecoveryPreflight.checking}
                          onClick={() => { void dayMemoBodyMismatchRecoveryPreflight.check() }}>
                          {dayMemoBodyMismatchRecoveryPreflight.checking ? 'remoteを再確認中…' : '送信前にremoteを再確認'}
                        </button>
                      ) : null}
                      {dayMemoBodyMismatchRecoveryPreflight.result ? (
                        <div role="status">
                          <p><strong>safety：{dayMemoBodyMismatchRecoveryPreflight.result.safety}</strong></p>
                          <ul className="cloud-day-memo-preview-summary">
                            <li>対象日：{dayMemoBodyMismatchRecoveryPreflight.result.date ?? '確認不能'}</li>
                            <li>operation mode：{dayMemoBodyMismatchRecoveryPreflight.result.operationMode ?? '確認不能'}</li>
                            <li>pending確認：{dayMemoBodyMismatchRecoveryPreflight.result.pendingVerified ? '確認済み' : '未確認'}</li>
                            <li>local鮮度：{dayMemoBodyMismatchRecoveryPreflight.result.localFresh ? '確認済み' : '未確認'}</li>
                            <li>remote active：{dayMemoBodyMismatchRecoveryPreflight.result.remoteActive ? '確認済み' : '未確認'}</li>
                            <li>revision：{dayMemoBodyMismatchRecoveryPreflight.result.revisionVerified ? '一致' : '未確認／不一致'}</li>
                            <li>change sequence：{dayMemoBodyMismatchRecoveryPreflight.result.changeSequenceVerified ? '一致' : '未確認／不一致'}</li>
                            <li>remote updatedAt：{dayMemoBodyMismatchRecoveryPreflight.result.remoteUpdatedAtVerified ? '一致' : '未確認／不一致'}</li>
                            <li>payload：{dayMemoBodyMismatchRecoveryPreflight.result.payloadVerified ? '確認済み' : '未確認／不一致'}</li>
                            <li>checkpoint：{dayMemoBodyMismatchRecoveryPreflight.result.checkpointVerified ? '確認済み' : '未確認'}</li>
                            <li>workspace：{dayMemoBodyMismatchRecoveryPreflight.result.workspaceVerified ? '一致' : '未確認／不一致'}</li>
                            <li>verification snapshot：{dayMemoBodyMismatchRecoveryPreflight.result.snapshotCreated ? '作成済み' : 'なし'}</li>
                            <li>永続変更：なし</li><li>RPC送信：なし</li>
                            <li>確認日時：{new Date(dayMemoBodyMismatchRecoveryPreflight.result.checkedAt).toLocaleString('ja-JP')}</li>
                          </ul>
                          <p>{dayMemoBodyMismatchRecoveryPreflight.result.nextAction}</p>
                          <button type="button" className="health-secondary-button cloud-sync-button"
                            disabled={dayMemoBodyMismatchRecoveryPreflight.checking}
                            onClick={dayMemoBodyMismatchRecoveryPreflight.discard}>送信前確認結果を破棄</button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {dayMemoBodyMismatchRecoverySend.eligible || dayMemoBodyMismatchRecoverySend.result ? (
                    <div className="cloud-day-memo-baseline-panel" role="region" aria-labelledby="day-memo-recovery-send-heading">
                      <h4 id="day-memo-recovery-send-heading">prepared recoveryを明示送信</h4>
                      <p>B-3f5e4b2で確認済みの1件だけを送信します。自動送信・自動再試行はなく、送信後もbaselineや未解決差異は確定せず、次Phaseでremoteを再確認します。</p>
                      {dayMemoBodyMismatchRecoverySend.canSend ? (
                        <button type="button" className="health-primary-button cloud-sync-button" disabled={dayMemoBodyMismatchRecoverySend.sending}
                          onClick={() => { void dayMemoBodyMismatchRecoverySend.send() }}>
                          {dayMemoBodyMismatchRecoverySend.sending ? 'recovery upsertを送信中…' : '確認済みlocalを同期先へ送信'}
                        </button>
                      ) : null}
                      {dayMemoBodyMismatchRecoverySend.result ? (
                        <div role="status">
                          <p><strong>safety：{dayMemoBodyMismatchRecoverySend.result.safety}</strong></p>
                          <ul className="cloud-day-memo-preview-summary">
                            <li>対象日：{dayMemoBodyMismatchRecoverySend.result.date ?? '確認不能'}</li>
                            <li>operation mode：{dayMemoBodyMismatchRecoverySend.result.operationMode ?? '確認不能'}</li>
                            <li>verification snapshot：{dayMemoBodyMismatchRecoverySend.result.snapshotVerified ? '確認済み' : '未確認'}</li>
                            <li>pending：{dayMemoBodyMismatchRecoverySend.result.pendingVerified ? '確認済み' : '未確認'}</li>
                            <li>local鮮度：{dayMemoBodyMismatchRecoverySend.result.localFresh ? '確認済み' : '未確認'}</li>
                            <li>checkpoint：{dayMemoBodyMismatchRecoverySend.result.checkpointVerified ? '確認済み' : '未確認'}</li>
                            <li>RPC実行：{dayMemoBodyMismatchRecoverySend.result.rpcCalled ? (dayMemoBodyMismatchRecoverySend.result.rpcValidated ? '結果検証済み' : '実行済み・確認必要') : 'なし'}</li>
                            <li>operation ID：既存値を使用（実値は非表示）</li>
                            <li>remote更新：{dayMemoBodyMismatchRecoverySend.result.remoteUpdated ? '成功' : '未確認／なし'}</li>
                            <li>metadata保存：{dayMemoBodyMismatchRecoverySend.result.metadataSaved ? '成功' : '未成功／なし'}</li>
                            <li>read-back：{dayMemoBodyMismatchRecoverySend.result.readBackSucceeded ? '成功' : '未成功／なし'}</li>
                            <li>rollback：{dayMemoBodyMismatchRecoverySend.result.rollbackAttempted ? (dayMemoBodyMismatchRecoverySend.result.rollbackSucceeded ? '成功' : '失敗／確認必要') : '未実行'}</li>
                            <li>pending status：{dayMemoBodyMismatchRecoverySend.result.pendingStatus ?? '未変更／確認不能'}</li>
                            <li>DayMemo変更：なし</li><li>baseline・cursor変更：なし</li>
                            <li>baselineStatus：{dayMemoBodyMismatchRecoverySend.result.baselineStatus ?? '確認不能'}</li>
                            <li>verification snapshot：{dayMemoBodyMismatchRecoverySend.result.snapshotConsumed ? '破棄済み' : '未消費／なし'}</li>
                            <li>自動retry：なし</li>
                            <li>確認日時：{new Date(dayMemoBodyMismatchRecoverySend.result.checkedAt).toLocaleString('ja-JP')}</li>
                          </ul>
                          <p>{dayMemoBodyMismatchRecoverySend.result.nextAction}</p>
                          <button type="button" className="health-secondary-button cloud-sync-button" disabled={dayMemoBodyMismatchRecoverySend.sending}
                            onClick={dayMemoBodyMismatchRecoverySend.discard}>送信結果表示を破棄</button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {dayMemoSavedOperationResultRead.eligible || dayMemoSavedOperationResultRead.result ? (
                    <div className="cloud-day-memo-baseline-panel" role="region"
                      aria-labelledby="day-memo-saved-operation-result-heading">
                      <h4 id="day-memo-saved-operation-result-heading">保存済みoperation結果をread-only取得</h4>
                      <p>保存済みoperation履歴だけを読み取ります。remote更新やoperation作成、metadata・pending・baseline・cursorの変更、自動再試行は行いません。成功後は次Phaseでfull pull結果と照合します。</p>
                      {dayMemoSavedOperationResultRead.eligible ? (
                        <button type="button" className="health-secondary-button cloud-sync-button"
                          disabled={dayMemoSavedOperationResultRead.reading}
                          onClick={() => { void dayMemoSavedOperationResultRead.read() }}>
                          {dayMemoSavedOperationResultRead.reading ? '保存済み結果を取得中…' : '保存済み送信結果を取得'}
                        </button>
                      ) : null}
                      {dayMemoSavedOperationResultRead.result ? (
                        <div role="status">
                          <p><strong>safety：{dayMemoSavedOperationResultRead.result.safety}</strong></p>
                          <ul className="cloud-day-memo-preview-summary">
                            <li>対象日：{dayMemoSavedOperationResultRead.result.date ?? '確認不能'}</li>
                            <li>operation mode：{dayMemoSavedOperationResultRead.result.operationMode ?? '確認不能'}</li>
                            <li>pending status：{dayMemoSavedOperationResultRead.result.pendingStatus ?? '確認不能'}</li>
                            <li>operation照合：{dayMemoSavedOperationResultRead.result.operationVerified ? '確認済み' : '不可'}</li>
                            <li>local鮮度：{dayMemoSavedOperationResultRead.result.localFresh ? '確認済み' : '不可'}</li>
                            <li>operation履歴：{dayMemoSavedOperationResultRead.result.historyRecovered ? '取得済み' : '未取得／見つからない'}</li>
                            <li>result status：{dayMemoSavedOperationResultRead.result.resultStatus ?? '未確認'}</li>
                            <li>base revision：{dayMemoSavedOperationResultRead.result.baseRevisionVerified ? '一致' : '未確認／不一致'}</li>
                            <li>post-send revision：{dayMemoSavedOperationResultRead.result.postSendRevisionVerified ? '確認済み' : '未確認／不正'}</li>
                            <li>post-send change sequence：{dayMemoSavedOperationResultRead.result.postSendChangeSequenceVerified ? '確認済み' : '未確認／不正'}</li>
                            <li>post-send server updatedAt：{dayMemoSavedOperationResultRead.result.postSendUpdatedAtVerified ? '確認済み' : '未確認／不正'}</li>
                            <li>result state：{dayMemoSavedOperationResultRead.result.activeStateVerified ? 'active' : '未確認／不正'}</li>
                            <li>deletedAt：{dayMemoSavedOperationResultRead.result.deletedAtAbsent ? 'なし' : '未確認／あり'}</li>
                            <li>result payload：{dayMemoSavedOperationResultRead.result.payloadVerified ? '一致' : '未確認／不一致'}</li>
                            <li>verification snapshot：{dayMemoSavedOperationResultRead.result.snapshotCreated ? '作成済み' : 'なし'}</li>
                            <li>remote更新：なし</li><li>operation作成・更新：なし</li>
                            <li>metadata・pending変更：なし</li><li>baseline・cursor変更：なし</li>
                            <li>RPC：{dayMemoSavedOperationResultRead.result.rpcCalled ? 'read-only取得1回' : 'なし'}</li>
                            <li>自動retry：なし</li>
                            <li>確認日時：{new Date(dayMemoSavedOperationResultRead.result.checkedAt).toLocaleString('ja-JP')}</li>
                          </ul>
                          <p>{dayMemoSavedOperationResultRead.result.nextAction}</p>
                          <button type="button" className="health-secondary-button cloud-sync-button"
                            disabled={dayMemoSavedOperationResultRead.reading}
                            onClick={dayMemoSavedOperationResultRead.discard}>取得結果を破棄</button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {dayMemoBaselineRebase.eligible ? (
                    <div className="cloud-day-memo-rebase-panel">
                      <h4>baseline差異の安全確認</h4>
                      <p>本文がすべて一致し、更新日時だけが異なる場合に限り、この端末の同期metadataだけを再確立します。自動では実行しません。</p>
                      {dayMemoBaselineRebase.state === 'idle' ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" onClick={() => { void dayMemoBaselineRebase.checkBaselineDifference() }}>
                          baseline差異を確認
                        </button>
                      ) : null}
                      {dayMemoBaselineRebase.state === 'checking' ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" disabled>同期先を確認中…</button>
                      ) : null}
                      {dayMemoBaselineRebase.summary ? (
                        <>
                          <ul className="cloud-day-memo-preview-summary">
                            <li>同期先：{dayMemoBaselineRebase.summary.remoteCount}件</li>
                            <li>この端末：{dayMemoBaselineRebase.summary.localCount}件</li>
                            <li>本文・更新日時一致：{dayMemoBaselineRebase.summary.contentAndUpdatedAtMatchCount}件</li>
                            <li>本文一致・更新日時相違：{dayMemoBaselineRebase.summary.contentMatchUpdatedAtDiffCount}件</li>
                            <li>本文相違：{dayMemoBaselineRebase.summary.contentDiffCount}件</li>
                            <li>同期先のみ：{dayMemoBaselineRebase.summary.remoteOnlyCount}件</li>
                            <li>この端末のみ：{dayMemoBaselineRebase.summary.localOnlyCount}件</li>
                            <li>削除済み：{dayMemoBaselineRebase.summary.tombstoneCount}件</li>
                          </ul>
                          {dayMemoBaselineRebase.items.length > 0 ? (
                            <ul className="cloud-day-memo-preview-items">
                              {dayMemoBaselineRebase.items.map((item) => (
                                <li key={`${item.date}-${item.classification}`}>
                                  <strong>{item.date}</strong>
                                  <span>{item.classification === 'content_and_updated_at_match' ? '本文・更新日時一致'
                                    : item.classification === 'content_match_updated_at_diff' ? '本文一致・更新日時相違'
                                      : item.classification === 'content_diff' ? '本文相違'
                                        : item.classification === 'remote_only' ? '同期先のみ'
                                          : item.classification === 'local_only' ? 'この端末のみ'
                                            : item.classification === 'tombstone' ? '削除済み'
                                              : '確認不能'}</span>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </>
                      ) : null}
                      {dayMemoBaselineRebase.state === 'rebase_ready' ? (
                        <div className="cloud-day-memo-apply-confirmation">
                          <strong>本文はすべて一致しています</strong>
                          <p>更新日時の差だけを吸収し、baseline metadataを再確立できます。SupabaseとローカルDayMemo本文は変更しません。</p>
                          <button type="button" className="health-primary-button cloud-sync-button" onClick={dayMemoBaselineRebase.confirmRebase}>
                            baselineを再確立
                          </button>
                        </div>
                      ) : null}
                      {dayMemoBaselineRebase.state === 'saving' ? <p>baseline metadataを安全に保存しています…</p> : null}
                      {dayMemoBaselineRebase.state === 'preview_ready' ? <p className="cloud-sync-note">本文と更新日時はすでに一致しています。metadata-only rebaseは不要です。</p> : null}
                      {dayMemoBaselineRebase.state === 'completed' ? (
                        <p className="cloud-day-memo-success" role="status">baseline metadataを再確立しました。SupabaseとローカルDayMemoは変更していません。</p>
                      ) : null}
                      {dayMemoBaselineRebase.safeErrorMessage ? <p className="cloud-pairing-error" role="alert">{dayMemoBaselineRebase.safeErrorMessage}</p> : null}
                      {dayMemoBaselineRebase.hasFreshPreview || dayMemoBaselineRebase.summary ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" onClick={dayMemoBaselineRebase.clearPreview} disabled={dayMemoBaselineRebase.state === 'saving'}>
                          確認結果を破棄
                        </button>
                      ) : null}
                      <p className="cloud-sync-note">full pullは明示操作時だけ行います。upsert・delete・自動再試行・pushBlock解除は行いません。</p>
                    </div>
                  ) : null}
                  {dayMemoUpdatePreview.eligible ? (
                    <div className="cloud-day-memo-update-panel">
                      <h4>通常更新の候補</h4>
                      <p>確認済みbaselineとこの端末のDayMemoを比較します。明示操作だけで判定し、Supabaseへはまだ送信しません。</p>
                      <p>baseline：{dayMemoSyncBaseline.baselineState === 'confirmed' ? '確認済み' : '未確認'}</p>
                      {dayMemoUpdatePreview.previewState === 'idle' ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" onClick={dayMemoUpdatePreview.checkForUpdates}>
                          更新候補を確認
                        </button>
                      ) : null}
                      {dayMemoUpdatePreview.previewState === 'checking' ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" disabled>確認中…</button>
                      ) : null}
                      {dayMemoUpdatePreview.summary ? (
                        <>
                          <ul className="cloud-day-memo-preview-summary">
                            <li>更新候補：{dayMemoUpdatePreview.summary.modifiedCandidateCount}件</li>
                            <li>変更なし：{dayMemoUpdatePreview.summary.unchangedCount}件</li>
                            <li>この端末のみ：{dayMemoUpdatePreview.summary.localOnlyCount}件</li>
                            <li>端末に存在しない：{dayMemoUpdatePreview.summary.missingLocalCount}件</li>
                            <li>削除済みbaseline：{dayMemoUpdatePreview.summary.tombstoneCount}件</li>
                            <li>metadata不整合：{dayMemoUpdatePreview.summary.metadataInvalidCount}件</li>
                          </ul>
                          {dayMemoUpdatePreview.items.some((item) => item.classification !== 'unchanged') ? (
                            <ul className="cloud-day-memo-preview-items">
                              {dayMemoUpdatePreview.items.filter((item) => item.classification !== 'unchanged').map((item) => (
                                <li key={`${item.date}-${item.classification}`}>
                                  <strong>{item.date}</strong>
                                  <span>{updateClassificationLabels[item.classification]}</span>
                                  {item.baseRevision !== null ? <small>base revision {item.baseRevision}・change {item.baselineChangeSequence}</small> : null}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </>
                      ) : null}
                      {dayMemoUpdatePreview.previewState === 'preview_ready' ? (
                        <>
                          <p className="cloud-day-memo-success" role="status">既存DayMemoの更新候補を確認しました。</p>
                          {dayMemoUpdatePreview.summary?.modifiedCandidateCount === 1 && dayMemoUpdateUpload.state === 'idle' && dayMemoSyncSafety.canStartUpload ? (
                            <button
                              type="button"
                              className="health-secondary-button cloud-sync-button"
                              onClick={() => { void dayMemoUpdateUpload.runPreflight() }}
                            >
                              同期先の更新状態を確認
                            </button>
                          ) : dayMemoUpdatePreview.summary?.modifiedCandidateCount !== 1 ? <p className="cloud-sync-note">更新候補が1件ではないため、今回の送信対象にはできません。</p> : null}
                        </>
                      ) : null}
                      {dayMemoUpdateUpload.state === 'preflighting' ? <button type="button" className="health-secondary-button cloud-sync-button" disabled>同期先を確認中…</button> : null}
                      {dayMemoUpdateUpload.state === 'preflight_ready' ? (
                        <div className="cloud-day-memo-update-upload-step">
                          <p className="cloud-day-memo-success" role="status">同期先のrevision・change sequence・更新日時がbaselineと一致しました。</p>
                          <button type="button" className="health-secondary-button cloud-sync-button" onClick={dayMemoUpdateUpload.prepareUpload}>
                            この1件の送信を準備
                          </button>
                        </div>
                      ) : null}
                      {dayMemoUpdateUpload.state === 'preparing' ? <p>operation IDとpending operationを安全に保存しています…</p> : null}
                      {dayMemoUpdateUpload.state === 'prepared' ? (
                        <div className="cloud-day-memo-apply-confirmation">
                          <strong>1件の送信準備が完了しました</strong>
                          <p>この操作で既存remote DayMemo 1件だけを更新します。自動再試行は行いません。</p>
                          <button type="button" className="health-primary-button cloud-sync-button" onClick={() => { void dayMemoUpdateUpload.uploadPrepared() }}>
                            この1件を同期先へ送信
                          </button>
                        </div>
                      ) : null}
                      {dayMemoUpdateUpload.state === 'uploading' ? <p>1件を同期先へ送信しています。画面を閉じずにお待ちください…</p> : null}
                      {dayMemoUpdateUpload.state === 'completed' && dayMemoUpdateUpload.result ? (
                        <div className="cloud-day-memo-update-upload-result" role="status">
                          <p className="cloud-day-memo-success">1件を同期先へ送信しました。</p>
                          <ul className="cloud-day-memo-preview-summary">
                            <li>対象日付：{dayMemoUpdateUpload.result.date}</li>
                            <li>新しいrevision：{dayMemoUpdateUpload.result.revision}</li>
                            <li>change sequence：{dayMemoUpdateUpload.result.changeSequence}</li>
                          </ul>
                          <p>この端末のDayMemoは変更していません。PC側へはまだ自動反映されません。</p>
                          <p className="cloud-sync-note">自動同期ではありません。PC側では送信前に同期先を再確認してください。</p>
                        </div>
                      ) : null}
                      {dayMemoUpdateUpload.safeErrorMessage ? <p className="cloud-pairing-error" role="alert">{dayMemoUpdateUpload.safeErrorMessage}</p> : null}
                      {dayMemoUpdatePreview.previewState === 'no_changes' ? (
                        <p className="cloud-sync-note" role="status">更新候補はありません。</p>
                      ) : null}
                      {dayMemoUpdatePreview.safeErrorMessage ? <p className="cloud-pairing-error" role="alert">{dayMemoUpdatePreview.safeErrorMessage}</p> : null}
                      {(dayMemoUpdatePreview.hasFreshSnapshot || dayMemoUpdatePreview.summary) && !dayMemoUpdateUpload.hasPendingOperation ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" onClick={() => { dayMemoUpdateUpload.reset(); dayMemoUpdatePreview.discardPreview() }}>
                          確認結果を破棄
                        </button>
                      ) : null}
                      <p className="cloud-sync-note">本文は表示・metadata保存しません。upsertは明示操作で1件だけ行い、delete・自動再試行は行いません。</p>
                    </div>
                  ) : null}
                  {dayMemoDeletePreview.eligible ? (
                    <div className="cloud-day-memo-update-panel">
                      <h4>DayMemo削除候補</h4>
                      <p>明示的に記録した削除意図だけを、同期先の全件pullで読み取り専用確認します。今回は削除送信しません。</p>
                      {dayMemoDeletePreview.state === 'idle' && dayMemoDeleteUpload.state === 'idle' ? <button type="button" className="health-secondary-button cloud-sync-button" onClick={() => { void dayMemoDeletePreview.previewDeletes() }}>削除状態を確認</button> : null}
                      {dayMemoDeletePreview.state === 'checking' ? <button type="button" className="health-secondary-button cloud-sync-button" disabled>削除状態を確認中…</button> : null}
                      {dayMemoDeletePreview.summary ? (
                        <ul className="cloud-day-memo-preview-summary">
                          <li>削除意図：{dayMemoDeletePreview.summary.intentCount}件</li>
                          <li>削除送信候補：{dayMemoDeletePreview.summary.localDeletedCandidateCount}件</li>
                          <li>意図未確認のlocal欠落：{dayMemoDeletePreview.summary.localMissingUnconfirmedCount}件</li>
                          <li>同期先で削除済み：{dayMemoDeletePreview.summary.remoteDeletedCandidateCount}件</li>
                          <li>同期先削除済み・localなし：{dayMemoDeletePreview.summary.remoteDeletedLocalMissingCount}件</li>
                          <li>競合：{dayMemoDeletePreview.summary.deleteConflictCount}件</li>
                          <li>確認不能：{dayMemoDeletePreview.summary.deleteUnknownCount}件</li>
                        </ul>
                      ) : null}
                      {dayMemoDeletePreview.items.length > 0 ? <ul className="cloud-day-memo-preview-items">{dayMemoDeletePreview.items.map((item) => <li key={`${item.date}-${item.classification}`}><strong>{item.date}</strong><span>{item.classification}</span><small>baseline revision {item.baselineRevision ?? '－'}／remote revision {item.remoteRevision ?? '－'}・baseline change {item.baselineChangeSequence ?? '－'}／remote change {item.remoteChangeSequence ?? '－'}</small></li>)}</ul> : null}
                      {dayMemoDeletePreview.summary?.intentCount === 1
                        && dayMemoDeletePreview.summary.localDeletedCandidateCount === 1
                        && dayMemoDeletePreview.summary.localMissingUnconfirmedCount === 0
                        && dayMemoDeletePreview.summary.remoteDeletedCandidateCount === 0
                        && dayMemoDeletePreview.summary.remoteDeletedLocalMissingCount === 0
                        && dayMemoDeletePreview.summary.deleteConflictCount === 0
                        && dayMemoDeletePreview.summary.deleteUnknownCount === 0
                        && dayMemoDeleteUpload.state === 'idle' ? (
                          <button type="button" className="health-secondary-button cloud-sync-button" onClick={dayMemoDeleteUpload.prepareDelete}>
                            この削除候補を同期
                          </button>
                        ) : null}
                      {dayMemoDeleteUpload.state === 'preparing' ? <p>operation IDとpending deleteを安全に保存しています…</p> : null}
                      {dayMemoDeleteUpload.state === 'prepared' ? (
                        <div className="cloud-day-memo-upload-confirm">
                          <p>削除候補1件を送信する準備ができました。同期先にはまだ送信していません。</p>
                          <button type="button" className="health-primary-button cloud-sync-button" onClick={() => { void dayMemoDeleteUpload.uploadPreparedDelete() }}>
                            削除を同期
                          </button>
                        </div>
                      ) : null}
                      {dayMemoDeleteUpload.state === 'uploading' ? <p>削除候補1件を同期先へ送信しています。画面を閉じずにお待ちください…</p> : null}
                      {dayMemoDeleteUpload.state === 'completed' && dayMemoDeleteUpload.result ? (
                        <div className="cloud-day-memo-upload-result" role="status">
                          <strong>削除同期完了</strong>
                          <ul>
                            <li>対象日付：{dayMemoDeleteUpload.result.date}</li>
                            <li>revision：{dayMemoDeleteUpload.result.revision}</li>
                            <li>change sequence：{dayMemoDeleteUpload.result.changeSequence}</li>
                            <li>tombstone：作成済み</li>
                            <li>local DayMemo：削除済み</li>
                          </ul>
                        </div>
                      ) : null}
                      {dayMemoDeletePreview.state === 'no_intents' ? <p className="cloud-sync-note">明示的な削除意図はありません。</p> : null}
                      {dayMemoDeletePreview.safeErrorMessage ? <p className="cloud-pairing-error" role="alert">{dayMemoDeletePreview.safeErrorMessage}</p> : null}
                      {dayMemoDeleteUpload.safeErrorMessage ? <p className="cloud-pairing-error" role="alert">{dayMemoDeleteUpload.safeErrorMessage}</p> : null}
                      {(dayMemoDeletePreview.summary || dayMemoDeletePreview.items.length > 0) && !dayMemoDeleteUpload.hasPendingOperation ? <button type="button" className="health-secondary-button cloud-sync-button" onClick={() => { dayMemoDeleteUpload.reset(); dayMemoDeletePreview.discardPreview() }}>確認結果を破棄</button> : null}
                      {dayMemoDeleteIntent.safeErrorMessage ? <p className="cloud-pairing-error" role="alert">{dayMemoDeleteIntent.safeErrorMessage}</p> : null}
                      <p className="cloud-sync-note">削除意図の取消しには本文の復元が必要なため未実装です。delete RPC・tombstone作成・自動再試行は行いません。</p>
                    </div>
                  ) : null}
                  {dayMemoTombstonePreview.eligible ? (
                    <div className="cloud-day-memo-update-panel">
                      <h4>同期先の削除済みDayMemo</h4>
                      <p>同期先のtombstoneを読み取り専用で確認し、この端末の状態と分類します。自動削除や同期先への書き込みは行いません。</p>
                      {dayMemoTombstonePreview.state === 'idle' ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" onClick={() => { void dayMemoTombstonePreview.previewTombstones() }}>
                          削除状態を確認
                        </button>
                      ) : null}
                      {dayMemoTombstonePreview.state === 'checking' ? <button type="button" className="health-secondary-button cloud-sync-button" disabled>削除状態を確認中…</button> : null}
                      {dayMemoTombstonePreview.summary ? (
                        <ul className="cloud-day-memo-preview-summary">
                          <li>tombstone：{dayMemoTombstonePreview.summary.tombstoneCount}件</li>
                          <li>端末へ反映可能候補：{dayMemoTombstonePreview.summary.remoteDeletedLocalActiveCount}件</li>
                          <li>端末で変更あり：{dayMemoTombstonePreview.summary.remoteDeletedLocalModifiedCount}件</li>
                          <li>端末でも削除済み：{dayMemoTombstonePreview.summary.remoteDeletedLocalMissingCount}件</li>
                          <li>確認不能：{dayMemoTombstonePreview.summary.remoteDeletedUnknownCount}件</li>
                        </ul>
                      ) : null}
                      {dayMemoTombstonePreview.items.length > 0 ? (
                        <ul className="cloud-day-memo-preview-items">
                          {dayMemoTombstonePreview.items.map((item) => (
                            <li key={`${item.date}-${item.remoteChangeSequence}`}>
                              <strong>{item.date}</strong>
                              <span>{item.classification}</span>
                              <small>remote revision {item.remoteRevision}／change sequence {item.remoteChangeSequence}／削除日時 {item.deletedAt}</small>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {dayMemoTombstonePreview.summary?.tombstoneCount === 1
                        && dayMemoTombstonePreview.summary.remoteDeletedLocalActiveCount === 1
                        && dayMemoTombstonePreview.summary.remoteDeletedLocalModifiedCount === 0
                        && dayMemoTombstonePreview.summary.remoteDeletedLocalMissingCount === 0
                        && dayMemoTombstonePreview.summary.remoteDeletedUnknownCount === 0
                        && dayMemoTombstoneApply.state === 'idle' ? (
                          <button type="button" className="health-primary-button cloud-sync-button" onClick={dayMemoTombstoneApply.applyTombstone}>
                            削除済み状態をこの端末へ反映
                          </button>
                        ) : null}
                      {dayMemoTombstoneApply.state === 'applying' ? <button type="button" className="health-primary-button cloud-sync-button" disabled>この端末へ反映中…</button> : null}
                      {dayMemoTombstoneApply.state === 'completed' && dayMemoTombstoneApply.result ? (
                        <div className="cloud-day-memo-upload-result" role="status">
                          <strong>local反映完了</strong>
                          <ul>
                            <li>対象日付：{dayMemoTombstoneApply.result.date}</li>
                            <li>remote revision：{dayMemoTombstoneApply.result.remoteRevision}</li>
                            <li>change sequence：{dayMemoTombstoneApply.result.remoteChangeSequence}</li>
                            <li>tombstone baseline：保存済み</li>
                          </ul>
                          <p>Supabaseへの書き込みは行っていません。</p>
                        </div>
                      ) : null}
                      {dayMemoTombstoneApply.safeErrorMessage ? <p className="cloud-pairing-error" role="alert">{dayMemoTombstoneApply.safeErrorMessage}</p> : null}
                      {dayMemoTombstonePreview.state === 'no_tombstones' ? <p className="cloud-sync-note" role="status">同期先に削除済みDayMemoはありません。</p> : null}
                      {dayMemoTombstonePreview.state === 'blocked' ? <p className="cloud-pairing-error" role="alert">同期状態を安全に確認できないため、削除状態を確認できません。</p> : null}
                      {dayMemoTombstonePreview.safeErrorMessage ? <p className="cloud-pairing-error" role="alert">{dayMemoTombstonePreview.safeErrorMessage}</p> : null}
                      {(dayMemoTombstonePreview.summary || dayMemoTombstonePreview.items.length > 0 || dayMemoTombstonePreview.state === 'no_tombstones') ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" onClick={() => { dayMemoTombstoneApply.reset(); dayMemoTombstonePreview.discardPreview() }}>確認結果を破棄</button>
                      ) : null}
                      <p className="cloud-sync-note">確認結果はこの画面のメモリ内だけに保持し、再読み込み後は復元しません。local DayMemo、baseline、cursor、削除意図、pending operationは変更しません。</p>
                    </div>
                  ) : null}
                  {dayMemoResurrectionPreview.eligible ? (
                    <div className="cloud-day-memo-update-panel">
                      <h4>削除済みDayMemoの復活候補</h4>
                      <p>tombstone baselineと同じ日付にあるDayMemoについて、同期先の削除済み状態を読み取り専用で確認します。今回は復活や送信を行いません。</p>
                      {dayMemoResurrectionPreview.state === 'idle' ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" onClick={() => { void dayMemoResurrectionPreview.previewResurrectionCandidates() }}>
                          復活候補を確認
                        </button>
                      ) : null}
                      {dayMemoResurrectionPreview.state === 'checking' ? <button type="button" className="health-secondary-button cloud-sync-button" disabled>復活候補を確認中…</button> : null}
                      {dayMemoResurrectionPreview.summary ? (
                        <ul className="cloud-day-memo-preview-summary">
                          <li>確認対象：{dayMemoResurrectionPreview.summary.candidateCount}件</li>
                          <li>復活候補：{dayMemoResurrectionPreview.summary.resurrectionCandidateCount}件</li>
                          <li>競合：{dayMemoResurrectionPreview.summary.resurrectionConflictCount}件</li>
                          <li>確認不能：{dayMemoResurrectionPreview.summary.resurrectionUnknownCount}件</li>
                        </ul>
                      ) : null}
                      {dayMemoResurrectionPreview.items.length > 0 ? (
                        <ul className="cloud-day-memo-preview-items">
                          {dayMemoResurrectionPreview.items.map((item) => (
                            <li key={`${item.date}-${item.tombstoneChangeSequence}`}>
                              <strong>{item.date}</strong>
                              <span>{item.classification}</span>
                              <small>tombstone revision {item.tombstoneRevision}・change sequence {item.tombstoneChangeSequence}・削除日時 {item.deletedAt}</small>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {dayMemoResurrectionPreview.summary?.candidateCount === 1
                        && dayMemoResurrectionPreview.summary.resurrectionCandidateCount === 1
                        && dayMemoResurrectionPreview.summary.resurrectionConflictCount === 0
                        && dayMemoResurrectionPreview.summary.resurrectionUnknownCount === 0
                        && dayMemoResurrectionUpload.state === 'idle' ? (
                          <button type="button" className="health-secondary-button cloud-sync-button" onClick={() => { void dayMemoResurrectionUpload.runPreflight() }}>
                            同期先の削除済み状態を確認
                          </button>
                        ) : null}
                      {dayMemoResurrectionUpload.state === 'preflighting' ? <button type="button" className="health-secondary-button cloud-sync-button" disabled>同期先を再確認中…</button> : null}
                      {dayMemoResurrectionUpload.state === 'preflight_ready' ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" onClick={dayMemoResurrectionUpload.prepareUpload}>
                          このDayMemoの復活を準備
                        </button>
                      ) : null}
                      {dayMemoResurrectionUpload.state === 'preparing' ? <button type="button" className="health-secondary-button cloud-sync-button" disabled>復活を準備中…</button> : null}
                      {dayMemoResurrectionUpload.state === 'prepared' ? (
                        <div className="cloud-day-memo-upload-confirm">
                          <p>復活する1件の準備が完了しました。次の操作で初めて同期先へ送信します。</p>
                          <button type="button" className="health-primary-button cloud-sync-button" onClick={() => { void dayMemoResurrectionUpload.uploadPrepared() }}>
                            削除済みDayMemoを復活
                          </button>
                        </div>
                      ) : null}
                      {dayMemoResurrectionUpload.state === 'uploading' ? <button type="button" className="health-primary-button cloud-sync-button" disabled>復活処理中…</button> : null}
                      {dayMemoResurrectionUpload.state === 'completed' && dayMemoResurrectionUpload.result ? (
                        <div className="cloud-day-memo-upload-result" role="status">
                          <strong>復活が完了しました</strong>
                          <ul>
                            <li>対象日付：{dayMemoResurrectionUpload.result.date}</li>
                            <li>新しいrevision：{dayMemoResurrectionUpload.result.revision}</li>
                            <li>change sequence：{dayMemoResurrectionUpload.result.changeSequence}</li>
                            <li>active baseline：保存済み</li>
                          </ul>
                          <p>この端末のDayMemo本文は変更していません。</p>
                        </div>
                      ) : null}
                      {dayMemoResurrectionUpload.safeErrorMessage ? <p className="cloud-pairing-error" role="alert">{dayMemoResurrectionUpload.safeErrorMessage}</p> : null}
                      {dayMemoResurrectionPreview.state === 'no_candidates' ? <p className="cloud-sync-note" role="status">復活候補として確認するDayMemoはありません。</p> : null}
                      {dayMemoResurrectionPreview.state === 'blocked' ? <p className="cloud-pairing-error" role="alert">同期状態を安全に確認できないため、復活候補を確認できません。</p> : null}
                      {dayMemoResurrectionPreview.safeErrorMessage ? <p className="cloud-pairing-error" role="alert">{dayMemoResurrectionPreview.safeErrorMessage}</p> : null}
                      {(dayMemoResurrectionPreview.summary || dayMemoResurrectionPreview.items.length > 0 || dayMemoResurrectionPreview.state === 'no_candidates') && !dayMemoResurrectionUpload.hasPendingOperation ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" onClick={() => { dayMemoResurrectionUpload.reset(); dayMemoResurrectionPreview.discardPreview() }}>確認結果を破棄</button>
                      ) : null}
                      <p className="cloud-sync-note">確認結果はこの画面のメモリ内だけに保持します。DayMemo本文は表示せず、metadata・baseline・cursor・削除意図は変更しません。</p>
                    </div>
                  ) : null}
                  {dayMemoLocalOnlyPreview.eligible ? (
                    <div className="cloud-day-memo-local-only-panel">
                      <h4>local-only候補</h4>
                      <p>この端末だけにあるDayMemoについて、同期先の通常recordと削除済みrecordをfull pullで確認します。自動同期ではありません。</p>
                      {dayMemoLocalOnlyPreview.previewState === 'idle' ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" onClick={() => { void dayMemoLocalOnlyPreview.previewLocalOnly() }}>
                          local-only候補を確認
                        </button>
                      ) : null}
                      {dayMemoLocalOnlyPreview.previewState === 'checking' ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" disabled>同期先を確認中…</button>
                      ) : null}
                      {dayMemoLocalOnlyPreview.summary ? (
                        <>
                          <ul className="cloud-day-memo-preview-summary">
                            <li>候補：{dayMemoLocalOnlyPreview.summary.candidateCount}件</li>
                            <li>新規候補：{dayMemoLocalOnlyPreview.summary.localNewCandidateCount}件</li>
                            <li>同期先で削除済み：{dayMemoLocalOnlyPreview.summary.remoteDeletedCandidateCount}件</li>
                            <li>確認不能：{dayMemoLocalOnlyPreview.summary.unknownLocalOnlyCount}件</li>
                          </ul>
                          {dayMemoLocalOnlyPreview.items.length > 0 ? (
                            <ul className="cloud-day-memo-preview-items">
                              {dayMemoLocalOnlyPreview.items.map((item) => (
                                <li key={`${item.date}-${item.classification}`}>
                                  <strong>{item.date}</strong>
                                  <span>{item.classification === 'local_new_candidate' ? '新規候補'
                                    : item.classification === 'remote_deleted_candidate' ? '同期先で削除済み'
                                      : '確認不能'}</span>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </>
                      ) : null}
                      {dayMemoLocalOnlyPreview.previewState === 'preview_ready' ? (
                        <>
                          <p className="cloud-day-memo-success" role="status">local-only候補の分類が完了しました。</p>
                          {dayMemoLocalOnlyPreview.summary?.localNewCandidateCount === 1
                            && dayMemoLocalOnlyPreview.summary.candidateCount === 1
                            && dayMemoLocalOnlyUpload.state === 'idle'
                            && dayMemoSyncSafety.canStartUpload ? (
                            <button type="button" className="health-secondary-button cloud-sync-button" onClick={() => { void dayMemoLocalOnlyUpload.runPreflight() }}>
                              新規DayMemo候補の同期先を最終確認
                            </button>
                          ) : <p className="cloud-sync-note">安全な新規候補が1件だけの場合に限り、送信準備へ進めます。</p>}
                        </>
                      ) : null}
                      {dayMemoLocalOnlyUpload.state === 'preflighting' ? <button type="button" className="health-secondary-button cloud-sync-button" disabled>同期先を最終確認中…</button> : null}
                      {dayMemoLocalOnlyUpload.state === 'preflight_ready' ? (
                        <div className="cloud-day-memo-update-upload-step">
                          <p className="cloud-day-memo-success" role="status">対象日付に通常recordも削除済みrecordもありません。</p>
                          <button type="button" className="health-secondary-button cloud-sync-button" onClick={dayMemoLocalOnlyUpload.prepareUpload}>
                            この新規DayMemoを送信準備
                          </button>
                        </div>
                      ) : null}
                      {dayMemoLocalOnlyUpload.state === 'preparing' ? <p>operation IDとpending operationを安全に保存しています…</p> : null}
                      {dayMemoLocalOnlyUpload.state === 'prepared' ? (
                        <div className="cloud-day-memo-apply-confirmation">
                          <strong>新規DayMemo 1件の送信準備が完了しました</strong>
                          <p>base revision 0で1件だけ追加します。自動再試行や削除済みrecordの復活は行いません。</p>
                          <button type="button" className="health-primary-button cloud-sync-button" onClick={() => { void dayMemoLocalOnlyUpload.uploadPrepared() }}>
                            このDayMemoを同期先へ追加
                          </button>
                        </div>
                      ) : null}
                      {dayMemoLocalOnlyUpload.state === 'uploading' ? <p>新規DayMemo 1件を同期先へ追加しています。画面を閉じずにお待ちください…</p> : null}
                      {dayMemoLocalOnlyUpload.state === 'completed' && dayMemoLocalOnlyUpload.result ? (
                        <div className="cloud-day-memo-update-upload-result" role="status">
                          <p className="cloud-day-memo-success">新規DayMemoの作成が完了しました。</p>
                          <ul className="cloud-day-memo-preview-summary">
                            <li>対象日付：{dayMemoLocalOnlyUpload.result.date}</li>
                            <li>revision：{dayMemoLocalOnlyUpload.result.revision}</li>
                            <li>change sequence：{dayMemoLocalOnlyUpload.result.changeSequence}</li>
                          </ul>
                          <p>この端末のDayMemoは変更していません。</p>
                        </div>
                      ) : null}
                      {dayMemoLocalOnlyUpload.safeErrorMessage ? <p className="cloud-pairing-error" role="alert">{dayMemoLocalOnlyUpload.safeErrorMessage}</p> : null}
                      {dayMemoLocalOnlyPreview.previewState === 'no_candidates' ? (
                        <p className="cloud-sync-note" role="status">baselineに存在しないローカルDayMemoはありません。</p>
                      ) : null}
                      {dayMemoLocalOnlyPreview.safeErrorMessage ? <p className="cloud-pairing-error" role="alert">{dayMemoLocalOnlyPreview.safeErrorMessage}</p> : null}
                      {(dayMemoLocalOnlyPreview.summary || dayMemoLocalOnlyPreview.items.length > 0) && !dayMemoLocalOnlyUpload.hasPendingOperation ? (
                        <button type="button" className="health-secondary-button cloud-sync-button" onClick={() => { dayMemoLocalOnlyUpload.reset(); dayMemoLocalOnlyPreview.discardPreview() }}>
                          確認結果を破棄
                        </button>
                      ) : null}
                      <p className="cloud-sync-note">本文やoperation IDは表示しません。新規upsertは明示操作で1件だけ行い、delete・自動再試行は行いません。</p>
                    </div>
                  ) : null}
                  {supabaseWorkspace.connection?.workspaceRole === 'member' ? (
                    <>
                      <strong>workspaceへの参加が完了しました</strong>
                      <p>{supabasePairingJoin.joinedByRecovery
                        ? '既存の参加状態を確認し、このiPhoneの接続情報を復旧しました。DayMemo同期はまだ実装されていません。'
                        : 'この端末は子機・memberとして接続済みです。DayMemo同期はまだ実装されていません。'}</p>
                      <div className="cloud-day-memo-pull-panel">
                        <h4>DayMemoを確認</h4>
                        <p>同期先の内容を読み取り、ローカルへ反映する前のpreviewだけを作成します。本文は表示しません。</p>
                        {dayMemoPullPreview.previewState === 'idle' ? (
                          <button type="button" className="health-primary-button cloud-sync-button" onClick={() => { void dayMemoPullPreview.pullPreview() }}>
                            DayMemoを確認
                          </button>
                        ) : null}
                        {dayMemoPullPreview.previewState === 'pulling' ? (
                          <>
                            <p>同期先のDayMemoを順番に確認しています…</p>
                            <button type="button" className="health-primary-button cloud-sync-button" disabled>確認中…</button>
                          </>
                        ) : null}
                        {dayMemoPullPreview.summary ? (
                          <>
                            <p className="cloud-day-memo-progress">
                              通常 {dayMemoPullPreview.summary.remoteActiveCount}件・削除済み {dayMemoPullPreview.summary.remoteTombstoneCount}件
                            </p>
                            <ul className="cloud-day-memo-preview-summary">
                              <li>同期先のみ：{dayMemoPullPreview.summary.remoteOnlyCount}件</li>
                              <li>この端末のみ：{dayMemoPullPreview.summary.localOnlyCount}件</li>
                              <li>内容一致：{dayMemoPullPreview.summary.sameCount}件</li>
                              <li>内容相違：{dayMemoPullPreview.summary.differentCount}件</li>
                              <li>削除済み・端末にあり：{dayMemoPullPreview.summary.remoteTombstoneLocalExistsCount}件</li>
                              <li>削除済み・端末になし：{dayMemoPullPreview.summary.remoteTombstoneLocalMissingCount}件</li>
                            </ul>
                            {dayMemoPullPreview.items.length > 0 ? (
                              <ul className="cloud-day-memo-preview-items">
                                {dayMemoPullPreview.items.map((item) => (
                                  <li key={`${item.date}-${item.comparison}`}>
                                    <strong>{item.date}</strong>
                                    <span>{pullComparisonLabels[item.comparison]}</span>
                                    {item.remoteRevision !== null ? <small>revision {item.remoteRevision}・change {item.remoteChangeSequence}</small> : null}
                                  </li>
                                ))}
                              </ul>
                            ) : <p>同期先のDayMemoは空です。</p>}
                            <p className="cloud-sync-note">この結果はpreviewです。ローカルDayMemoへの反映はまだ行いません。</p>
                            {dayMemoPullPreview.canApplyPreview ? (
                              <div className="cloud-day-memo-apply-confirmation">
                                <strong>この端末へ追加する内容を確認してください</strong>
                                <p>同期先にだけあるDayMemoを追加します。この端末だけの内容、相違がある内容、削除済みデータは変更しません。</p>
                                <p>反映前バックアップを保存してから、明示操作で1回だけ反映します。Supabaseへの書き込みは行いません。</p>
                                <button
                                  type="button"
                                  className="health-primary-button cloud-sync-button"
                                  disabled={dayMemoPullPreview.applyState === 'applying'}
                                  onClick={dayMemoPullPreview.applyPreview}
                                >
                                  {dayMemoPullPreview.applyState === 'applying' ? 'DayMemoを反映中…' : '確認したDayMemoをこの端末へ追加'}
                                </button>
                              </div>
                            ) : null}
                            <button type="button" className="health-secondary-button cloud-sync-button" onClick={dayMemoPullPreview.clearPreview} disabled={dayMemoPullPreview.applyState === 'applying'}>
                              確認結果を破棄
                            </button>
                          </>
                        ) : null}
                        {dayMemoPullPreview.applyState === 'completed' && dayMemoPullPreview.applyResult ? (
                          <p className="cloud-day-memo-success" role="status">
                            DayMemoを{dayMemoPullPreview.applyResult.appliedCount}件追加しました。現在は{dayMemoPullPreview.applyResult.localTotalCount}件です。
                          </p>
                        ) : null}
                        {dayMemoPullPreview.safeErrorMessage ? <p className="cloud-pairing-error" role="alert">{dayMemoPullPreview.safeErrorMessage}</p> : null}
                        {dayMemoPullPreview.safeErrorMessage && dayMemoPullPreview.previewState !== 'pulling' ? (
                          <button type="button" className="health-secondary-button cloud-sync-button" onClick={dayMemoPullPreview.clearPreview}>
                            確認結果を破棄
                          </button>
                        ) : null}
                        <p className="cloud-sync-note">自動pull・自動再試行・ローカル保存・pushBlock解除は行いません。</p>
                      </div>
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
