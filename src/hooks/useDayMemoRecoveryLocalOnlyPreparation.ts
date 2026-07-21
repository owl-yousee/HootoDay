import { useCallback, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoLocalOnlyRecoveryPendingOperationV5, DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { isStoredDayMemo, readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords } from '../utils/dayMemoSyncPull'
import { isDayMemoSyncMetadataV5, loadDayMemoSyncMetadataAny, replaceDayMemoSyncMetadataV2 } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import { createUuidV4 } from '../utils/uuid'
import type { DayMemoSavedRecoveryStateResult } from './useDayMemoSavedRecoveryStateCheck'
import { classifyDayMemoNormalDifference } from './useDayMemoNormalDifferenceRecoveryPlan'

export type DayMemoRecoveryLocalOnlyPreparationSafety =
  | 'recovery_local_only_prepared' | 'recovery_local_only_candidate_unavailable'
  | 'recovery_local_only_state_changed' | 'recovery_local_only_remote_appeared'
  | 'recovery_local_only_tombstone_appeared' | 'recovery_local_only_validation_failed'
  | 'recovery_local_only_persistence_failed' | 'recovery_local_only_rollback_failed'
  | 'recovery_local_only_cancelled' | 'recovery_local_only_unknown'

export interface DayMemoRecoveryLocalOnlyPreparationResult {
  safety: DayMemoRecoveryLocalOnlyPreparationSafety
  date: string | null
  operationMode: 'local_only_recovery' | null
  remoteAbsent: boolean
  tombstoneAbsent: boolean
  operationIdGenerated: boolean
  pendingCreated: boolean
  metadataSaved: boolean
  persistentStateChanged: boolean
  rpcSent: false
  checkedAt: string
}

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  reactMetadata: DayMemoSyncMetadataV5 | null
  savedRecoveryResult: DayMemoSavedRecoveryStateResult | null
  adoptVerifiedMetadata: (metadata: DayMemoSyncMetadataV5) => void
}

