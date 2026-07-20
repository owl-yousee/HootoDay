import type {
  DayMemoInitialUploadEntryV1,
  DayMemoInitialUploadEntryV2,
  DayMemoPushBlockReason,
  DayMemoSyncMetadata,
  DayMemoSyncMetadataV1,
  DayMemoSyncMetadataV2,
  DayMemoSyncMetadataV3,
  DayMemoSyncMetadataV4,
  DayMemoPendingOperationV3,
} from '../types/dayMemoSync'
import type { DayMemo } from '../types/dayMemo'
import { fromDateKey } from './date'
import { isStoredDayMemo } from './dayMemoStorage'
import { isUuid } from './syncConnectionStorage'
import { isUuidV4 } from './uuid'

export const DAY_MEMO_SYNC_STORAGE_KEY = 'hootoDay.dayMemoSync'
export const DAY_MEMO_SYNC_STORAGE_VERSION = 1

export type DayMemoSyncLoadResult =
  | { status: 'absent'; metadata: null }
  | { status: 'ready'; metadata: DayMemoSyncMetadataV1 }
  | { status: 'storage_unavailable' | 'metadata_invalid'; metadata: null }

export type DayMemoSyncSaveResult = 'saved' | 'storage_unavailable' | 'metadata_invalid'

export type DayMemoSyncAnyLoadResult =
  | { status: 'absent'; metadata: null; raw: null }
  | { status: 'ready'; metadata: DayMemoSyncMetadata; raw: string }
  | { status: 'storage_unavailable' | 'metadata_invalid'; metadata: null; raw: null }

export type DayMemoSyncV2SaveResult =
  | 'saved'
  | 'stale'
  | 'storage_unavailable'
  | 'metadata_invalid'
  | 'write_failed'
  | 'readback_failed'
  | 'rollback_failed'

export type DayMemoSyncMigrationResult =
  | { status: 'ready'; metadata: DayMemoSyncMetadataV3 | DayMemoSyncMetadataV4; raw: string; migrated: boolean }
  | {
    status:
      | 'workspace_mismatch'
      | 'metadata_v1_invalid'
      | 'migration_invalid'
      | 'migration_save_failed'
      | 'migration_readback_failed'
      | 'migration_rollback_failed'
    metadata: null
    raw: null
    migrated: false
  }

export type DayMemoSyncV4MigrationAnalysis =
  | { status: 'ready'; source: DayMemoSyncMetadataV3; next: DayMemoSyncMetadataV4 }
  | { status: 'already_current'; source: DayMemoSyncMetadataV4; next: DayMemoSyncMetadataV4 }
  | { status: 'pending_ambiguous' | 'intent_without_pending' | 'pending_without_intent' | 'operation_unresolvable' | 'baseline_mismatch' | 'unsupported'; source: DayMemoSyncMetadataV3 | null; next: null }

