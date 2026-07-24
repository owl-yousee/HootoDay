import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CalendarEvent } from '../types/calendar'
import type { EventSalesRecord, EventSalesStatus, Product } from '../types/inventory'
import type {
  EventSalesBatchDraftRow,
  EventSalesBatchRowErrors,
} from '../utils/inventoryEventSalesBatch'
import { createUuidV4 } from '../utils/uuid'

type SaveResult =
  | { status: 'saved' }
  | { status: 'invalid'; errors: Record<string, EventSalesBatchRowErrors> }
  | { status: 'storage_error'; storageStatus: string }

type Props = {
  open: boolean
  mode: 'create' | 'complete'
  products: Product[]
  events: CalendarEvent[]
  records: EventSalesRecord[]
  initialEventId: string
  onClose: () => void
  onSave: (input: {
    eventId: string
    eventDate: string
    status: EventSalesStatus
    rows: EventSalesBatchDraftRow[]
    requirePlannedRecords?: boolean
  }) => SaveResult
}

const emptyRow = (): EventSalesBatchDraftRow | null => {
  const rowId = createUuidV4()
  return rowId ? {
    rowId, existingRecordId: null, productId: '', broughtQuantity: '',
    soldQuantity: '0', sampleQuantity: '0', unitPrice: '', memo: '',
  } : null
}

const recordRow = (record: EventSalesRecord): EventSalesBatchDraftRow => ({
  rowId: `record:${record.id}`,
  existingRecordId: record.id,
  productId: record.productId,
  broughtQuantity: String(record.broughtQuantity),
  soldQuantity: String(record.soldQuantity ?? 0),
  sampleQuantity: String(record.sampleQuantity ?? 0),
  unitPrice: String(record.unitPriceSnapshot),
  memo: record.memo,
})

