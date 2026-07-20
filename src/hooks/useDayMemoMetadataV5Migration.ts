import { useCallback, useRef, useState } from 'react'
import type { DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import {
  analyzeDayMemoSyncMetadataV5Migration,
  isDayMemoSyncMetadataV5,
  loadDayMemoSyncMetadataAny,
  replaceDayMemoSyncMetadataV2,
} from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'

export type DayMemoMetadataV5MigrationClassification =
  | 'metadata_v5_migration_ready'
  | 'metadata_v5_migration_succeeded'
  | 'metadata_v5_already_current'
  | 'metadata_v5_migration_pending_normal'
  | 'metadata_v5_migration_pending_delete'
  | 'metadata_v5_migration_pending_invalid'
  | 'metadata_v5_migration_workspace_invalid'
  | 'metadata_v5_migration_metadata_invalid'
  | 'metadata_v5_migration_verification_stale'
  | 'metadata_v5_migration_persistence_failed'
  | 'metadata_v5_migration_rollback_succeeded'
  | 'metadata_v5_migration_rollback_failed'
  | 'metadata_v5_migration_unsupported'
  | 'metadata_v5_migration_state_unknown'

export type DayMemoMetadataV5PendingKind = 'none' | 'normal_upsert' | 'recovery_upsert' | 'delete' | 'invalid'

export interface DayMemoMetadataV5MigrationResult {
  sourceVersion: number | null
  targetVersion: 5
  ready: boolean
  classification: DayMemoMetadataV5MigrationClassification
  pendingCount: number
  pendingKind: DayMemoMetadataV5PendingKind
  pendingMigrationPossible: boolean
  workspaceValid: boolean
  metadataValid: boolean
  persistentChanged: boolean
  readBackSucceeded: boolean
  rollbackAttempted: boolean
  rollbackSucceeded: boolean
  checkedAt: string
  nextAction: string
}

interface Snapshot { sourceRaw: string; targetRaw: string; pendingKind: DayMemoMetadataV5PendingKind }

function nextAction(classification: DayMemoMetadataV5MigrationClassification): string {
  if (classification === 'metadata_v5_migration_ready') return '内容を変更せず、明示操作でmetadata v5へ移行できます。'
  if (classification === 'metadata_v5_already_current' || classification === 'metadata_v5_migration_succeeded') return 'metadata v5を前提とする次の安全確認へ進めます。'
  if (classification === 'metadata_v5_migration_verification_stale') return '状態が変化しました。移行条件をもう一度確認してください。'
  if (classification === 'metadata_v5_migration_rollback_failed') return '永続状態を安全に確認できません。自動修復せず停止してください。'
  return '自動移行せず、metadataと未完了操作の状態を確認してください。'
}

export function useDayMemoMetadataV5Migration(
  connection: SyncConnection | null,
  adoptVerifiedMetadata: (metadata: DayMemoSyncMetadataV5) => void,
) {
  const [result, setResult] = useState<DayMemoMetadataV5MigrationResult | null>(null)
  const snapshotRef = useRef<Snapshot | null>(null)
  const eligible = Boolean(connection && isUuid(connection.workspaceId))

  const finish = useCallback((classification: DayMemoMetadataV5MigrationClassification, values: Partial<DayMemoMetadataV5MigrationResult> = {}) => {
    const next: DayMemoMetadataV5MigrationResult = {
      sourceVersion: values.sourceVersion ?? null,
      targetVersion: 5,
      ready: classification === 'metadata_v5_migration_ready'
        || classification === 'metadata_v5_migration_pending_normal'
        || classification === 'metadata_v5_migration_pending_delete',
      classification,
      pendingCount: values.pendingCount ?? 0,
      pendingKind: values.pendingKind ?? 'invalid',
      pendingMigrationPossible: values.pendingMigrationPossible ?? false,
      workspaceValid: values.workspaceValid ?? false,
      metadataValid: values.metadataValid ?? false,
      persistentChanged: values.persistentChanged ?? false,
      readBackSucceeded: values.readBackSucceeded ?? false,
      rollbackAttempted: values.rollbackAttempted ?? false,
      rollbackSucceeded: values.rollbackSucceeded ?? false,
      checkedAt: new Date().toISOString(),
      nextAction: nextAction(classification),
    }
    setResult(next)
    return next
  }, [])

  const check = useCallback(() => {
    snapshotRef.current = null
    if (!eligible || !connection?.workspaceId) return finish('metadata_v5_migration_workspace_invalid')
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    if (loaded.status !== 'ready') return finish('metadata_v5_migration_metadata_invalid')
    const workspaceValid = loaded.metadata.workspaceId === connection.workspaceId
    const common = { sourceVersion: loaded.metadata.version, workspaceValid, metadataValid: true }
    if (!workspaceValid) return finish('metadata_v5_migration_workspace_invalid', common)
    const analysis = analyzeDayMemoSyncMetadataV5Migration(loaded.metadata)
    if (analysis.status === 'already_current') {
      return finish('metadata_v5_already_current', {
        ...common, pendingCount: analysis.next.pendingOperation ? 1 : 0,
        pendingKind: analysis.pendingKind, pendingMigrationPossible: true, readBackSucceeded: true,
      })
    }
    if (analysis.status !== 'ready') {
      return finish(analysis.status === 'pending_invalid' ? 'metadata_v5_migration_pending_invalid' : 'metadata_v5_migration_unsupported', {
        ...common, pendingKind: 'invalid',
      })
    }
    const classification = analysis.pendingKind === 'normal_upsert'
      ? 'metadata_v5_migration_pending_normal'
      : analysis.pendingKind === 'delete' ? 'metadata_v5_migration_pending_delete' : 'metadata_v5_migration_ready'
    snapshotRef.current = { sourceRaw: loaded.raw, targetRaw: JSON.stringify(analysis.next), pendingKind: analysis.pendingKind }
    return finish(classification, {
      ...common, pendingCount: analysis.next.pendingOperation ? 1 : 0,
      pendingKind: analysis.pendingKind, pendingMigrationPossible: true,
    })
  }, [connection?.workspaceId, eligible, finish])

  const migrate = useCallback(() => {
    const snapshot = snapshotRef.current
    if (!snapshot || !result?.ready) return
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    if (loaded.status !== 'ready' || loaded.raw !== snapshot.sourceRaw || loaded.metadata.workspaceId !== connection?.workspaceId) {
      snapshotRef.current = null
      finish('metadata_v5_migration_verification_stale', { sourceVersion: loaded.status === 'ready' ? loaded.metadata.version : null })
      return
    }
    let next: unknown
    try { next = JSON.parse(snapshot.targetRaw) } catch { next = null }
    if (!isDayMemoSyncMetadataV5(next)) {
      snapshotRef.current = null
      finish('metadata_v5_migration_pending_invalid', { sourceVersion: loaded.metadata.version, workspaceValid: true, metadataValid: true })
      return
    }
    const saved = replaceDayMemoSyncMetadataV2(window.localStorage, next, loaded.raw)
    if (saved !== 'saved') {
      snapshotRef.current = null
      const rollbackFailed = saved === 'rollback_failed'
      finish(rollbackFailed ? 'metadata_v5_migration_rollback_failed' : 'metadata_v5_migration_persistence_failed', {
        sourceVersion: loaded.metadata.version, workspaceValid: true, metadataValid: true,
        pendingKind: snapshot.pendingKind, pendingMigrationPossible: true,
        rollbackAttempted: true, rollbackSucceeded: !rollbackFailed,
      })
      return
    }
    const readBack = loadDayMemoSyncMetadataAny(window.localStorage)
    if (readBack.status !== 'ready' || !isDayMemoSyncMetadataV5(readBack.metadata) || readBack.raw !== snapshot.targetRaw) {
      const rollback = loaded.metadata.version === 4
        ? replaceDayMemoSyncMetadataV2(window.localStorage, loaded.metadata, snapshot.targetRaw) : 'metadata_invalid'
      const restored = loadDayMemoSyncMetadataAny(window.localStorage)
      const rollbackSucceeded = rollback === 'saved' && restored.status === 'ready' && restored.raw === loaded.raw
      snapshotRef.current = null
      finish(rollbackSucceeded ? 'metadata_v5_migration_rollback_succeeded' : 'metadata_v5_migration_rollback_failed', {
        sourceVersion: loaded.metadata.version, workspaceValid: true, metadataValid: true,
        pendingKind: snapshot.pendingKind, pendingMigrationPossible: true,
        persistentChanged: !rollbackSucceeded, rollbackAttempted: true, rollbackSucceeded,
      })
      return
    }
    snapshotRef.current = null
    adoptVerifiedMetadata(readBack.metadata)
    finish('metadata_v5_migration_succeeded', {
      sourceVersion: 4, workspaceValid: true, metadataValid: true,
      pendingCount: readBack.metadata.pendingOperation ? 1 : 0,
      pendingKind: snapshot.pendingKind, pendingMigrationPossible: true,
      persistentChanged: true, readBackSucceeded: true,
    })
  }, [adoptVerifiedMetadata, connection?.workspaceId, finish, result?.ready])

  const discard = useCallback(() => { snapshotRef.current = null; setResult(null) }, [])
  return { eligible, result, check, migrate, discard }
}
