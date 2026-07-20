import { useCallback, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoSyncMetadataV4 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { saveDayMemoPullApplyBackup } from '../utils/dayMemoPullApplyBackupStorage'
import { isStoredDayMemo, readDayMemoStorageSnapshot, replaceStoredDayMemosVerified } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords } from '../utils/dayMemoSyncPull'
import { isDayMemoSyncMetadataV4, loadDayMemoSyncMetadataAny, replaceDayMemoSyncMetadataV2 } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import { countRemoteAdoptionMismatches, type DayMemoRemoteAdoptionPreflightResult, type DayMemoRemoteTombstoneAdoptionSnapshot } from './useDayMemoRemoteAdoptionPreflight'

export type DayMemoRemoteTombstoneAdoptionState =
  | 'idle'
  | 'applying'
  | 'completed'
  | 'blocked'
  | 'backup_failed'
  | 'storage_failed'
  | 'metadata_failed'
  | 'recovery_required'
  | 'reload_required'

export interface DayMemoRemoteTombstoneAdoptionResult {
  date: string
  remoteRevision: number
  remoteChangeSequence: number
  localEffect: 'delete' | 'metadata_only'
  intentResolved: boolean
}

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  preflightResult: DayMemoRemoteAdoptionPreflightResult | null
  getReadyTombstoneSnapshot: () => DayMemoRemoteTombstoneAdoptionSnapshot | null
  adoptVerifiedStoredDayMemos: (memos: DayMemo[]) => void
  discardPreflight: () => void
  discardConflictPreview: () => void
}

