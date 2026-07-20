import { useCallback, useMemo, useState } from 'react'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoSyncMetadataV4 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { readDayMemoStorageSnapshot, replaceStoredDayMemosVerified } from '../utils/dayMemoStorage'
import { isDayMemoSyncMetadataV4, loadDayMemoSyncMetadataAny, replaceDayMemoSyncMetadataV2 } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import type { DayMemoTombstoneApplySnapshot } from './useDayMemoTombstonePreview'

export type DayMemoTombstoneApplyState =
  | 'idle'
  | 'applying'
  | 'completed'
  | 'blocked'
  | 'storage_failed'
  | 'metadata_failed'
  | 'recovery_required'

export interface DayMemoTombstoneApplyResult {
  date: string
  remoteRevision: number
  remoteChangeSequence: number
}

interface Input {
  dayMemos: DayMemo[]
  connection: SyncConnection | null
  adoptVerifiedStoredDayMemos: (memos: DayMemo[]) => void
  getSingleActiveSnapshot: () => DayMemoTombstoneApplySnapshot | null
  discardPreview: () => void
}

function localSignature(memos: DayMemo[]): string {
  return JSON.stringify(memos
    .map((memo) => [memo.date, memo.updatedAt, memo.content])
    .sort(([left], [right]) => left.localeCompare(right)))
}

