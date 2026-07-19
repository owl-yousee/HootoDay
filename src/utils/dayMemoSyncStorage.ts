import type {
  DayMemoInitialUploadEntryV1,
  DayMemoPushBlockReason,
  DayMemoSyncMetadataV1,
} from '../types/dayMemoSync'
import { fromDateKey } from './date'
import { isUuid } from './syncConnectionStorage'
import { isUuidV4 } from './uuid'

export const DAY_MEMO_SYNC_STORAGE_KEY = 'hootoDay.dayMemoSync'
export const DAY_MEMO_SYNC_STORAGE_VERSION = 1

export type DayMemoSyncLoadResult =
  | { status: 'absent'; metadata: null }
  | { status: 'ready'; metadata: DayMemoSyncMetadataV1 }
  | { status: 'storage_unavailable' | 'metadata_invalid'; metadata: null }

export type DayMemoSyncSaveResult = 'saved' | 'storage_unavailable' | 'metadata_invalid'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/
const UPLOAD_STATUSES = ['not_started', 'prepared', 'uploading', 'partial', 'completed', 'blocked']
const ENTRY_STATUSES = ['pending', 'response_unknown', 'applied', 'conflict']
const ERROR_CODES = [
  'authentication_required', 'membership_required', 'remote_not_empty', 'local_changed',
  'rpc_failed', 'response_invalid', 'storage_failed', 'metadata_invalid',
]
const PUSH_BLOCK_REASONS = ['json_restore', 'full_reset', 'remote_not_empty', 'metadata_invalid']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoDateTime(value: unknown): value is string {
  return typeof value === 'string'
    && ISO_DATE_TIME_PATTERN.test(value)
    && !Number.isNaN(Date.parse(value))
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isEntry(value: unknown): value is DayMemoInitialUploadEntryV1 {
  if (!isRecord(value)
    || !ENTRY_STATUSES.includes(String(value.status))
    || !(value.operationId === null || isUuidV4(value.operationId))
    || !isIsoDateTime(value.preparedUpdatedAt)
    || value.baseRevision !== 0
    || !(value.remoteRevision === null || isSafeNonNegativeInteger(value.remoteRevision))
    || !(value.remoteChangeSequence === null || isSafeNonNegativeInteger(value.remoteChangeSequence))
    || !(value.errorCode === null || ERROR_CODES.includes(String(value.errorCode)))) return false

  if (value.status === 'applied') {
    return value.operationId === null
      && Number(value.remoteRevision) === 1
      && Number(value.remoteChangeSequence) >= 1
      && value.errorCode === null
  }
  return isUuidV4(value.operationId)
}

export function isDayMemoSyncMetadata(value: unknown): value is DayMemoSyncMetadataV1 {
  if (!isRecord(value)
    || value.version !== DAY_MEMO_SYNC_STORAGE_VERSION
    || !isUuid(value.workspaceId)
    || !UPLOAD_STATUSES.includes(String(value.initialUploadStatus))
    || !(value.preparedAt === null || isIsoDateTime(value.preparedAt))
    || !(value.completedAt === null || isIsoDateTime(value.completedAt))
    || !Array.isArray(value.targetDates)
    || !value.targetDates.every((date) => typeof date === 'string' && DATE_PATTERN.test(date) && Boolean(fromDateKey(date)))
    || new Set(value.targetDates).size !== value.targetDates.length
    || !isRecord(value.entries)
    || !isSafeNonNegativeInteger(value.lastPulledChangeSequence)
    || !(value.lastSuccessfulSyncAt === null || isIsoDateTime(value.lastSuccessfulSyncAt))) return false

  const entries = value.entries as Record<string, unknown>
  const entryKeys = Object.keys(entries)
  if (entryKeys.length !== value.targetDates.length
    || !value.targetDates.every((date) => entryKeys.includes(date) && isEntry(entries[date]))) return false

  if (value.pushBlock !== null) {
    if (!isRecord(value.pushBlock)
      || !PUSH_BLOCK_REASONS.includes(String(value.pushBlock.reason))
      || !isIsoDateTime(value.pushBlock.blockedAt)) return false
  }

  if (value.initialUploadStatus === 'not_started') {
    return value.preparedAt === null && value.completedAt === null && value.targetDates.length === 0
  }
  if (value.initialUploadStatus === 'completed') {
    return value.completedAt !== null
      && value.targetDates.length > 0
      && value.targetDates.every((date) => (entries[date] as DayMemoInitialUploadEntryV1).status === 'applied')
  }
  if (value.initialUploadStatus === 'blocked' && value.targetDates.length === 0) {
    return value.preparedAt === null && value.completedAt === null && value.pushBlock !== null
  }
  return value.preparedAt !== null && value.completedAt === null && value.targetDates.length > 0
}

export function createInitialDayMemoSyncMetadata(workspaceId: string): DayMemoSyncMetadataV1 | null {
  if (!isUuid(workspaceId)) return null
  return {
    version: DAY_MEMO_SYNC_STORAGE_VERSION,
    workspaceId,
    initialUploadStatus: 'not_started',
    preparedAt: null,
    completedAt: null,
    targetDates: [],
    entries: {},
    lastPulledChangeSequence: 0,
    pushBlock: null,
    lastSuccessfulSyncAt: null,
  }
}

export function loadDayMemoSyncMetadata(storage: Storage): DayMemoSyncLoadResult {
  let raw: string | null
  try {
    raw = storage.getItem(DAY_MEMO_SYNC_STORAGE_KEY)
  } catch {
    return { status: 'storage_unavailable', metadata: null }
  }
  if (raw === null) return { status: 'absent', metadata: null }
  try {
    const value: unknown = JSON.parse(raw)
    return isDayMemoSyncMetadata(value)
      ? { status: 'ready', metadata: value }
      : { status: 'metadata_invalid', metadata: null }
  } catch {
    return { status: 'metadata_invalid', metadata: null }
  }
}

export function saveDayMemoSyncMetadata(storage: Storage, metadata: DayMemoSyncMetadataV1): DayMemoSyncSaveResult {
  if (!isDayMemoSyncMetadata(metadata)) return 'metadata_invalid'
  const serialized = JSON.stringify(metadata)
  try {
    storage.setItem(DAY_MEMO_SYNC_STORAGE_KEY, serialized)
    const readBack = storage.getItem(DAY_MEMO_SYNC_STORAGE_KEY)
    if (readBack === null) return 'storage_unavailable'
    const parsed: unknown = JSON.parse(readBack)
    return isDayMemoSyncMetadata(parsed) && JSON.stringify(parsed) === serialized
      ? 'saved'
      : 'metadata_invalid'
  } catch {
    return 'storage_unavailable'
  }
}

export function bindDayMemoSyncMetadata(
  loadResult: DayMemoSyncLoadResult,
  workspaceId: string,
): DayMemoSyncMetadataV1 | null {
  if (!isUuid(workspaceId)) return null
  if (loadResult.status === 'absent') return createInitialDayMemoSyncMetadata(workspaceId)
  if (loadResult.status !== 'ready' || loadResult.metadata.workspaceId !== workspaceId) return null
  return loadResult.metadata
}

export function setDayMemoPushBlock(
  storage: Storage,
  workspaceId: string | null,
  reason: DayMemoPushBlockReason,
): { result: DayMemoSyncSaveResult | 'not_required'; metadata: DayMemoSyncMetadataV1 | null } {
  const loaded = loadDayMemoSyncMetadata(storage)
  if (loaded.status === 'storage_unavailable') return { result: 'storage_unavailable', metadata: null }
  if (loaded.status === 'metadata_invalid') return { result: 'metadata_invalid', metadata: null }
  if (loaded.status === 'absent' && workspaceId === null) return { result: 'not_required', metadata: null }

  const binding = workspaceId ?? (loaded.status === 'ready' ? loaded.metadata.workspaceId : null)
  if (!binding) return { result: 'metadata_invalid', metadata: null }
  const current = bindDayMemoSyncMetadata(loaded, binding)
  if (!current) return { result: 'metadata_invalid', metadata: null }
  const next: DayMemoSyncMetadataV1 = {
    ...current,
    initialUploadStatus: current.initialUploadStatus === 'completed' ? 'completed' : 'blocked',
    pushBlock: { reason, blockedAt: new Date().toISOString() },
  }
  const result = saveDayMemoSyncMetadata(storage, next)
  return { result, metadata: result === 'saved' ? next : null }
}
