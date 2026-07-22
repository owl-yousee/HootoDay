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
import type {
  DayMemoNormalDeleteLifecycleStartResult,
  DayMemoNormalDeleteLocalPersistenceResult,
  DayMemoNormalDeleteMetadataPersistenceResult,
  DayMemoNormalDeletePreparationConnectionResult,
} from '../hooks/useDayMemoLocalOperationPreparation'

interface DayMemoDialogProps {
  date: string
  weekday: string
  memo: DayMemo | null
  onSave: (memo: DayMemo) => boolean | void
  onDelete: (date: string) => boolean | void
  onCheckDelete?: (date: string) => void
  onStartDeletePreparation?: (date: string) => boolean
  onPersistDeletePreparation?: (date: string) => boolean
  onDeletePreparedLocal?: (date: string) => boolean
  deleteMode?: DayMemoDeleteMode
  deleteDiagnostic?: DayMemoV5DeleteDiagnostic | null
  deletePreparationConnectionResult?: DayMemoNormalDeletePreparationConnectionResult | null
  deletePreparationResult?: DayMemoNormalDeleteLifecycleStartResult | null
  deletePreparationMetadataResult?: DayMemoNormalDeleteMetadataPersistenceResult | null
  deletePreparationLocalResult?: DayMemoNormalDeleteLocalPersistenceResult | null
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
  onStartDeletePreparation,
  onPersistDeletePreparation,
  onDeletePreparedLocal,
  deleteMode = 'local_delete',
  deleteDiagnostic = null,
  deletePreparationConnectionResult = null,
  deletePreparationResult = null,
  deletePreparationMetadataResult = null,
  deletePreparationLocalResult = null,
  onClose,
  mobileSlide = false,
}: DayMemoDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pendingInternalCloseEventsRef = useRef(0)
  const [content, setContent] = useState(memo?.content ?? '')
  const [error, setError] = useState('')
  const localDeleteCompleted = deletePreparationLocalResult?.date === date
    && deletePreparationLocalResult.succeeded

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
    if (localDeleteCompleted) return
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
    if (deleteMode === 'v5_delete_ready') {
      setError('')
      onStartDeletePreparation?.(date)
      return
    }
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
            <h2 id="day-memo-dialog-title">{localDeleteCompleted
              ? 'DayMemoの削除完了' : memo ? '日記・メモを編集' : '日記・メモを書く'}</h2>
            <p className="day-memo-target-date">{date}（{weekday}）</p>
          </div>
          <button type="button" className="theme-close-button" onClick={closeDialog} aria-label="日記・メモ入力を閉じる">
            <XIcon size={20} weight="bold" aria-hidden="true" />
          </button>
        </header>

        {!localDeleteCompleted && <div className="form-field">
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
        </div>}

        <div className="event-editor-actions">
          {memo && !(deletePreparationMetadataResult?.date === date && deletePreparationMetadataResult.succeeded) && (
            <button
              type="button"
              className="event-action-button danger"
              onClick={handleDelete}
              disabled={deleteMode === 'sync_delete_blocked'}
            >
              {deleteMode === 'sync_delete_ready'
                ? '端末から削除し同期候補へ記録'
                : deleteMode === 'v5_delete_ready'
                  ? '削除準備を開始'
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
          {!localDeleteCompleted && <button type="submit" className="event-action-button primary">保存</button>}
        </div>
        {memo && deleteMode === 'sync_delete_blocked' && (
          <p className="field-hint" role="status">
            このDayMemoは同期対象です。baselineや未完了同期を確認してから削除してください。
          </p>
        )}
        {memo && deleteMode === 'v5_delete_ready' && (
          <p className="field-hint" role="status">
            V5削除候補を確認しました。「削除準備を開始」でoperation planだけを生成します。
          </p>
        )}
        {memo && deletePreparationResult?.date === date && deletePreparationResult.ready
          && !(deletePreparationMetadataResult?.date === date && deletePreparationMetadataResult.succeeded) && (
          <div className="field-hint" role="status">
            <p><strong>削除準備planを生成しました</strong></p>
            <ul>
              <li>plan生成：完了</li>
              <li>metadata保存：未実行</li>
              <li>local DayMemo削除：未実行</li>
              <li>remote送信：未実行</li>
              <li>永続状態変更：なし</li>
            </ul>
            <button type="button" className="event-action-button danger"
              onClick={() => onPersistDeletePreparation?.(date)}>
              削除準備情報を保存
            </button>
          </div>
        )}
        {memo && deletePreparationResult?.date === date && !deletePreparationResult.ready && (
          <div className="field-hint" role="status">
            <p><strong>削除準備を安全に開始できませんでした</strong></p>
            <ul>
              <li>classification：{deletePreparationResult.classification}</li>
              <li>connection確認：{deletePreparationConnectionResult?.date === date
                && deletePreparationConnectionResult.ready ? '成功' : '未確認／停止'}</li>
              <li>plan生成：{deletePreparationResult.operationIdGenerated ? '成功' : '未実行'}</li>
              <li>pending候補：{deletePreparationResult.pendingPrepared ? '生成済み' : '未生成'}</li>
              <li>intent候補：{deletePreparationResult.localDeleteIntentPrepared ? '生成済み' : '未生成'}</li>
              <li>候補間整合：{deletePreparationResult.operationIdsMatch ? '一致' : '未確認'}</li>
              <li>validator：{deletePreparationResult.metadataValid ? '成功' : '未確認／停止'}</li>
              <li>永続状態変更：{deletePreparationResult.persistentChanged ? 'あり' : 'なし'}</li>
            </ul>
          </div>
        )}
        {deletePreparationMetadataResult?.date === date && deletePreparationMetadataResult.succeeded
          && !localDeleteCompleted && (
          <div className="field-hint" role="status">
            <p><strong>削除準備情報を保存しました</strong></p>
            <ul>
              <li>metadata保存：完了</li>
              <li>verified read-back：完了</li>
              <li>pendingOperation保存：完了</li>
              <li>localDeleteIntent保存：完了</li>
              <li>local DayMemo削除：未実行</li>
              <li>remote送信：未実行</li>
            </ul>
            <button type="button" className="event-action-button danger"
              onClick={() => onDeletePreparedLocal?.(date)}>
              この端末のDayMemoを削除
            </button>
          </div>
        )}
        {memo && deletePreparationMetadataResult?.date === date && !deletePreparationMetadataResult.succeeded && (
          <div className="field-hint" role="status">
            <p><strong>削除準備情報を安全に保存できませんでした</strong></p>
            <ul>
              <li>classification：{deletePreparationMetadataResult.classification}</li>
              <li>plan確認：{deletePreparationResult?.date === date && deletePreparationResult.ready ? '成功' : '未確認／停止'}</li>
              <li>metadata鮮度確認：{deletePreparationMetadataResult.classification === 'normal_delete_v5_metadata_state_changed'
                ? '不一致' : '確認済み／別条件で停止'}</li>
              <li>pending候補：{deletePreparationMetadataResult.pendingSaved ? '保存確認済み' : '未保存／未確認'}</li>
              <li>intent候補：{deletePreparationMetadataResult.localDeleteIntentSaved ? '保存確認済み' : '未保存／未確認'}</li>
              <li>operation ID整合：{deletePreparationMetadataResult.operationIdsMatch ? '一致' : '未確認／不一致'}</li>
              <li>validator：{deletePreparationMetadataResult.metadataValid ? '成功' : '未確認／失敗'}</li>
              <li>compare-and-write：{deletePreparationMetadataResult.succeeded ? '成功' : '成功未確認'}</li>
              <li>read-back：{deletePreparationMetadataResult.readBackVerified ? '成功' : '未確認／失敗'}</li>
              <li>rollback実行：{deletePreparationMetadataResult.rollbackAttempted ? 'あり' : 'なし'}</li>
              <li>rollback確認：{deletePreparationMetadataResult.rollbackVerified ? '成功' : '未実行／確認不能'}</li>
              <li>recoveryRequired：{deletePreparationMetadataResult.classification === 'normal_delete_v5_metadata_rollback_failed'
                ? 'はい' : 'いいえ'}</li>
            </ul>
          </div>
        )}
        {deletePreparationLocalResult?.date === date && deletePreparationLocalResult.succeeded && (
          <div className="field-hint" role="status">
            <p><strong>この端末のDayMemoを削除しました</strong></p>
            <ul>
              <li>local DayMemo削除：完了</li>
              <li>verified local read-back：完了</li>
              <li>React state更新：完了</li>
              <li>pendingOperation：保持中</li>
              <li>localDeleteIntent：保持中</li>
              <li>remote確認：未実行</li>
              <li>remote送信：未実行</li>
            </ul>
          </div>
        )}
        {deletePreparationLocalResult?.date === date && !deletePreparationLocalResult.succeeded && (
          <div className="field-hint" role="status">
            <p><strong>この端末のDayMemoを安全に削除できませんでした</strong></p>
            <ul>
              <li>classification：{deletePreparationLocalResult.classification}</li>
              <li>metadata確認：{deletePreparationLocalResult.classification === 'normal_delete_v5_local_metadata_invalid'
                ? '不一致／無効' : '確認済み／別条件で停止'}</li>
              <li>pending確認：{deletePreparationLocalResult.operationIdsMatch ? '確認済み' : '未確認／不一致'}</li>
              <li>intent確認：{deletePreparationLocalResult.operationIdsMatch ? '確認済み' : '未確認／不一致'}</li>
              <li>operation ID整合：{deletePreparationLocalResult.operationIdsMatch ? '一致' : '未確認／不一致'}</li>
              <li>対象local：{deletePreparationLocalResult.targetDeleted ? '削除済み' : '保持／未確認'}</li>
              <li>対象外不変：{deletePreparationLocalResult.outsideMemosUnchanged ? '確認済み' : '未確認'}</li>
              <li>local保存：{deletePreparationLocalResult.succeeded ? '成功' : '成功未確認／失敗'}</li>
              <li>read-back：{deletePreparationLocalResult.readBackVerified ? '成功' : '未確認／失敗'}</li>
              <li>rollback実行：{deletePreparationLocalResult.rollbackAttempted ? 'あり' : 'なし'}</li>
              <li>rollback確認：{deletePreparationLocalResult.rollbackVerified ? '成功' : '未実行／確認不能'}</li>
              <li>recoveryRequired：{deletePreparationLocalResult.recoveryRequired ? 'はい' : 'いいえ'}</li>
            </ul>
          </div>
        )}
        {memo && deleteMode === 'v5_delete_blocked'
          && !(deletePreparationMetadataResult?.date === date && deletePreparationMetadataResult.succeeded) && (
          <p className="field-hint" role="status">
            V5削除候補を安全に確認できませんでした。保存状態または同期状態を再確認してください。
          </p>
        )}
        {memo && deleteMode === 'v5_delete_blocked' && deleteDiagnostic
          && !(deletePreparationMetadataResult?.date === date && deletePreparationMetadataResult.succeeded) && (
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
              <li>preview ready：{deleteDiagnostic.previewReady ? 'はい' : 'いいえ'}</li>
              <li>summary same件数：{deleteDiagnostic.summarySameCount ?? '確認不能'}</li>
              <li>summary差異件数：{deleteDiagnostic.summaryDifferenceCount ?? '確認不能'}</li>
              <li>未解決tombstone：{deleteDiagnostic.unresolvedTombstoneCount ?? '確認不能'}件</li>
              <li>baseline件数：{deleteDiagnostic.baselineCount ?? '確認不能'}</li>
              <li>preview item件数：{deleteDiagnostic.previewItemCount}</li>
              <li>metadata cursor一致：{deleteDiagnostic.cursorMatched ? 'はい' : 'いいえ'}</li>
              <li>full pull sequence一致：{deleteDiagnostic.fullPullSequenceMatched ? 'はい' : 'いいえ'}</li>
              <li>same件数とbaseline件数一致：{deleteDiagnostic.sameCountMatchesBaselineCount ? 'はい' : 'いいえ'}</li>
              <li>preview件数とsame件数一致：{deleteDiagnostic.previewItemCountMatchesSameCount ? 'はい' : 'いいえ'}</li>
              <li>全preview item厳格一致：{deleteDiagnostic.allPreviewItemsConfirmed ? 'はい' : 'いいえ'}</li>
            </ul>
          </div>
        )}
      </form>
    </dialog>
  )
}
