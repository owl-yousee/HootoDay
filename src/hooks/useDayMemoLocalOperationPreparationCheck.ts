import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DayMemo } from '../types/dayMemo'
import type { SyncConnection } from '../types/sync'
import { readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { loadDayMemoSyncMetadataAny } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import type { DayMemoLocalOperationPreparationSnapshot, DayMemoRemoteAdoptionVerificationResult } from './useDayMemoRemoteAdoptionVerification'

export type DayMemoLocalOperationPreparationKind = 'local_edit_prepare' | 'local_save_prepare' | 'local_delete_prepare'

export type DayMemoLocalOperationPreparationClassification =
  | 'local_operation_prepare_ready'
  | 'local_operation_prepare_target_only'
  | 'local_operation_prepare_pending_remaining'
  | 'local_operation_prepare_delete_intent_remaining'
  | 'local_operation_prepare_push_blocked'
  | 'local_operation_prepare_cursor_invalid'
  | 'local_operation_prepare_state_changed'
  | 'local_operation_prepare_target_mismatch'
  | 'local_operation_prepare_verification_missing'
  | 'local_operation_prepare_verification_stale'
  | 'local_operation_prepare_unsupported_adoption'
  | 'local_operation_prepare_prerequisite_missing'
  | 'local_operation_prepare_state_unknown'

export interface DayMemoLocalOperationPreparationResult {
  date: string | null
  adoptionKind: DayMemoRemoteAdoptionVerificationResult['adoptionKind']
  operationKind: DayMemoLocalOperationPreparationKind
  classification: DayMemoLocalOperationPreparationClassification
  ready: boolean
  metadataValid: boolean
  workspaceValid: boolean
  pushBlockClear: boolean
  targetPendingClear: boolean
  targetIntentClear: boolean
  otherPendingCount: number
  otherIntentCount: number
  cursorValid: boolean
  outsideMismatchCount: number
  verificationFresh: boolean
  checkedAt: string
  nextAction: string
}

export interface DayMemoLocalOperationPreparationReadySnapshot {
  result: DayMemoLocalOperationPreparationResult
  metadataRaw: string
  localStorageSerialized: string
  localSignature: string
  verificationSnapshot: DayMemoLocalOperationPreparationSnapshot
}

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  verificationResult: DayMemoRemoteAdoptionVerificationResult | null
  getPreparationSnapshot: () => DayMemoLocalOperationPreparationSnapshot | null
}

function localSignature(memos: DayMemo[]): string {
  return JSON.stringify(memos.map((memo) => [memo.date, memo.updatedAt, memo.content]).sort(([left], [right]) => left.localeCompare(right)))
}

