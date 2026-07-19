import { useState, type ChangeEvent } from 'react'
import type { HootoDayBackup, HootoDayBackupData } from '../types/backup'
import {
  backupThemeLabels,
  buildBackupFilename,
  createHootoDayBackup,
  downloadBackupJson,
  getBackupSummary,
  MAX_BACKUP_FILE_SIZE,
  parseHootoDayBackup,
  restoreBackupToStorage,
  serializeHootoDayBackup,
} from '../utils/jsonBackup'
import { RestoreConfirmDialog } from './RestoreConfirmDialog'

interface JsonBackupPanelProps {
  data: HootoDayBackupData
  onRestore: (data: HootoDayBackupData) => void
  beforeRestore: () => boolean
}

interface SelectedBackup {
  filename: string
  backup: HootoDayBackup
}

const summaryRows = [
  ['events', '予定'],
  ['dayMemos', '日記・メモ'],
  ['weightRecords', '体重'],
  ['sleepRecords', '睡眠'],
  ['mealRecords', '食事'],
  ['mealTemplates', '食事定型'],
  ['exerciseSessions', '運動'],
  ['conditionRecords', '体調'],
  ['dailyAchievements', 'できたこと'],
  ['monthlyAchievementSelections', '月のベスト'],
] as const

function formatCreatedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ja-JP')
}

export function JsonBackupPanel({ data, onRestore, beforeRestore }: JsonBackupPanelProps) {
  const [selected, setSelected] = useState<SelectedBackup | null>(null)
  const [backupError, setBackupError] = useState('')
  const [backupNotice, setBackupNotice] = useState('')
  const [restoreError, setRestoreError] = useState('')
  const [restoreNotice, setRestoreNotice] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const summary = selected ? getBackupSummary(selected.backup) : null

  const saveBackup = () => {
    if (isSaving) return
    setIsSaving(true)
    setBackupError('')
    setBackupNotice('')
    try {
      const now = new Date()
      const backup = createHootoDayBackup(data, now.toISOString())
      downloadBackupJson(serializeHootoDayBackup(backup), buildBackupFilename(now))
      setBackupNotice('バックアップを保存しました')
    } catch {
      setBackupError('バックアップを保存できませんでした')
    } finally {
      setIsSaving(false)
    }
  }

  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    setSelected(null)
    setRestoreError('')
    setRestoreNotice('')
    if (!file) return
    if (file.size > MAX_BACKUP_FILE_SIZE) {
      setRestoreError('バックアップファイルが大きすぎます')
      return
    }
    try {
      const result = parseHootoDayBackup(await file.text())
      if (!result.backup) {
        setRestoreError(result.error ?? 'バックアップを検証できませんでした。')
        return
      }
      setSelected({ filename: file.name, backup: result.backup })
      setRestoreNotice('復元可能なバックアップです')
    } catch {
      setRestoreError('バックアップファイルを読み込めませんでした。')
    }
  }

  const restore = () => {
    if (!selected || isRestoring) return
    setIsRestoring(true)
    setRestoreError('')
    setRestoreNotice('')
    try {
      const now = new Date()
      const currentBackup = createHootoDayBackup(data, now.toISOString())
      try {
        downloadBackupJson(serializeHootoDayBackup(currentBackup), buildBackupFilename(now, true))
      } catch {
        setRestoreError('現在のデータを退避できなかったため、復元を中止しました')
        setIsConfirmOpen(false)
        return
      }

      if (!beforeRestore()) {
        setRestoreError('同期の誤送信防止設定を保存できなかったため、復元を中止しました。')
        setIsConfirmOpen(false)
        return
      }

      const result = restoreBackupToStorage(window.localStorage, selected.backup.data)
      if (!result.success) {
        setRestoreError(result.rollbackFailed
          ? '復元と元データへの復帰に失敗しました。自動保存された復元前バックアップを保管してください'
          : '復元に失敗したため、元のデータへ戻しました')
        setIsConfirmOpen(false)
        return
      }

      onRestore(selected.backup.data)
      setSelected(null)
      setIsConfirmOpen(false)
      setRestoreNotice('バックアップを復元しました')
    } catch {
      setRestoreError('復元に失敗したため、現在のデータは変更していません')
      setIsConfirmOpen(false)
    } finally {
      setIsRestoring(false)
    }
  }

  return (
    <div className="json-backup-area">
      <section className="json-backup-card" aria-labelledby="json-backup-title">
        <p className="health-card-kicker">JSON backup</p>
        <h2 id="json-backup-title">JSONバックアップ</h2>
        <p>HootoDayの予定・日記・健康記録などを、ひとつのJSONファイルへ保存します。</p>
        <button type="button" className="health-primary-button" disabled={isSaving} onClick={saveBackup}>{isSaving ? '保存しています…' : 'バックアップを保存'}</button>
        {backupError && <p className="form-error" role="alert">{backupError}</p>}
        <p className="backup-notice" aria-live="polite">{backupNotice}</p>
      </section>

      <section className="json-restore-card" aria-labelledby="json-restore-title">
        <p className="health-card-kicker">JSON restore</p>
        <h2 id="json-restore-title">JSONから復元</h2>
        <p>HootoDayで作成したバックアップを検証し、現在のデータへ上書き復元します。</p>
        <p className="json-restore-warning"><strong>復元すると現在のデータは上書きされます。</strong><br />復元直前に現在データの自動バックアップを保存します。</p>
        <label className="backup-file-field" htmlFor="backup-file-input">
          <span>バックアップファイル</span>
          <input id="backup-file-input" type="file" accept=".json,application/json" onChange={selectFile} />
          <small>HootoDayのJSONファイルを1つ選択してください（最大10MB）。選択だけでは復元されません。</small>
        </label>

        {selected && summary && (
          <div className="backup-summary" aria-labelledby="backup-summary-title">
            <div className="backup-summary-heading">
              <div><strong id="backup-summary-title">バックアップ情報</strong><span>復元可能なバックアップです</span></div>
              <p>{selected.filename}</p>
            </div>
            <dl>
              <div><dt>作成日時</dt><dd>{formatCreatedAt(summary.createdAt)}</dd></div>
              <div><dt>テーマ</dt><dd>{backupThemeLabels[summary.theme]}</dd></div>
              <div><dt>健康プロフィール</dt><dd>{summary.hasHealthProfile ? 'あり' : 'なし'}</dd></div>
              {summaryRows.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{summary[key]}件</dd></div>)}
            </dl>
          </div>
        )}

        {restoreError && <p className="form-error" role="alert">{restoreError}</p>}
        <p className="backup-notice" aria-live="polite">{restoreNotice}</p>
        <button type="button" className="backup-danger-button" disabled={!selected || isRestoring} onClick={() => setIsConfirmOpen(true)}>復元する</button>
        <p className="export-privacy-note">バックアップと復元はこの端末内で処理され、外部へ自動送信されません。</p>
      </section>

      {isConfirmOpen && selected && summary && (
        <RestoreConfirmDialog filename={selected.filename} summary={summary} isBusy={isRestoring} onConfirm={restore} onClose={() => setIsConfirmOpen(false)} />
      )}
    </div>
  )
}
