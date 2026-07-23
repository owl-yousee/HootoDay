import { useCallback, useState } from 'react'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { isDayMemoSyncMetadataV5, loadDayMemoSyncMetadataAny, replaceDayMemoSyncMetadataV2 } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import type { DayMemoRemoteAppliedRecoverySnapshot, DayMemoSyncRecoveryCheckResult } from './useDayMemoSyncRecoveryCheck'

export type DayMemoSyncRecoveryApplyState =
  | 'idle'
  | 'recovering'
  | 'completed'
  | 'recovery_required'
  | 'rollback_failed'
  | 'error'

interface UseDayMemoSyncRecoveryApplyInput {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  recoveryResult: DayMemoSyncRecoveryCheckResult | null
  getRemoteAppliedSnapshot: () => DayMemoRemoteAppliedRecoverySnapshot | null
  discardRecoveryResult: () => void
}

function localSignature(memos: DayMemo[]): string {
  return JSON.stringify(memos.map((memo) => [memo.date, memo.updatedAt, memo.content]).sort(([left], [right]) => left.localeCompare(right)))
}

function pendingCanRecover(status: string): boolean {
  return status === 'sending' || status === 'response_unknown' || status === 'recovery_required'
}

function connectionIsEligible(connection: SyncConnection | null): boolean {
  return Boolean(connection
    && isUuid(connection.workspaceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}

function snapshotIsConsistent(snapshot: DayMemoRemoteAppliedRecoverySnapshot): boolean {
  const pending = snapshot.pendingOperation
  if (snapshot.operationKind === 'delete') {
    return pending.kind === 'delete'
      && pendingCanRecover(pending.status)
      && pending.date === snapshot.date
      && snapshot.localMemo === null
      && snapshot.remotePayload === null
      && snapshot.remoteRevision === pending.baseRevision + 1
      && Number.isSafeInteger(snapshot.remoteChangeSequence)
      && snapshot.remoteChangeSequence > snapshot.previousChangeSequence
      && snapshot.deletedAt !== null
      && !Number.isNaN(Date.parse(snapshot.deletedAt))
      && !Number.isNaN(Date.parse(snapshot.remoteUpdatedAt))
      && snapshot.conflict === false
  }
  return pendingCanRecover(pending.status)
    && pending.kind === 'upsert'
    && pending.date === snapshot.date
    && snapshot.localMemo !== null
    && snapshot.remotePayload !== null
    && snapshot.localMemo.date === snapshot.date
    && pending.preparedLocalUpdatedAt === snapshot.localMemo.updatedAt
    && snapshot.remotePayload.date === snapshot.date
    && snapshot.remotePayload.updatedAt === snapshot.localMemo.updatedAt
    && snapshot.remotePayload.content === snapshot.localMemo.content
    && snapshot.remoteRevision === pending.baseRevision + 1
    && Number.isSafeInteger(snapshot.remoteChangeSequence)
    && snapshot.remoteChangeSequence > snapshot.previousChangeSequence
    && snapshot.deletedAt === null
    && snapshot.conflict === false
}

export function useDayMemoSyncRecoveryApply({
  dayMemos,
  isConfigured,
  isSignedIn,
  connection,
  recoveryResult,
  getRemoteAppliedSnapshot,
  discardRecoveryResult,
}: UseDayMemoSyncRecoveryApplyInput) {
  const [state, setState] = useState<DayMemoSyncRecoveryApplyState>('idle')
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const [completedDate, setCompletedDate] = useState<string | null>(null)
  const canRecover = Boolean(
    isConfigured
    && isSignedIn
    && connectionIsEligible(connection)
    && recoveryResult?.classification === 'remote_applied',
  )

  const recoverMetadata = useCallback(() => {
    if (!canRecover || !connection?.workspaceId || state !== 'idle') return
    setState('recovering')
    setSafeErrorMessage(null)
    const snapshot = getRemoteAppliedSnapshot()
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const stored = readDayMemoStorageSnapshot(window.localStorage)
    if (!snapshot
      || snapshot.workspaceId !== connection.workspaceId
      || !snapshotIsConsistent(snapshot)
      || loaded.status !== 'ready'
      || loaded.metadata.version !== 5
      || loaded.raw !== snapshot.metadataRaw
      || loaded.metadata.workspaceId !== connection.workspaceId
      || loaded.metadata.pushBlock !== null
      || !loaded.metadata.pendingOperation
      || !pendingCanRecover(loaded.metadata.pendingOperation.status)
      || JSON.stringify(loaded.metadata.pendingOperation) !== JSON.stringify(snapshot.pendingOperation)
      || stored.status !== 'ready'
      || stored.serialized !== snapshot.localStorageSerialized
      || localSignature(stored.memos) !== localSignature(dayMemos)
      || (snapshot.operationKind === 'upsert'
        ? stored.memos.filter((memo) => memo.date === snapshot.date).length !== 1
          || snapshot.localMemo === null
          || localSignature([stored.memos.find((memo) => memo.date === snapshot.date)!])
            !== localSignature([snapshot.localMemo])
        : stored.memos.some((memo) => memo.date === snapshot.date)
          || loaded.metadata.localDeleteIntents[snapshot.date]?.operationId !== snapshot.pendingOperation.operationId)) {
      setState('error')
      setSafeErrorMessage('確認後に同期情報またはDayMemoが変化したため、復旧できません。再送は行っていません。')
      return
    }
    const confirmedAt = new Date().toISOString()
    const remainingIntents = { ...loaded.metadata.localDeleteIntents }
    if (snapshot.operationKind === 'delete') delete remainingIntents[snapshot.date]
    const nextBaseline = snapshot.operationKind === 'delete' ? {
      date: snapshot.date,
      remoteRevision: snapshot.remoteRevision,
      remoteChangeSequence: snapshot.remoteChangeSequence,
      remoteUpdatedAt: snapshot.remoteUpdatedAt,
      baselineLocalUpdatedAt: null,
      deletedAt: snapshot.deletedAt,
    } : {
      date: snapshot.date,
      remoteRevision: snapshot.remoteRevision,
      remoteChangeSequence: snapshot.remoteChangeSequence,
      remoteUpdatedAt: snapshot.remotePayload!.updatedAt,
      baselineLocalUpdatedAt: snapshot.localMemo!.updatedAt,
      deletedAt: null,
    }
    const next: DayMemoSyncMetadataV5 = {
      ...loaded.metadata,
      baselines: {
        ...loaded.metadata.baselines,
        [snapshot.date]: nextBaseline,
      },
      lastPulledChangeSequence: Math.max(loaded.metadata.lastPulledChangeSequence, snapshot.remoteChangeSequence),
      baselineStatus: 'confirmed',
      baselineConfirmedAt: confirmedAt,
      pendingOperation: null,
      localDeleteIntents: remainingIntents,
      lastSuccessfulSyncAt: confirmedAt,
    }
    if (!isDayMemoSyncMetadataV5(next)) {
      setState('error')
      setSafeErrorMessage('復旧後の同期情報を安全に検証できませんでした。metadataは変更していません。')
      return
    }
    const saved = replaceDayMemoSyncMetadataV2(window.localStorage, next, loaded.raw)
    if (saved !== 'saved') {
      const rollbackFailed = saved === 'rollback_failed'
      setState(rollbackFailed ? 'rollback_failed' : 'recovery_required')
      setSafeErrorMessage(rollbackFailed
        ? '同期情報のrollbackを確認できませんでした。新しい送信を行わず確認してください。'
        : '同期情報を保存できなかったため、元のpending状態を維持しました。再送は行っていません。')
      return
    }
    setCompletedDate(snapshot.date)
    setState('completed')
    discardRecoveryResult()
  }, [canRecover, connection?.workspaceId, dayMemos, discardRecoveryResult, getRemoteAppliedSnapshot, state])

  return { state, canRecover: canRecover && state === 'idle', safeErrorMessage, completedDate, recoverMetadata }
}