export function analyzeDayMemoSyncMetadataV4Migration(metadata: DayMemoSyncMetadata): DayMemoSyncV4MigrationAnalysis {
  if (metadata.version === 4) return { status: 'already_current', source: metadata, next: metadata }
  if (metadata.version !== 3) return { status: 'unsupported', source: null, next: null }
  const entries = Object.entries(metadata.localDeleteIntents)
  const pending = metadata.pendingOperation
  if (entries.length === 0) {
    if (pending?.kind === 'delete') return { status: 'pending_without_intent', source: metadata, next: null }
    const next: DayMemoSyncMetadataV4 = {
      ...metadata,
      version: 4,
      localDeleteIntents: {},
      migration: { sourceVersion: 3, status: 'completed', migratedAt: new Date().toISOString() },
    }
    return isDayMemoSyncMetadataV4(next)
      ? { status: 'ready', source: metadata, next }
      : { status: 'operation_unresolvable', source: metadata, next: null }
  }
  if (entries.length !== 1) return { status: 'pending_ambiguous', source: metadata, next: null }
  if (!pending) return { status: 'intent_without_pending', source: metadata, next: null }
  if (pending.kind !== 'delete') return { status: 'operation_unresolvable', source: metadata, next: null }
  const [date, intent] = entries[0]
  if (pending.date !== date || pending.baseRevision !== intent.baselineRevision) {
    return { status: 'operation_unresolvable', source: metadata, next: null }
  }
  const baseline = metadata.baselines[date]
  if (!baseline || baseline.deletedAt !== null || baseline.remoteRevision !== intent.baselineRevision
    || baseline.remoteChangeSequence !== intent.baselineChangeSequence) {
    return { status: 'baseline_mismatch', source: metadata, next: null }
  }
  const next: DayMemoSyncMetadataV4 = {
    ...metadata,
    version: 4,
    localDeleteIntents: { [date]: { ...intent, operationId: pending.operationId } },
    migration: { sourceVersion: 3, status: 'completed', migratedAt: new Date().toISOString() },
  }
  return isDayMemoSyncMetadataV4(next)
    ? { status: 'ready', source: metadata, next }
    : { status: 'operation_unresolvable', source: metadata, next: null }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/
const UPLOAD_STATUSES = ['not_started', 'prepared', 'uploading', 'partial', 'completed', 'blocked']
const ENTRY_STATUSES = ['pending', 'response_unknown', 'applied', 'conflict']
const ERROR_CODES = [
  'authentication_required', 'membership_required', 'remote_not_empty', 'local_changed',
  'rpc_failed', 'response_invalid', 'storage_failed', 'metadata_invalid',
]
const PUSH_BLOCK_REASONS = ['json_restore', 'full_reset', 'remote_not_empty', 'metadata_invalid']
const INITIAL_UPLOAD_STATUSES_V2 = ['not_started', 'prepared', 'uploading', 'partially_completed', 'completed', 'recovery_required']
const BASELINE_STATUSES_V2 = ['not_confirmed', 'confirming', 'confirmed', 'mismatch', 'remote_empty', 'recovery_required']
const PENDING_OPERATION_STATUSES_V2 = ['prepared', 'sending', 'response_unknown', 'conflict', 'recovery_required']
const DELETE_INTENT_STATUSES_V3 = ['intent_recorded', 'preview_ready', 'prepared', 'sending', 'conflict', 'response_unknown', 'recovery_required']

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

function isInitialUploadEntryV2(value: unknown): value is DayMemoInitialUploadEntryV2 {
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
      && Number(value.remoteRevision) >= 1
      && Number(value.remoteChangeSequence) >= 1
      && value.errorCode === null
  }
  return isUuidV4(value.operationId)
}

function isRemoteBaselineV2(value: unknown, date: string): boolean {
  return isRecord(value)
    && value.date === date
    && DATE_PATTERN.test(date)
    && Boolean(fromDateKey(date))
    && Number.isSafeInteger(value.remoteRevision)
    && Number(value.remoteRevision) >= 1
    && Number.isSafeInteger(value.remoteChangeSequence)
    && Number(value.remoteChangeSequence) >= 1
    && isIsoDateTime(value.remoteUpdatedAt)
    && (value.baselineLocalUpdatedAt === null || isIsoDateTime(value.baselineLocalUpdatedAt))
    && (value.deletedAt === null || isIsoDateTime(value.deletedAt))
}

function isPendingOperationV2(value: unknown): boolean {
  return isRecord(value)
    && value.kind === 'upsert'
    && typeof value.date === 'string'
    && DATE_PATTERN.test(value.date)
    && Boolean(fromDateKey(value.date))
    && isUuidV4(value.operationId)
    && isSafeNonNegativeInteger(value.baseRevision)
    && isIsoDateTime(value.preparedLocalUpdatedAt)
    && isIsoDateTime(value.preparedAt)
    && PENDING_OPERATION_STATUSES_V2.includes(String(value.status))
}

function isPendingOperationV3(value: unknown): value is DayMemoPendingOperationV3 {
  if (isPendingOperationV2(value)) return true
  return isRecord(value)
    && value.kind === 'delete'
    && typeof value.date === 'string'
    && DATE_PATTERN.test(value.date)
    && Boolean(fromDateKey(value.date))
    && isUuidV4(value.operationId)
    && Number.isSafeInteger(value.baseRevision)
    && Number(value.baseRevision) >= 1
    && isIsoDateTime(value.preparedAt)
    && isIsoDateTime(value.clientDeletedAt)
    && PENDING_OPERATION_STATUSES_V2.includes(String(value.status))
}

