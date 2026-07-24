import type {
  AnniversaryCampaign,
  AnniversaryShipment,
  BoothSalesRecord,
  BoothWarehouseSaleRecord,
  EventSalesRecord,
  InventoryMovement,
  Product,
} from './inventory'

export const INVENTORY_SYNC_SNAPSHOT_SCHEMA_VERSION = 1
export const INVENTORY_SYNC_METADATA_VERSION = 1

export type InventorySyncSnapshot = {
  schemaVersion: 1
  workspaceId: string
  revision: number
  generatedAt: string
  products: Product[]
  inventoryMovements: InventoryMovement[]
  eventSalesRecords: EventSalesRecord[]
  boothSalesRecords: BoothSalesRecord[]
  boothWarehouseSalesRecords: BoothWarehouseSaleRecord[]
  anniversaryCampaigns: AnniversaryCampaign[]
  anniversaryShipments: AnniversaryShipment[]
}

export type InventorySyncBaseline = {
  workspaceId: string
  revision: number
  contentFingerprint: string
  snapshot: InventorySyncSnapshot
  confirmedAt: string
}

export type InventorySyncPendingOperationType =
  | 'initial_upload'
  | 'push_snapshot'
  | 'resolve_conflict'

export type InventorySyncPendingOperation = {
  operationId: string
  workspaceId: string
  operationType: InventorySyncPendingOperationType
  baseRevision: number | null
  targetContentFingerprint: string
  createdAt: string
}

export type InventorySyncState = 'unconfirmed' | 'confirmed' | 'pending' | 'conflict'

export type InventorySyncLocalMetadata = {
  version: 1
  workspaceId: string
  state: InventorySyncState
  lastRemoteRevision: number | null
  lastCheckedAt: string | null
}

export type InventoryLocalDifferenceResult = {
  status:
    | 'no_baseline'
    | 'unchanged'
    | 'changed'
    | 'invalid_local'
    | 'invalid_baseline'
    | 'workspace_mismatch'
  localContentFingerprint: string | null
  baselineContentFingerprint: string | null
}

export type InventorySyncRemoteSnapshotResponse = {
  workspaceId: string
  revision: number
  snapshot: InventorySyncSnapshot | null
  contentFingerprint: string | null
}

export type InventorySyncSaveRequest = {
  workspaceId: string
  operationId: string
  baseRevision: number | null
  snapshot: InventorySyncSnapshot
  contentFingerprint: string
}

export type InventorySyncSaveResponse =
  | { status: 'saved'; revision: number; contentFingerprint: string }
  | { status: 'conflict'; currentRevision: number; currentContentFingerprint: string | null }
  | { status: 'replayed'; revision: number; contentFingerprint: string }

export type InventorySyncStorageResult = {
  status: 'saved' | 'cleared' | 'validation_error' | 'storage_error' | 'read_back_error'
  rollbackFailed: boolean
}
