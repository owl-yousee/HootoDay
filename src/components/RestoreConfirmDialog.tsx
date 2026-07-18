import { useEffect, useRef, type SyntheticEvent } from 'react'
import type { BackupSummary } from '../types/backup'
import { backupThemeLabels } from '../utils/jsonBackup'

interface RestoreConfirmDialogProps {
  filename: string
  summary: BackupSummary
  isBusy: boolean
  onConfirm: () => void
  onClose: () => void
}

function formatCreatedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ja-JP')
}

export function RestoreConfirmDialog({ filename, summary, isBusy, onConfirm, onClose }: RestoreConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pendingInternalCloseEventsRef = useRef(0)

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
    if (!isBusy && dialogRef.current?.open) dialogRef.current.close()
  }

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

  return (
    <dialog ref={dialogRef} className="restore-confirm-dialog" aria-labelledby="restore-confirm-title" onCancel={handleCancel} onClose={handleClose}>
      <section className="restore-confirm-panel">
        <p className="achievement-eyebrow">Restore confirmation</p>
        <h2 id="restore-confirm-title">バックアップを復元しますか？</h2>
        <p className="restore-warning"><strong>現在のHootoDayデータは、選択したバックアップ内容で上書きされます。</strong><br />復元直前に、現在のデータを自動バックアップとして保存します。</p>
        <dl className="restore-confirm-summary">
          <div><dt>選択ファイル</dt><dd>{filename}</dd></div>
          <div><dt>作成日時</dt><dd>{formatCreatedAt(summary.createdAt)}</dd></div>
          <div><dt>テーマ</dt><dd>{backupThemeLabels[summary.theme]}</dd></div>
          <div><dt>記録件数</dt><dd>{summary.events + summary.dayMemos + summary.weightRecords + summary.sleepRecords + summary.mealRecords + summary.mealTemplates + summary.exerciseSessions + summary.conditionRecords + summary.dailyAchievements + summary.monthlyAchievementSelections}件</dd></div>
          <div><dt>販売・在庫</dt><dd>商品 {summary.products}件／履歴 {summary.inventoryMovements}件／イベント {summary.eventSalesRecords}件／BOOTH {summary.boothSalesRecords}件</dd></div>
        </dl>
        <div className="restore-confirm-actions">
          <button type="button" className="health-secondary-button" disabled={isBusy} onClick={closeDialog}>キャンセル</button>
          <button type="button" className="backup-danger-button" disabled={isBusy} onClick={onConfirm}>{isBusy ? '復元しています…' : '復元する'}</button>
        </div>
      </section>
    </dialog>
  )
}
