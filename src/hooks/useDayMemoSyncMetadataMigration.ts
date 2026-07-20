import { useCallback, useEffect, useState } from 'react'
import type { DayMemo } from '../types/dayMemo'
import type { SyncConnection } from '../types/sync'
import { loadDayMemoSyncMetadataAny, migrateDayMemoSyncMetadataToV3 } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'

export type DayMemoSyncMetadataMigrationState =
  | 'unavailable'
  | 'needs_migration'
  | 'migrating'
  | 'completed'
  | 'error'
  | 'rollback_failed'

interface Input {
  dayMemos: DayMemo[]
  connection: SyncConnection | null
}

export function useDayMemoSyncMetadataMigration({ dayMemos, connection }: Input) {
  const [state, setState] = useState<DayMemoSyncMetadataMigrationState>('unavailable')
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const eligible = Boolean(connection?.workspaceId && isUuid(connection.workspaceId) && connection.pairingStatus !== 'unpaired')

  useEffect(() => {
    if (!eligible || !connection?.workspaceId) {
      setState('unavailable')
      return
    }
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    if (loaded.status === 'ready' && loaded.metadata.workspaceId === connection.workspaceId) {
      setState(loaded.metadata.version === 3 ? 'completed' : 'needs_migration')
      return
    }
    setState(loaded.status === 'absent' ? 'needs_migration' : 'error')
  }, [connection?.workspaceId, eligible])

  const migrate = useCallback(() => {
    if (!eligible || !connection?.workspaceId || state === 'migrating' || state === 'completed') return
    setState('migrating')
    setSafeErrorMessage(null)
    const result = migrateDayMemoSyncMetadataToV3(window.localStorage, connection.workspaceId, dayMemos)
    if (result.status === 'ready') {
      setState('completed')
      return
    }
    if (result.status === 'migration_rollback_failed') {
      setState('rollback_failed')
      setSafeErrorMessage('同期metadataのrollbackを確認できませんでした。送信せず確認してください。')
      return
    }
    setState('error')
    setSafeErrorMessage('同期metadataを安全にversion 3へ移行できませんでした。旧versionを維持しています。')
  }, [connection?.workspaceId, dayMemos, eligible, state])

  return { eligible, state, metadataVersion: state === 'completed' ? 3 : null, safeErrorMessage, migrate }
}
