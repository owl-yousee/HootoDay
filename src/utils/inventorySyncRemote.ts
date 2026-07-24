import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseClient } from '../lib/supabaseClient'
import type {
  InventorySyncRemoteSnapshotResponse,
  InventorySyncSaveRequest,
  InventorySyncSaveResponse,
} from '../types/inventorySync'
import {
  inventoryContentFingerprint,
  isInventorySyncRemoteSnapshotResponse,
  isInventorySyncSaveRequest,
  isInventorySyncSaveResponse,
} from './inventorySyncSnapshot'
import { isUuid } from './syncConnectionStorage'

export type InventorySyncRemoteFailure =
  | 'configuration_error'
  | 'authentication_error'
  | 'membership_error'
  | 'input_invalid'
  | 'rpc_error'
  | 'response_invalid'

export type InventorySyncRemoteResult<T> =
  | { status: 'success'; data: T }
  | { status: InventorySyncRemoteFailure; data: null }

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function normalizeSingleResult(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.length === 1 ? value[0] : null
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
}

export function normalizeInventoryRemoteSnapshotResponse(
  value: unknown,
  expectedWorkspaceId: string,
): InventorySyncRemoteSnapshotResponse | null {
  const row = normalizeSingleResult(value)
  if (!object(row) || !hasExactKeys(row, [
    'workspaceId', 'revision', 'snapshot', 'contentFingerprint',
  ])) return null
  if (!isInventorySyncRemoteSnapshotResponse(row) || row.workspaceId !== expectedWorkspaceId) return null
  return row
}

export function normalizeInventorySyncSaveResponse(value: unknown): InventorySyncSaveResponse | null {
  const row = normalizeSingleResult(value)
  if (!object(row) || !isInventorySyncSaveResponse(row)) return null
  const expectedKeys = row.status === 'conflict'
    ? ['status', 'currentRevision', 'currentContentFingerprint']
    : ['status', 'revision', 'contentFingerprint']
  return hasExactKeys(row, expectedKeys) ? row : null
}

function classifyRpcError(message: unknown): InventorySyncRemoteFailure {
  const text = typeof message === 'string' ? message.toLowerCase() : ''
  if (text.includes('authentication is required') || text.includes('jwt')) return 'authentication_error'
  if (text.includes('workspace membership is required')) return 'membership_error'
  return 'rpc_error'
}

async function hasAuthenticatedSession(client: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await client.auth.getSession()
    return !error && Boolean(data.session)
  } catch {
    return false
  }
}

export async function fetchInventoryRemoteSnapshot(
  workspaceId: string,
  client: SupabaseClient | null = supabaseClient,
): Promise<InventorySyncRemoteResult<InventorySyncRemoteSnapshotResponse>> {
  if (!client) return { status: 'configuration_error', data: null }
  if (!isUuid(workspaceId)) return { status: 'input_invalid', data: null }
  if (!await hasAuthenticatedSession(client)) return { status: 'authentication_error', data: null }

  try {
    const { data, error } = await client.rpc('get_app_inventory_snapshot', {
      target_workspace_id: workspaceId,
    })
    if (error) return { status: classifyRpcError(error.message), data: null }
    const normalized = normalizeInventoryRemoteSnapshotResponse(data, workspaceId)
    return normalized
      ? { status: 'success', data: normalized }
      : { status: 'response_invalid', data: null }
  } catch {
    return { status: 'rpc_error', data: null }
  }
}

export async function saveInventoryRemoteSnapshot(
  request: InventorySyncSaveRequest,
  client: SupabaseClient | null = supabaseClient,
): Promise<InventorySyncRemoteResult<InventorySyncSaveResponse>> {
  if (!client) return { status: 'configuration_error', data: null }
  if (!isUuid(request.workspaceId) || !isInventorySyncSaveRequest(request)) {
    return { status: 'input_invalid', data: null }
  }
  if (!await hasAuthenticatedSession(client)) return { status: 'authentication_error', data: null }

  try {
    const { data, error } = await client.rpc('save_app_inventory_snapshot', {
      target_workspace_id: request.workspaceId,
      operation_id: request.operationId,
      base_revision: request.baseRevision,
      target_snapshot: request.snapshot,
      target_content_fingerprint: request.contentFingerprint,
    })
    if (error) return { status: classifyRpcError(error.message), data: null }
    const normalized = normalizeInventorySyncSaveResponse(data)
    return normalized
      ? { status: 'success', data: normalized }
      : { status: 'response_invalid', data: null }
  } catch {
    return { status: 'rpc_error', data: null }
  }
}

export function verifyInventoryRemoteReadBack(
  request: InventorySyncSaveRequest,
  saveResponse: InventorySyncSaveResponse,
  remoteResponse: InventorySyncRemoteSnapshotResponse,
): boolean {
  if (!isInventorySyncSaveRequest(request) ||
    saveResponse.status === 'conflict' ||
    !isInventorySyncSaveResponse(saveResponse) ||
    !isInventorySyncRemoteSnapshotResponse(remoteResponse) ||
    remoteResponse.snapshot === null) return false
  const expectedRevision = request.baseRevision === null ? 1 : request.baseRevision + 1
  return saveResponse.revision === expectedRevision &&
    remoteResponse.workspaceId === request.workspaceId &&
    remoteResponse.revision === expectedRevision &&
    remoteResponse.snapshot.revision === expectedRevision &&
    saveResponse.contentFingerprint === request.contentFingerprint &&
    remoteResponse.contentFingerprint === request.contentFingerprint &&
    inventoryContentFingerprint(remoteResponse.snapshot) === request.contentFingerprint
}