export function isDayMemoSyncMetadataV2(value: unknown): value is DayMemoSyncMetadataV2 {
  if (!isRecord(value)
    || value.version !== 2
    || !isUuid(value.workspaceId)
    || !isRecord(value.initialUpload)
    || !INITIAL_UPLOAD_STATUSES_V2.includes(String(value.initialUpload.status))
    || !(value.initialUpload.preparedAt === null || isIsoDateTime(value.initialUpload.preparedAt))
    || !(value.initialUpload.completedAt === null || isIsoDateTime(value.initialUpload.completedAt))
    || !Array.isArray(value.initialUpload.targetDates)
    || !value.initialUpload.targetDates.every((date) => typeof date === 'string' && DATE_PATTERN.test(date) && Boolean(fromDateKey(date)))
    || new Set(value.initialUpload.targetDates).size !== value.initialUpload.targetDates.length
    || !isRecord(value.initialUpload.entries)
    || !isRecord(value.baselines)
    || !isSafeNonNegativeInteger(value.lastPulledChangeSequence)
    || !BASELINE_STATUSES_V2.includes(String(value.baselineStatus))
    || !(value.baselineConfirmedAt === null || isIsoDateTime(value.baselineConfirmedAt))
    || !(value.pendingOperation === null || isPendingOperationV2(value.pendingOperation))
    || !(value.lastSuccessfulSyncAt === null || isIsoDateTime(value.lastSuccessfulSyncAt))
    || !isRecord(value.migration)
    || !(value.migration.sourceVersion === 1 || value.migration.sourceVersion === 2)
    || value.migration.status !== 'completed'
    || !isIsoDateTime(value.migration.migratedAt)) return false

  const entries = value.initialUpload.entries as Record<string, unknown>
  const entryKeys = Object.keys(entries)
  if (entryKeys.length !== value.initialUpload.targetDates.length
    || !value.initialUpload.targetDates.every((date) => entryKeys.includes(date) && isInitialUploadEntryV2(entries[date]))) return false
  const baselines = value.baselines as Record<string, unknown>
  if (!Object.keys(baselines).every((date) => isRemoteBaselineV2(baselines[date], date))) return false
  const baselineValues = Object.values(baselines) as DayMemoSyncMetadataV2['baselines'][string][]
  if (new Set(baselineValues.map((baseline) => baseline.remoteChangeSequence)).size !== baselineValues.length) return false
  if (value.pushBlock !== null && (!isRecord(value.pushBlock)
    || !PUSH_BLOCK_REASONS.includes(String(value.pushBlock.reason))
    || !isIsoDateTime(value.pushBlock.blockedAt))) return false
  if (value.baselineStatus === 'confirmed') {
    if (value.baselineConfirmedAt === null
      || Object.keys(baselines).length === 0
      || baselineValues.some((baseline) => baseline.deletedAt !== null || baseline.baselineLocalUpdatedAt === null)
      || baselineValues.some((baseline) => baseline.remoteChangeSequence > Number(value.lastPulledChangeSequence))
      || Math.max(...baselineValues.map((baseline) => baseline.remoteChangeSequence)) !== value.lastPulledChangeSequence) return false
  } else if (value.baselineStatus === 'remote_empty') {
    if (value.baselineConfirmedAt === null || Object.keys(baselines).length !== 0 || value.lastPulledChangeSequence !== 0) return false
  } else if (value.baselineStatus === 'mismatch') {
    if (value.baselineConfirmedAt !== null || Object.keys(baselines).length !== 0) return false
  } else if (value.baselineConfirmedAt !== null) return false
  if (value.initialUpload.status === 'not_started') {
    return value.initialUpload.preparedAt === null
      && value.initialUpload.completedAt === null
      && value.initialUpload.targetDates.length === 0
  }
  if (value.initialUpload.status === 'completed') {
    return value.initialUpload.completedAt !== null
      && value.initialUpload.targetDates.length > 0
      && value.initialUpload.targetDates.every((date) => (entries[date] as DayMemoInitialUploadEntryV2).status === 'applied')
  }
  if (value.initialUpload.status === 'recovery_required' && value.initialUpload.targetDates.length === 0) {
    return value.initialUpload.preparedAt === null && value.initialUpload.completedAt === null && value.pushBlock !== null
  }
  return value.initialUpload.preparedAt !== null
    && value.initialUpload.completedAt === null
    && value.initialUpload.targetDates.length > 0
}