function connectionIsEligible(connection: SyncConnection | null): boolean {
  return Boolean(connection
    && isUuid(connection.workspaceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}

function message(classification: DayMemoLocalOperationPreparationClassification): string {
  if (classification === 'local_operation_prepare_ready') return '新しいlocal操作の準備条件を満たしています。実際の操作開始は後続Phaseで明示的に行います。'
  if (classification === 'local_operation_prepare_target_only') return '採用対象以外の不一致が残るため、端末全体のread-only確認が必要です。'
  if (classification === 'local_operation_prepare_pending_remaining') return '未完了同期が残っています。新しい操作を開始せずrecovery checkで確認してください。'
  if (classification === 'local_operation_prepare_delete_intent_remaining') return '削除意図が残っています。新しい操作を開始せずread-only確認を行ってください。'
  if (classification === 'local_operation_prepare_push_blocked') return 'pushBlock中のため、新しいlocal操作を準備できません。'
  if (classification === 'local_operation_prepare_cursor_invalid') return '同期位置を安全に確認できません。自動修正せずrecovery checkを行ってください。'
  if (classification === 'local_operation_prepare_state_changed') return '採用後確認から端末状態が変化しました。remote採用後の状態確認からやり直してください。'
  if (classification === 'local_operation_prepare_target_mismatch') return '採用対象のlocal・remote・baseline一致を確認できません。'
  if (classification === 'local_operation_prepare_verification_missing') return '対象を特定できるremote採用後確認結果がありません。先に採用後の状態を確認してください。'
  if (classification === 'local_operation_prepare_verification_stale') return 'remote採用後確認結果の鮮度を確認できません。明示的に再確認してください。'
  if (classification === 'local_operation_prepare_unsupported_adoption') return 'この採用種類は新しいlocal操作の準備対象として扱えません。'
  if (classification === 'local_operation_prepare_prerequisite_missing') return '選択したlocal操作に必要な現在状態がありません。'
  return '準備条件を安全に判定できませんでした。永続データは変更していません。'
}

export function useDayMemoLocalOperationPreparationCheck({
  dayMemos,
  isConfigured,
  isSignedIn,
  connection,
  verificationResult,
  getPreparationSnapshot,
}: Input) {
  const [operationKind, setOperationKindState] = useState<DayMemoLocalOperationPreparationKind>('local_edit_prepare')
  const [result, setResult] = useState<DayMemoLocalOperationPreparationResult | null>(null)
  const readySnapshotRef = useRef<DayMemoLocalOperationPreparationReadySnapshot | null>(null)
  const signature = useMemo(() => localSignature(dayMemos), [dayMemos])
  const verificationSignature = useMemo(() => JSON.stringify(verificationResult), [verificationResult])
  const eligible = Boolean(isConfigured && isSignedIn && connectionIsEligible(connection))

  const setOperationKind = useCallback((next: DayMemoLocalOperationPreparationKind) => {
    setOperationKindState(next)
    setResult(null)
    readySnapshotRef.current = null
  }, [])

  const discard = useCallback(() => {
    setResult(null)
    readySnapshotRef.current = null
  }, [])

  useEffect(() => { discard() }, [connection?.workspaceId, discard, signature, verificationSignature])

  const check = useCallback(() => {
    const checkedAt = new Date().toISOString()
    const snapshot = getPreparationSnapshot()
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const stored = readDayMemoStorageSnapshot(window.localStorage)
    const date = verificationResult?.date ?? null
    const adoptionKind = verificationResult?.adoptionKind ?? 'overall'
    const metadata = loaded.status === 'ready' && loaded.metadata.version === 4 ? loaded.metadata : null
    const metadataValid = metadata !== null
    const workspaceValid = Boolean(metadata && connection?.workspaceId
      && metadata.workspaceId === connection.workspaceId && snapshot?.workspaceId === connection.workspaceId)
    const pushBlockClear = Boolean(metadata && metadata.pushBlock === null)
    const targetPendingClear = Boolean(metadata && (!date || metadata.pendingOperation?.date !== date))
    const targetIntentClear = Boolean(metadata && (!date || metadata.localDeleteIntents[date] === undefined))
    const otherPendingCount = metadata?.pendingOperation && metadata.pendingOperation.date !== date ? 1 : 0
    const otherIntentCount = metadata ? Object.keys(metadata.localDeleteIntents).filter((intentDate) => intentDate !== date).length : 0
    const cursorValid = Boolean(metadata && verificationResult?.remoteChangeSequence !== null
      && verificationResult?.remoteChangeSequence !== undefined
      && metadata.lastPulledChangeSequence >= verificationResult.remoteChangeSequence)
    const outsideMismatchCount = verificationResult?.outside.total ?? 0
    const verificationFresh = Boolean(snapshot && verificationResult
      && snapshot.result.checkedAt === verificationResult.checkedAt
      && JSON.stringify(snapshot.result) === JSON.stringify(verificationResult)
      && loaded.status === 'ready' && loaded.raw === snapshot.metadataRaw
      && stored.status === 'ready' && stored.serialized === snapshot.localStorageSerialized
      && signature === snapshot.localSignature)

    let classification: DayMemoLocalOperationPreparationClassification
    if (!verificationResult) classification = 'local_operation_prepare_verification_missing'
    else if (verificationResult.scope !== 'adoption_target' || !date || adoptionKind === 'overall') classification = 'local_operation_prepare_unsupported_adoption'
    else if (verificationResult.classification === 'adoption_verified_target_only') classification = 'local_operation_prepare_target_only'
    else if (verificationResult.classification === 'adoption_pending_remaining') classification = 'local_operation_prepare_pending_remaining'
    else if (verificationResult.classification === 'adoption_target_mismatch') classification = 'local_operation_prepare_target_mismatch'
    else if (verificationResult.classification === 'adoption_cursor_invalid') classification = 'local_operation_prepare_cursor_invalid'
    else if (verificationResult.classification !== 'adoption_verified_normal') classification = 'local_operation_prepare_state_unknown'
    else if (!snapshot) classification = 'local_operation_prepare_verification_stale'
    else if (!metadataValid || !eligible || !workspaceValid) classification = 'local_operation_prepare_state_unknown'
    else if (!pushBlockClear) classification = 'local_operation_prepare_push_blocked'
    else if (!targetPendingClear || otherPendingCount > 0) classification = 'local_operation_prepare_pending_remaining'
    else if (!targetIntentClear || otherIntentCount > 0) classification = 'local_operation_prepare_delete_intent_remaining'
    else if (!cursorValid) classification = 'local_operation_prepare_cursor_invalid'
    else if (outsideMismatchCount > 0) classification = 'local_operation_prepare_target_only'
    else if (!verificationFresh) classification = 'local_operation_prepare_state_changed'
    else {
      const baseline = metadata?.baselines[date]
      const localMatches = stored.status === 'ready' ? stored.memos.filter((memo) => memo.date === date) : []
      const activeState = adoptionKind === 'remote_active'
        && verificationResult.localState === 'active_match' && verificationResult.baselineState === 'match'
        && localMatches.length === 1 && baseline?.deletedAt === null
        && baseline.remoteRevision === verificationResult.remoteRevision
        && baseline.remoteChangeSequence === verificationResult.remoteChangeSequence
        && baseline.remoteUpdatedAt === snapshot.targetRemoteUpdatedAt
        && localMatches[0].updatedAt === snapshot.targetRemoteUpdatedAt
        && baseline.baselineLocalUpdatedAt === localMatches[0].updatedAt
      const tombstoneState = (adoptionKind === 'remote_tombstone' || adoptionKind === 'metadata_only_tombstone')
        && verificationResult.localState === 'deleted_match' && verificationResult.baselineState === 'match'
        && localMatches.length === 0 && baseline?.deletedAt !== null && baseline.baselineLocalUpdatedAt === null
        && baseline.remoteRevision === verificationResult.remoteRevision
        && baseline.remoteChangeSequence === verificationResult.remoteChangeSequence
        && baseline.remoteUpdatedAt === snapshot.targetRemoteUpdatedAt
        && baseline.deletedAt === snapshot.targetDeletedAt
      if (!activeState && !tombstoneState) classification = 'local_operation_prepare_target_mismatch'
      else if (operationKind === 'local_delete_prepare' && !activeState) classification = 'local_operation_prepare_prerequisite_missing'
      else classification = 'local_operation_prepare_ready'
    }

    const nextResult: DayMemoLocalOperationPreparationResult = {
      date,
      adoptionKind,
      operationKind,
      classification,
      ready: classification === 'local_operation_prepare_ready',
      metadataValid,
      workspaceValid,
      pushBlockClear,
      targetPendingClear,
      targetIntentClear,
      otherPendingCount,
      otherIntentCount,
      cursorValid,
      outsideMismatchCount,
      verificationFresh,
      checkedAt,
      nextAction: message(classification),
    }
    setResult(nextResult)
    readySnapshotRef.current = classification === 'local_operation_prepare_ready'
      && snapshot && loaded.status === 'ready' && stored.status === 'ready'
      ? {
        result: { ...nextResult },
        metadataRaw: loaded.raw,
        localStorageSerialized: stored.serialized,
        localSignature: signature,
        verificationSnapshot: {
          ...snapshot,
          result: { ...snapshot.result, outside: { ...snapshot.result.outside } },
        },
      }
      : null
  }, [connection?.workspaceId, eligible, getPreparationSnapshot, operationKind, signature, verificationResult])

  const getReadySnapshot = useCallback((): DayMemoLocalOperationPreparationReadySnapshot | null => {
    const snapshot = readySnapshotRef.current
    return snapshot ? {
      ...snapshot,
      result: { ...snapshot.result },
      verificationSnapshot: {
        ...snapshot.verificationSnapshot,
        result: { ...snapshot.verificationSnapshot.result, outside: { ...snapshot.verificationSnapshot.result.outside } },
      },
    } : null
  }, [])

  return { eligible, operationKind, setOperationKind, result, check, discard, getReadySnapshot }
}
