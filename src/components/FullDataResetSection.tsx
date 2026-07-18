import { useMemo, useState } from 'react'
import type { HootoDayBackupData } from '../types/backup'
import {
  buildFullResetBackupFilename,
  createHootoDayBackup,
  downloadBackupJson,
  serializeHootoDayBackup,
} from '../utils/jsonBackup'
import { resetHootoDayDataStorage } from '../utils/fullDataReset'
import { FullDataResetDialog, type FullDataResetSummaryItem } from './FullDataResetDialog'

interface FullDataResetSectionProps {
  data: HootoDayBackupData
  onResetState: () => void
}

function getResetSummary(data: HootoDayBackupData): FullDataResetSummaryItem[] {
  return [
    { label: '予定', count: data.events.length },
    { label: '日記・メモ', count: data.dayMemos.length },
    { label: '健康プロフィール', count: data.healthProfile ? 1 : 0 },
    { label: '体重', count: data.weightRecords.length },
    { label: '睡眠', count: data.sleepRecords.length },
    { label: '食事', count: data.mealRecords.length },
    { label: '食事定型', count: data.mealTemplates.length },
    { label: '運動', count: data.exerciseSessions.length },
    { label: '体調', count: data.conditionRecords.length },
    { label: 'できたこと', count: data.dailyAchievements.length },
    { label: '月のベスト', count: data.monthlyAchievementSelections.length },
    { label: '商品', count: data.products.length },
    { label: '在庫履歴', count: data.inventoryMovements.length },
    { label: 'イベント販売', count: data.eventSalesRecords.length },
    { label: 'BOOTH販売', count: data.boothSalesRecords.length },
  ]
}

export function FullDataResetSection({ data, onResetState }: FullDataResetSectionProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const summary = useMemo(() => getResetSummary(data), [data])
  const totalCount = useMemo(() => summary.reduce((total, item) => total + item.count, 0), [summary])

  const openDialog = () => {
    setError('')
    setNotice('')
    setIsDialogOpen(true)
  }

  const closeDialog = () => {
    if (isBusy) return
    setError('')
    setIsDialogOpen(false)
  }

  const executeReset = () => {
    if (isBusy || totalCount === 0) return
    setIsBusy(true)
    setError('')

    try {
      const backup = createHootoDayBackup(data)
      downloadBackupJson(
        serializeHootoDayBackup(backup),
        buildFullResetBackupFilename(),
      )
    } catch {
      setError('バックアップファイルを作成できなかったため、初期化は行いませんでした。')
      setIsBusy(false)
      return
    }

    const result = resetHootoDayDataStorage(window.localStorage, data.theme)
    if (!result.success) {
      setError(result.rollbackFailed
        ? '保存データの初期化に失敗し、元の状態への復元も完了できませんでした。再読み込みせず、手動バックアップを確認してください。'
        : '保存データの初期化に失敗したため、元の状態へ戻しました。')
      setIsBusy(false)
      return
    }

    onResetState()
    setIsBusy(false)
    setIsDialogOpen(false)
    setNotice('テーマ設定を残し、その他の保存データを初期化しました。')
  }

  return (
    <section className="full-reset-section" aria-labelledby="full-reset-section-title">
      <div className="export-section-heading">
        <div>
          <p className="health-card-kicker">Data management</p>
          <h2 id="full-reset-section-title">データ管理</h2>
        </div>
      </div>
      <p>テーマ設定を残し、予定・日記・健康・できたこと・販売・在庫の保存データを空の状態へ戻します。</p>
      <p className="full-reset-section-warning">実行前に全データのJSONバックアップを自動保存します。この操作は元に戻せません。</p>
      <button type="button" className="backup-danger-button" onClick={openDialog}>保存データを一括初期化</button>
      <p className="backup-notice" aria-live="polite">{notice}</p>

      {isDialogOpen && (
        <FullDataResetDialog
          summary={summary}
          totalCount={totalCount}
          isBusy={isBusy}
          error={error}
          onConfirm={executeReset}
          onClose={closeDialog}
        />
      )}
    </section>
  )
}
