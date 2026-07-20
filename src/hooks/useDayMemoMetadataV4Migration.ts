import { useCallback, useRef, useState } from 'react'
import type { SyncConnection } from '../types/sync'
import { analyzeDayMemoSyncMetadataV4Migration, isDayMemoSyncMetadataV4, loadDayMemoSyncMetadataAny, replaceDayMemoSyncMetadataV2 } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'

export type DayMemoMetadataV4MigrationClassification =
  | 'metadata_v4_migration_ready'
  | 'metadata_v4_migration_succeeded'
  | 'metadata_v4_already_current'
  | 'metadata_v4_migration_pending_ambiguous'
  | 'metadata_v4_migration_intent_without_pending'
  | 'metadata_v4_migration_pending_without_intent'
  | 'metadata_v4_migration_operation_unresolvable'
  | 'metadata_v4_migration_workspace_invalid'
  | 'metadata_v4_migration_baseline_mismatch'
  | 'metadata_v4_migration_metadata_invalid'
  | 'metadata_v4_migration_verification_stale'
  | 'metadata_v4_migration_persistence_failed'
  | 'metadata_v4_migration_rollback_failed'
  | 'metadata_v4_migration_unsupported'
  | 'metadata_v4_migration_state_unknown'

export interface DayMemoMetadataV4MigrationResult {
  sourceVersion: number | null
  targetVersion: 4
  ready: boolean
  classification: DayMemoMetadataV4MigrationClassification
  pendingCount: number
  deletePendingCount: number
  hasDeleteIntent: boolean
  operationResolvable: boolean
  targetMatches: boolean
  baselineMatches: boolean
  workspaceValid: boolean
  metadataValid: boolean
  persistentChanged: boolean
  rollbackAttempted: boolean
  checkedAt: string
  nextAction: string
}

interface Snapshot { raw: string; nextRaw: string }

function connectionEligible(connection: SyncConnection | null): boolean {
  return Boolean(connection && isUuid(connection.workspaceId))
}

function classificationFor(status: string): DayMemoMetadataV4MigrationClassification {
  switch (status) {
    case 'ready': return 'metadata_v4_migration_ready'
    case 'already_current': return 'metadata_v4_already_current'
    case 'pending_ambiguous': return 'metadata_v4_migration_pending_ambiguous'
    case 'intent_without_pending': return 'metadata_v4_migration_intent_without_pending'
    case 'pending_without_intent': return 'metadata_v4_migration_pending_without_intent'
    case 'operation_unresolvable': return 'metadata_v4_migration_operation_unresolvable'
    case 'baseline_mismatch': return 'metadata_v4_migration_baseline_mismatch'
    default: return 'metadata_v4_migration_unsupported'
  }
}

function nextAction(classification: DayMemoMetadataV4MigrationClassification): string {
  if (classification === 'metadata_v4_migration_ready') return '内容を変えず、明示操作でmetadata v4へ移行できます。'
  if (classification === 'metadata_v4_migration_succeeded' || classification === 'metadata_v4_already_current') return 'metadata v4を前提とする次の安全確認へ進めます。'
  if (classification === 'metadata_v4_migration_verification_stale') return '状態が変化しました。移行条件をもう一度確認してください。'
  if (classification === 'metadata_v4_migration_rollback_failed') return '自動再試行せず、永続状態の確認が必要です。'
  return '自動移行せず、pending・削除意図・baselineの状態を確認してください。'
}

