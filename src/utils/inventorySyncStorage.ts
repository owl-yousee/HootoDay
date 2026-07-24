import {
  INVENTORY_SYNC_METADATA_VERSION,
  type InventorySyncBaseline,
  type InventorySyncLocalMetadata,
  type InventorySyncPendingOperation,
  type InventorySyncStorageResult,
} from '../types/inventorySync'
import {
  inventoryContentFingerprint,
  isInventorySyncBaseline,
  isInventorySyncPendingOperation,
} from './inventorySyncSnapshot'

export const INVENTORY_SYNC_METADATA_STORAGE_KEY = 'hootoDay.inventorySync.metadata'
export const INVENTORY_SYNC_BASELINE_STORAGE_KEY = 'hootoDay.inventorySync.baseline'
export const INVENTORY_SYNC_PENDING_STORAGE_KEY = 'hootoDay.inventorySync.pending'
export const INVENTORY_SYNC_STORAGE_KEYS = [
  INVENTORY_SYNC_METADATA_STORAGE_KEY,
  INVENTORY_SYNC_BASELINE_STORAGE_KEY,
  INVENTORY_SYNC_PENDING_STORAGE_KEY,
] as const

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && Boolean(value.trim())
const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
const iso = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))

export function createUnconfirmedInventorySyncMetadata(workspaceId = ''): InventorySyncLocalMetadata {
  return {
    version: INVENTORY_SYNC_METADATA_VERSION,
    workspaceId,
    state: 'unconfirmed',
    lastRemoteRevision: null,
    lastCheckedAt: null,
  }
}

export function isInventorySyncLocalMetadata(value: unknown): value is InventorySyncLocalMetadata {
  return object(value) && value.version === INVENTORY_SYNC_METADATA_VERSION &&
    nonEmpty(value.workspaceId) &&
    ['unconfirmed', 'confirmed', 'pending', 'conflict'].includes(String(value.state)) &&
    (value.lastRemoteRevision === null || integer(value.lastRemoteRevision)) &&
    (value.lastCheckedAt === null || iso(value.lastCheckedAt))
}

