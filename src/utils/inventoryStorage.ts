import type {
  AnniversaryCampaign,
  AnniversaryShipment,
  AnniversaryShipmentStatus,
  BoothSalesRecord,
  BoothWarehouseSaleRecord,
  EventSalesRecord,
  InventoryMovement,
  InventoryMovementType,
  Product,
} from '../types/inventory'
import { fromDateKey } from './date'

export const PRODUCTS_STORAGE_KEY = 'hootoDay.products'
export const INVENTORY_MOVEMENTS_STORAGE_KEY = 'hootoDay.inventoryMovements'
export const EVENT_SALES_STORAGE_KEY = 'hootoDay.eventSalesRecords'
export const BOOTH_SALES_STORAGE_KEY = 'hootoDay.boothSalesRecords'
export const BOOTH_WAREHOUSE_SALES_STORAGE_KEY = 'hootoDay.boothWarehouseSalesRecords'
export const ANNIVERSARY_CAMPAIGNS_STORAGE_KEY = 'hootoDay.anniversaryCampaigns'
export const ANNIVERSARY_SHIPMENTS_STORAGE_KEY = 'hootoDay.anniversaryShipments'
export const INVENTORY_STORAGE_VERSION = 2

const movementTypes: InventoryMovementType[] = ['restock','eventSale','eventSample','boothSale','boothCancellation','boothWarehouseSale','return','adjustmentIncrease','adjustmentDecrease']
const boothStatuses = ['pending','shipped','cancelled']
const anniversaryStatuses: AnniversaryShipmentStatus[] = ['unprepared','preparing','prepared','not_shipped','shipped']
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const iso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
const dateKey = (value: unknown): value is string => typeof value === 'string' && Boolean(fromDateKey(value))
const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max
const nonEmptyText = (value: unknown, max: number) => text(value,max) && Boolean(String(value).trim())
const nonEmptyId = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim())
const integer = (value: unknown, min = 0) => typeof value === 'number' && Number.isInteger(value) && value >= min
const nullableInteger = (value: unknown) => value === null || integer(value)
const nullableId = (value: unknown) => value === null || nonEmptyId(value)
const nullableDateKey = (value: unknown) => value === null || dateKey(value)
const nullableIso = (value: unknown) => value === null || iso(value)
const writeBlockedKeys = new Set<string>()

export function hasInventoryStorageWriteBlock(): boolean {
  return writeBlockedKeys.size > 0
}

