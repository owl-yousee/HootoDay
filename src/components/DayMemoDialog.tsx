import { XIcon } from '@phosphor-icons/react/X'
import { CaretLeftIcon } from '@phosphor-icons/react/CaretLeft'
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type SyntheticEvent,
} from 'react'
import { MAX_DAY_MEMO_CONTENT_LENGTH, type DayMemo } from '../types/dayMemo'
import type { DayMemoDeleteMode, DayMemoV5DeleteDiagnostic } from '../hooks/useDayMemoDeleteIntent'

interface DayMemoDialogProps {
  date: string
  weekday: string
  memo: DayMemo | null
  onSave: (memo: DayMemo) => boolean | void
  onDelete: (date: string) => boolean | void
  onCheckDelete?: (date: string) => void
  deleteMode?: DayMemoDeleteMode
  deleteDiagnostic?: DayMemoV5DeleteDiagnostic | null
  onClose: () => void
  mobileSlide?: boolean
}

export function DayMemoDialog({
  date,
  weekday,
  memo,
  onSave,
  onDelete,
  onCheckDelete,
  deleteMode = 'local_delete',
  deleteDiagnostic = null,
  onClose,
  mobileSlide = false,
}: DayMemoDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pendingInternalCloseEventsRef = useRef(0)
  const [content, setContent] = useState(memo?.content ?? '')
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

  const handleDialogCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault()
    closeDialog()
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedContent = content.trim()

    if (!trimmedContent) {
      setError('日記・メモの本文を入力してください。')
      requestAnimationFrame(() => {
        const contentField = dialogRef.current?.querySelector<HTMLTextAreaElement>('#day-memo-content')
        contentField?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        contentField?.focus({ preventScroll: true })
      })
      return
    }

    const saved = onSave({
      date,
      content: trimmedContent,
      updatedAt: new Date().toISOString(),
    })
    if (saved === false) {
      setError('新しい同期操作を安全に準備できませんでした。設定画面で準備状態を確認してください。')
      return
    }
    closeDialog()
  }

  const handleDelete = () => {
    if (deleteMode === 'sync_delete_blocked') return
    if (deleteMode === 'v5_delete_check' || deleteMode === 'v5_delete_blocked') {
      setError('')
      onCheckDelete?.(date)
      return
    }
    if (deleteMode === 'v5_delete_ready') return
    const message = deleteMode === 'sync_delete_ready'
      ? `${date}の日記・メモをこの端末から削除し、同期先の削除候補として記録しますか？\n\nこの時点では同期先から削除しません。`
      : `${date}の日記・メモをこの端末から削除しますか？`
    if (memo && window.confirm(message)) {
      const deleted = onDelete(date)
      if (deleted !== false) closeDialog()
      else setError('同期済みDayMemoを安全に削除できる状態ではありません。設定画面で同期状態を確認してください。')
    }
  }

  const errorId = error ? 'day-memo-content-error' : undefined

  return (
    <dialog
      ref={dialogRef}
      className={`day-memo-dialog${mobileSlide ? ' mobile-entry-dialog' : ''}`}
      aria-labelledby="day-memo-dialog-title"
      onCancel={handleDialogCancel}
      onClose={handleDialogClose}
    >
      <form className="day-memo-panel" onSubmit={handleSubmit} noValidate>
        <header className="day-memo-header">
          {mobileSlide && (
            <button type="button" className="mobile-entry-back" onClick={closeDialog} aria-label="カレンダーへ戻る">
              <CaretLeftIcon size={21} weight="bold" aria-hidden="true" />
            </button>
          )}
          <div>
            <p className="day-memo-eyebrow">Diary &amp; memo</p>
            <h2 id="day-memo-dialog-title">{memo ? '日記・メモを編集' : '日記・メモを書く'}</h2>
            <p className="day-memo-target-date">{date}（{weekday}）</p>
          </div>
          <button type="button" className="theme-close-button" onClick={closeDialog} aria-label="日記・メモ入力を閉じる">
            <XIcon size={20} weight="bold" aria-hidden="true" />
          </button>
        </header>

        <div className="form-field">
          <label htmlFor="day-memo-content">本文 <span className="required-label">必須・最大2000文字</span></label>
          <textarea
            id="day-memo-content"
            value={content}
            onChange={(event) => {
              setContent(event.target.value)
              if (error) setError('')
            }}
            maxLength={MAX_DAY_MEMO_CONTENT_LENGTH}
            rows={10}
            required
            aria-invalid={Boolean(error)}
            aria-describedby={errorId}
          />
          <span className="character-count" aria-live="polite">{content.length}/{MAX_DAY_MEMO_CONTENT_LENGTH}</span>
          {error && <p id="day-memo-content-error" className="form-error" role="alert">{error}</p>}
        </div>

        <div className="event-editor-actions">
          {memo && (
            <button
              type="button"
              className="event-action-button danger"
              onClick={handleDelete}
              disabled={deleteMode === 'sync_delete_blocked' || deleteMode === 'v5_delete_ready'}
            >
              {deleteMode === 'sync_delete_ready'
                ? '端末から削除し同期候補へ記録'
                : deleteMode === 'v5_delete_ready'
                  ? 'V5削除候補を確認済み'
                  : deleteMode === 'v5_delete_check'
                    ? 'V5削除候補を確認'
                    : deleteMode === 'v5_delete_blocked'
                      ? 'V5削除候補を再確認'
                : deleteMode === 'sync_delete_blocked'
                  ? '同期状態の確認が必要'
                  : 'メモを削除'}
            </button>
          )}
          <span className="event-action-spacer" />
          <button type="button" className="event-action-button secondary" onClick={closeDialog}>キャンセル</button>
          <button type="submit" className="event-action-button primary">保存</button>
        </div>
        {memo && deleteMode === 'sync_delete_blocked' && (
          <p className="field-hint" role="status">
            このDayMemoは同期対象です。baselineや未完了同期を確認してから削除してください。
          </p>
        )}
        {memo && deleteMode === 'v5_delete_ready' && (
          <p className="field-hint" role="status">
            V5削除候補を確認しました。この段階ではmetadata保存、端末削除、同期先への送信は行いません。
          </p>
        )}
        {memo && deleteMode === 'v5_delete_blocked' && (
          <p className="field-hint" role="status">
            V5削除候補を安全に確認できませんでした。保存状態または同期状態を再確認してください。
          </p>
        )}
        {memo && deleteMode === 'v5_delete_blocked' && deleteDiagnostic && (
          <div className="field-hint" role="status">
            <p><strong>安全停止の診断</strong></p>
            <ul>
              <li>classification：{deleteDiagnostic.classification}</li>
              <li>metadata version：{deleteDiagnostic.metadataVersion ?? '確認不能'}</li>
              <li>baseline confirmed：{deleteDiagnostic.baselineConfirmed ? 'はい' : 'いいえ'}</li>
              <li>pendingなし：{deleteDiagnostic.pendingAbsent ? 'はい' : 'いいえ'}</li>
              <li>pushBlockなし：{deleteDiagnostic.pushBlockClear ? 'はい' : 'いいえ'}</li>
              <li>delete intent件数：{deleteDiagnostic.intentCount}</li>
              <li>差異なし確認：{deleteDiagnostic.differencesConfirmedAbsent ? '確認済み' : '未確認'}</li>
              <li>対象baseline確認：{deleteDiagnostic.targetBaselineConfirmed ? '確認済み' : '未確認'}</li>
              <li>local状態一致：{deleteDiagnostic.localStateMatched ? '確認済み' : '未確認'}</li>
            </ul>
          </div>
        )}
      </form>
    </dialog>
  )
}
