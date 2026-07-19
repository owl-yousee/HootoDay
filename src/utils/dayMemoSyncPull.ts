import type { SupabaseClient } from '@supabase/supabase-js'
import type { DayMemo } from '../types/dayMemo'
import { fromDateKey } from './date'

export const DAY_MEMO_PULL_PAGE_LIMIT = 100
export const DAY_MEMO_PULL_MAX_PAGES = 20
export const DAY_MEMO_PULL_MAX_RECORDS = DAY_MEMO_PULL_PAGE_LIMIT * DAY_MEMO_PULL_MAX_PAGES

export interface RemoteDayMemoRecord {
  workspaceId: string
  entityId: string
  revision: number
  changeSequence: number
  serverUpdatedAt: string
  deletedAt: string | null
  payload: DayMemo | null
}

export type DayMemoFullPullResult =
  | { status: 'complete'; records: RemoteDayMemoRecord[]; maxChangeSequence: number }
  | { status: 'cancelled' | 'authentication_error' | 'membership_error' | 'rpc_error' | 'validation_error' | 'limit_reached'; records: null; maxChangeSequence: null }

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoDateTime(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE_TIME_PATTERN.test(value) && !Number.isNaN(Date.parse(value))
}

function isValidPayload(value: unknown, expectedDate: string): value is DayMemo {
  if (!isRecord(value)) return false
  const keys = Object.keys(value).sort()
  return JSON.stringify(keys) === JSON.stringify(['content', 'date', 'updatedAt'])
    && value.date === expectedDate
    && typeof value.content === 'string'
    && value.content.length >= 1
    && value.content.length <= 2000
    && value.content === value.content.trim()
    && isIsoDateTime(value.updatedAt)
}

export function validateRemoteDayMemoRecord(value: unknown, workspaceId: string): RemoteDayMemoRecord | null {
  if (!isRecord(value)
    || value.status !== 'current'
    || value.workspace_id !== workspaceId
    || value.entity_type !== 'day_memo'
    || typeof value.entity_id !== 'string'
    || !DATE_PATTERN.test(value.entity_id)
    || !fromDateKey(value.entity_id)
    || !Number.isSafeInteger(value.revision)
    || Number(value.revision) < 1
    || !Number.isSafeInteger(value.change_sequence)
    || Number(value.change_sequence) < 1
    || !isIsoDateTime(value.server_updated_at)
    || value.conflict !== false) return null
  if (value.deleted_at === null) {
    if (!isValidPayload(value.payload, value.entity_id)) return null
    return {
      workspaceId,
      entityId: value.entity_id,
      revision: Number(value.revision),
      changeSequence: Number(value.change_sequence),
      serverUpdatedAt: value.server_updated_at,
      deletedAt: null,
      payload: { ...value.payload },
    }
  }
  if (!isIsoDateTime(value.deleted_at) || value.payload !== null) return null
  return {
    workspaceId,
    entityId: value.entity_id,
    revision: Number(value.revision),
    changeSequence: Number(value.change_sequence),
    serverUpdatedAt: value.server_updated_at,
    deletedAt: value.deleted_at,
    payload: null,
  }
}

export async function pullAllDayMemoSyncRecords(
  client: SupabaseClient,
  workspaceId: string,
  shouldContinue: () => boolean = () => true,
): Promise<DayMemoFullPullResult> {
  const records: RemoteDayMemoRecord[] = []
  const entityIds = new Set<string>()
  const changeSequences = new Set<number>()
  let cursor = 0

  for (let page = 0; page < DAY_MEMO_PULL_MAX_PAGES; page += 1) {
    if (!shouldContinue()) return { status: 'cancelled', records: null, maxChangeSequence: null }
    const { data, error } = await client.rpc('hooto_day_pull_sync_records', {
      target_workspace_id: workspaceId,
      after_change_sequence: cursor,
      limit_count: DAY_MEMO_PULL_PAGE_LIMIT,
    })
    if (!shouldContinue()) return { status: 'cancelled', records: null, maxChangeSequence: null }
    if (error) {
      const message = typeof error.message === 'string' ? error.message.toLowerCase() : ''
      const status = message.includes('authentication is required')
        ? 'authentication_error'
        : message.includes('workspace membership is required') ? 'membership_error' : 'rpc_error'
      return { status, records: null, maxChangeSequence: null }
    }
    if (!Array.isArray(data) || data.length > DAY_MEMO_PULL_PAGE_LIMIT) {
      return { status: 'validation_error', records: null, maxChangeSequence: null }
    }
    let nextCursor = cursor
    for (const value of data) {
      const record = validateRemoteDayMemoRecord(value, workspaceId)
      if (!record
        || record.changeSequence <= nextCursor
        || entityIds.has(record.entityId)
        || changeSequences.has(record.changeSequence)) {
        return { status: 'validation_error', records: null, maxChangeSequence: null }
      }
      records.push(record)
      entityIds.add(record.entityId)
      changeSequences.add(record.changeSequence)
      nextCursor = record.changeSequence
    }
    if (data.length < DAY_MEMO_PULL_PAGE_LIMIT) {
      return { status: 'complete', records, maxChangeSequence: records.at(-1)?.changeSequence ?? 0 }
    }
    if (nextCursor <= cursor || records.length >= DAY_MEMO_PULL_MAX_RECORDS) {
      return { status: 'limit_reached', records: null, maxChangeSequence: null }
    }
    cursor = nextCursor
  }
  return { status: 'limit_reached', records: null, maxChangeSequence: null }
}