export function isProduct(value: unknown): value is Product {
  return object(value) && nonEmptyId(value.id) && nonEmptyText(value.name,100) &&
    nullableInteger(value.defaultPrice) && integer(value.initialStock) && text(value.category,100) && text(value.memo,1000) &&
    nullableId(value.firstSaleEventId) && typeof value.isActive === 'boolean' && typeof value.boothEnabled === 'boolean' &&
    text(value.boothDisplayName,100) && nullableInteger(value.boothDefaultPrice) && nullableInteger(value.boothListingQuantity) &&
    text(value.boothUrl,500) && (!value.boothUrl || /^https?:\/\//.test(String(value.boothUrl))) &&
    nullableInteger(value.boothWarehouseCustomerUnitPrice) && nullableInteger(value.boothWarehouseReceiptUnitPrice) &&
    iso(value.createdAt) && iso(value.updatedAt)
}

export function isMovement(value: unknown): value is InventoryMovement {
  return object(value) && nonEmptyId(value.id) && nonEmptyId(value.productId) && dateKey(value.date) &&
    movementTypes.includes(value.type as InventoryMovementType) && integer(value.quantity,1) &&
    nullableId(value.eventSalesRecordId) && nullableId(value.boothSalesRecordId) && nullableId(value.boothWarehouseSalesRecordId) &&
    text(value.memo,500) && iso(value.createdAt)
}

export function isEventSale(value: unknown): value is EventSalesRecord {
  if (!object(value) || !nonEmptyId(value.id) || !nonEmptyId(value.eventId) || !nonEmptyId(value.productId) ||
    !text(value.productNameSnapshot,100) || !integer(value.unitPriceSnapshot) || !integer(value.broughtQuantity) ||
    !text(value.memo,500) || !iso(value.updatedAt)) return false
  if (value.status === 'planned') return value.soldQuantity === null && value.sampleQuantity === null
  return value.status === 'completed' && integer(value.soldQuantity) && integer(value.sampleQuantity) &&
    Number(value.soldQuantity) + Number(value.sampleQuantity) <= Number(value.broughtQuantity)
}

export function isBoothSale(value: unknown): value is BoothSalesRecord {
  return object(value) && nonEmptyId(value.id) && dateKey(value.date) && nonEmptyId(value.productId) &&
    text(value.productNameSnapshot,100) && integer(value.unitPriceSnapshot) && integer(value.quantity,1) &&
    text(value.orderReference,100) && boothStatuses.includes(String(value.status)) && nullableInteger(value.shippingFee) &&
    nullableDateKey(value.shippedAt) &&
    text(value.memo,500) && iso(value.createdAt) && iso(value.updatedAt)
}

export function isBoothWarehouseSale(value: unknown): value is BoothWarehouseSaleRecord {
  return object(value) && nonEmptyId(value.id) && dateKey(value.date) && nonEmptyId(value.productId) &&
    nonEmptyText(value.productNameSnapshot,100) && integer(value.customerUnitPriceSnapshot) &&
    integer(value.receiptUnitPriceSnapshot) && integer(value.quantity,1) && text(value.memo,500) &&
    iso(value.createdAt) && iso(value.updatedAt)
}

export function isAnniversaryCampaign(value: unknown): value is AnniversaryCampaign {
  return object(value) && nonEmptyId(value.id) && integer(value.year,1000) && Number(value.year) <= 9999 &&
    nonEmptyText(value.name,100) && nullableIso(value.completedAt) && iso(value.createdAt) && iso(value.updatedAt)
}

export function isAnniversaryShipment(value: unknown): value is AnniversaryShipment {
  return object(value) && nonEmptyId(value.id) && nonEmptyId(value.campaignId) &&
    nonEmptyText(value.fanboxPlan,100) && nonEmptyText(value.destinationNumber,100) &&
    nonEmptyText(value.itemDescription,500) && integer(value.quantity,1) &&
    anniversaryStatuses.includes(value.status as AnniversaryShipmentStatus) && nullableDateKey(value.shippedAt) &&
    text(value.memo,500) &&
    iso(value.createdAt) && iso(value.updatedAt)
}

function isProductV1(value: unknown): value is Omit<Product,'boothWarehouseCustomerUnitPrice'|'boothWarehouseReceiptUnitPrice'> {
  return object(value) && nonEmptyId(value.id) && nonEmptyText(value.name,100) &&
    nullableInteger(value.defaultPrice) && integer(value.initialStock) && text(value.category,100) && text(value.memo,1000) &&
    (value.firstSaleEventId === undefined || nullableId(value.firstSaleEventId)) &&
    typeof value.isActive === 'boolean' && typeof value.boothEnabled === 'boolean' &&
    text(value.boothDisplayName,100) && nullableInteger(value.boothDefaultPrice) && nullableInteger(value.boothListingQuantity) &&
    text(value.boothUrl,500) && (!value.boothUrl || /^https?:\/\//.test(String(value.boothUrl))) &&
    iso(value.createdAt) && iso(value.updatedAt)
}

function isMovementV1(value: unknown): value is Omit<InventoryMovement,'boothWarehouseSalesRecordId'> {
  const v1Types: InventoryMovementType[] = movementTypes.filter((type) => type !== 'boothWarehouseSale')
  return object(value) && nonEmptyId(value.id) && nonEmptyId(value.productId) && dateKey(value.date) &&
    v1Types.includes(value.type as InventoryMovementType) && integer(value.quantity,1) &&
    nullableId(value.eventSalesRecordId) && nullableId(value.boothSalesRecordId) &&
    text(value.memo,500) && iso(value.createdAt)
}

function isBoothSaleV1(value: unknown): value is Omit<BoothSalesRecord,'shippingFee'|'shippedAt'> {
  return object(value) && nonEmptyId(value.id) && dateKey(value.date) && nonEmptyId(value.productId) &&
    text(value.productNameSnapshot,100) && integer(value.unitPriceSnapshot) && integer(value.quantity,1) &&
    text(value.orderReference,100) && boothStatuses.includes(String(value.status)) && text(value.memo,500) &&
    iso(value.createdAt) && iso(value.updatedAt)
}

export const migrateProductV1 = (value: unknown): Product | null =>
  isProductV1(value) ? { ...value, firstSaleEventId: value.firstSaleEventId ?? null, boothWarehouseCustomerUnitPrice: null, boothWarehouseReceiptUnitPrice: null } : null
export const migrateMovementV1 = (value: unknown): InventoryMovement | null =>
  isMovementV1(value) ? { ...value, boothWarehouseSalesRecordId: null } : null
export const migrateBoothSaleV1 = (value: unknown): BoothSalesRecord | null =>
  isBoothSaleV1(value) ? { ...value, shippingFee: null, shippedAt: null } : null

function deduplicate<T>(records: T[]): T[] {
  const map = new Map<string,T>()
  records.forEach((item) => {
    const id = (item as {id:string}).id
    const current = map.get(id) as ({updatedAt?:string})|undefined
    const next = item as ({updatedAt?:string})
    if (!current || !current.updatedAt || !next.updatedAt || next.updatedAt >= current.updatedAt) map.set(id,item)
  })
  return [...map.values()]
}

function load<T>(key: string, validate: (value: unknown) => value is T, migrateV1?: (value: unknown) => T | null): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!object(parsed) || !Array.isArray(parsed.records)) {
      writeBlockedKeys.add(key)
      return []
    }
    if (parsed.version === INVENTORY_STORAGE_VERSION) {
      if (!parsed.records.every(validate)) {
        writeBlockedKeys.add(key)
        return []
      }
      return deduplicate(parsed.records)
    }
    if (parsed.version === 1 && migrateV1) {
      const migrated = parsed.records.map(migrateV1)
      if (migrated.some((item) => item === null)) {
        writeBlockedKeys.add(key)
        return []
      }
      return deduplicate(migrated as T[])
    }
    writeBlockedKeys.add(key)
    return []
  } catch {
    writeBlockedKeys.add(key)
    console.warn('販売・在庫データを読み込めませんでした。画面上の操作は継続します。')
    return []
  }
}

