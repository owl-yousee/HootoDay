import { useEffect, useState } from 'react'
import { CaretDownIcon } from '@phosphor-icons/react/CaretDown'

export interface QuickEventDraft {
  title: string
  date: string
  startTime: string
  memo: string
}

interface Props {
  value: QuickEventDraft
  onChange: (value: QuickEventDraft) => void
  prefix: string
}

export function EventQuickCreateFields({ value, onChange, prefix }: Props) {
  const isCollapsible = prefix === 'sale-event'
  const [isOpen, setIsOpen] = useState(false)
  const [createErrors, setCreateErrors] = useState<Partial<Record<keyof QuickEventDraft, string>>>({})
  const set = (key: keyof QuickEventDraft, next: string) => {
    onChange({ ...value, [key]: next })
    setCreateErrors((current) => {
      if (!current[key]) return current
      const nextErrors = { ...current }
      delete nextErrors[key]
      return nextErrors
    })
  }

  useEffect(() => {
    if (isCollapsible && !value.title && !value.date && !value.startTime && !value.memo) {
      setIsOpen(false)
      setCreateErrors({})
    }
  }, [isCollapsible, value])

  const focusField = (key: keyof QuickEventDraft) => {
    requestAnimationFrame(() => {
      const suffix = key === 'startTime' ? 'time' : key
      const field = document.getElementById(`${prefix}-${suffix}`)
      field?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      field?.focus()
    })
  }

  const requestCreate = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const errors: Partial<Record<keyof QuickEventDraft, string>> = {}
    if (!value.title.trim()) errors.title = 'イベント名を入力してください。'
    if (!value.date) errors.date = '開催日を入力してください。'
    if (value.startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.startTime)) errors.startTime = '開始時刻を正しく入力してください。'
    if (value.memo.length > 500) errors.memo = 'メモは500文字以内で入力してください。'
    const firstError = (['title', 'date', 'startTime', 'memo'] as const).find((key) => errors[key])
    if (firstError) {
      setCreateErrors(errors)
      setIsOpen(true)
      focusField(firstError)
      return
    }
    setCreateErrors({})
    event.currentTarget.form?.querySelector<HTMLButtonElement>('.event-action-button.secondary')?.click()
  }

  const errorFor = (key: keyof QuickEventDraft) => createErrors[key]
  const describedBy = (key: keyof QuickEventDraft) => errorFor(key) ? `${prefix}-${key}-error` : undefined

  const fields = (
    <div className="inventory-quick-event-fields" aria-label="新しい即売会予定">
      <label htmlFor={`${prefix}-title`}>イベント名 <span className="required-label">必須</span>
        <input id={`${prefix}-title`} name={`${prefix}Title`} value={value.title} onChange={(event) => set('title', event.target.value)} maxLength={80} aria-invalid={Boolean(errorFor('title'))} aria-describedby={describedBy('title')} />
        {errorFor('title') && <span id={`${prefix}-title-error`} className="inventory-inline-error" role="alert">{errorFor('title')}</span>}
      </label>
      <label htmlFor={`${prefix}-date`}>開催日 <span className="required-label">必須</span>
        <input id={`${prefix}-date`} name={`${prefix}Date`} type="date" value={value.date} onChange={(event) => set('date', event.target.value)} aria-invalid={Boolean(errorFor('date'))} aria-describedby={describedBy('date')} />
        {errorFor('date') && <span id={`${prefix}-date-error`} className="inventory-inline-error" role="alert">{errorFor('date')}</span>}
      </label>
      <label htmlFor={`${prefix}-time`}>開始時刻（任意）
        <input id={`${prefix}-time`} name={`${prefix}Time`} type="time" value={value.startTime} onChange={(event) => set('startTime', event.target.value)} aria-invalid={Boolean(errorFor('startTime'))} aria-describedby={describedBy('startTime')} />
        {errorFor('startTime') && <span id={`${prefix}-startTime-error`} className="inventory-inline-error" role="alert">{errorFor('startTime')}</span>}
      </label>
      <label htmlFor={`${prefix}-memo`}>メモ（任意）
        <textarea id={`${prefix}-memo`} name={`${prefix}Memo`} value={value.memo} onChange={(event) => set('memo', event.target.value)} maxLength={500} aria-invalid={Boolean(errorFor('memo'))} aria-describedby={describedBy('memo')} />
        {errorFor('memo') && <span id={`${prefix}-memo-error`} className="inventory-inline-error" role="alert">{errorFor('memo')}</span>}
      </label>
      <small>カテゴリは「即売会」で作成され、通常のカレンダーにも保存されます。</small>
    </div>
  )

  if (!isCollapsible) return <div className="inventory-quick-event">{fields}</div>

  const panelId = `${prefix}-quick-create`
  return (
    <div className={`inventory-quick-event-disclosure${isOpen ? ' is-open' : ''}`}>
      <button
        type="button"
        className="inventory-quick-event-toggle"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span>新しい即売会予定を作る</span>
        <CaretDownIcon size={18} weight="bold" aria-hidden="true" />
      </button>
      {isOpen && <div id={panelId} className="inventory-quick-event-panel">
        {fields}
        <div className="inventory-quick-event-actions">
          <button
            type="button"
            className="health-primary-button inventory-quick-event-create"
            onClick={requestCreate}
          >
            この内容で即売会予定を作成
          </button>
        </div>
      </div>}
    </div>
  )
}