export function isDayMemoSyncMetadataV3(value: unknown): value is DayMemoSyncMetadataV3 {
  if (!isRecord(value)
    || value.version !== 3
    || !isUuid(value.workspaceId)
    || !isRecord(value.initialUpload)
    || !INITIAL_UPLOAD_STATUSES_V2.includes(String(value.initialUpload.status))
    || !(value.initialUpload.preparedAt === null || isIsoDateTime(value.initialUpload.preparedAt))
    || !(value.initialUpload.completedAt === null || isIsoDateTime(value.initialUpload.completedAt))
    || !Array.isArray(value.initialUpload.targetDates)
    || !value.initialUpload.targetDates.every((date) => typeof date === 'string' && DATE_PATTERN.test(date) && Boolean(fromDateKey(date)))
    || new Set(value.initialUpload.targetDates).size !== value.initialUpload.targetDates.length
    || !isRecord(value.initialUpload.entries)
    || !isRecord(value.baselines)
    || !isRecord(value.localDeleteIntents)
    || !isSafeNonNegativeInteger(value.lastPulledChangeSequence)
    || !BASELINE_STATUSES_V2.includes(String(value.baselineStatus))
    || !(value.baselineConfirmedAt === null || isIsoDateTime(value.baselineConfirmedAt))
    || !(value.pendingOperation === null || isPendingOperationV3(value.pendingOperation))
    || !(value.lastSuccessfulSyncAt === null || isIsoDateTime(value.lastSuccessfulSyncAt))
    || !isRecord(value.migration)
    || ![1, 2, 3].includes(Number(value.migration.sourceVersion))
    || value.migration.status !== 'completed'
    || !isIsoDateTime(value.migration.migratedAt)) return false

  const entries = value.initialUpload.entries as Record<string, unknown>
  if (Object.keys(entries).length !== value.initialUpload.targetDates.length
    || !value.initialUpload.targetDates.every((date) => Object.hasOwn(entries, date) && isInitialUploadEntryV2(entries[date]))) return false
  const baselines = value.baselines as Record<string, unknown>
  if (!Object.keys(baselines).every((date) => isRemoteBaselineV2(baselines[date], date))) return false
  const baselineValues = Object.values(baselines) as DayMemoSyncMetadataV3['baselines'][string][]
  if (new Set(baselineValues.map((baseline) => baseline.remoteChangeSequence)).size !== baselineValues.length) return false
  if (baselineValues.some((baseline) => baseline.deletedAt === null
    ? baseline.baselineLocalUpdatedAt === null
    : baseline.baselineLocalUpdatedAt !== null)) return false

  const intents = value.localDeleteIntents as Record<string, unknown>
  for (const [date, intent] of Object.entries(intents)) {
    if (!isRecord(intent) || intent.date !== date || !DATE_PATTERN.test(date) || !fromDateKey(date)
      || !Number.isSafeInteger(intent.baselineRevision) || Number(intent.baselineRevision) < 1
      || !Number.isSafeInteger(intent.baselineChangeSequence) || Number(intent.baselineChangeSequence) < 1
      || !isIsoDateTime(intent.deletedLocalUpdatedAt) || !isIsoDateTime(intent.createdAt)
      || !DELETE_INTENT_STATUSES_V3.includes(String(intent.status))) return false
    const baseline = baselines[date]
    if (!isRecord(baseline) || baseline.deletedAt !== null
      || baseline.remoteRevision !== intent.baselineRevision
      || baseline.remoteChangeSequence !== intent.baselineChangeSequence) return false
  }
  if (value.pushBlock !== null && (!isRecord(value.pushBlock)
    || !PUSH_BLOCK_REASONS.includes(String(value.pushBlock.reason))
    || !isIsoDateTime(value.pushBlock.blockedAt))) return false
  if (value.baselineStatus === 'confirmed') {
    if (value.baselineConfirmedAt === null || baselineValues.length === 0
      || baselineValues.some((baseline) => baseline.remoteChangeSequence > Number(value.lastPulledChangeSequence))
      || Math.max(...baselineValues.map((baseline) => baseline.remoteChangeSequence)) !== value.lastPulledChangeSequence) return false
  } else if (value.baselineStatus === 'remote_empty') {
    if (value.baselineConfirmedAt === null || baselineValues.length !== 0 || value.lastPulledChangeSequence !== 0) return false
  } else if (value.baselineStatus === 'mismatch') {
    if (value.baselineConfirmedAt !== null || baselineValues.length !== 0) return false
  } else if (value.baselineConfirmedAt !== null) return false
  if (value.initialUpload.status === 'not_started') return value.initialUpload.preparedAt === null && value.initialUpload.completedAt === null && value.initialUpload.targetDates.length === 0
  if (value.initialUpload.status === 'completed') return value.initialUpload.completedAt !== null && value.initialUpload.targetDates.length > 0 && value.initialUpload.targetDates.every((date) => (entries[date] as DayMemoInitialUploadEntryV2).status === 'applied')
  if (value.initialUpload.status === 'recovery_required' && value.initialUpload.targetDates.length === 0) return value.initialUpload.preparedAt === null && value.initialUpload.completedAt === null && value.pushBlock !== null
  return value.initialUpload.preparedAt !== null && value.initialUpload.completedAt === null && value.initialUpload.targetDates.length > 0
}

