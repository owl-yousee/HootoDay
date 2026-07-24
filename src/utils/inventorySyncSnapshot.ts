import type {
  AnniversaryCampaign,
  AnniversaryShipment,
  BoothSalesRecord,
  BoothWarehouseSaleRecord,
  EventSalesRecord,
  InventoryMovement,
  Product,
} from '../types/inventory'
import {
  INVENTORY_SYNC_SNAPSHOT_SCHEMA_VERSION,
  type InventoryLocalDifferenceResult,
  type InventorySyncBaseline,
  type InventorySyncPendingOperation,
  type InventorySyncRemoteSnapshotResponse,
  type InventorySyncSaveRequest,
  type InventorySyncSaveResponse,
  type InventorySyncSnapshot,
} from '../types/inventorySync'
import {
  isAnniversaryCampaign,
  isAnniversaryShipment,
  isBoothSale,
  isBoothWarehouseSale,
  isEventSale,
  isMovement,
  isProduct,
} from './inventoryStorage'
import { isUuidV4 } from './uuid'

export type InventorySyncSnapshotInput = {
  workspaceId: string
  revision: number
  generatedAt?: string
  products: Product[]
  inventoryMovements: InventoryMovement[]
  eventSalesRecords: EventSalesRecord[]
  boothSalesRecords: BoothSalesRecord[]
  boothWarehouseSalesRecords: BoothWarehouseSaleRecord[]
  anniversaryCampaigns: AnniversaryCampaign[]
  anniversaryShipments: AnniversaryShipment[]
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && Boolean(value.trim())
const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
const iso = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))
const fingerprintPattern = /^inv-[0-9a-f]{16}$/

function cloneDefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function stableValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(stableValue)
  if (!object(value)) throw new TypeError('Unsupported inventory sync value')
  const result: { [key: string]: JsonValue } = {}
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) result[key] = stableValue(value[key])
  }
  return result
}

function sortedRecords<T extends { id: string }>(records: T[]): T[] {
  return records.map(cloneDefined).sort((left, right) => left.id.localeCompare(right.id))
}

export function createInventorySyncSnapshot(input: InventorySyncSnapshotInput): InventorySyncSnapshot {
  return {
    schemaVersion: INVENTORY_SYNC_SNAPSHOT_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    revision: input.revision,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    products: input.products.map(cloneDefined),
    inventoryMovements: input.inventoryMovements.map(cloneDefined),
    eventSalesRecords: input.eventSalesRecords.map(cloneDefined),
    boothSalesRecords: input.boothSalesRecords.map(cloneDefined),
    boothWarehouseSalesRecords: input.boothWarehouseSalesRecords.map(cloneDefined),
    anniversaryCampaigns: input.anniversaryCampaigns.map(cloneDefined),
    anniversaryShipments: input.anniversaryShipments.map(cloneDefined),
  }
}

export function canonicalizeInventorySyncSnapshot(snapshot: InventorySyncSnapshot): InventorySyncSnapshot {
  return {
    ...cloneDefined(snapshot),
    products: sortedRecords(snapshot.products),
    inventoryMovements: sortedRecords(snapshot.inventoryMovements),
    eventSalesRecords: sortedRecords(snapshot.eventSalesRecords),
    boothSalesRecords: sortedRecords(snapshot.boothSalesRecords),
    boothWarehouseSalesRecords: sortedRecords(snapshot.boothWarehouseSalesRecords),
    anniversaryCampaigns: sortedRecords(snapshot.anniversaryCampaigns),
    anniversaryShipments: sortedRecords(snapshot.anniversaryShipments),
  }
}

function canonicalContent(snapshot: InventorySyncSnapshot): string {
  const canonical = canonicalizeInventorySyncSnapshot(snapshot)
  return JSON.stringify(stableValue({
    schemaVersion: canonical.schemaVersion,
    workspaceId: canonical.workspaceId,
    products: canonical.products,
    inventoryMovements: canonical.inventoryMovements,
    eventSalesRecords: canonical.eventSalesRecords,
    boothSalesRecords: canonical.boothSalesRecords,
    boothWarehouseSalesRecords: canonical.boothWarehouseSalesRecords,
    anniversaryCampaigns: canonical.anniversaryCampaigns,
    anniversaryShipments: canonical.anniversaryShipments,
  }))
}