function parse(raw: string | null): unknown {
  if (raw === null) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function restoreRaw(storage: Storage, key: string, previous: string | null): boolean {
  try {
    if (previous === null) storage.removeItem(key)
    else storage.setItem(key, previous)
    return storage.getItem(key) === previous
  } catch {
    return false
  }
}

function saveVerified<T>(
  storage: Storage,
  key: string,
  value: T,
  validate: (candidate: unknown) => candidate is T,
  same: (left: T, right: T) => boolean,
): InventorySyncStorageResult {
  if (!validate(value)) return { status: 'validation_error', rollbackFailed: false }
  let previous: string | null
  try {
    previous = storage.getItem(key)
    storage.setItem(key, JSON.stringify(value))
  } catch {
    return { status: 'storage_error', rollbackFailed: false }
  }
  try {
    const readBack = parse(storage.getItem(key))
    if (validate(readBack) && same(value, readBack)) return { status: 'saved', rollbackFailed: false }
  } catch {
    // rollback below
  }
  return {
    status: 'read_back_error',
    rollbackFailed: !restoreRaw(storage, key, previous),
  }
}

function clearVerified(storage: Storage, key: string): InventorySyncStorageResult {
  let previous: string | null
  try {
    previous = storage.getItem(key)
    storage.removeItem(key)
    if (storage.getItem(key) === null) return { status: 'cleared', rollbackFailed: false }
  } catch {
    return { status: 'storage_error', rollbackFailed: false }
  }
  return {
    status: 'read_back_error',
    rollbackFailed: !restoreRaw(storage, key, previous),
  }
}

export function loadInventorySyncMetadata(storage: Storage): InventorySyncLocalMetadata | null {
  let value: unknown
  try {
    value = parse(storage.getItem(INVENTORY_SYNC_METADATA_STORAGE_KEY))
  } catch {
    return null
  }
  if (!isInventorySyncLocalMetadata(value)) return null
  if (value.state === 'confirmed') {
    const baseline = loadInventorySyncBaseline(storage, value.workspaceId)
    if (!baseline || baseline.revision !== value.lastRemoteRevision) {
      return createUnconfirmedInventorySyncMetadata(value.workspaceId)
    }
  }
  if (value.state === 'pending' && !loadInventorySyncPendingOperation(storage, value.workspaceId)) {
    return createUnconfirmedInventorySyncMetadata(value.workspaceId)
  }
  return value
}

export function saveInventorySyncMetadata(
  storage: Storage,
  metadata: InventorySyncLocalMetadata,
): InventorySyncStorageResult {
  return saveVerified(storage, INVENTORY_SYNC_METADATA_STORAGE_KEY, metadata,
    isInventorySyncLocalMetadata, (left, right) => JSON.stringify(left) === JSON.stringify(right))
}

export function loadInventorySyncBaseline(storage: Storage, workspaceId?: string): InventorySyncBaseline | null {
  try {
    const value = parse(storage.getItem(INVENTORY_SYNC_BASELINE_STORAGE_KEY))
    if (!isInventorySyncBaseline(value)) return null
    return workspaceId === undefined || value.workspaceId === workspaceId ? value : null
  } catch {
    return null
  }
}

export function saveInventorySyncBaseline(
  storage: Storage,
  baseline: InventorySyncBaseline,
): InventorySyncStorageResult {
  return saveVerified(storage, INVENTORY_SYNC_BASELINE_STORAGE_KEY, baseline,
    isInventorySyncBaseline, (left, right) =>
      left.contentFingerprint === right.contentFingerprint &&
      inventoryContentFingerprint(left.snapshot) === inventoryContentFingerprint(right.snapshot) &&
      JSON.stringify(left) === JSON.stringify(right))
}

export function clearInventorySyncBaseline(storage: Storage): InventorySyncStorageResult {
  return clearVerified(storage, INVENTORY_SYNC_BASELINE_STORAGE_KEY)
}

export function loadInventorySyncPendingOperation(
  storage: Storage,
  workspaceId?: string,
): InventorySyncPendingOperation | null {
  try {
    const value = parse(storage.getItem(INVENTORY_SYNC_PENDING_STORAGE_KEY))
    if (!isInventorySyncPendingOperation(value)) return null
    return workspaceId === undefined || value.workspaceId === workspaceId ? value : null
  } catch {
    return null
  }
}

export function saveInventorySyncPendingOperation(
  storage: Storage,
  pending: InventorySyncPendingOperation,
): InventorySyncStorageResult {
  return saveVerified(storage, INVENTORY_SYNC_PENDING_STORAGE_KEY, pending,
    isInventorySyncPendingOperation, (left, right) => JSON.stringify(left) === JSON.stringify(right))
}

export function clearInventorySyncPendingOperation(storage: Storage): InventorySyncStorageResult {
  return clearVerified(storage, INVENTORY_SYNC_PENDING_STORAGE_KEY)
}

function restoreMany(storage: Storage, previous: Map<string, string | null>): boolean {
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

export function resetInventorySyncStateAfterRestore(
  storage: Storage,
  workspaceId?: string,
): InventorySyncStorageResult {
  const previous = new Map<string, string | null>()
  try {
    for (const key of INVENTORY_SYNC_STORAGE_KEYS) previous.set(key, storage.getItem(key))
  } catch {
    return { status: 'storage_error', rollbackFailed: false }
  }
  const existingWorkspaceId = loadInventorySyncMetadata(storage)?.workspaceId
  const nextWorkspaceId = nonEmpty(workspaceId) ? workspaceId : existingWorkspaceId
  try {
    storage.removeItem(INVENTORY_SYNC_BASELINE_STORAGE_KEY)
    storage.removeItem(INVENTORY_SYNC_PENDING_STORAGE_KEY)
    if (nextWorkspaceId) {
      storage.setItem(INVENTORY_SYNC_METADATA_STORAGE_KEY,
        JSON.stringify(createUnconfirmedInventorySyncMetadata(nextWorkspaceId)))
    } else {
      storage.removeItem(INVENTORY_SYNC_METADATA_STORAGE_KEY)
    }
    const metadataValid = nextWorkspaceId
      ? isInventorySyncLocalMetadata(parse(storage.getItem(INVENTORY_SYNC_METADATA_STORAGE_KEY))) &&
        loadInventorySyncMetadata(storage)?.state === 'unconfirmed'
      : storage.getItem(INVENTORY_SYNC_METADATA_STORAGE_KEY) === null
    if (metadataValid && storage.getItem(INVENTORY_SYNC_BASELINE_STORAGE_KEY) === null &&
      storage.getItem(INVENTORY_SYNC_PENDING_STORAGE_KEY) === null) {
      return { status: 'cleared', rollbackFailed: false }
    }
  } catch {
    // rollback below
  }
  return {
    status: 'read_back_error',
    rollbackFailed: !restoreMany(storage, previous),
  }
}

export function clearInventorySyncState(storage: Storage): InventorySyncStorageResult {
  const previous = new Map<string, string | null>()
  try {
    for (const key of INVENTORY_SYNC_STORAGE_KEYS) previous.set(key, storage.getItem(key))
    for (const key of INVENTORY_SYNC_STORAGE_KEYS) storage.removeItem(key)
    if (INVENTORY_SYNC_STORAGE_KEYS.every((key) => storage.getItem(key) === null)) {
      return { status: 'cleared', rollbackFailed: false }
    }
  } catch {
    // rollback below
  }
  return {
    status: 'read_back_error',
    rollbackFailed: !restoreMany(storage, previous),
  }
}