export function isDayMemoSyncMetadataV4(value: unknown): value is DayMemoSyncMetadataV4 {
  if (!isRecord(value) || value.version !== 4) return false
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
    'baselineConfirmedAt', 'baselineStatus', 'baselines', 'initialUpload', 'lastPulledChangeSequence',
    'lastSuccessfulSyncAt', 'localDeleteIntents', 'migration', 'pendingOperation', 'pushBlock', 'version', 'workspaceId',
  ])) return false
  if (!isRecord(value.migration)) return false
  const v3Shape = { ...value, version: 3, migration: { ...value.migration, sourceVersion: 3 } }
  if (!isDayMemoSyncMetadataV3(v3Shape)) return false
  if (!isRecord(value.migration)
    || JSON.stringify(Object.keys(value.migration).sort()) !== JSON.stringify(['migratedAt', 'sourceVersion', 'status'])
    || ![1, 2, 3, 4].includes(Number(value.migration.sourceVersion))) return false
  const candidate = value as unknown as DayMemoSyncMetadataV4
  if (candidate.pendingOperation) {
    const pendingKeys = candidate.pendingOperation.kind === 'upsert'
      ? ['baseRevision', 'date', 'kind', 'operationId', 'preparedAt', 'preparedLocalUpdatedAt', 'status']
      : ['baseRevision', 'clientDeletedAt', 'date', 'kind', 'operationId', 'preparedAt', 'status']
    if (JSON.stringify(Object.keys(candidate.pendingOperation).sort()) !== JSON.stringify(pendingKeys)) return false
  }
  const intents = candidate.localDeleteIntents as Record<string, unknown>
  for (const [date, intent] of Object.entries(intents)) {
    if (!isRecord(intent) || JSON.stringify(Object.keys(intent).sort()) !== JSON.stringify([
      'baselineChangeSequence', 'baselineRevision', 'createdAt', 'date', 'deletedLocalUpdatedAt', 'operationId', 'status',
    ]) || !isUuidV4(intent.operationId)) return false
    const pending = candidate.pendingOperation
    if (!isRecord(pending) || pending.kind !== 'delete' || pending.date !== date
      || pending.operationId !== intent.operationId
      || pending.baseRevision !== intent.baselineRevision) return false
    const baseline = candidate.baselines[date]
    if (!baseline || baseline.remoteRevision !== intent.baselineRevision
      || baseline.remoteChangeSequence !== intent.baselineChangeSequence) return false
  }
  if (candidate.pendingOperation?.kind === 'delete') {
    const intent = candidate.localDeleteIntents[candidate.pendingOperation.date]
    if (!intent || intent.operationId !== candidate.pendingOperation.operationId) return false
  }
  if (candidate.pendingOperation?.kind === 'upsert' && candidate.localDeleteIntents[candidate.pendingOperation.date]) return false
  return true
}

