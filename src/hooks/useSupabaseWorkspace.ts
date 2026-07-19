import { useCallback, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { SyncConnection } from '../types/sync'
import {
  isUuid,
  loadOrCreateSyncConnection,
  saveSyncConnection,
  type SyncConnectionLoadResult,
} from '../utils/syncConnectionStorage'

export type SupabaseWorkspaceState =
  | 'unavailable'
  | 'not_created'
  | 'creating'
  | 'created'
  | 'error'
  | 'recovery_required'

const WORKSPACE_NAME = 'HootoDay'
const PARENT_DEVICE_LABEL = 'hootoday-parent-pc'
const CREATE_ERROR_MESSAGE = '同期先を作成できませんでした。通信状態を確認してください。'
const RECOVERY_MESSAGE = '同期先が作成済みの可能性があります。確認が必要です。自動で再実行しないでください。'
const STORAGE_ERROR_MESSAGE = 'この端末へ同期先情報を安全に保存できませんでした。'

function getInitialWorkspaceState(result: SyncConnectionLoadResult): SupabaseWorkspaceState {
  if (result.status !== 'ready') {
    return result.status === 'invalid' ? 'recovery_required' : 'error'
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
    if (initialResult.status === 'invalid') return RECOVERY_MESSAGE
    if (initialResult.status === 'unavailable') return STORAGE_ERROR_MESSAGE
    return null
  })
  const creationInFlightRef = useRef(false)

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
    workspaceState,
    workspaceConnected: workspaceState === 'created' && Boolean(connection?.workspaceId),
    createWorkspace,
    safeErrorMessage: workspaceState === 'error' ? (safeErrorMessage ?? CREATE_ERROR_MESSAGE) : safeErrorMessage,
  }
}