function connectionIsEligible(connection: SyncConnection | null): boolean {
  return Boolean(connection
    && isUuid(connection.workspaceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}

export function useDayMemoTombstoneApply({
  dayMemos,
  connection,
  adoptVerifiedStoredDayMemos,
  getSingleActiveSnapshot,
  discardPreview,
}: Input) {
  const [state, setState] = useState<DayMemoTombstoneApplyState>('idle')
  const [result, setResult] = useState<DayMemoTombstoneApplyResult | null>(null)
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const currentLocalSignature = useMemo(() => localSignature(dayMemos), [dayMemos])

  const reset = useCallback(() => {
    setState('idle')
    setResult(null)
    setSafeErrorMessage(null)
  }, [])

  const applyTombstone = useCallback(() => {
    if (state !== 'idle' || !connectionIsEligible(connection) || !connection?.workspaceId) return
    setState('applying')
    setResult(null)
    setSafeErrorMessage(null)

    const snapshot = getSingleActiveSnapshot()
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const stored = readDayMemoStorageSnapshot(window.localStorage)
    if (!snapshot
      || snapshot.workspaceId !== connection.workspaceId
      || loaded.status !== 'ready'
      || loaded.metadata.version !== 4
      || loaded.raw !== snapshot.metadataRaw
      || loaded.metadata.workspaceId !== connection.workspaceId
      || loaded.metadata.baselineStatus !== 'confirmed'
      || loaded.metadata.baselineConfirmedAt === null
      || loaded.metadata.pendingOperation !== null
      || loaded.metadata.pushBlock !== null
      || Object.keys(loaded.metadata.localDeleteIntents).length !== 0
      || stored.status !== 'ready'
      || stored.serialized !== snapshot.localStorageSerialized
      || localSignature(stored.memos) !== currentLocalSignature
      || localSignature(stored.memos) !== localSignature(snapshot.localMemos)) {
      setState('blocked')
      setSafeErrorMessage('反映前の同期状態を安全に再確認できませんでした。DayMemoは変更していません。')
      return
    }

    const baseline = loaded.metadata.baselines[snapshot.date]
    const localMatches = stored.memos.filter((memo) => memo.date === snapshot.date)
    if (!baseline
      || baseline.deletedAt !== null
      || baseline.baselineLocalUpdatedAt === null
      || JSON.stringify(baseline) !== JSON.stringify(snapshot.baseline)
      || localMatches.length !== 1
      || localMatches[0].updatedAt !== baseline.baselineLocalUpdatedAt
      || snapshot.remoteRevision !== baseline.remoteRevision + 1
      || snapshot.remoteChangeSequence <= baseline.remoteChangeSequence) {
      setState('blocked')
      setSafeErrorMessage('削除済み状態の系譜または端末のDayMemoが変化したため、反映を停止しました。')
      return
    }

    const nextMemos = stored.memos.filter((memo) => memo.date !== snapshot.date)
    const memoSave = replaceStoredDayMemosVerified(window.localStorage, nextMemos, stored.serialized)
    if (memoSave !== 'saved') {
      setState(memoSave === 'rollback_failed' ? 'recovery_required' : 'storage_failed')
      setSafeErrorMessage(memoSave === 'rollback_failed'
        ? 'DayMemo保存のrollbackを確認できませんでした。同期操作を行わず確認してください。'
        : 'DayMemoを安全に保存できなかったため、元の状態を維持しました。')
      return
    }

    const savedMemos = readDayMemoStorageSnapshot(window.localStorage)
    if (savedMemos.status !== 'ready' || savedMemos.memos.some((memo) => memo.date === snapshot.date)) {
      const rollback = savedMemos.status === 'ready'
        ? replaceStoredDayMemosVerified(window.localStorage, stored.memos, savedMemos.serialized)
        : 'rollback_failed'
      setState(rollback === 'saved' ? 'storage_failed' : 'recovery_required')
      setSafeErrorMessage(rollback === 'saved'
        ? 'DayMemoのread-backに失敗したため、元の状態へ戻しました。'
        : 'DayMemoのrollbackを確認できませんでした。同期操作を行わず確認してください。')
      return
    }

    const completedAt = new Date().toISOString()
    const nextMetadata: DayMemoSyncMetadataV4 = {
      ...loaded.metadata,
      baselines: {
        ...loaded.metadata.baselines,
        [snapshot.date]: {
          date: snapshot.date,
          remoteRevision: snapshot.remoteRevision,
          remoteChangeSequence: snapshot.remoteChangeSequence,
          remoteUpdatedAt: snapshot.remoteUpdatedAt,
          baselineLocalUpdatedAt: null,
          deletedAt: snapshot.deletedAt,
        },
      },
      lastPulledChangeSequence: Math.max(loaded.metadata.lastPulledChangeSequence, snapshot.remoteChangeSequence),
      baselineConfirmedAt: completedAt,
      lastSuccessfulSyncAt: completedAt,
    }
    if (!isDayMemoSyncMetadataV4(nextMetadata)) {
      const rollback = replaceStoredDayMemosVerified(window.localStorage, stored.memos, savedMemos.serialized)
      setState(rollback === 'saved' ? 'metadata_failed' : 'recovery_required')
      setSafeErrorMessage(rollback === 'saved'
        ? 'tombstone baselineを安全に構築できなかったため、DayMemoを元へ戻しました。'
        : 'metadata検証失敗後のrollbackを確認できませんでした。同期操作を行わず確認してください。')
      return
    }

    const metadataSave = replaceDayMemoSyncMetadataV2(window.localStorage, nextMetadata, loaded.raw)
    if (metadataSave !== 'saved') {
      const memoRollback = replaceStoredDayMemosVerified(window.localStorage, stored.memos, savedMemos.serialized)
      const recoveryRequired = metadataSave === 'rollback_failed' || memoRollback !== 'saved'
      setState(recoveryRequired ? 'recovery_required' : 'metadata_failed')
      setSafeErrorMessage(recoveryRequired
        ? '反映処理のrollbackを確認できませんでした。同期操作を行わず確認してください。'
        : 'metadataを保存できなかったため、DayMemoを元へ戻しました。')
      return
    }

    adoptVerifiedStoredDayMemos(nextMemos)
    discardPreview()
    setResult({
      date: snapshot.date,
      remoteRevision: snapshot.remoteRevision,
      remoteChangeSequence: snapshot.remoteChangeSequence,
    })
    setState('completed')
  }, [adoptVerifiedStoredDayMemos, connection, currentLocalSignature, discardPreview, getSingleActiveSnapshot, state])

  return { state, result, safeErrorMessage, applyTombstone, reset }
}