export function useDayMemoMetadataV4Migration(connection: SyncConnection | null) {
  const [result, setResult] = useState<DayMemoMetadataV4MigrationResult | null>(null)
  const snapshotRef = useRef<Snapshot | null>(null)
  const eligible = connectionEligible(connection)

  const finish = useCallback((classification: DayMemoMetadataV4MigrationClassification, values: Partial<DayMemoMetadataV4MigrationResult> = {}) => {
    const next: DayMemoMetadataV4MigrationResult = {
      sourceVersion: values.sourceVersion ?? null,
      targetVersion: 4,
      ready: classification === 'metadata_v4_migration_ready',
      classification,
      pendingCount: values.pendingCount ?? 0,
      deletePendingCount: values.deletePendingCount ?? 0,
      hasDeleteIntent: values.hasDeleteIntent ?? false,
      operationResolvable: values.operationResolvable ?? false,
      targetMatches: values.targetMatches ?? false,
      baselineMatches: values.baselineMatches ?? false,
      workspaceValid: values.workspaceValid ?? false,
      metadataValid: values.metadataValid ?? false,
      persistentChanged: values.persistentChanged ?? false,
      rollbackAttempted: values.rollbackAttempted ?? false,
      checkedAt: new Date().toISOString(),
      nextAction: nextAction(classification),
    }
    setResult(next)
    return next
  }, [])

  const check = useCallback(() => {
    snapshotRef.current = null
    if (!eligible || !connection?.workspaceId) return finish('metadata_v4_migration_workspace_invalid')
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    if (loaded.status !== 'ready') return finish('metadata_v4_migration_metadata_invalid')
    const metadata = loaded.metadata
    const currentPending = metadata.version === 2 || metadata.version === 3 || metadata.version === 4
      ? metadata.pendingOperation : null
    const currentIntents = metadata.version === 3 || metadata.version === 4 ? metadata.localDeleteIntents : {}
    const common = {
      sourceVersion: metadata.version,
      pendingCount: currentPending ? 1 : 0,
      deletePendingCount: currentPending?.kind === 'delete' ? 1 : 0,
      hasDeleteIntent: Object.keys(currentIntents).length > 0,
      workspaceValid: metadata.workspaceId === connection.workspaceId,
      metadataValid: true,
    }
    if (!common.workspaceValid) return finish('metadata_v4_migration_workspace_invalid', common)
    const analysis = analyzeDayMemoSyncMetadataV4Migration(metadata)
    const classification = classificationFor(analysis.status)
    if (analysis.status === 'ready') snapshotRef.current = { raw: loaded.raw, nextRaw: JSON.stringify(analysis.next) }
    const resolved = analysis.status === 'ready' || analysis.status === 'already_current'
    return finish(classification, { ...common, operationResolvable: resolved, targetMatches: resolved, baselineMatches: resolved })
  }, [connection?.workspaceId, eligible, finish])

  const migrate = useCallback(() => {
    const snapshot = snapshotRef.current
    if (!snapshot || result?.classification !== 'metadata_v4_migration_ready') return
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    if (loaded.status !== 'ready' || loaded.raw !== snapshot.raw || loaded.metadata.workspaceId !== connection?.workspaceId) {
      snapshotRef.current = null
      finish('metadata_v4_migration_verification_stale', { sourceVersion: loaded.status === 'ready' ? loaded.metadata.version : null })
      return
    }
    let next: unknown
    try { next = JSON.parse(snapshot.nextRaw) } catch { next = null }
    if (!isDayMemoSyncMetadataV4(next)) {
      finish('metadata_v4_migration_operation_unresolvable', { sourceVersion: loaded.metadata.version, metadataValid: true, workspaceValid: true })
      return
    }
    const saved = replaceDayMemoSyncMetadataV2(window.localStorage, next, loaded.raw)
    snapshotRef.current = null
    if (saved !== 'saved') {
      finish(saved === 'rollback_failed' ? 'metadata_v4_migration_rollback_failed' : 'metadata_v4_migration_persistence_failed', {
        sourceVersion: loaded.metadata.version, metadataValid: true, workspaceValid: true, rollbackAttempted: true,
      })
      return
    }
    const readBack = loadDayMemoSyncMetadataAny(window.localStorage)
    if (readBack.status !== 'ready' || readBack.metadata.version !== 4 || readBack.raw !== snapshot.nextRaw || !isDayMemoSyncMetadataV4(readBack.metadata)) {
      const rollback = loaded.metadata.version === 2 || loaded.metadata.version === 3 || loaded.metadata.version === 4
        ? replaceDayMemoSyncMetadataV2(window.localStorage, loaded.metadata, snapshot.nextRaw) : 'metadata_invalid'
      const restored = loadDayMemoSyncMetadataAny(window.localStorage)
      const rollbackVerified = rollback === 'saved' && restored.status === 'ready' && restored.raw === loaded.raw
      finish(rollbackVerified ? 'metadata_v4_migration_persistence_failed' : 'metadata_v4_migration_rollback_failed', {
        sourceVersion: loaded.metadata.version, metadataValid: true, workspaceValid: true,
        persistentChanged: !rollbackVerified, rollbackAttempted: true,
      })
      return
    }
    finish('metadata_v4_migration_succeeded', { sourceVersion: 4, metadataValid: true, workspaceValid: true, operationResolvable: true, targetMatches: true, baselineMatches: true, persistentChanged: true })
  }, [connection?.workspaceId, finish, result?.classification])

  const discard = useCallback(() => { snapshotRef.current = null; setResult(null) }, [])
  return { eligible, result, check, migrate, discard }
}
