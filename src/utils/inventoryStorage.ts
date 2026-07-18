import type { BoothSalesRecord, EventSalesRecord, InventoryMovement, InventoryMovementType, Product } from '../types/inventory'
import { fromDateKey } from './date'

export const PRODUCTS_STORAGE_KEY = 'hootoDay.products'
export const INVENTORY_MOVEMENTS_STORAGE_KEY = 'hootoDay.inventoryMovements'
export const EVENT_SALES_STORAGE_KEY = 'hootoDay.eventSalesRecords'
export const BOOTH_SALES_STORAGE_KEY = 'hootoDay.boothSalesRecords'
export const INVENTORY_STORAGE_VERSION = 1
const movementTypes: InventoryMovementType[] = ['restock','eventSale','eventSample','boothSale','boothCancellation','return','adjustmentIncrease','adjustmentDecrease']
const statuses = ['pending','shipped','cancelled']
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max
const integer = (v: unknown, min = 0) => typeof v === 'number' && Number.isInteger(v) && v >= min
const nullableInteger = (v: unknown) => v === null || integer(v)
const nullableId = (v: unknown) => v === null || (typeof v === 'string' && Boolean(v.trim()))

export function isProduct(v: unknown): v is Product { return object(v) && typeof v.id === 'string' && Boolean(v.id.trim()) && text(v.name,100) && Boolean(String(v.name).trim()) && nullableInteger(v.defaultPrice) && integer(v.initialStock) && text(v.category,100) && text(v.memo,1000) && (v.firstSaleEventId === undefined || nullableId(v.firstSaleEventId)) && typeof v.isActive === 'boolean' && typeof v.boothEnabled === 'boolean' && text(v.boothDisplayName,100) && nullableInteger(v.boothDefaultPrice) && nullableInteger(v.boothListingQuantity) && text(v.boothUrl,500) && (!v.boothUrl || /^https?:\/\//.test(String(v.boothUrl))) && iso(v.createdAt) && iso(v.updatedAt) }
export function isMovement(v: unknown): v is InventoryMovement { return object(v) && typeof v.id === 'string' && Boolean(v.id.trim()) && typeof v.productId === 'string' && Boolean(v.productId.trim()) && typeof v.date === 'string' && Boolean(fromDateKey(v.date)) && movementTypes.includes(v.type as InventoryMovementType) && integer(v.quantity,1) && nullableId(v.eventSalesRecordId) && nullableId(v.boothSalesRecordId) && text(v.memo,500) && iso(v.createdAt) }
export function isEventSale(v: unknown): v is EventSalesRecord { if(!object(v) || typeof v.id !== 'string' || !v.id.trim() || typeof v.eventId !== 'string' || !v.eventId.trim() || typeof v.productId !== 'string' || !v.productId.trim() || !text(v.productNameSnapshot,100) || !integer(v.unitPriceSnapshot) || !integer(v.broughtQuantity) || !text(v.memo,500) || !iso(v.updatedAt)) return false; const status=v.status===undefined?'completed':v.status; if(status==='planned') return v.soldQuantity===null&&v.sampleQuantity===null; return status==='completed'&&integer(v.soldQuantity)&&integer(v.sampleQuantity)&&Number(v.soldQuantity)+Number(v.sampleQuantity)<=Number(v.broughtQuantity) }
export function isBoothSale(v: unknown): v is BoothSalesRecord { return object(v) && typeof v.id === 'string' && Boolean(v.id.trim()) && typeof v.date === 'string' && Boolean(fromDateKey(v.date)) && typeof v.productId === 'string' && Boolean(v.productId.trim()) && text(v.productNameSnapshot,100) && integer(v.unitPriceSnapshot) && integer(v.quantity,1) && text(v.orderReference,100) && statuses.includes(String(v.status)) && text(v.memo,500) && iso(v.createdAt) && iso(v.updatedAt) }

function load<T>(key: string, validate: (v: unknown) => v is T): T[] { try { const raw=localStorage.getItem(key); if(!raw)return []; const parsed:unknown=JSON.parse(raw); if(!object(parsed)||parsed.version!==1||!Array.isArray(parsed.records))return []; const map=new Map<string,T>(); parsed.records.filter(validate).forEach((item)=>{ const id=(item as {id:string}).id; const current=map.get(id) as ({updatedAt?:string})|undefined; const next=item as ({updatedAt?:string}); if(!current || !current.updatedAt || !next.updatedAt || next.updatedAt>=current.updatedAt) map.set(id,item) }); return [...map.values()] } catch { console.warn('販売・在庫データを読み込めませんでした。画面上の操作は継続します。'); return [] } }
function save<T>(key:string, records:T[]):void { try { localStorage.setItem(key,JSON.stringify({version:1,records})) } catch { console.warn('販売・在庫データを保存できませんでした。画面上の操作は継続します。') } }
export const loadProducts=()=>load(PRODUCTS_STORAGE_KEY,isProduct).map(product=>({...product,firstSaleEventId:product.firstSaleEventId??null})); export const saveProducts=(v:Product[])=>save(PRODUCTS_STORAGE_KEY,v)
export const loadInventoryMovements=()=>load(INVENTORY_MOVEMENTS_STORAGE_KEY,isMovement); export const saveInventoryMovements=(v:InventoryMovement[])=>save(INVENTORY_MOVEMENTS_STORAGE_KEY,v)
export const loadEventSalesRecords=()=>load(EVENT_SALES_STORAGE_KEY,isEventSale).map(record=>({...record,status:record.status??'completed'} as EventSalesRecord)); export const saveEventSalesRecords=(v:EventSalesRecord[])=>save(EVENT_SALES_STORAGE_KEY,v)
export const loadBoothSalesRecords=()=>load(BOOTH_SALES_STORAGE_KEY,isBoothSale); export const saveBoothSalesRecords=(v:BoothSalesRecord[])=>save(BOOTH_SALES_STORAGE_KEY,v)
