import type { DayMemo } from '../types/dayMemo'
import { fromDateKey } from './date'
import { isUuid } from './syncConnectionStorage'

export type DayMemoSyncOperationKind = 'upsert' | 'delete'

export interface DayMemoSyncSavedOperationResult {
  found: true
  resultStatus: 'applied' | 'conflict'
  workspaceId: string
  entityType: 'day_memo'
  entityId: string
  operationKind: DayMemoSyncOperationKind
  requestBaseRevision: number
  requestFingerprint: string
  resultRevision: number
  resultChangeSequence: number
  resultServerUpdatedAt: string | null
  resultDeletedAt: string | null
  resultPayload: unknown
  operationCreatedAt: string
  conflict: boolean
}

export type DayMemoSyncOperationResultRead =
  | DayMemoSyncSavedOperationResult
  | { found: false }

const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/
const REQUEST_FINGERPRINT_PATTERN = /^[0-9a-f]{32}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoDateTime(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE_TIME_PATTERN.test(value) && !Number.isNaN(Date.parse(value))
}

function normalizeSingleRow(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.length === 1 ? value[0] : null
}

function isCanonicalDayMemoPayload(value: unknown, expectedDate: string): value is DayMemo {
  if (!isRecord(value)) return false
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify(['content', 'date', 'updatedAt'])
    && value.date === expectedDate
    && typeof value.content === 'string'
    && value.content.length >= 1
    && value.content.length <= 2000
    && value.content === value.content.trim()
    && isIsoDateTime(value.updatedAt)
}

export function canonicalDayMemoPayloadFingerprint(memo: DayMemo): string {
  return JSON.stringify({ content: memo.content, date: memo.date, updatedAt: memo.updatedAt })
}

export function normalizeDayMemoSyncOperationResult(value: unknown): DayMemoSyncOperationResultRead | null {
  const row = normalizeSingleRow(value)
  if (!isRecord(row) || typeof row.found !== 'boolean') return null
  const expectedKeys = [
    'conflict', 'entity_id', 'entity_type', 'found', 'operation_created_at', 'operation_kind',
    'request_base_revision', 'request_fingerprint', 'result_change_sequence', 'result_deleted_at',
    'result_payload', 'result_revision', 'result_server_updated_at', 'result_status', 'workspace_id',
  ]
  if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(expectedKeys)) return null
  if (row.found === false) {
    const nonFoundKeys = Object.entries(row).filter(([key, field]) => key !== 'found' && field !== null)
    return nonFoundKeys.length === 0 ? { found: false } : null
  }
  if (row.result_status !== 'applied' && row.result_status !== 'conflict') return null
  if (row.entity_type !== 'day_memo' || typeof row.entity_id !== 'string' || !fromDateKey(row.entity_id)) return null
  if (row.operation_kind !== 'upsert' && row.operation_kind !== 'delete') return null
  if (!isUuid(row.workspace_id) || !REQUEST_FINGERPRINT_PATTERN.test(String(row.request_fingerprint))) return null
  if (!Number.isSafeInteger(row.request_base_revision) || Number(row.request_base_revision) < 0
    || !Number.isSafeInteger(row.result_revision) || Number(row.result_revision) < 0
    || !Number.isSafeInteger(row.result_change_sequence) || Number(row.result_change_sequence) < 0
    || !isIsoDateTime(row.operation_created_at)
    || !(row.result_server_updated_at === null || isIsoDateTime(row.result_server_updated_at))
    || !(row.result_deleted_at === null || isIsoDateTime(row.result_deleted_at))
    || typeof row.conflict !== 'boolean'
    || row.conflict !== (row.result_status === 'conflict')) return null
  if (row.result_status === 'applied') {
    const active = row.result_deleted_at === null && isCanonicalDayMemoPayload(row.result_payload, row.entity_id)
    const tombstone = isIsoDateTime(row.result_deleted_at) && row.result_payload === null
    if (Number(row.result_revision) < 1 || Number(row.result_change_sequence) < 1
      || !isIsoDateTime(row.result_server_updated_at) || (!active && !tombstone)) return null
  }

  return {
    found: true,
    resultStatus: row.result_status,
    workspaceId: row.workspace_id,
    entityType: 'day_memo',
    entityId: row.entity_id,
    operationKind: row.operation_kind,
    requestBaseRevision: Number(row.request_base_revision),
    requestFingerprint: String(row.request_fingerprint),
    resultRevision: Number(row.result_revision),
    resultChangeSequence: Number(row.result_change_sequence),
    resultServerUpdatedAt: row.result_server_updated_at,
    resultDeletedAt: row.result_deleted_at,
    resultPayload: row.result_payload,
    operationCreatedAt: row.operation_created_at,
    conflict: row.conflict,
  }
}

export function operationResultMatchesAppliedDayMemo(
  result: DayMemoSyncSavedOperationResult,
  workspaceId: string,
  memo: DayMemo,
  baseRevision: number,
  baseChangeSequence: number,
): boolean {
  if (!isCanonicalDayMemoPayload(result.resultPayload, memo.date)) return false
  return result.resultStatus === 'applied'
    && !result.conflict
    && result.workspaceId === workspaceId
    && result.entityId === memo.date
    && result.operationKind === 'upsert'
    && result.requestBaseRevision === baseRevision
    && result.resultRevision === baseRevision + 1
    && result.resultChangeSequence > baseChangeSequence
    && result.resultServerUpdatedAt !== null
    && result.resultDeletedAt === null
    && canonicalDayMemoPayloadFingerprint(result.resultPayload)
      === canonicalDayMemoPayloadFingerprint(memo)
}
