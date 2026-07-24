import type { InventorySyncSnapshot } from '../types/inventorySync'
import {
  ANNIVERSARY_CAMPAIGNS_STORAGE_KEY,
  ANNIVERSARY_SHIPMENTS_STORAGE_KEY,
  BOOTH_SALES_STORAGE_KEY,
  BOOTH_WAREHOUSE_SALES_STORAGE_KEY,
  EVENT_SALES_STORAGE_KEY,
  INVENTORY_MOVEMENTS_STORAGE_KEY,
  INVENTORY_STORAGE_VERSION,
  PRODUCTS_STORAGE_KEY,
  loadAnniversaryCampaigns,
  loadAnniversaryShipments,
  loadBoothSalesRecords,
  loadBoothWarehouseSalesRecords,
  loadEventSalesRecords,
  loadInventoryMovements,
  loadProducts,
} from './inventoryStorage'
import { inventoryContentFingerprint, isInventorySyncSnapshot } from './inventorySyncSnapshot'

export type InventorySyncApplyResult = {
  status: 'applied' | 'invalid_snapshot' | 'storage_error' | 'read_back_error'
  rollbackFailed: boolean
}

const keys = [
  PRODUCTS_STORAGE_KEY,
  INVENTORY_MOVEMENTS_STORAGE_KEY,
  EVENT_SALES_STORAGE_KEY,
  BOOTH_SALES_STORAGE_KEY,
  BOOTH_WAREHOUSE_SALES_STORAGE_KEY,
  ANNIVERSARY_CAMPAIGNS_STORAGE_KEY,
  ANNIVERSARY_SHIPMENTS_STORAGE_KEY,
] as const

function restore(storage: Storage, previous: Map<string, string | null>): boolean {
  try {
    for (const [key, value] of previous) {
      if (value === null) storage.removeItem(key)
      else storage.setItem(key, value)
    }
    return [...previous].every(([key, value]) => storage.getItem(key) === value)
  } catch {
    return false
  }
}

export function applyInventorySyncSnapshotToStorage(
  storage: Storage,
  snapshot: InventorySyncSnapshot,
): InventorySyncApplyResult {
  if (!isInventorySyncSnapshot(snapshot)) {
    return { status: 'invalid_snapshot', rollbackFailed: false }
  }
  const previous = new Map<string, string | null>()
  try {
    for (const key of keys) previous.set(key, storage.getItem(key))
    const values = [
      snapshot.products,
      snapshot.inventoryMovements,
      snapshot.eventSalesRecords,
      snapshot.boothSalesRecords,
      snapshot.boothWarehouseSalesRecords,
      snapshot.anniversaryCampaigns,
      snapshot.anniversaryShipments,
    ]
    keys.forEach((key, index) => {
      storage.setItem(key, JSON.stringify({ version: INVENTORY_STORAGE_VERSION, records: values[index] }))
    })
  } catch {
    return { status: 'storage_error', rollbackFailed: !restore(storage, previous) }
  }

  try {
    const readBack: InventorySyncSnapshot = {
      ...snapshot,
      products: loadProducts(),
      inventoryMovements: loadInventoryMovements(),
      eventSalesRecords: loadEventSalesRecords(),
      boothSalesRecords: loadBoothSalesRecords(),
      boothWarehouseSalesRecords: loadBoothWarehouseSalesRecords(),
      anniversaryCampaigns: loadAnniversaryCampaigns(),
      anniversaryShipments: loadAnniversaryShipments(),
    }
    if (isInventorySyncSnapshot(readBack) &&
      inventoryContentFingerprint(readBack) === inventoryContentFingerprint(snapshot)) {
      return { status: 'applied', rollbackFailed: false }
    }
  } catch {
    // rollback below
  }
  return { status: 'read_back_error', rollbackFailed: !restore(storage, previous) }
}