function hashPair(value: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x85ebca6b)
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

export function inventoryContentFingerprint(snapshot: InventorySyncSnapshot): string {
  return `inv-${hashPair(canonicalContent(snapshot))}`
}

export function inventorySnapshotFingerprint(snapshot: InventorySyncSnapshot): string {
  return `inv-${hashPair(JSON.stringify({
    contentFingerprint: inventoryContentFingerprint(snapshot),
    revision: snapshot.revision,
  }))}`
}

function uniqueIds(records: { id: string }[]): boolean {
  return new Set(records.map((record) => record.id)).size === records.length
}

function movementReferencesAreValid(
  movement: InventoryMovement,
  events: Map<string, EventSalesRecord>,
  boothSales: Map<string, BoothSalesRecord>,
  warehouseSales: Map<string, BoothWarehouseSaleRecord>,
): boolean {
  const noEvent = movement.eventSalesRecordId === null
  const noBooth = movement.boothSalesRecordId === null
  const noWarehouse = movement.boothWarehouseSalesRecordId === null
  if (movement.type === 'eventSale' || movement.type === 'eventSample') {
    const record = nonEmpty(movement.eventSalesRecordId) ? events.get(movement.eventSalesRecordId) : null
    return Boolean(record && record.productId === movement.productId) && noBooth && noWarehouse
  }
  if (movement.type === 'boothSale') {
    const record = nonEmpty(movement.boothSalesRecordId) ? boothSales.get(movement.boothSalesRecordId) : null
    return noEvent && Boolean(record && record.productId === movement.productId) && noWarehouse
  }
  if (movement.type === 'boothWarehouseSale') {
    const record = nonEmpty(movement.boothWarehouseSalesRecordId)
      ? warehouseSales.get(movement.boothWarehouseSalesRecordId)
      : null
    return noEvent && noBooth && Boolean(record && record.productId === movement.productId)
  }
  if (movement.type === 'boothCancellation') {
    const record = nonEmpty(movement.boothSalesRecordId) ? boothSales.get(movement.boothSalesRecordId) : null
    return noEvent && noWarehouse &&
      (noBooth || Boolean(record && record.productId === movement.productId && record.status === 'cancelled'))
  }
  return noEvent && noBooth && noWarehouse
}

function matchingMovements(
  movements: InventoryMovement[],
  type: InventoryMovement['type'],
  sourceId: string,
): InventoryMovement[] {
  return movements.filter((movement) => {
    if (movement.type !== type) return false
    if (type === 'eventSale' || type === 'eventSample') return movement.eventSalesRecordId === sourceId
    if (type === 'boothSale') return movement.boothSalesRecordId === sourceId
    return movement.boothWarehouseSalesRecordId === sourceId
  })
}

export function validateInventorySalesMovementConsistency(snapshot: InventorySyncSnapshot): boolean {
  for (const record of snapshot.eventSalesRecords) {
    const sales = matchingMovements(snapshot.inventoryMovements, 'eventSale', record.id)
    const samples = matchingMovements(snapshot.inventoryMovements, 'eventSample', record.id)
    const expectedSales = record.status === 'completed' ? record.soldQuantity ?? 0 : 0
    const expectedSamples = record.status === 'completed' ? record.sampleQuantity ?? 0 : 0
    if (sales.length !== (expectedSales > 0 ? 1 : 0) || samples.length !== (expectedSamples > 0 ? 1 : 0)) return false
    if (sales[0] && sales[0].quantity !== expectedSales) return false
    if (samples[0] && samples[0].quantity !== expectedSamples) return false
  }
  for (const record of snapshot.boothSalesRecords) {
    const movements = matchingMovements(snapshot.inventoryMovements, 'boothSale', record.id)
    const expected = record.status === 'cancelled' ? 0 : record.quantity
    if (movements.length !== (expected > 0 ? 1 : 0) || (movements[0] && movements[0].quantity !== expected)) return false
  }
  for (const record of snapshot.boothWarehouseSalesRecords) {
    const movements = matchingMovements(snapshot.inventoryMovements, 'boothWarehouseSale', record.id)
    if (movements.length !== 1 || movements[0].quantity !== record.quantity) return false
  }
  return true
}