function localSignature(memos: DayMemo[]): string {
  return JSON.stringify(memos.map((memo) => [memo.date, memo.updatedAt, memo.content]).sort(([left], [right]) => left.localeCompare(right)))
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function connectionIsEligible(connection: SyncConnection | null): boolean {
  return Boolean(connection
    && isUuid(connection.workspaceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}

function rebuildCandidate(localMemos: DayMemo[], date: string): DayMemo[] | null {
  const next = localMemos.filter((memo) => memo.date !== date).map((memo) => ({ ...memo }))
    .sort((left, right) => left.date.localeCompare(right.date))
  return next.every(isStoredDayMemo) && new Set(next.map((memo) => memo.date)).size === next.length ? next : null
}

export function useDayMemoRemoteTombstoneAdoption({
  dayMemos,
  isConfigured,
  isSignedIn,
  connection,
  preflightResult,
  getReadyTombstoneSnapshot,
  adoptVerifiedStoredDayMemos,
  discardPreflight,
  discardConflictPreview,
}: Input) {
  const [state, setState] = useState<DayMemoRemoteTombstoneAdoptionState>('idle')
  const [result, setResult] = useState<DayMemoRemoteTombstoneAdoptionResult | null>(null)
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const currentSignature = useMemo(() => localSignature(dayMemos), [dayMemos])
  const liveEligibility = useRef({ isConfigured, isSignedIn, workspaceId: connection?.workspaceId ?? null })
  liveEligibility.current = { isConfigured, isSignedIn, workspaceId: connection?.workspaceId ?? null }
  const canApply = Boolean(isConfigured
    && isSignedIn
    && connectionIsEligible(connection)
    && preflightResult?.classification === 'ready_remote_tombstone'
    && preflightResult.remoteState === 'deleted'
    && (preflightResult.localEffect === 'delete' || preflightResult.localEffect === 'metadata_only')
    && state === 'idle')

  const reset = useCallback(() => {
    if (state === 'applying') return
    setState('idle')
    setResult(null)
    setSafeErrorMessage(null)
  }, [state])

  const applyRemoteTombstone = useCallback(async () => {
    if (!canApply || !connection?.workspaceId || !supabaseClient || state !== 'idle') return
    setState('applying')
    setResult(null)
    setSafeErrorMessage(null)

    const snapshot = getReadyTombstoneSnapshot()
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const stored = readDayMemoStorageSnapshot(window.localStorage)
    if (!snapshot
      || snapshot.result.classification !== 'ready_remote_tombstone'
      || snapshot.result.remoteState !== 'deleted'
      || snapshot.result.otherMismatchCount !== 0
      || !sameJson(snapshot.result, preflightResult)
      || snapshot.conflictSnapshot.workspaceId !== connection.workspaceId
      || loaded.status !== 'ready' || loaded.metadata.version !== 4
      || loaded.metadata.workspaceId !== connection.workspaceId
      || loaded.metadata.baselineStatus !== 'confirmed' || loaded.metadata.pushBlock !== null
      || loaded.raw !== snapshot.conflictSnapshot.metadataRaw
      || stored.status !== 'ready' || stored.serialized !== snapshot.conflictSnapshot.localStorageSerialized
      || localSignature(stored.memos) !== currentSignature
      || localSignature(stored.memos) !== localSignature(snapshot.conflictSnapshot.localMemos)
      || !sameJson(loaded.metadata.pendingOperation, snapshot.conflictSnapshot.pendingOperation)
      || !sameJson(loaded.metadata.localDeleteIntents, snapshot.conflictSnapshot.localDeleteIntents)
      || !sameJson(loaded.metadata.baselines[snapshot.result.date] ?? null, snapshot.conflictSnapshot.baseline)) {
      setState('blocked')
      setSafeErrorMessage('preflight後に端末または同期設定が変化したため、削除状態の反映を開始しませんでした。')
      return
    }

    const pending = loaded.metadata.pendingOperation
    const targetIntent = loaded.metadata.localDeleteIntents[snapshot.result.date]
    const pendingMatches = Boolean(pending
      && pending.date === snapshot.result.date
      && pending.baseRevision === snapshot.result.baseRevision
      && ((pending.kind === 'delete' && snapshot.result.localOperation === 'delete')
        || (pending.kind === 'upsert' && snapshot.result.localOperation !== 'delete')))
    const intentMatches = Boolean(targetIntent
      && targetIntent.date === snapshot.result.date
      && targetIntent.baselineRevision === snapshot.result.baseRevision
      && snapshot.result.localOperation === 'delete')
    if ((!pendingMatches && !intentMatches)
      || (pending && !pendingMatches)
      || Object.keys(loaded.metadata.localDeleteIntents).some((date) => date !== snapshot.result.date)) {
      setState('blocked')
      setSafeErrorMessage('対象の未完了操作または削除意図を安全に特定できないため、反映を開始しませんでした。')
      return
    }

    const pulled = await pullAllDayMemoSyncRecords(supabaseClient, connection.workspaceId).catch(() => null)
    if (!pulled || pulled.status !== 'complete') {
      setState('blocked')
      setSafeErrorMessage('同期先の削除状態を保存直前に確認できなかったため、反映を開始しませんでした。')
      return
    }
    const afterPullMetadata = loadDayMemoSyncMetadataAny(window.localStorage)
    const afterPullStored = readDayMemoStorageSnapshot(window.localStorage)
    const remoteMatches = pulled.records.filter((record) => record.entityId === snapshot.result.date)
    const remote = remoteMatches.length === 1 ? remoteMatches[0] : null
    if (!liveEligibility.current.isConfigured || !liveEligibility.current.isSignedIn
      || liveEligibility.current.workspaceId !== connection.workspaceId
      || afterPullMetadata.status !== 'ready' || afterPullMetadata.metadata.version !== 4
      || afterPullMetadata.raw !== snapshot.conflictSnapshot.metadataRaw
      || afterPullStored.status !== 'ready' || afterPullStored.serialized !== snapshot.conflictSnapshot.localStorageSerialized
      || !remote || remote.deletedAt === null || !Number.isFinite(Date.parse(remote.deletedAt)) || remote.payload !== null
      || !sameJson(remote, snapshot.conflictSnapshot.remoteRecord)
      || remote.revision !== snapshot.result.remoteRevision
      || remote.changeSequence !== snapshot.result.remoteChangeSequence
      || remote.revision <= snapshot.result.baseRevision
      || remote.changeSequence <= snapshot.result.baselineChangeSequence
      || countRemoteAdoptionMismatches(afterPullMetadata.metadata, afterPullStored.memos, pulled.records, snapshot.result.date) !== 0) {
      setState('blocked')
      setSafeErrorMessage('同期先または対象外の状態が変化したため、競合確認からやり直してください。')
      return
    }

    const completedMemos = rebuildCandidate(afterPullStored.memos, snapshot.result.date)
    const targetExists = afterPullStored.memos.some((memo) => memo.date === snapshot.result.date)
    const expectedEffect = targetExists ? 'delete' : 'metadata_only'
    if (!completedMemos || expectedEffect !== snapshot.result.localEffect
      || !sameJson(completedMemos, snapshot.completedLocalCandidate)
      || (!targetExists && (!snapshot.conflictSnapshot.baseline
        || snapshot.conflictSnapshot.baseline.date !== snapshot.result.date
        || snapshot.conflictSnapshot.baseline.remoteRevision !== snapshot.result.baseRevision))) {
      setState('blocked')
      setSafeErrorMessage('完成するDayMemoをpreflight結果と一致確認できなかったため、反映を停止しました。')
      return
    }

    let savedLocalSerialized = afterPullStored.serialized
    if (targetExists) {
      const backup = saveDayMemoPullApplyBackup(window.localStorage, connection.workspaceId, afterPullStored.memos)
      if (backup !== 'saved' && backup !== 'reused') {
        setState('backup_failed')
        setSafeErrorMessage('採用前バックアップを安全に確認できなかったため、DayMemoは変更していません。')
        return
      }
      const localSave = replaceStoredDayMemosVerified(window.localStorage, completedMemos, afterPullStored.serialized)
      if (localSave !== 'saved') {
        setState(localSave === 'rollback_failed' ? 'recovery_required' : 'storage_failed')
        setSafeErrorMessage(localSave === 'rollback_failed'
          ? 'DayMemoのrollbackを確認できませんでした。自動再実行せず確認してください。'
          : 'DayMemoを保存できなかったため、採用前状態を維持しました。')
        return
      }
      const savedLocal = readDayMemoStorageSnapshot(window.localStorage)
      if (savedLocal.status !== 'ready' || !sameJson(savedLocal.memos, completedMemos)
        || savedLocal.memos.some((memo) => memo.date === snapshot.result.date)) {
        const rollback = savedLocal.status === 'ready'
          ? replaceStoredDayMemosVerified(window.localStorage, afterPullStored.memos, savedLocal.serialized)
          : 'rollback_failed'
        setState(rollback === 'saved' ? 'storage_failed' : 'recovery_required')
        setSafeErrorMessage(rollback === 'saved'
          ? 'DayMemoのread-backに失敗したため採用前状態へ戻しました。'
          : 'DayMemoのread-backとrollbackを確認できませんでした。自動再実行しないでください。')
        return
      }
      savedLocalSerialized = savedLocal.serialized
    }

    const completedAt = new Date().toISOString()
    const { [snapshot.result.date]: removedIntent, ...remainingIntents } = loaded.metadata.localDeleteIntents
    const completedMetadata: DayMemoSyncMetadataV4 = {
      ...loaded.metadata,
      baselines: {
        ...loaded.metadata.baselines,
        [snapshot.result.date]: {
          date: snapshot.result.date,
          remoteRevision: remote.revision,
          remoteChangeSequence: remote.changeSequence,
          remoteUpdatedAt: remote.serverUpdatedAt,
          baselineLocalUpdatedAt: null,
          deletedAt: remote.deletedAt,
        },
      },
      localDeleteIntents: remainingIntents,
      lastPulledChangeSequence: Math.max(loaded.metadata.lastPulledChangeSequence, remote.changeSequence),
      baselineStatus: 'confirmed',
      baselineConfirmedAt: completedAt,
      pendingOperation: null,
      lastSuccessfulSyncAt: completedAt,
    }
    if (!isDayMemoSyncMetadataV4(completedMetadata)) {
      const rollback = targetExists
        ? replaceStoredDayMemosVerified(window.localStorage, afterPullStored.memos, savedLocalSerialized)
        : 'saved'
      setState(rollback === 'saved' ? 'metadata_failed' : 'recovery_required')
      setSafeErrorMessage(rollback === 'saved'
        ? '完成metadataを安全に構築できなかったため、採用前状態へ戻しました。'
        : 'metadata検証失敗後のDayMemo rollbackを確認できませんでした。')
      return
    }

    const metadataSave = replaceDayMemoSyncMetadataV2(window.localStorage, completedMetadata, loaded.raw)
    if (metadataSave !== 'saved') {
      const metadataAfterFailure = loadDayMemoSyncMetadataAny(window.localStorage)
      const metadataRestored = metadataAfterFailure.status === 'ready' && metadataAfterFailure.raw === loaded.raw
      const localRollback = targetExists
        ? replaceStoredDayMemosVerified(window.localStorage, afterPullStored.memos, savedLocalSerialized)
        : 'saved'
      const recoveryRequired = metadataSave === 'rollback_failed' || !metadataRestored || localRollback !== 'saved'
      setState(recoveryRequired ? 'recovery_required' : 'metadata_failed')
      setSafeErrorMessage(recoveryRequired
        ? 'localまたはmetadataのrollbackを確認できませんでした。自動再実行せずread-only確認を行ってください。'
        : 'metadataを保存できなかったため採用前状態へ戻しました。')
      return
    }
    const metadataReadBack = loadDayMemoSyncMetadataAny(window.localStorage)
    if (metadataReadBack.status !== 'ready' || metadataReadBack.raw !== JSON.stringify(completedMetadata)) {
      setState('recovery_required')
      setSafeErrorMessage('保存済みmetadataの追加read-backを確認できませんでした。状態を推測で戻さず、再読み込み後に同期情報を確認してください。')
      return
    }

    try {
      adoptVerifiedStoredDayMemos(completedMemos)
    } catch {
      setState('reload_required')
      setSafeErrorMessage('反映は保存されました。画面を再読み込みしてください。自動再実行は行いません。')
      return
    }
    discardPreflight()
    discardConflictPreview()
    setResult({
      date: snapshot.result.date,
      remoteRevision: remote.revision,
      remoteChangeSequence: remote.changeSequence,
      localEffect: expectedEffect,
      intentResolved: Boolean(removedIntent),
    })
    setState('completed')
  }, [adoptVerifiedStoredDayMemos, canApply, connection?.workspaceId, currentSignature, discardConflictPreview, discardPreflight, getReadyTombstoneSnapshot, preflightResult, state])

  return { state, result, safeErrorMessage, canApply, applyRemoteTombstone, reset }
}
