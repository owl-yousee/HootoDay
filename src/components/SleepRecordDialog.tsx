import { XIcon } from '@phosphor-icons/react/X'
import { useEffect, useRef, useState, type FormEvent, type SyntheticEvent } from 'react'
import type { SleepAwakening, SleepRecord } from '../types/health'
import { formatDateKeyJa } from '../utils/date'
import {
  calculateSleepSummary,
  DEFAULT_POINT_AWAKENING_MINUTES,
  formatDurationMinutes,
  MAX_POINT_AWAKENING_MINUTES,
  MIN_POINT_AWAKENING_MINUTES,
} from '../utils/sleepMetrics'
import { MAX_SLEEP_MEMO_LENGTH } from '../utils/sleepStorage'

interface SleepRecordDialogProps {
  date: string
  record: SleepRecord | null
  onSave: (record: SleepRecord) => void
  onDelete: (date: string) => void
  onClose: () => void
}

function createAwakening(): SleepAwakening {
  return {
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `awakening-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    mode: 'point',
    startTime: '',
    endTime: null,
    estimatedMinutes: DEFAULT_POINT_AWAKENING_MINUTES,
  }
}

export function SleepRecordDialog({ date, record, onSave, onDelete, onClose }: SleepRecordDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pendingInternalCloseEventsRef = useRef(0)
  const [bedtime, setBedtime] = useState(record?.bedtime ?? '')
  const [wakeTime, setWakeTime] = useState(record?.wakeTime ?? '')
  const [awakenings, setAwakenings] = useState<SleepAwakening[]>(record?.awakenings ?? [])
  const [memo, setMemo] = useState(record?.memo ?? '')
  const [error, setError] = useState('')
  const calculation = calculateSleepSummary(bedtime, wakeTime, awakenings)

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

  const updateAwakening = (id: string, update: (item: SleepAwakening) => SleepAwakening) => {
    setAwakenings((current) => current.map((item) => item.id === id ? update(item) : item))
    if (error) setError('')
  }

  const changeMode = (id: string, mode: SleepAwakening['mode']) => {
    updateAwakening(id, (item) => mode === 'point'
      ? { id: item.id, mode: 'point', startTime: item.startTime, endTime: null, estimatedMinutes: DEFAULT_POINT_AWAKENING_MINUTES }
      : { id: item.id, mode: 'range', startTime: item.startTime, endTime: '', estimatedMinutes: null })
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const result = calculateSleepSummary(bedtime, wakeTime, awakenings)
    if (!result.summary) {
      setError(result.error ?? '入力内容を確認してください。')
      return
    }
    onSave({
      date,
      bedtime,
      wakeTime,
      awakenings,
      ...result.summary,
      memo: memo.trim(),
      updatedAt: new Date().toISOString(),
    })
    closeDialog()
  }

  const handleDelete = () => {
    if (record && window.confirm(`${date}の睡眠記録を削除しますか？`)) {
      onDelete(date)
      closeDialog()
    }
  }

  return (
    <dialog ref={dialogRef} className="sleep-record-dialog" aria-labelledby="sleep-record-dialog-title" onCancel={handleCancel} onClose={handleDialogClose}>
      <form className="sleep-record-panel" onSubmit={handleSubmit} noValidate>
        <header className="weight-record-header">
          <div>
            <p className="weight-record-eyebrow">Sleep</p>
            <h2 id="sleep-record-dialog-title">{record ? '睡眠記録を編集' : '睡眠を記録'}</h2>
            <p className="weight-record-target-date">起床日：{formatDateKeyJa(date)}</p>
          </div>
          <button type="button" className="theme-close-button" onClick={closeDialog} aria-label="睡眠入力を閉じる">
            <XIcon size={20} weight="bold" aria-hidden="true" />
          </button>
        </header>

        <div className="dialog-scroll-body">
          <div className="sleep-record-form">
          <div className="sleep-time-grid">
            <div className="form-field">
              <label htmlFor="sleep-bedtime">就寝時刻 <span className="required-label">必須</span></label>
              <input id="sleep-bedtime" type="time" value={bedtime} onChange={(event) => { setBedtime(event.target.value); setError('') }} required aria-invalid={Boolean(error)} aria-describedby={error ? 'sleep-time-hint sleep-record-error' : 'sleep-time-hint'} />
            </div>
            <div className="form-field">
              <label htmlFor="sleep-wake-time">起床時刻 <span className="required-label">必須</span></label>
              <input id="sleep-wake-time" type="time" value={wakeTime} onChange={(event) => { setWakeTime(event.target.value); setError('') }} required aria-invalid={Boolean(error)} aria-describedby={error ? 'sleep-time-hint sleep-record-error' : 'sleep-time-hint'} />
            </div>
          </div>
          <span id="sleep-time-hint" className="field-hint">起床した日を記録日とし、起床時刻が早い場合は日またぎとして計算します。</span>

          <section className="sleep-awakening-section" aria-labelledby="sleep-awakening-heading">
            <div className="sleep-awakening-heading">
              <div><h3 id="sleep-awakening-heading">途中覚醒</h3><p>複数回追加できます</p></div>
              <button type="button" className="sleep-add-awakening" onClick={() => setAwakenings((current) => [...current, createAwakening()])}>途中覚醒を追加</button>
            </div>
            {awakenings.length === 0 ? <p className="sleep-awakening-empty">途中覚醒なし</p> : (
              <div className="sleep-awakening-list">
                {awakenings.map((awakening, index) => (
                  <fieldset className="sleep-awakening-row" key={awakening.id}>
                    <legend>途中覚醒 {index + 1}</legend>
                    <div className="form-field">
                      <label htmlFor={`awakening-mode-${awakening.id}`}>種類</label>
                      <select id={`awakening-mode-${awakening.id}`} value={awakening.mode} onChange={(event) => changeMode(awakening.id, event.target.value as SleepAwakening['mode'])}>
                        <option value="point">時刻だけ</option>
                        <option value="range">時間範囲</option>
                      </select>
                    </div>
                    <div className="form-field">
                      <label htmlFor={`awakening-start-${awakening.id}`}>{awakening.mode === 'point' ? '覚醒時刻' : '覚醒開始'}</label>
                      <input id={`awakening-start-${awakening.id}`} type="time" value={awakening.startTime} onChange={(event) => updateAwakening(awakening.id, (item) => ({ ...item, startTime: event.target.value }))} aria-invalid={Boolean(error)} />
                    </div>
                    {awakening.mode === 'point' ? (
                      <div className="form-field">
                        <label htmlFor={`awakening-minutes-${awakening.id}`}>差し引く時間（分）</label>
                        <input id={`awakening-minutes-${awakening.id}`} type="number" min={MIN_POINT_AWAKENING_MINUTES} max={MAX_POINT_AWAKENING_MINUTES} step="5" value={awakening.estimatedMinutes} onChange={(event) => updateAwakening(awakening.id, (item) => item.mode === 'point' ? { ...item, estimatedMinutes: Number(event.target.value) } : item)} aria-invalid={Boolean(error)} />
                      </div>
                    ) : (
                      <div className="form-field">
                        <label htmlFor={`awakening-end-${awakening.id}`}>再入眠時刻</label>
                        <input id={`awakening-end-${awakening.id}`} type="time" value={awakening.endTime} onChange={(event) => updateAwakening(awakening.id, (item) => item.mode === 'range' ? { ...item, endTime: event.target.value } : item)} aria-invalid={Boolean(error)} />
                      </div>
                    )}
                    <button type="button" className="sleep-remove-awakening" onClick={() => setAwakenings((current) => current.filter((item) => item.id !== awakening.id))} aria-label={`途中覚醒${index + 1}を削除`}>削除</button>
                  </fieldset>
                ))}
              </div>
            )}
          </section>

          <section className="sleep-calculation-preview" aria-live="polite" aria-label="睡眠時間の計算結果">
            <h3>計算結果</h3>
            {calculation.summary ? (
              <dl>
                <div><dt>総就床時間</dt><dd>{formatDurationMinutes(calculation.summary.totalInBedMinutes)}</dd></div>
                <div><dt>途中覚醒合計</dt><dd>{formatDurationMinutes(calculation.summary.awakeMinutes)}</dd></div>
                <div><dt>実睡眠時間</dt><dd>{formatDurationMinutes(calculation.summary.sleepMinutes)}</dd></div>
              </dl>
            ) : <p>計算できません</p>}
            <small>本人入力による概算であり、医療機器による測定値ではありません。</small>
          </section>

          <div className="form-field">
            <label htmlFor="sleep-memo">メモ（任意）</label>
            <textarea id="sleep-memo" value={memo} onChange={(event) => setMemo(event.target.value)} maxLength={MAX_SLEEP_MEMO_LENGTH} rows={4} placeholder="寝付き、途中覚醒の様子、夢、睡眠の質など" />
            <span className="character-count" aria-live="polite">{memo.length}/{MAX_SLEEP_MEMO_LENGTH}</span>
          </div>
          {error && <p id="sleep-record-error" className="form-error" role="alert">{error}</p>}
          </div>
        </div>

        <div className="event-editor-actions">
          {record && <button type="button" className="event-action-button danger" onClick={handleDelete}>睡眠記録を削除</button>}
          <span className="event-action-spacer" />
          <button type="button" className="event-action-button secondary" onClick={closeDialog}>キャンセル</button>
          <button type="submit" className="event-action-button primary">保存</button>
        </div>
      </form>
    </dialog>
  )
}