export function isInventorySyncSnapshot(value: unknown): value is InventorySyncSnapshot {
  if (!object(value) || value.schemaVersion !== INVENTORY_SYNC_SNAPSHOT_SCHEMA_VERSION ||
    !nonEmpty(value.workspaceId) || !integer(value.revision) || !iso(value.generatedAt)) return false
  const arrays = [
    value.products, value.inventoryMovements, value.eventSalesRecords, value.boothSalesRecords,
    value.boothWarehouseSalesRecords, value.anniversaryCampaigns, value.anniversaryShipments,
  ]
  if (!arrays.every(Array.isArray)) return false
  if (!(value.products as unknown[]).every(isProduct) ||
    !(value.inventoryMovements as unknown[]).every(isMovement) ||
    !(value.eventSalesRecords as unknown[]).every(isEventSale) ||
    !(value.boothSalesRecords as unknown[]).every(isBoothSale) ||
    !(value.boothWarehouseSalesRecords as unknown[]).every(isBoothWarehouseSale) ||
    !(value.anniversaryCampaigns as unknown[]).every(isAnniversaryCampaign) ||
    !(value.anniversaryShipments as unknown[]).every(isAnniversaryShipment)) return false
  const snapshot = value as InventorySyncSnapshot
  if (![snapshot.products, snapshot.inventoryMovements, snapshot.eventSalesRecords, snapshot.boothSalesRecords,
    snapshot.boothWarehouseSalesRecords, snapshot.anniversaryCampaigns, snapshot.anniversaryShipments].every(uniqueIds)) return false
  const productIds = new Set(snapshot.products.map((record) => record.id))
  const events = new Map(snapshot.eventSalesRecords.map((record) => [record.id, record]))
  const boothSales = new Map(snapshot.boothSalesRecords.map((record) => [record.id, record]))
  const warehouseSales = new Map(snapshot.boothWarehouseSalesRecords.map((record) => [record.id, record]))
  const campaignIds = new Set(snapshot.anniversaryCampaigns.map((record) => record.id))
  if (snapshot.eventSalesRecords.some((record) => !productIds.has(record.productId) || !record.productNameSnapshot.trim()) ||
    snapshot.boothSalesRecords.some((record) => !productIds.has(record.productId) || !record.productNameSnapshot.trim()) ||
    snapshot.boothWarehouseSalesRecords.some((record) => !productIds.has(record.productId) || !record.productNameSnapshot.trim()) ||
    snapshot.inventoryMovements.some((record) => !productIds.has(record.productId) ||
      !movementReferencesAreValid(record, events, boothSales, warehouseSales)) ||
    snapshot.anniversaryShipments.some((record) => !campaignIds.has(record.campaignId))) return false
  const stockByProduct = new Map(snapshot.products.map((product) => [product.id, product.initialStock]))
  for (const movement of snapshot.inventoryMovements) {
    const direction = ['restock', 'boothCancellation', 'return', 'adjustmentIncrease'].includes(movement.type) ? 1 : -1
    stockByProduct.set(movement.productId, (stockByProduct.get(movement.productId) ?? 0) + direction * movement.quantity)
  }
  if ([...stockByProduct.values()].some((stock) => stock < 0)) return false
  return validateInventorySalesMovementConsistency(snapshot)
}

export function isInventorySyncBaseline(value: unknown): value is InventorySyncBaseline {
  return object(value) && nonEmpty(value.workspaceId) && integer(value.revision) &&
    fingerprintPattern.test(String(value.contentFingerprint)) && isInventorySyncSnapshot(value.snapshot) &&
    value.snapshot.workspaceId === value.workspaceId && value.snapshot.revision === value.revision &&
    value.contentFingerprint === inventoryContentFingerprint(value.snapshot) && iso(value.confirmedAt)
}