function projectCurrentToV1(metadata: DayMemoSyncMetadataV2 | DayMemoSyncMetadataV3 | DayMemoSyncMetadataV4): DayMemoSyncMetadataV1 {
  const status = metadata.initialUpload.status === 'partially_completed'
    ? 'partial'
    : metadata.initialUpload.status === 'recovery_required' ? 'blocked' : metadata.initialUpload.status
  return {
    version: 1,
    workspaceId: metadata.workspaceId,
    initialUploadStatus: status,
    preparedAt: metadata.initialUpload.preparedAt,
    completedAt: metadata.initialUpload.completedAt,
    targetDates: [...metadata.initialUpload.targetDates],
    entries: Object.fromEntries(Object.entries(metadata.initialUpload.entries).map(([date, entry]) => [date, { ...entry, baseRevision: 0 as const }])),
    lastPulledChangeSequence: metadata.lastPulledChangeSequence,
    pushBlock: metadata.pushBlock,
    lastSuccessfulSyncAt: metadata.lastSuccessfulSyncAt,
  }
}

export function loadDayMemoSyncMetadataAny(storage: Storage): DayMemoSyncAnyLoadResult {
  let raw: string | null
  try {
    raw = storage.getItem(DAY_MEMO_SYNC_STORAGE_KEY)
  } catch {
    return { status: 'storage_unavailable', metadata: null, raw: null }
  }
  if (raw === null) return { status: 'absent', metadata: null, raw: null }
  try {
    const value: unknown = JSON.parse(raw)
    return isDayMemoSyncMetadata(value) || isDayMemoSyncMetadataV2(value) || isDayMemoSyncMetadataV3(value) || isDayMemoSyncMetadataV4(value)
      ? { status: 'ready', metadata: value, raw }
      : { status: 'metadata_invalid', metadata: null, raw: null }
  } catch {
    return { status: 'metadata_invalid', metadata: null, raw: null }
  }
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
  const loaded = loadDayMemoSyncMetadataAny(storage)
  if (loaded.status !== 'ready') return { status: loaded.status, metadata: null }
  return {
    status: 'ready',
    metadata: loaded.metadata.version === 1 ? loaded.metadata : projectCurrentToV1(loaded.metadata),
  }
}

export function replaceDayMemoSyncMetadataV2(
  storage: Storage,
  metadata: DayMemoSyncMetadataV2 | DayMemoSyncMetadataV3 | DayMemoSyncMetadataV4,
  expectedCurrentRaw: string | null,
): DayMemoSyncV2SaveResult {
  if (!(isDayMemoSyncMetadataV2(metadata) || isDayMemoSyncMetadataV3(metadata) || isDayMemoSyncMetadataV4(metadata))) return 'metadata_invalid'
  const serialized = JSON.stringify(metadata)
  let current: string | null
  try {
    current = storage.getItem(DAY_MEMO_SYNC_STORAGE_KEY)
  } catch {
    return 'storage_unavailable'
  }
  if (current !== expectedCurrentRaw) return 'stale'

  const rollback = (failure: 'write_failed' | 'readback_failed'): DayMemoSyncV2SaveResult => {
    try {
      if (expectedCurrentRaw === null) storage.removeItem(DAY_MEMO_SYNC_STORAGE_KEY)
      else storage.setItem(DAY_MEMO_SYNC_STORAGE_KEY, expectedCurrentRaw)
      return storage.getItem(DAY_MEMO_SYNC_STORAGE_KEY) === expectedCurrentRaw ? failure : 'rollback_failed'
    } catch {
      return 'rollback_failed'
    }
  }

  try {
    storage.setItem(DAY_MEMO_SYNC_STORAGE_KEY, serialized)
  } catch {
    return rollback('write_failed')
  }
  try {
    const readBack = storage.getItem(DAY_MEMO_SYNC_STORAGE_KEY)
    if (readBack === serialized) {
      const parsed: unknown = JSON.parse(readBack)
      if (isDayMemoSyncMetadataV2(parsed) || isDayMemoSyncMetadataV3(parsed) || isDayMemoSyncMetadataV4(parsed)) return 'saved'
    }
  } catch {
    return rollback('readback_failed')
  }
  return rollback('readback_failed')
}

function statusV1ToV2(status: DayMemoSyncMetadataV1['initialUploadStatus']): DayMemoSyncMetadataV2['initialUpload']['status'] {
  if (status === 'partial') return 'partially_completed'
  if (status === 'blocked') return 'recovery_required'
  return status
}

