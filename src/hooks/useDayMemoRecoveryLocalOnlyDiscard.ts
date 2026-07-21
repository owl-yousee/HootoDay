import { useCallback, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { saveDayMemoPullApplyBackup } from '../utils/dayMemoPullApplyBackupStorage'
import { isStoredDayMemo, readDayMemoStorageSnapshot, replaceStoredDayMemosVerified } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords } from '../utils/dayMemoSyncPull'
import { isDayMemoSyncMetadataV5, loadDayMemoSyncMetadataAny } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import { classifyDayMemoNormalDifference } from './useDayMemoNormalDifferenceRecoveryPlan'
import type { DayMemoSavedRecoveryStateResult } from './useDayMemoSavedRecoveryStateCheck'

export type DayMemoRecoveryLocalOnlyDiscardSafety =
  | 'recovery_local_only_discarded' | 'recovery_local_only_discard_cancelled'
  | 'recovery_local_only_discard_state_changed' | 'recovery_local_only_discard_remote_changed'
  | 'recovery_local_only_discard_backup_failed' | 'recovery_local_only_discard_save_failed'
  | 'recovery_local_only_discard_readback_failed' | 'recovery_local_only_discard_rollback_failed'
  | 'recovery_local_only_discard_unknown'

export interface DayMemoRecoveryLocalOnlyDiscardResult {
  safety: DayMemoRecoveryLocalOnlyDiscardSafety
  date: string | null
  localState: 'unchanged' | 'discarded' | 'rolled_back' | 'uncertain'
  metadataChanged: false
  remoteWritten: false
  pendingCreated: false
  operationIdGenerated: false
  fullPullCount: 0 | 1
  checkedAt: string
}

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  reactMetadata: DayMemoSyncMetadataV5 | null
  savedRecoveryResult: DayMemoSavedRecoveryStateResult | null
  adoptVerifiedStoredDayMemos: (memos: DayMemo[]) => void
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
function eligibleConnection(connection: SyncConnection | null): connection is SyncConnection & { workspaceId: string } {
  return Boolean(connection && isUuid(connection.workspaceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}

export function useDayMemoRecoveryLocalOnlyDiscard(input: Input) {
  const [discarding, setDiscarding] = useState(false)
  const [result, setResult] = useState<DayMemoRecoveryLocalOnlyDiscardResult | null>(null)
  const inFlight = useRef(false)
  const runId = useRef(0)
  const candidateDates = useMemo(() => input.savedRecoveryResult?.safety === 'normal_difference_checkpoint_saved_state_ready'
    ? Object.entries(input.savedRecoveryResult.unresolvedClassifications)
      .filter(([, classification]) => classification === 'local_only').map(([date]) => date)
    : [], [input.savedRecoveryResult])
  const eligible = Boolean(input.isConfigured && input.isSignedIn && supabaseClient
    && eligibleConnection(input.connection) && input.reactMetadata?.version === 5
    && input.reactMetadata.baselineStatus === 'recovery_required' && input.reactMetadata.baselineConfirmedAt === null
    && input.reactMetadata.pendingOperation === null && input.reactMetadata.pushBlock === null
    && Object.keys(input.reactMetadata.localDeleteIntents).length === 0 && candidateDates.length > 0)

  const finish = useCallback((safety: DayMemoRecoveryLocalOnlyDiscardSafety,
    values: Partial<DayMemoRecoveryLocalOnlyDiscardResult> = {}) => {
    setResult({ safety, date: null, localState: 'unchanged', metadataChanged: false, remoteWritten: false,
      pendingCreated: false, operationIdGenerated: false, fullPullCount: 0,
      checkedAt: new Date().toISOString(), ...values })
  }, [])

  const discardLocalOnly = useCallback(async (date: string) => {
    if (inFlight.current || !eligible || !supabaseClient || !eligibleConnection(input.connection)
      || !candidateDates.includes(date)) return
    if (!window.confirm(`${date} のこのiPhoneだけにあるデータを削除します。同期先は変更せず、自動retryもしません。削除後は画面から元に戻せません。削除しますか？`)) return
    inFlight.current = true
    setDiscarding(true)
    setResult(null)
    const currentRun = ++runId.current
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
      const stored = readDayMemoStorageSnapshot(window.localStorage)
      if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata) || stored.status !== 'ready'
        || !input.reactMetadata || !same(input.reactMetadata, loaded.metadata) || !same(input.dayMemos, stored.memos)
        || loaded.metadata.workspaceId !== input.connection.workspaceId
        || loaded.metadata.baselineStatus !== 'recovery_required' || loaded.metadata.baselineConfirmedAt !== null
        || loaded.metadata.pendingOperation || loaded.metadata.pushBlock
        || Object.keys(loaded.metadata.localDeleteIntents).length || loaded.metadata.baselines[date]) {
        finish('recovery_local_only_discard_state_changed', { date }); return
      }
      const targets = stored.memos.filter((memo) => memo.date === date)
      if (targets.length !== 1 || !isStoredDayMemo(targets[0])) {
        finish('recovery_local_only_discard_state_changed', { date }); return
      }
      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, input.connection.workspaceId,
        () => runId.current === currentRun).catch(() => null)
      const afterMetadata = loadDayMemoSyncMetadataAny(window.localStorage)
      const afterLocal = readDayMemoStorageSnapshot(window.localStorage)
      if (!pulled || pulled.status !== 'complete' || afterMetadata.status !== 'ready'
        || !isDayMemoSyncMetadataV5(afterMetadata.metadata) || afterMetadata.raw !== loaded.raw
        || afterLocal.status !== 'ready' || afterLocal.serialized !== stored.serialized || !same(input.dayMemos, stored.memos)) {
        finish('recovery_local_only_discard_state_changed', { date, fullPullCount: 1 }); return
      }
      const remoteByDate = new Map(pulled.records.map((record) => [record.entityId, record]))
      const localByDate = new Map(stored.memos.map((memo) => [memo.date, memo]))
      if (remoteByDate.size !== pulled.records.length || localByDate.size !== stored.memos.length
        || pulled.maxChangeSequence !== loaded.metadata.lastPulledChangeSequence || remoteByDate.has(date)) {
        finish('recovery_local_only_discard_remote_changed', { date, fullPullCount: 1 }); return
      }
      const metadata = loaded.metadata
      const dates = [...new Set([...localByDate.keys(), ...remoteByDate.keys(), ...Object.keys(metadata.baselines)])].sort()
      const classifications = Object.fromEntries(dates.map((itemDate) => [itemDate, classifyDayMemoNormalDifference(
        localByDate.get(itemDate) ?? null, remoteByDate.get(itemDate) ?? null, metadata.baselines[itemDate] ?? null)]))
      const unresolved = Object.fromEntries(Object.entries(classifications)
        .filter(([, classification]) => classification !== 'exact_match_baseline_confirmed'))
      if (classifications[date] !== 'local_only' || !same(unresolved, input.savedRecoveryResult?.unresolvedClassifications)) {
        finish('recovery_local_only_discard_remote_changed', { date, fullPullCount: 1 }); return
      }
      const backup = saveDayMemoPullApplyBackup(window.localStorage, input.connection.workspaceId, stored.memos,
        { replaceExistingForSameWorkspace: true })
      if (backup !== 'saved' && backup !== 'reused') {
        finish('recovery_local_only_discard_backup_failed', { date, fullPullCount: 1 }); return
      }
      const next = stored.memos.filter((memo) => memo.date !== date)
      const saved = replaceStoredDayMemosVerified(window.localStorage, next, stored.serialized)
      if (saved !== 'saved') {
        finish(saved === 'rollback_failed' ? 'recovery_local_only_discard_rollback_failed' : 'recovery_local_only_discard_save_failed', {
          date, fullPullCount: 1,
          localState: saved === 'rollback_failed' ? 'uncertain' : saved === 'readback_invalid' ? 'rolled_back' : 'unchanged',
        }); return
      }
      const readBack = readDayMemoStorageSnapshot(window.localStorage)
      if (readBack.status !== 'ready' || !same(readBack.memos, next)) {
        const rollback = readBack.status === 'ready'
          ? replaceStoredDayMemosVerified(window.localStorage, stored.memos, readBack.serialized) : 'rollback_failed'
        finish(rollback === 'saved' ? 'recovery_local_only_discard_readback_failed' : 'recovery_local_only_discard_rollback_failed', {
          date, fullPullCount: 1, localState: rollback === 'saved' ? 'rolled_back' : 'uncertain',
        }); return
      }
      input.adoptVerifiedStoredDayMemos(next.map((memo) => ({ ...memo })))
      finish('recovery_local_only_discarded', { date, localState: 'discarded', fullPullCount: 1 })
    } catch {
      finish('recovery_local_only_discard_unknown', { date, localState: 'uncertain' })
    } finally {
      inFlight.current = false
      if (runId.current === currentRun) setDiscarding(false)
    }
  }, [candidateDates, eligible, finish, input])

  const discardResult = useCallback(() => setResult(null), [])
  return { eligible, discarding, candidateDates, result, discardLocalOnly, discardResult }
}
