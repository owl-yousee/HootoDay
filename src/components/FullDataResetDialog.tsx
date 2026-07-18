import { useEffect, useRef, useState, type SyntheticEvent } from 'react'

export interface FullDataResetSummaryItem {
  label: string
  count: number
}

interface FullDataResetDialogProps {
  summary: FullDataResetSummaryItem[]
  totalCount: number
  isBusy: boolean
  error: string
  onConfirm: () => void
  onClose: () => void
}

export function FullDataResetDialog({ summary, totalCount, isBusy, error, onConfirm, onClose }: FullDataResetDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pendingInternalCloseEventsRef = useRef(0)
  const [confirmation, setConfirmation] = useState('')
  const canConfirm = confirmation === '初期化' && totalCount > 0 && !isBusy

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
    <dialog
      ref={dialogRef}
      className="full-reset-dialog"
      aria-labelledby="full-reset-title"
      aria-describedby="full-reset-warning"
      onCancel={handleCancel}
      onClose={handleClose}
    >
      <section className="full-reset-dialog-panel">
        <p className="achievement-eyebrow">Data reset</p>
        <h2 id="full-reset-title">保存データを一括初期化しますか？</h2>
        <p id="full-reset-warning" className="full-reset-warning">
          <strong>テーマ設定以外のすべての保存データが空になります。</strong><br />
          実行前に現在の全データをJSONファイルとして自動保存します。
        </p>

        <div className="full-reset-summary" aria-label="初期化対象の件数">
          {summary.map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              <strong>{item.count}件</strong>
            </div>
          ))}
        </div>
        <p className="full-reset-total">初期化対象 合計 <strong>{totalCount}件</strong></p>

        <label className="full-reset-confirm-field" htmlFor="full-reset-confirmation">
          <span>確認のため「初期化」と入力してください</span>
          <input
            id="full-reset-confirmation"
            type="text"
            value={confirmation}
            autoComplete="off"
            disabled={isBusy}
            aria-describedby={error ? 'full-reset-error' : undefined}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>

        {totalCount === 0 && <p className="full-reset-empty">初期化できる保存データはありません。</p>}
        {error && <p id="full-reset-error" className="form-error" role="alert">{error}</p>}

        <div className="full-reset-actions">
          <button type="button" className="health-secondary-button" disabled={isBusy} onClick={closeDialog}>キャンセル</button>
          <button type="button" className="backup-danger-button" disabled={!canConfirm} onClick={onConfirm}>
            {isBusy ? '初期化しています…' : 'バックアップして初期化'}
          </button>
        </div>
      </section>
    </dialog>
  )
}