function createV2FromV1(metadata: DayMemoSyncMetadataV1, localMemos: DayMemo[], migratedAt: string): DayMemoSyncMetadataV2 {
  const localByDate = new Map(localMemos.filter(isStoredDayMemo).map((memo) => [memo.date, memo]))
  const baselines: DayMemoSyncMetadataV2['baselines'] = {}
  if (metadata.pushBlock === null) {
    for (const [date, entry] of Object.entries(metadata.entries)) {
      const local = localByDate.get(date)
      if (entry.status === 'applied'
        && entry.remoteRevision !== null && entry.remoteRevision >= 1
        && entry.remoteChangeSequence !== null && entry.remoteChangeSequence >= 1
        && local?.updatedAt === entry.preparedUpdatedAt) {
        baselines[date] = {
          date,
          remoteRevision: entry.remoteRevision,
          remoteChangeSequence: entry.remoteChangeSequence,
          remoteUpdatedAt: entry.preparedUpdatedAt,
          baselineLocalUpdatedAt: local.updatedAt,
          deletedAt: null,
        }
      }
    }
  }
  return {
    version: 2,
    workspaceId: metadata.workspaceId,
    initialUpload: {
      status: statusV1ToV2(metadata.initialUploadStatus),
      preparedAt: metadata.preparedAt,
      completedAt: metadata.completedAt,
      targetDates: [...metadata.targetDates],
      entries: Object.fromEntries(Object.entries(metadata.entries).map(([date, entry]) => [date, { ...entry }])),
    },
    baselines,
    lastPulledChangeSequence: metadata.lastPulledChangeSequence,
    baselineStatus: 'not_confirmed',
    baselineConfirmedAt: null,
    pendingOperation: null,
    pushBlock: metadata.pushBlock,
    lastSuccessfulSyncAt: metadata.lastSuccessfulSyncAt,
    migration: { sourceVersion: 1, status: 'completed', migratedAt },
  }
}

function createEmptyV2(workspaceId: string, createdAt: string): DayMemoSyncMetadataV2 {
  return {
    version: 2,
    workspaceId,
    initialUpload: { status: 'not_started', preparedAt: null, completedAt: null, targetDates: [], entries: {} },
    baselines: {},
    lastPulledChangeSequence: 0,
    baselineStatus: 'not_confirmed',
    baselineConfirmedAt: null,
    pendingOperation: null,
    pushBlock: null,
    lastSuccessfulSyncAt: null,
    migration: { sourceVersion: 2, status: 'completed', migratedAt: createdAt },
  }
}

function createV3FromV2(metadata: DayMemoSyncMetadataV2, migratedAt: string, sourceVersion: 1 | 2 = 2): DayMemoSyncMetadataV3 {
  return {
    version: 3,
    workspaceId: metadata.workspaceId,
    initialUpload: {
      ...metadata.initialUpload,
      targetDates: [...metadata.initialUpload.targetDates],
      entries: Object.fromEntries(Object.entries(metadata.initialUpload.entries).map(([date, entry]) => [date, { ...entry }])),
    },
    baselines: Object.fromEntries(Object.entries(metadata.baselines).map(([date, baseline]) => [date, { ...baseline }])),
    localDeleteIntents: {},
    lastPulledChangeSequence: metadata.lastPulledChangeSequence,
    baselineStatus: metadata.baselineStatus,
    baselineConfirmedAt: metadata.baselineConfirmedAt,
    pendingOperation: metadata.pendingOperation ? { ...metadata.pendingOperation } : null,
    pushBlock: metadata.pushBlock ? { ...metadata.pushBlock } : null,
    lastSuccessfulSyncAt: metadata.lastSuccessfulSyncAt,
    migration: { sourceVersion, status: 'completed', migratedAt },
  }
}

