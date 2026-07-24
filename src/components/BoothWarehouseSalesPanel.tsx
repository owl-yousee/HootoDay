import { useMemo, useRef, useState, type FormEvent } from 'react'
import type { BoothWarehouseSaleRecord, Product } from '../types/inventory'
import { calculateAllProductStocks } from '../utils/inventoryCalculation'
import type { InventoryMovement } from '../types/inventory'
import { createUuidV4 } from '../utils/uuid'
import { toDateKey } from '../utils/date'

interface Props {
  products: Product[]
  movements: InventoryMovement[]
  records: BoothWarehouseSaleRecord[]
  onSave: (record: BoothWarehouseSaleRecord, expectedExistingId?: string | null) => string | null
  onDelete: (id: string) => string | null
  onEditingStateChange?: (editing: boolean) => void
}

const money = (value: number) => `${value.toLocaleString('ja-JP')}円`

export function BoothWarehouseSalesPanel(props: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [editing, setEditing] = useState<BoothWarehouseSaleRecord | null>(null)
  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [customerUnitPrice, setCustomerUnitPrice] = useState('')
  const [receiptUnitPrice, setReceiptUnitPrice] = useState('')
  const [error, setError] = useState('')
  const stocks = calculateAllProductStocks(props.products, props.movements)
  const activeProducts = props.products.filter((product) => product.isActive)
  const sortedRecords = useMemo(() => [...props.records].sort((a, b) =>
    b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt)
  ), [props.records])
  const totals = useMemo(() => props.records.reduce((sum, record) => ({
    quantity: sum.quantity + record.quantity,
    receipt: sum.receipt + record.quantity * record.receiptUnitPriceSnapshot,
  }), { quantity: 0, receipt: 0 }), [props.records])
  const selectedProduct = props.products.find((product) => product.id === productId)
  const receiptTotal = Number.isInteger(Number(quantity)) && Number(quantity) >= 1 &&
    Number.isInteger(Number(receiptUnitPrice)) && Number(receiptUnitPrice) >= 0
    ? Number(quantity) * Number(receiptUnitPrice)
    : 0

  const open = (record: BoothWarehouseSaleRecord | null = null) => {
    setEditing(record)
    setProductId(record?.productId ?? '')
    setQuantity(record ? String(record.quantity) : '')
    setCustomerUnitPrice(record ? String(record.customerUnitPriceSnapshot) : '')
    setReceiptUnitPrice(record ? String(record.receiptUnitPriceSnapshot) : '')
    setError('')
    props.onEditingStateChange?.(true)
    requestAnimationFrame(() => dialogRef.current?.showModal())
  }
  const close = () => {
    dialogRef.current?.close()
    setEditing(null)
    setError('')
    props.onEditingStateChange?.(false)
  }
  const selectProduct = (nextId: string) => {
    setProductId(nextId)
    if (editing) return
    const product = props.products.find((item) => item.id === nextId)
    setCustomerUnitPrice(product?.boothWarehouseCustomerUnitPrice === null ||
      product?.boothWarehouseCustomerUnitPrice === undefined ? '' : String(product.boothWarehouseCustomerUnitPrice))
    setReceiptUnitPrice(product?.boothWarehouseReceiptUnitPrice === null ||
      product?.boothWarehouseReceiptUnitPrice === undefined ? '' : String(product.boothWarehouseReceiptUnitPrice))
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const product = props.products.find((item) => item.id === productId)
    const date = String(data.get('date') ?? '')
    const memo = String(data.get('memo') ?? '').trim()
    const nextQuantity = Number(quantity)
    const nextCustomerUnitPrice = Number(customerUnitPrice)
    const nextReceiptUnitPrice = Number(receiptUnitPrice)
    if (!product) return setError('商品を選択してください。')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00`))) {
      return setError('日付を入力してください。')
    }
    if (!/^\d+$/.test(quantity) || !/^\d+$/.test(customerUnitPrice) || !/^\d+$/.test(receiptUnitPrice)) {
      return setError('数量は1以上、価格と受取単価は0以上の整数で入力してください。')
    }
    if (![nextQuantity, nextCustomerUnitPrice, nextReceiptUnitPrice].every(Number.isSafeInteger) ||
      nextQuantity < 1 || nextCustomerUnitPrice < 0 || nextReceiptUnitPrice < 0) {
      return setError('数量は1以上、価格と受取単価は0以上の整数で入力してください。')
    }
    if (memo.length > 500) return setError('メモは500文字以内で入力してください。')
    const id = editing?.id ?? createUuidV4()
    if (!id) return setError('保存に必要なIDを作成できませんでした。入力内容は変更されていません。')
    const now = new Date().toISOString()
    const result = props.onSave({
      id,
      date,
      productId: editing?.productId ?? product.id,
      productNameSnapshot: editing?.productNameSnapshot ?? product.name,
      customerUnitPriceSnapshot: nextCustomerUnitPrice,
      receiptUnitPriceSnapshot: nextReceiptUnitPrice,
      quantity: nextQuantity,
      memo,
      createdAt: editing?.createdAt ?? now,
      updatedAt: now,
    }, editing?.id ?? null)
    if (result) return setError(result)
    close()
  }

  return <section className="inventory-section">
    <div className="inventory-section-heading">
      <div><h2>BOOTH倉庫</h2><p>倉庫販売の結果を入力します。注文番号や発送状態は使用しません。</p></div>
      <button type="button" className="health-primary-button" disabled={!activeProducts.length} onClick={() => open()}>倉庫販売を記録</button>
    </div>
    <div className="inventory-warehouse-totals">
      <span>累計販売 <strong>{totals.quantity.toLocaleString('ja-JP')}個</strong></span>
      <span>累計受取 <strong>{money(totals.receipt)}</strong></span>
    </div>
    {sortedRecords.map((record) => <article className="inventory-row inventory-warehouse-row" key={record.id}>
      <strong>{record.productNameSnapshot}</strong>
      <div className="inventory-booth-detail">
        <span>{record.date}・{record.quantity.toLocaleString('ja-JP')}個</span>
        <small>販売価格 {money(record.customerUnitPriceSnapshot)} / 受取単価 {money(record.receiptUnitPriceSnapshot)}</small>
        {record.memo && <small>{record.memo}</small>}
      </div>
      <strong>{money(record.quantity * record.receiptUnitPriceSnapshot)}</strong>
      <div className="inventory-row-actions">
        <button type="button" onClick={() => open(record)}>編集</button>
        <button type="button" className="inventory-danger-button" onClick={() => {
          if (!window.confirm('このBOOTH倉庫販売記録を削除しますか？在庫も復元されます。')) return
          const result = props.onDelete(record.id)
          if (result) window.alert(result)
        }}>削除</button>
      </div>
    </article>)}
    {!sortedRecords.length && <p className="inventory-empty">BOOTH倉庫販売の記録はありません。</p>}
    <dialog ref={dialogRef} className="inventory-dialog" onCancel={(event) => { event.preventDefault(); close() }}>
      <form onSubmit={submit} noValidate>
        <header><div><p className="eyebrow">Inventory</p><h2>{editing ? 'BOOTH倉庫販売を編集' : 'BOOTH倉庫販売を記録'}</h2></div><button type="button" aria-label="ダイアログを閉じる" onClick={close}>×</button></header>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="inventory-form-grid">
          <label>日付<input name="date" type="date" required defaultValue={editing?.date ?? toDateKey(new Date())}/></label>
          <label>商品<select name="productId" required value={productId} disabled={Boolean(editing)} onChange={(event) => selectProduct(event.target.value)}><option value="">選択してください</option>{activeProducts.concat(editing && !activeProducts.some((item) => item.id === editing.productId) && selectedProduct ? [selectedProduct] : []).map((product) => <option key={product.id} value={product.id}>{product.name}（在庫 {stocks.get(product.id) ?? 0}）</option>)}</select></label>
          <label>数量<input name="quantity" type="number" min="1" step="1" inputMode="numeric" autoComplete="off" required value={quantity} onChange={(event) => setQuantity(event.target.value)}/></label>
          <label>購入者向け販売価格<input name="customerUnitPrice" type="number" min="0" step="1" inputMode="numeric" autoComplete="off" required value={customerUnitPrice} onChange={(event) => setCustomerUnitPrice(event.target.value)}/></label>
          <label>受取単価<input name="receiptUnitPrice" type="number" min="0" step="1" inputMode="numeric" autoComplete="off" required value={receiptUnitPrice} onChange={(event) => setReceiptUnitPrice(event.target.value)}/></label>
          <label>受取総額<input value={receiptTotal.toLocaleString('ja-JP')} readOnly aria-label="受取総額"/></label>
          <label className="inventory-wide">メモ<textarea name="memo" maxLength={500} defaultValue={editing?.memo}/></label>
        </div>
        <footer><button type="button" onClick={close}>キャンセル</button><button className="health-primary-button" type="submit">保存</button></footer>
      </form>
    </dialog>
  </section>
}
