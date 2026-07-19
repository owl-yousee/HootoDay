import { useCallback, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { SyncConnection } from '../types/sync'
import {
  isUuid,
  loadOrCreateSyncConnection,
  saveSyncConnection,
  saveSyncConnectionWithStatus,
  type SyncConnectionLoadResult,
} from '../utils/syncConnectionStorage'

export type SupabaseWorkspaceState =
  | 'unavailable'
  | 'not_created'
  | 'creating'
  | 'created'
  | 'error'
  | 'recovery_required'

export type ConnectAsMemberResult =
  | 'saved'
  | 'metadata_invalid'
  | 'storage_unavailable'
  | 'precondition_failed'
  | 'unexpected_failure'

const WORKSPACE_NAME = 'HootoDay'
const PARENT_DEVICE_LABEL = 'hootoday-parent-pc'
const CREATE_ERROR_MESSAGE = '同期先を作成できませんでした。通信状態を確認してください。'
const RECOVERY_MESSAGE = '同期先が作成済みの可能性があります。確認が必要です。自動で再実行しないでください。'
const UUID_ERROR_MESSAGE = 'この環境では端末識別情報を安全に作成できませんでした。'
const STORAGE_ERROR_MESSAGE = 'この端末へ同期先情報を保存できませんでした。ブラウザの保存設定を確認してください。'
const METADATA_ERROR_MESSAGE = 'この端末の同期設定を安全に確認できませんでした。'
const INITIALIZATION_ERROR_MESSAGE = 'この端末の同期設定を初期化できませんでした。'

function getInitialWorkspaceState(result: SyncConnectionLoadResult): SupabaseWorkspaceState {
  if (result.status !== 'ready') {
    return result.status === 'metadata_invalid' ? 'recovery_required' : 'error'
  }
  return result.connection.workspaceId ? 'created' : 'not_created'
}

export function useSupabaseWorkspace(isSignedIn: boolean) {
  const [initialResult] = useState(() => loadOrCreateSyncConnection(window.localStorage))
  const [connection, setConnection] = useState<SyncConnection | null>(initialResult.connection)
  const [workspaceState, setWorkspaceState] = useState<SupabaseWorkspaceState>(
    getInitialWorkspaceState(initialResult),
  )
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(() => {
    if (initialResult.status === 'uuid_unavailable') return UUID_ERROR_MESSAGE
    if (initialResult.status === 'storage_unavailable') return STORAGE_ERROR_MESSAGE
    if (initialResult.status === 'metadata_invalid') return METADATA_ERROR_MESSAGE
    if (initialResult.status === 'initialization_failed') return INITIALIZATION_ERROR_MESSAGE
    return null
  })
  const creationInFlightRef = useRef(false)

  const connectAsMember = useCallback((workspaceId: string): ConnectAsMemberResult => {
    if (!connection
      || connection.workspaceId
      || workspaceState !== 'not_created'
      || !isUuid(workspaceId)) {
      return 'precondition_failed'
    }

    try {
      const nextConnection: SyncConnection = {
        ...connection,
        workspaceId,
        deviceRole: 'child',
        workspaceRole: 'member',
        pairingStatus: 'member',
        pairedAt: new Date().toISOString(),
      }

      const saveResult = saveSyncConnectionWithStatus(window.localStorage, nextConnection)
      if (saveResult !== 'saved') return saveResult

      setConnection(nextConnection)
      setWorkspaceState('created')
      setSafeErrorMessage(null)
      return 'saved'
    } catch {
      return 'unexpected_failure'
    }
  }, [connection, workspaceState])

  const createWorkspace = useCallback(async () => {
    if (!supabaseClient
      || !isSignedIn
      || !connection
      || connection.workspaceId
      || workspaceState !== 'not_created'
      || creationInFlightRef.current) {
      return
    }

    creationInFlightRef.current = true
    setWorkspaceState('creating')
    setSafeErrorMessage(null)

    try {
      const { data, error } = await supabaseClient.rpc('create_app_workspace', {
        workspace_name: WORKSPACE_NAME,
        device_label: PARENT_DEVICE_LABEL,
      })

      if (error) {
        setWorkspaceState('recovery_required')
        setSafeErrorMessage(RECOVERY_MESSAGE)
        return
      }

      if (!isUuid(data)) {
        setWorkspaceState('recovery_required')
        setSafeErrorMessage(RECOVERY_MESSAGE)
        return
      }

      const pairedAt = new Date().toISOString()
      const nextConnection: SyncConnection = {
        ...connection,
        workspaceId: data,
        deviceRole: 'parent',
        workspaceRole: 'owner',
        pairingStatus: 'owner',
        pairedAt,
      }

      if (!saveSyncConnection(window.localStorage, nextConnection)) {
        setWorkspaceState('recovery_required')
        setSafeErrorMessage(STORAGE_ERROR_MESSAGE)
        return
      }

      setConnection(nextConnection)
      setWorkspaceState('created')
    } catch {
      setWorkspaceState('recovery_required')
      setSafeErrorMessage(RECOVERY_MESSAGE)
    } finally {
      creationInFlightRef.current = false
    }
  }, [connection, isSignedIn, workspaceState])

  return {
    connection,
    workspaceState,
    workspaceConnected: workspaceState === 'created' && Boolean(connection?.workspaceId),
    createWorkspace,
    connectAsMember,
    safeErrorMessage: workspaceState === 'error' ? (safeErrorMessage ?? CREATE_ERROR_MESSAGE) : safeErrorMessage,
  }
}