export function migrateDayMemoSyncMetadataToV3(
  storage: Storage,
  workspaceId: string,
  localMemos: DayMemo[],
): DayMemoSyncMigrationResult {
  if (!isUuid(workspaceId) || !localMemos.every(isStoredDayMemo)
    || new Set(localMemos.map((memo) => memo.date)).size !== localMemos.length) {
    return { status: 'migration_invalid', metadata: null, raw: null, migrated: false }
  }
  const loaded = loadDayMemoSyncMetadataAny(storage)
  if (loaded.status === 'storage_unavailable') return { status: 'migration_save_failed', metadata: null, raw: null, migrated: false }
  if (loaded.status === 'metadata_invalid') return { status: 'metadata_v1_invalid', metadata: null, raw: null, migrated: false }
  if (loaded.status === 'ready' && loaded.metadata.workspaceId !== workspaceId) return { status: 'workspace_mismatch', metadata: null, raw: null, migrated: false }
  if (loaded.status === 'ready' && loaded.metadata.version === 4) return { status: 'ready', metadata: loaded.metadata, raw: loaded.raw, migrated: false }
  if (loaded.status === 'ready' && loaded.metadata.version === 3) return { status: 'ready', metadata: loaded.metadata, raw: loaded.raw, migrated: false }

  const now = new Date().toISOString()
  const v2 = loaded.status === 'ready' && loaded.metadata.version === 2
    ? loaded.metadata
    : loaded.status === 'ready' && loaded.metadata.version === 1
      ? createV2FromV1(loaded.metadata, localMemos, now)
      : createEmptyV2(workspaceId, now)
  if (!isDayMemoSyncMetadataV2(v2)) return { status: 'migration_invalid', metadata: null, raw: null, migrated: false }
  const next = createV3FromV2(v2, now, loaded.status === 'ready' && loaded.metadata.version === 1 ? 1 : 2)
  if (!isDayMemoSyncMetadataV3(next)) return { status: 'migration_invalid', metadata: null, raw: null, migrated: false }
  const saveResult = replaceDayMemoSyncMetadataV2(storage, next, loaded.status === 'ready' ? loaded.raw : null)
  if (saveResult === 'metadata_invalid') return { status: 'migration_invalid', metadata: null, raw: null, migrated: false }
  if (saveResult === 'readback_failed') return { status: 'migration_readback_failed', metadata: null, raw: null, migrated: false }
  if (saveResult === 'rollback_failed') return { status: 'migration_rollback_failed', metadata: null, raw: null, migrated: false }
  if (saveResult !== 'saved') return { status: 'migration_save_failed', metadata: null, raw: null, migrated: false }
  return { status: 'ready', metadata: next, raw: JSON.stringify(next), migrated: true }
}

export function saveDayMemoSyncMetadata(storage: Storage, metadata: DayMemoSyncMetadataV1): DayMemoSyncSaveResult {
  if (!isDayMemoSyncMetadata(metadata)) return 'metadata_invalid'
  const existing = loadDayMemoSyncMetadataAny(storage)
  if (existing.status === 'ready' && (existing.metadata.version === 2 || existing.metadata.version === 3 || existing.metadata.version === 4)) {
    if (existing.metadata.workspaceId !== metadata.workspaceId) return 'metadata_invalid'
    const next: DayMemoSyncMetadataV2 | DayMemoSyncMetadataV3 | DayMemoSyncMetadataV4 = {
      ...existing.metadata,
      initialUpload: {
        status: statusV1ToV2(metadata.initialUploadStatus),
        preparedAt: metadata.preparedAt,
        completedAt: metadata.completedAt,
        targetDates: [...metadata.targetDates],
        entries: Object.fromEntries(Object.entries(metadata.entries).map(([date, entry]) => [date, { ...entry }])),
      },
      lastPulledChangeSequence: metadata.lastPulledChangeSequence,
      pushBlock: metadata.pushBlock,
      lastSuccessfulSyncAt: metadata.lastSuccessfulSyncAt,
    }
    return replaceDayMemoSyncMetadataV2(storage, next, existing.raw) === 'saved' ? 'saved' : 'storage_unavailable'
  }
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
  const anyLoaded = loadDayMemoSyncMetadataAny(storage)
  if (anyLoaded.status === 'ready' && (anyLoaded.metadata.version === 2 || anyLoaded.metadata.version === 3 || anyLoaded.metadata.version === 4)) {
    const binding = workspaceId ?? anyLoaded.metadata.workspaceId
    if (binding !== anyLoaded.metadata.workspaceId) return { result: 'metadata_invalid', metadata: null }
    const next: DayMemoSyncMetadataV2 | DayMemoSyncMetadataV3 | DayMemoSyncMetadataV4 = {
      ...anyLoaded.metadata,
      pushBlock: { reason, blockedAt: new Date().toISOString() },
    }
    const result = replaceDayMemoSyncMetadataV2(storage, next, anyLoaded.raw)
    return result === 'saved'
      ? { result: 'saved', metadata: projectCurrentToV1(next) }
      : { result: result === 'metadata_invalid' ? 'metadata_invalid' : 'storage_unavailable', metadata: null }
  }
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