export function EventSalesBatchDialog(props: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const submittingRef = useRef(false)
  const [eventId, setEventId] = useState(props.initialEventId)
  const [status, setStatus] = useState<EventSalesStatus>('planned')
  const [rows, setRows] = useState<EventSalesBatchDraftRow[]>([])
  const [errors, setErrors] = useState<Record<string, EventSalesBatchRowErrors>>({})
  const [summaryError, setSummaryError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const loadEvent = useCallback((nextEventId: string) => {
    setEventId(nextEventId)
    const existing = props.records.filter((record) =>
      record.eventId === nextEventId && (props.mode !== 'complete' || record.status === 'planned'))
    setRows(existing.length ? existing.map(recordRow) : [emptyRow()].filter(Boolean) as EventSalesBatchDraftRow[])
    setStatus(props.mode === 'complete' ? 'completed' : existing.length && existing.every((record) => record.status === 'completed') ? 'completed' : 'planned')
    setErrors({})
    setSummaryError('')
    submittingRef.current = false
    setSubmitting(false)
  }, [props.mode, props.records])

  useEffect(() => {
    if (!props.open) return
    loadEvent(props.initialEventId)
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    const y = window.scrollY
    const previous = { position: document.body.style.position, top: document.body.style.top, width: document.body.style.width }
    document.body.style.position = 'fixed'
    document.body.style.top = `-${y}px`
    document.body.style.width = '100%'
    return () => {
      document.body.style.position = previous.position
      document.body.style.top = previous.top
      document.body.style.width = previous.width
      window.scrollTo({ top: y, behavior: 'auto' })
    }
  }, [props.open, props.initialEventId, loadEvent])

  const totals = useMemo(() => {
    let valid = true
    const value = rows.reduce((sum, row) => {
      const soldValid = /^\d+$/.test(row.soldQuantity)
      const sampleValid = /^\d+$/.test(row.sampleQuantity)
      const priceValid = /^\d+$/.test(row.unitPrice)
      valid = valid && soldValid && sampleValid && priceValid
      const sold = soldValid ? Number(row.soldQuantity) : 0
      const sample = sampleValid ? Number(row.sampleQuantity) : 0
      const price = priceValid ? Number(row.unitPrice) : 0
      return { sold: sum.sold + sold, sample: sum.sample + sample, amount: sum.amount + sold * price }
    }, { sold: 0, sample: 0, amount: 0 })
    return { ...value, valid }
  }, [rows])

  if (!props.open) return null
  const selectedProducts = new Set(rows.map((row) => row.productId).filter(Boolean))
  const update = (rowId: string, patch: Partial<EventSalesBatchDraftRow>) => {
    setRows((current) => current.map((row) => row.rowId === rowId ? { ...row, ...patch } : row))
    setErrors((current) => {
      const next = { ...current }
      delete next[rowId]
      return next
    })
    setSummaryError('')
  }
  const close = () => {
    if (submittingRef.current) return
    dialogRef.current?.close()
    props.onClose()
  }
  const add = () => {
    const row = emptyRow()
    if (!row) {
      setSummaryError('商品行のIDを作成できませんでした。')
      return
    }
    setRows((current) => [...current, row])
  }
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (submittingRef.current) return
    const selectedEvent = props.events.find((item) => item.id === eventId)
    if (!selectedEvent) {
      setSummaryError('イベントを選択してください。')
      return
    }
    if (!rows.length) {
      setSummaryError('商品を1件以上追加してください。')
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    try {
      const result = props.onSave({ eventId, eventDate: selectedEvent.date, status, rows, requirePlannedRecords: props.mode === 'complete' })
      if (result.status === 'saved') {
        submittingRef.current = false
        dialogRef.current?.close()
        props.onClose()
        return
      }
      if (result.status === 'invalid') {
        setErrors(result.errors)
        setSummaryError(`${props.mode === 'complete' ? '実績を確定' : '保存'}できませんでした。${Object.keys(result.errors).length}件の入力内容を確認してください。`)
        requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.scrollIntoView({ block: 'center' }))
      } else {
        setSummaryError('保存に失敗しました。入力内容は変更されていません。')
      }
    } catch {
      setSummaryError('保存に失敗しました。入力内容は変更されていません。')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }
  return <dialog ref={dialogRef} className="inventory-dialog inventory-event-batch-dialog" onCancel={(event) => { event.preventDefault(); close() }}>
    <form onSubmit={submit} noValidate>
      <header><div><p className="eyebrow">Inventory</p><h2>{props.mode === 'complete' ? '販売実績をまとめて入力' : props.records.some((record) => record.eventId === eventId) ? '販売実績をまとめて編集' : 'イベント商品をまとめて登録'}</h2></div><button type="button" aria-label="閉じる" onClick={close}>×</button></header>
      {summaryError && <p className="form-error" role="alert">{summaryError}</p>}
      <label className="inventory-batch-event">イベント<select value={eventId} disabled={props.mode === 'complete'} onChange={(event) => loadEvent(event.target.value)}><option value="">選択してください</option>{props.events.map((item) => <option key={item.id} value={item.id}>{item.date} {item.title}</option>)}</select></label>
      {props.mode === 'complete' ? <p className="inventory-batch-mode">準備中の商品をまとめて実績確定します。</p> : <fieldset className="inventory-fieldset inventory-status-choice"><legend>記録状態</legend><label className="inventory-check"><input type="radio" checked={status === 'planned'} onChange={() => setStatus('planned')}/>準備中</label><label className="inventory-check"><input type="radio" checked={status === 'completed'} onChange={() => setStatus('completed')}/>実績確定済み</label></fieldset>}
      <div className="inventory-batch-rows">{rows.map((row, index) => {
        const rowErrors = errors[row.rowId] ?? {}
        return <section className="inventory-batch-row" key={row.rowId}>
          <div className="inventory-batch-row-heading"><strong>商品 {index + 1}</strong><button type="button" disabled={Boolean(row.existingRecordId)} onClick={() => setRows((current) => current.filter((item) => item.rowId !== row.rowId))}>{row.existingRecordId ? '保存済み行' : '行を削除'}</button></div>
          {rowErrors.row && <p className="inventory-inline-error">{rowErrors.row}</p>}
          <div className="inventory-batch-grid">
            <label data-field-error={rowErrors.productId}>商品<select value={row.productId} aria-invalid={Boolean(rowErrors.productId)} onChange={(event) => {
              const next = props.products.find((item) => item.id === event.target.value)
              update(row.rowId, { productId: event.target.value, unitPrice: next?.defaultPrice === null || next?.defaultPrice === undefined ? '' : String(next.defaultPrice) })
            }}><option value="">選択してください</option>{props.products.filter((item) => item.isActive || item.id === row.productId).map((item) => <option key={item.id} value={item.id} disabled={item.id !== row.productId && selectedProducts.has(item.id)}>{item.name}</option>)}</select></label>
            {([
              ['broughtQuantity', '持込数'], ['soldQuantity', '販売数'], ['sampleQuantity', 'サンプル数'], ['unitPrice', '単価'],
            ] as const).map(([field, label]) => <label key={field} data-field-error={rowErrors[field]}>{label}<input value={row[field]} readOnly={props.mode === 'complete' && field === 'broughtQuantity'} inputMode="numeric" pattern="[0-9]*" aria-invalid={Boolean(rowErrors[field])} onChange={(event) => update(row.rowId, { [field]: event.target.value })}/></label>)}
            <label className="inventory-wide">メモ<textarea value={row.memo} maxLength={500} onChange={(event) => update(row.rowId, { memo: event.target.value })}/></label>
          </div>
          {props.mode === 'complete' && <p className="inventory-batch-remaining">残数：{(/^\d+$/.test(row.broughtQuantity) && /^\d+$/.test(row.soldQuantity) && /^\d+$/.test(row.sampleQuantity)) ? Number(row.broughtQuantity) - Number(row.soldQuantity) - Number(row.sampleQuantity) : '—'}個</p>}
        </section>
      })}</div>
      {props.mode === 'create' && <button type="button" className="inventory-batch-add" onClick={add}>商品を追加</button>}
      {status === 'completed' && <div className="inventory-batch-totals"><span>販売合計 <strong>{totals.valid ? `${totals.sold.toLocaleString('ja-JP')}個` : '—'}</strong></span><span>サンプル合計 <strong>{totals.valid ? `${totals.sample.toLocaleString('ja-JP')}個` : '—'}</strong></span><span>売上合計 <strong>{totals.valid ? `${totals.amount.toLocaleString('ja-JP')}円` : '—'}</strong></span></div>}
      <footer><button type="button" onClick={close}>キャンセル</button><button className="health-primary-button" type="submit" disabled={submitting}>{submitting ? (props.mode === 'complete' ? '確定中…' : '保存中…') : (props.mode === 'complete' ? '実績をまとめて確定' : 'まとめて保存')}</button></footer>
    </form>
  </dialog>
}
