import type { DayMemo } from '../types/dayMemo'
import { fromDateKey } from './date'

export interface DayMemoSyncResultRecord {
  status: string
  workspace_id: string
  entity_type: string
  entity_id: string
  revision: number
  change_sequence: number
  server_updated_at: string
  deleted_at: string | null
  payload: unknown
  conflict: boolean
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoDateTime(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE_TIME_PATTERN.test(value) && !Number.isNaN(Date.parse(value))
}

export function normalizeDayMemoSyncResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : null
  return value
}

export function isAppliedDayMemoSyncResult(
  value: unknown,
  workspaceId: string,
  memo: DayMemo,
  baseRevision: number,
  previousChangeSequence: number,
): value is DayMemoSyncResultRecord {
  if (!isRecord(value) || !isRecord(value.payload)) return false
  const keys = Object.keys(value.payload).sort()
  return value.status === 'applied'
    && value.workspace_id === workspaceId
    && value.entity_type === 'day_memo'
    && value.entity_id === memo.date
    && DATE_PATTERN.test(memo.date)
    && Boolean(fromDateKey(memo.date))
    && value.revision === baseRevision + 1
    && Number.isSafeInteger(value.change_sequence)
    && Number(value.change_sequence) > previousChangeSequence
    && isIsoDateTime(value.server_updated_at)
    && value.deleted_at === null
    && value.conflict === false
    && JSON.stringify(keys) === JSON.stringify(['content', 'date', 'updatedAt'])
    && value.payload.date === memo.date
    && value.payload.content === memo.content
    && value.payload.updatedAt === memo.updatedAt
}

export function isConflictDayMemoSyncResult(
  value: unknown,
  workspaceId: string,
  date: string,
): value is DayMemoSyncResultRecord {
  return isRecord(value)
    && value.status === 'conflict'
    && value.workspace_id === workspaceId
    && value.entity_type === 'day_memo'
    && value.entity_id === date
    && value.conflict === true
    && Number.isSafeInteger(value.revision)
    && Number(value.revision) >= 0
    && Number.isSafeInteger(value.change_sequence)
    && Number(value.change_sequence) >= 0
    && (value.server_updated_at === null || isIsoDateTime(value.server_updated_at))
    && (value.deleted_at === null || isIsoDateTime(value.deleted_at))
}
