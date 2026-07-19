import type { SyncConnection } from '../types/sync'

export const SYNC_CONNECTION_STORAGE_KEY = 'hootoDay.syncConnection'
export const SYNC_CONNECTION_STORAGE_VERSION = 1

export type SyncConnectionLoadResult =
  | { status: 'ready'; connection: SyncConnection }
  | {
    status: 'uuid_unavailable' | 'storage_unavailable' | 'metadata_invalid' | 'initialization_failed'
    connection: null
  }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function isValidConnection(value: unknown): value is SyncConnection {
  if (!isRecord(value)
    || value.version !== SYNC_CONNECTION_STORAGE_VERSION
    || !isUuid(value.deviceId)
    || !(value.workspaceId === null || isUuid(value.workspaceId))
    || !(value.deviceRole === null || value.deviceRole === 'parent' || value.deviceRole === 'child')
    || !(value.workspaceRole === null || value.workspaceRole === 'owner' || value.workspaceRole === 'member')
    || !['unpaired', 'owner', 'member'].includes(String(value.pairingStatus))
    || !(value.pairedAt === null || (
      typeof value.pairedAt === 'string'
      && !Number.isNaN(Date.parse(value.pairedAt))
      && new Date(value.pairedAt).toISOString() === value.pairedAt
    ))) {
    return false
  }

  if (value.workspaceId === null) {
    return value.deviceRole === null
      && value.workspaceRole === null
      && value.pairingStatus === 'unpaired'
      && value.pairedAt === null
  }

  const isOwnerConnection = value.deviceRole === 'parent'
    && value.workspaceRole === 'owner'
    && value.pairingStatus === 'owner'
  const isMemberConnection = value.deviceRole === 'child'
    && value.workspaceRole === 'member'
    && value.pairingStatus === 'member'

  return (isOwnerConnection || isMemberConnection) && value.pairedAt !== null
}

function createDeviceUuid(): string | null {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi) return null

  try {
    if (typeof cryptoApi.randomUUID === 'function') {
      const nativeUuid = cryptoApi.randomUUID()
      if (isUuid(nativeUuid)) return nativeUuid
    }
  } catch {
    // LAN内HTTPなどでrandomUUIDが利用できない場合だけ安全なfallbackへ進む。
  }

  if (typeof cryptoApi.getRandomValues !== 'function') return null

  try {
    const bytes = new Uint8Array(16)
    cryptoApi.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    const fallbackUuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    return isUuid(fallbackUuid) ? fallbackUuid : null
  } catch {
    return null
  }
}

function createInitialConnection(): SyncConnection | null {
  try {
    const deviceId = createDeviceUuid()
    if (!deviceId) return null

    return {
      version: SYNC_CONNECTION_STORAGE_VERSION,
      workspaceId: null,
      deviceId,
      deviceRole: null,
      workspaceRole: null,
      pairingStatus: 'unpaired',
      pairedAt: null,
    }
  } catch {
    return null
  }
}

export type SyncConnectionSaveResult = 'saved' | 'metadata_invalid' | 'storage_unavailable'

export function saveSyncConnectionWithStatus(
  storage: Storage,
  connection: SyncConnection,
): SyncConnectionSaveResult {
  if (!isValidConnection(connection)) return 'metadata_invalid'

  try {
    storage.setItem(SYNC_CONNECTION_STORAGE_KEY, JSON.stringify(connection))
    return 'saved'
  } catch {
    return 'storage_unavailable'
  }
}

export function saveSyncConnection(storage: Storage, connection: SyncConnection): boolean {
  return saveSyncConnectionWithStatus(storage, connection) === 'saved'
}

function loadOrCreateSyncConnectionInternal(storage: Storage): SyncConnectionLoadResult {
  let rawValue: string | null

  try {
    rawValue = storage.getItem(SYNC_CONNECTION_STORAGE_KEY)
  } catch {
    return { status: 'storage_unavailable', connection: null }
  }

  if (rawValue !== null) {
    try {
      const parsed: unknown = JSON.parse(rawValue)
      return isValidConnection(parsed)
        ? { status: 'ready', connection: parsed }
        : { status: 'metadata_invalid', connection: null }
    } catch {
      return { status: 'metadata_invalid', connection: null }
    }
  }

  const connection = createInitialConnection()
  if (!connection) return { status: 'uuid_unavailable', connection: null }

  const saveResult = saveSyncConnectionWithStatus(storage, connection)
  if (saveResult === 'metadata_invalid') return { status: 'metadata_invalid', connection: null }
  if (saveResult === 'storage_unavailable') return { status: 'storage_unavailable', connection: null }
  return { status: 'ready', connection }
}

export function loadOrCreateSyncConnection(storage: Storage): SyncConnectionLoadResult {
  try {
    return loadOrCreateSyncConnectionInternal(storage)
  } catch {
    return { status: 'initialization_failed', connection: null }
  }
}