function save<T>(key: string, records: T[]): void {
  if (writeBlockedKeys.has(key)) {
    console.warn('検証に失敗した販売・在庫データを上書きしないため、保存を停止しました。')
    return
  }
  try {
    localStorage.setItem(key,JSON.stringify({version:INVENTORY_STORAGE_VERSION,records}))
  } catch {
    console.warn('販売・在庫データを保存できませんでした。画面上の操作は継続します。')
  }
}

export const loadProducts = () => load(PRODUCTS_STORAGE_KEY,isProduct,migrateProductV1)
export const saveProducts = (records: Product[]) => save(PRODUCTS_STORAGE_KEY,records)
export const loadInventoryMovements = () => load(INVENTORY_MOVEMENTS_STORAGE_KEY,isMovement,migrateMovementV1)
export const saveInventoryMovements = (records: InventoryMovement[]) => save(INVENTORY_MOVEMENTS_STORAGE_KEY,records)
export const loadEventSalesRecords = () => load(EVENT_SALES_STORAGE_KEY,isEventSale,(value) => {
  if (!object(value)) return null
  const migrated = { ...value, status: value.status ?? 'completed' }
  return isEventSale(migrated) ? migrated : null
})
export const saveEventSalesRecords = (records: EventSalesRecord[]) => save(EVENT_SALES_STORAGE_KEY,records)
export const loadBoothSalesRecords = () => load(BOOTH_SALES_STORAGE_KEY,isBoothSale,migrateBoothSaleV1)
export const saveBoothSalesRecords = (records: BoothSalesRecord[]) => save(BOOTH_SALES_STORAGE_KEY,records)
export const loadBoothWarehouseSalesRecords = () => load(BOOTH_WAREHOUSE_SALES_STORAGE_KEY,isBoothWarehouseSale)
export const saveBoothWarehouseSalesRecords = (records: BoothWarehouseSaleRecord[]) => save(BOOTH_WAREHOUSE_SALES_STORAGE_KEY,records)
export const loadAnniversaryCampaigns = () => load(ANNIVERSARY_CAMPAIGNS_STORAGE_KEY,isAnniversaryCampaign)
export const saveAnniversaryCampaigns = (records: AnniversaryCampaign[]) => save(ANNIVERSARY_CAMPAIGNS_STORAGE_KEY,records)
export const loadAnniversaryShipments = () => load(ANNIVERSARY_SHIPMENTS_STORAGE_KEY,isAnniversaryShipment)
export const saveAnniversaryShipments = (records: AnniversaryShipment[]) => save(ANNIVERSARY_SHIPMENTS_STORAGE_KEY,records)