function eligibleConnection(connection: SyncConnection | null): connection is SyncConnection & { workspaceId: string } {
  return Boolean(connection && isUuid(connection.workspaceId))
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function useDayMemoRecoveryLocalOnlyPreparation(input: Input) {
  const { dayMemos, isConfigured, isSignedIn, connection, reactMetadata, savedRecoveryResult, adoptVerifiedMetadata } = input
  const [preparing, setPreparing] = useState(false)
  const [result, setResult] = useState<DayMemoRecoveryLocalOnlyPreparationResult | null>(null)
  const inFlight = useRef(false)
  const candidateDates = useMemo(() => savedRecoveryResult?.safety === 'normal_difference_checkpoint_saved_state_ready'
    ? Object.entries(savedRecoveryResult.unresolvedClassifications).filter(([, value]) => value === 'local_only').map(([date]) => date)
    : [], [savedRecoveryResult])
  const eligible = Boolean(isConfigured && isSignedIn && supabaseClient && eligibleConnection(connection)
    && candidateDates.length > 0 && reactMetadata?.pendingOperation === null
    && reactMetadata.baselineStatus === 'recovery_required' && reactMetadata.baselineConfirmedAt === null)
  const finish = useCallback((safety: DayMemoRecoveryLocalOnlyPreparationSafety,
    values: Partial<DayMemoRecoveryLocalOnlyPreparationResult> = {}) => setResult({ safety, date: null,
    operationMode: null, remoteAbsent: false, tombstoneAbsent: false, operationIdGenerated: false,
    pendingCreated: false, metadataSaved: false, persistentStateChanged: false, rpcSent: false,
    checkedAt: new Date().toISOString(), ...values }), [])

  const prepare = useCallback(async (date: string) => {
    if (inFlight.current || !eligible || !supabaseClient || !eligibleConnection(connection)
      || !candidateDates.includes(date)) return
    if (!window.confirm(`${date} のlocal-only 1件を同期先へ送る準備をします。この操作ではまだ送信しません。準備しますか？`)) {
      finish('recovery_local_only_cancelled', { date }); return
    }
    inFlight.current = true; setPreparing(true); setResult(null)
    try {
      const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
      const stored = readDayMemoStorageSnapshot(window.localStorage)
      if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata) || stored.status !== 'ready'
        || !reactMetadata || !same(reactMetadata, loaded.metadata) || !same(dayMemos, stored.memos)) {
        finish('recovery_local_only_state_changed', { date }); return
      }
      const metadata = loaded.metadata
      const locals = stored.memos.filter((memo) => memo.date === date)
      if (metadata.workspaceId !== connection.workspaceId || metadata.baselineStatus !== 'recovery_required'
        || metadata.baselineConfirmedAt !== null || metadata.pendingOperation || metadata.pushBlock
        || Object.keys(metadata.localDeleteIntents).length || metadata.baselines[date]
        || locals.length !== 1 || !isStoredDayMemo(locals[0])) {
        finish('recovery_local_only_validation_failed', { date }); return
      }
      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, connection.workspaceId).catch(() => null)
      const after = loadDayMemoSyncMetadataAny(window.localStorage)
      const afterLocal = readDayMemoStorageSnapshot(window.localStorage)
      if (!pulled || pulled.status !== 'complete' || after.status !== 'ready' || after.raw !== loaded.raw
        || afterLocal.status !== 'ready' || afterLocal.serialized !== stored.serialized) {
        finish('recovery_local_only_state_changed', { date }); return
      }
      const remoteByDate = new Map(pulled.records.map((record) => [record.entityId, record]))
      if (remoteByDate.size !== pulled.records.length) {
        finish('recovery_local_only_validation_failed', { date }); return
      }
      const remote = remoteByDate.get(date)
      if (remote?.deletedAt) { finish('recovery_local_only_tombstone_appeared', { date }); return }
      if (remote) { finish('recovery_local_only_remote_appeared', { date }); return }
      const localByDate = new Map(stored.memos.map((memo) => [memo.date, memo]))
      if (localByDate.size !== stored.memos.length) {
        finish('recovery_local_only_validation_failed', { date, remoteAbsent: true, tombstoneAbsent: true }); return
      }
      const dates = [...new Set([...localByDate.keys(), ...remoteByDate.keys(), ...Object.keys(metadata.baselines)])].sort()
      const classifications = Object.fromEntries(dates.map((itemDate) => [itemDate, classifyDayMemoNormalDifference(
        localByDate.get(itemDate) ?? null, remoteByDate.get(itemDate) ?? null, metadata.baselines[itemDate] ?? null)]))
      const unresolved = Object.fromEntries(Object.entries(classifications)
        .filter(([, classification]) => classification !== 'exact_match_baseline_confirmed'))
      if (pulled.maxChangeSequence !== metadata.lastPulledChangeSequence
        || classifications[date] !== 'local_only'
        || !same(unresolved, savedRecoveryResult?.unresolvedClassifications)) {
        finish('recovery_local_only_validation_failed', { date, remoteAbsent: true, tombstoneAbsent: true }); return
      }
      const operationId = createUuidV4()
      if (!operationId) { finish('recovery_local_only_validation_failed', { date, remoteAbsent: true, tombstoneAbsent: true }); return }
      const pending: DayMemoLocalOnlyRecoveryPendingOperationV5 = { kind: 'upsert', operationMode: 'local_only_recovery',
        date, operationId, baseRevision: 0, baseChangeSequence: 0, baseRemoteUpdatedAt: null,
        baseRemoteState: 'missing', preparedLocalUpdatedAt: locals[0].updatedAt,
        preparedAt: new Date().toISOString(), status: 'prepared' }
      const next: DayMemoSyncMetadataV5 = { ...metadata, pendingOperation: pending }
      if (!isDayMemoSyncMetadataV5(next)) {
        finish('recovery_local_only_validation_failed', { date, remoteAbsent: true, tombstoneAbsent: true, operationIdGenerated: true }); return
      }
      const saved = replaceDayMemoSyncMetadataV2(window.localStorage, next, loaded.raw)
      if (saved !== 'saved') {
        finish(saved === 'rollback_failed' ? 'recovery_local_only_rollback_failed' : 'recovery_local_only_persistence_failed',
          { date, remoteAbsent: true, tombstoneAbsent: true, operationIdGenerated: true }); return
      }
      const readBack = loadDayMemoSyncMetadataAny(window.localStorage)
      if (readBack.status !== 'ready' || !isDayMemoSyncMetadataV5(readBack.metadata) || readBack.raw !== JSON.stringify(next)) {
        const rollback = replaceDayMemoSyncMetadataV2(window.localStorage, metadata, JSON.stringify(next))
        finish(rollback === 'saved' ? 'recovery_local_only_persistence_failed' : 'recovery_local_only_rollback_failed',
          { date, remoteAbsent: true, tombstoneAbsent: true, operationIdGenerated: true }); return
      }
      adoptVerifiedMetadata(readBack.metadata)
      finish('recovery_local_only_prepared', { date, operationMode: 'local_only_recovery', remoteAbsent: true,
        tombstoneAbsent: true, operationIdGenerated: true, pendingCreated: true, metadataSaved: true,
        persistentStateChanged: true })
    } catch { finish('recovery_local_only_unknown', { date }) }
    finally { inFlight.current = false; setPreparing(false) }
  }, [adoptVerifiedMetadata, candidateDates, connection, dayMemos, eligible, finish, reactMetadata, savedRecoveryResult])

  const discard = useCallback(() => setResult(null), [])
  return { eligible, preparing, candidateDates, result, prepare, discard }
}