export function createInventorySyncBaseline(
  snapshot: InventorySyncSnapshot,
  confirmedAt: string,
): InventorySyncBaseline | null {
  if (!isInventorySyncSnapshot(snapshot) || !iso(confirmedAt)) return null
  return {
    workspaceId: snapshot.workspaceId,
    revision: snapshot.revision,
    contentFingerprint: inventoryContentFingerprint(snapshot),
    snapshot: cloneDefined(snapshot),
    confirmedAt,
  }
}

export function isInventorySyncPendingOperation(value: unknown): value is InventorySyncPendingOperation {
  if (!object(value) || !isUuidV4(value.operationId) || !nonEmpty(value.workspaceId) ||
    !['initial_upload', 'push_snapshot', 'resolve_conflict'].includes(String(value.operationType)) ||
    !(value.baseRevision === null || integer(value.baseRevision)) ||
    !fingerprintPattern.test(String(value.targetContentFingerprint)) || !iso(value.createdAt)) return false
  if (value.operationType === 'initial_upload') return value.baseRevision === null
  return value.baseRevision !== null
}

export function createInventorySyncPendingOperation(
  pending: InventorySyncPendingOperation,
): InventorySyncPendingOperation | null {
  return isInventorySyncPendingOperation(pending) ? cloneDefined(pending) : null
}

export function compareInventorySnapshotToBaseline(
  localSnapshot: InventorySyncSnapshot,
  baseline: InventorySyncBaseline | null,
): InventoryLocalDifferenceResult {
  if (!isInventorySyncSnapshot(localSnapshot)) {
    return { status: 'invalid_local', localContentFingerprint: null, baselineContentFingerprint: null }
  }
  const localContentFingerprint = inventoryContentFingerprint(localSnapshot)
  if (!baseline) return { status: 'no_baseline', localContentFingerprint, baselineContentFingerprint: null }
  if (!isInventorySyncBaseline(baseline)) {
    return { status: 'invalid_baseline', localContentFingerprint, baselineContentFingerprint: null }
  }
  if (localSnapshot.workspaceId !== baseline.workspaceId) {
    return { status: 'workspace_mismatch', localContentFingerprint, baselineContentFingerprint: baseline.contentFingerprint }
  }
  return {
    status: localContentFingerprint === baseline.contentFingerprint ? 'unchanged' : 'changed',
    localContentFingerprint,
    baselineContentFingerprint: baseline.contentFingerprint,
  }
}

export function isInventorySyncRemoteSnapshotResponse(value: unknown): value is InventorySyncRemoteSnapshotResponse {
  if (!object(value) || !nonEmpty(value.workspaceId) || !integer(value.revision)) return false
  if (value.snapshot === null) return value.contentFingerprint === null
  return isInventorySyncSnapshot(value.snapshot) && value.snapshot.workspaceId === value.workspaceId &&
    value.snapshot.revision === value.revision && value.contentFingerprint === inventoryContentFingerprint(value.snapshot)
}

export function isInventorySyncSaveRequest(value: unknown): value is InventorySyncSaveRequest {
  if (!(object(value) && nonEmpty(value.workspaceId) && isUuidV4(value.operationId) &&
    (value.baseRevision === null || integer(value.baseRevision)) && isInventorySyncSnapshot(value.snapshot) &&
    value.snapshot.workspaceId === value.workspaceId &&
    value.contentFingerprint === inventoryContentFingerprint(value.snapshot))) return false
  return value.baseRevision === null ? value.snapshot.revision === 0 : value.snapshot.revision === value.baseRevision
}

export function isInventorySyncSaveResponse(value: unknown): value is InventorySyncSaveResponse {
  if (!object(value) || !['saved', 'conflict', 'replayed'].includes(String(value.status))) return false
  if (value.status === 'conflict') {
    return integer(value.currentRevision) && fingerprintPattern.test(String(value.currentContentFingerprint))
  }
  return integer(value.revision) && fingerprintPattern.test(String(value.contentFingerprint))
}
