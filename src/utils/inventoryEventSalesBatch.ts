import type { EventSalesRecord, EventSalesStatus, InventoryMovement, Product } from '../types/inventory'
import { calculateCurrentStock } from './inventoryCalculation'
import { isEventSale, isMovement } from './inventoryStorage'

export type EventSalesBatchDraftRow = {
  rowId: string
  existingRecordId: string | null
  productId: string
  broughtQuantity: string
  soldQuantity: string
  sampleQuantity: string
  unitPrice: string
  memo: string
}

export type EventSalesBatchField =
  | 'productId' | 'broughtQuantity' | 'soldQuantity' | 'sampleQuantity' | 'unitPrice' | 'row'

export type EventSalesBatchRowErrors = Partial<Record<EventSalesBatchField, string>>

export type EventSalesBatchPrepareResult =
  | { status: 'ready'; records: EventSalesRecord[]; movements: InventoryMovement[] }
  | { status: 'invalid'; errors: Record<string, EventSalesBatchRowErrors> }

type PrepareOptions = {
  eventId: string
  eventDate: string
  status: EventSalesStatus
  rows: EventSalesBatchDraftRow[]
  products: Product[]
  records: EventSalesRecord[]
  movements: InventoryMovement[]
  now: string
  createId: () => string | null
  requirePlannedRecords?: boolean
}

const wholeNumber = (value: string) =>
  /^\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value)) ? Number(value) : null

export function prepareEventSalesBatch(options: PrepareOptions): EventSalesBatchPrepareResult {
  const errors: Record<string, EventSalesBatchRowErrors> = {}
  const selected = new Set<string>()
  const recordsForEvent = options.records.filter((record) => record.eventId === options.eventId)
  const duplicateStoredProducts = new Set(
    recordsForEvent
      .filter((record, index, records) => records.findIndex((item) => item.productId === record.productId) !== index)
      .map((record) => record.productId),
  )
  const prepared: EventSalesRecord[] = []
  const generatedMovements: InventoryMovement[] = []

  for (const row of options.rows) {
    const rowErrors: EventSalesBatchRowErrors = {}
    const product = options.products.find((item) => item.id === row.productId)
    if (!row.productId) rowErrors.productId = '商品を選択してください。'
    else if (!product || !product.isActive) rowErrors.productId = '利用可能な商品を選択してください。'
    else if (selected.has(row.productId)) rowErrors.productId = '同じ商品を2回登録することはできません。'
    else if (duplicateStoredProducts.has(row.productId)) rowErrors.row = '同じイベント・商品に複数の保存済み記録があります。'
    selected.add(row.productId)

    const brought = wholeNumber(row.broughtQuantity)
    const sold = wholeNumber(row.soldQuantity)
    const sample = wholeNumber(row.sampleQuantity)
    const price = wholeNumber(row.unitPrice)
    if (brought === null) rowErrors.broughtQuantity = '持込数を0以上の整数で入力してください。'
    if (price === null) rowErrors.unitPrice = '単価を0以上の整数で入力してください。'
    if (options.status === 'completed') {
      if (sold === null) rowErrors.soldQuantity = '販売数を0以上の整数で入力してください。'
      if (sample === null) rowErrors.sampleQuantity = 'サンプル数を0以上の整数で入力してください。'
      if (brought !== null && sold !== null && sample !== null && sold + sample > brought) {
        rowErrors.row = `販売数${sold}個＋サンプル数${sample}個が、持込数${brought}個を超えています。`
      }
    }

    const existing = row.existingRecordId
      ? options.records.find((record) => record.id === row.existingRecordId)
      : null
    if (row.existingRecordId && (!existing || existing.eventId !== options.eventId || existing.productId !== row.productId)) {
      rowErrors.row = '編集対象の保存済み記録が見つかりません。'
    }
    if (options.requirePlannedRecords && existing?.status !== 'planned') {
      rowErrors.row = '対象の準備中記録が変更されています。画面を閉じて再確認してください。'
    }
    if (existing) {
      const related = options.movements.filter((movement) => movement.eventSalesRecordId === existing.id)
      const sales = related.filter((movement) => movement.type === 'eventSale' && movement.productId === existing.productId)
      const samples = related.filter((movement) => movement.type === 'eventSample' && movement.productId === existing.productId)
      const expectedSales = existing.status === 'completed' ? existing.soldQuantity ?? 0 : 0
      const expectedSamples = existing.status === 'completed' ? existing.sampleQuantity ?? 0 : 0
      const movementsMatch =
        related.length === sales.length + samples.length &&
        (expectedSales === 0 ? sales.length === 0 : sales.length === 1 && sales[0].quantity === expectedSales) &&
        (expectedSamples === 0 ? samples.length === 0 : samples.length === 1 && samples[0].quantity === expectedSamples)
      if (!movementsMatch) rowErrors.row = '保存済み記録と在庫履歴の対応を安全に確認できません。'
    }
    const conflicting = options.records.find((record) =>
      record.eventId === options.eventId && record.productId === row.productId &&
      record.id !== row.existingRecordId)
    if (conflicting) rowErrors.row = '同じイベント・商品の保存済み記録が既にあります。'

    if (product && options.status === 'completed' && sold !== null && sample !== null) {
      const oldUsed = existing?.status === 'completed'
        ? (existing.soldQuantity ?? 0) + (existing.sampleQuantity ?? 0)
        : 0
      const available = calculateCurrentStock(product, options.movements) + oldUsed
      if (sold + sample > available) {
        rowErrors.row = `販売・サンプル合計${sold + sample}個に対して、利用可能な在庫は${available}個です。`
      }
    }
    if (Object.keys(rowErrors).length) {
      errors[row.rowId] = rowErrors
      continue
    }

    const recordId = existing?.id ?? options.createId()
    if (!recordId) {
      errors[row.rowId] = { row: '保存に必要なIDを作成できませんでした。' }
      continue
    }
    const record: EventSalesRecord = {
      id: recordId,
      eventId: options.eventId,
      productId: row.productId,
      productNameSnapshot: existing?.productNameSnapshot ?? product!.name,
      unitPriceSnapshot: price!,
      broughtQuantity: brought!,
      soldQuantity: options.status === 'completed' ? sold! : null,
      sampleQuantity: options.status === 'completed' ? sample! : null,
      status: options.status,
      memo: row.memo.trim(),
      updatedAt: options.now,
    }
    if (!isEventSale(record)) {
      errors[row.rowId] = { row: '保存内容を安全に検証できませんでした。' }
      continue
    }
    prepared.push(record)
    if (options.status === 'completed' && sold! > 0) {
      const id = options.createId()
      if (!id) errors[row.rowId] = { row: '販売履歴IDを作成できませんでした。' }
      else generatedMovements.push({
        id, productId: record.productId, date: options.eventDate, type: 'eventSale',
        quantity: sold!, eventSalesRecordId: record.id, boothSalesRecordId: null,
        boothWarehouseSalesRecordId: null, memo: '', createdAt: options.now,
      })
    }
    if (options.status === 'completed' && sample! > 0) {
      const id = options.createId()
      if (!id) errors[row.rowId] = { row: 'サンプル履歴IDを作成できませんでした。' }
      else generatedMovements.push({
        id, productId: record.productId, date: options.eventDate, type: 'eventSample',
        quantity: sample!, eventSalesRecordId: record.id, boothSalesRecordId: null,
        boothWarehouseSalesRecordId: null, memo: '', createdAt: options.now,
      })
    }
  }
  if (Object.keys(errors).length) return { status: 'invalid', errors }

  const replacedIds = new Set(prepared.map((record) => record.id))
  const records = [
    ...options.records.filter((record) => !replacedIds.has(record.id)),
    ...prepared,
  ]
  const movements = [
    ...options.movements.filter((movement) =>
      !movement.eventSalesRecordId || !replacedIds.has(movement.eventSalesRecordId)),
    ...generatedMovements,
  ]
  if (!records.every(isEventSale) || !movements.every(isMovement)) {
    return { status: 'invalid', errors: { batch: { row: '保存後のデータを安全に検証できませんでした。' } } }
  }
  return { status: 'ready', records, movements }
}
