import { useCallback, useRef, useState } from 'react'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoPendingOperationV5, DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { isStoredDayMemo, readDayMemoStorageSnapshot, replaceStoredDayMemosVerified } from '../utils/dayMemoStorage'
import { isDayMemoSyncMetadataV5, loadDayMemoSyncMetadataAny, replaceDayMemoSyncMetadataV2 } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import { createUuidV4 } from '../utils/uuid'
import type {
  DayMemoLocalOperationPreparationKind,
  DayMemoLocalOperationPreparationReadySnapshot,
  DayMemoLocalOperationPreparationResult,
} from './useDayMemoLocalOperationPreparationCheck'

export type DayMemoLocalOperationPersistentPreparationClassification =
  | 'local_operation_prepared'
  | 'local_operation_prepare_verification_missing'
  | 'local_operation_prepare_verification_stale'
  | 'local_operation_prepare_target_mismatch'
  | 'local_operation_prepare_type_mismatch'
  | 'local_operation_prepare_pending_exists'
  | 'local_operation_prepare_delete_intent_exists'
  | 'local_operation_prepare_push_blocked'
  | 'local_operation_prepare_cursor_invalid'
  | 'local_operation_prepare_state_changed'
  | 'local_operation_prepare_prerequisite_missing'
  | 'local_operation_prepare_persistence_failed'
  | 'local_operation_prepare_unsupported'
  | 'local_operation_prepare_state_unknown'

export interface DayMemoLocalOperationPersistentPreparationResult {
  date: string | null
  operationKind: DayMemoLocalOperationPreparationKind
  succeeded: boolean
  classification: DayMemoLocalOperationPersistentPreparationClassification
  operationIdGenerated: boolean
  pendingCreated: boolean
  localDeleteIntentCreated: boolean
  dayMemoChanged: boolean
  remoteSent: false
  checkedAt: string
  nextAction: string
}

export interface DayMemoLocalOperationDeletePreparationInput {
  source: 'normal_delete_preparation'
  operationKind: 'local_delete_prepare'
  date: string
  workspaceId: string
  metadataRaw: string
  localStorageSerialized: string
  localSignature: string
  baselineRevision: number
  baselineChangeSequence: number
  baselineRemoteUpdatedAt: string
  baselineLocalUpdatedAt: string
  memoUpdatedAt: string
  checkedAt: string
}

export function isDayMemoLocalOperationDeletePreparationInput(
  value: DayMemoLocalOperationDeletePreparationInput,
): boolean {
  return value.source === 'normal_delete_preparation'
    && value.operationKind === 'local_delete_prepare'
    && value.date.length > 0
    && isUuid(value.workspaceId)
    && value.metadataRaw.length > 0
    && value.localStorageSerialized.length > 0
    && value.localSignature.length > 0
    && Number.isSafeInteger(value.baselineRevision) && value.baselineRevision >= 1
    && Number.isSafeInteger(value.baselineChangeSequence) && value.baselineChangeSequence >= 1
    && value.baselineRemoteUpdatedAt.length > 0
    && value.baselineLocalUpdatedAt.length > 0
    && value.memoUpdatedAt.length > 0
    && value.baselineLocalUpdatedAt === value.memoUpdatedAt
    && value.checkedAt.length > 0
}

export type DayMemoNormalDeletePreparationConnectionClassification =
  | 'normal_delete_v5_connection_ready'
  | 'normal_delete_v5_connection_missing'
  | 'normal_delete_v5_connection_target_mismatch'
  | 'normal_delete_v5_connection_state_changed'
  | 'normal_delete_v5_connection_prerequisite_invalid'

export interface DayMemoNormalDeletePreparationConnectionResult {
  date: string
  classification: DayMemoNormalDeletePreparationConnectionClassification
  ready: boolean
  checkedAt: string
}

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  preparationResult: DayMemoLocalOperationPreparationResult | null
  getReadySnapshot: () => DayMemoLocalOperationPreparationReadySnapshot | null
  getNormalDeletePreparationInput?: () => DayMemoLocalOperationDeletePreparationInput | null
  adoptVerifiedStoredDayMemos: (memos: DayMemo[]) => void
}

function signature(memos: DayMemo[]): string {
  return JSON.stringify(memos.map((memo) => [memo.date, memo.updatedAt, memo.content]).sort(([left], [right]) => left.localeCompare(right)))
}

function connectionIsEligible(connection: SyncConnection | null): boolean {
  return Boolean(connection && isUuid(connection.workspaceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}

function nextAction(classification: DayMemoLocalOperationPersistentPreparationClassification): string {
  if (classification === 'local_operation_prepared') return '新しいlocal操作を準備しました。送信は後続Phaseの別の明示操作で行います。'
  if (classification === 'local_operation_prepare_verification_missing') return '先に新しいlocal操作の準備条件を確認してください。'
  if (classification === 'local_operation_prepare_verification_stale') return '準備確認結果が古いため、remote採用後確認からやり直してください。'
  if (classification === 'local_operation_prepare_target_mismatch') return '対象日が準備確認結果と一致しません。'
  if (classification === 'local_operation_prepare_type_mismatch') return '操作種類が準備確認結果と一致しません。'
  if (classification === 'local_operation_prepare_pending_exists') return '未完了operationが残っているため、新しいoperationを作成しませんでした。'
  if (classification === 'local_operation_prepare_delete_intent_exists') return '削除意図が残っているため、新しいoperationを作成しませんでした。'
  if (classification === 'local_operation_prepare_push_blocked') return 'pushBlock中のため、新しいoperationを作成しませんでした。'
  if (classification === 'local_operation_prepare_cursor_invalid') return 'cursorの整合を確認できないため停止しました。'
  if (classification === 'local_operation_prepare_state_changed') return '準備確認後に端末状態が変化したため、永続データを変更しませんでした。'
  if (classification === 'local_operation_prepare_prerequisite_missing') return '選択した操作に必要なlocal／baseline状態がありません。'
  if (classification === 'local_operation_prepare_persistence_failed') return '永続準備を完了できませんでした。自動再試行せず同期状態を確認してください。'
  if (classification === 'local_operation_prepare_unsupported') return 'この操作はB-3f5d2b1の永続準備対象ではありません。'
  return '状態を安全に確認できなかったため、永続データを変更しませんでした。'
}

export function useDayMemoLocalOperationPreparation({
  dayMemos,
  isConfigured,
  isSignedIn,
  connection,
  preparationResult,
  getReadySnapshot,
  getNormalDeletePreparationInput,
  adoptVerifiedStoredDayMemos,
}: Input) {
  const [result, setResult] = useState<DayMemoLocalOperationPersistentPreparationResult | null>(null)
  const [normalDeleteConnectionResult, setNormalDeleteConnectionResult] = useState<DayMemoNormalDeletePreparationConnectionResult | null>(null)
  const normalDeleteInputRef = useRef<DayMemoLocalOperationDeletePreparationInput | null>(null)
  const eligible = Boolean(isConfigured && isSignedIn && connectionIsEligible(connection))

  const connectNormalDeletePreparation = useCallback((date: string): boolean => {
    const checkedAt = new Date().toISOString()
    const finish = (classification: DayMemoNormalDeletePreparationConnectionClassification): boolean => {
      normalDeleteInputRef.current = null
      setNormalDeleteConnectionResult({
        date,
        classification,
        ready: classification === 'normal_delete_v5_connection_ready',
        checkedAt,
      })
      return classification === 'normal_delete_v5_connection_ready'
    }
    const adapter = getNormalDeletePreparationInput?.() ?? null
    if (!adapter || !isDayMemoLocalOperationDeletePreparationInput(adapter)) {
      return finish('normal_delete_v5_connection_missing')
    }
    if (adapter.date !== date) return finish('normal_delete_v5_connection_target_mismatch')
    if (!eligible || !connection?.workspaceId || adapter.workspaceId !== connection.workspaceId) {
      return finish('normal_delete_v5_connection_prerequisite_invalid')
    }
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const stored = readDayMemoStorageSnapshot(window.localStorage)
    if (loaded.status !== 'ready' || loaded.metadata.version !== 5 || stored.status !== 'ready') {
      return finish('normal_delete_v5_connection_prerequisite_invalid')
    }
    if (loaded.raw !== adapter.metadataRaw || stored.serialized !== adapter.localStorageSerialized
      || signature(stored.memos) !== adapter.localSignature || signature(dayMemos) !== adapter.localSignature) {
      return finish('normal_delete_v5_connection_state_changed')
    }
    const baseline = loaded.metadata.baselines[date]
    const memo = stored.memos.find((item) => item.date === date)
    if (loaded.metadata.workspaceId !== adapter.workspaceId
      || loaded.metadata.baselineStatus !== 'confirmed' || loaded.metadata.baselineConfirmedAt === null
      || loaded.metadata.pendingOperation !== null || loaded.metadata.pushBlock !== null
      || Object.keys(loaded.metadata.localDeleteIntents).length !== 0
      || !baseline || baseline.deletedAt !== null || !memo
      || baseline.remoteRevision !== adapter.baselineRevision
      || baseline.remoteChangeSequence !== adapter.baselineChangeSequence
      || baseline.remoteUpdatedAt !== adapter.baselineRemoteUpdatedAt
      || baseline.baselineLocalUpdatedAt !== adapter.baselineLocalUpdatedAt
      || memo.updatedAt !== adapter.memoUpdatedAt) {
      return finish('normal_delete_v5_connection_prerequisite_invalid')
    }
    normalDeleteInputRef.current = { ...adapter }
    setNormalDeleteConnectionResult({
      date,
      classification: 'normal_delete_v5_connection_ready',
      ready: true,
      checkedAt,
    })
    return true
  }, [connection?.workspaceId, dayMemos, eligible, getNormalDeletePreparationInput])

  const getConnectedNormalDeletePreparationInput = useCallback(() => {
    const adapter = normalDeleteInputRef.current
    return adapter ? { ...adapter } : null
  }, [])

  const finish = useCallback((
    operationKind: DayMemoLocalOperationPreparationKind,
    classification: DayMemoLocalOperationPersistentPreparationClassification,
    flags: Partial<Pick<DayMemoLocalOperationPersistentPreparationResult,
      'operationIdGenerated' | 'pendingCreated' | 'localDeleteIntentCreated' | 'dayMemoChanged'>> = {},
  ): boolean => {
    setResult({
      date: preparationResult?.date ?? null,
      operationKind,
      succeeded: classification === 'local_operation_prepared',
      classification,
      operationIdGenerated: flags.operationIdGenerated ?? false,
      pendingCreated: flags.pendingCreated ?? false,
      localDeleteIntentCreated: flags.localDeleteIntentCreated ?? false,
      dayMemoChanged: flags.dayMemoChanged ?? false,
      remoteSent: false,
      checkedAt: new Date().toISOString(),
      nextAction: nextAction(classification),
    })
    return classification === 'local_operation_prepared'
  }, [preparationResult?.date])

  const validateCurrent = useCallback((operationKind: DayMemoLocalOperationPreparationKind) => {
    const snapshot = getReadySnapshot()
    if (!preparationResult || !snapshot) return { error: 'local_operation_prepare_verification_missing' as const }
    if (preparationResult.classification !== 'local_operation_prepare_ready' || !preparationResult.ready) {
      return { error: 'local_operation_prepare_verification_stale' as const }
    }
    if (snapshot.result.date !== preparationResult.date || !preparationResult.date) {
      return { error: 'local_operation_prepare_target_mismatch' as const }
    }
    if (snapshot.result.operationKind !== operationKind || preparationResult.operationKind !== operationKind) {
      return { error: 'local_operation_prepare_type_mismatch' as const }
    }
    if (!eligible || !connection?.workspaceId) return { error: 'local_operation_prepare_state_unknown' as const }
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const stored = readDayMemoStorageSnapshot(window.localStorage)
    if (loaded.status !== 'ready' || loaded.metadata.version !== 5 || stored.status !== 'ready') {
      return { error: 'local_operation_prepare_state_unknown' as const }
    }
    if (loaded.metadata.workspaceId !== connection.workspaceId) return { error: 'local_operation_prepare_state_unknown' as const }
    if (loaded.raw !== snapshot.metadataRaw || stored.serialized !== snapshot.localStorageSerialized
      || signature(stored.memos) !== snapshot.localSignature || signature(dayMemos) !== snapshot.localSignature) {
      return { error: 'local_operation_prepare_state_changed' as const }
    }
    if (loaded.metadata.pushBlock !== null) return { error: 'local_operation_prepare_push_blocked' as const }
    if (loaded.metadata.pendingOperation !== null) return { error: 'local_operation_prepare_pending_exists' as const }
    if (Object.keys(loaded.metadata.localDeleteIntents).length > 0) return { error: 'local_operation_prepare_delete_intent_exists' as const }
    if (!preparationResult.cursorValid || loaded.metadata.lastPulledChangeSequence < (snapshot.verificationSnapshot.result.remoteChangeSequence ?? Number.MAX_SAFE_INTEGER)) {
      return { error: 'local_operation_prepare_cursor_invalid' as const }
    }
    if (!preparationResult.verificationFresh || preparationResult.outsideMismatchCount !== 0
      || JSON.stringify(snapshot.result) !== JSON.stringify(preparationResult)) {
      return { error: 'local_operation_prepare_verification_stale' as const }
    }
    return { snapshot, loaded, stored, metadata: loaded.metadata }
  }, [connection?.workspaceId, dayMemos, eligible, getReadySnapshot, preparationResult])

  const prepareEdit = useCallback(() => {
    const checked = validateCurrent('local_edit_prepare')
    if ('error' in checked && checked.error) return finish('local_edit_prepare', checked.error)
    return finish('local_edit_prepare', 'local_operation_prepared')
  }, [finish, validateCurrent])

  const prepareSave = useCallback((memo: DayMemo): boolean => {
    const operationKind = 'local_save_prepare' as const
    const checked = validateCurrent(operationKind)
    if ('error' in checked && checked.error) return finish(operationKind, checked.error)
    if (!isStoredDayMemo(memo) || memo.date !== checked.snapshot.result.date) {
      return finish(operationKind, 'local_operation_prepare_target_mismatch')
    }
    const baseline = checked.metadata.baselines[memo.date]
    if (!baseline || baseline.remoteRevision !== checked.snapshot.verificationSnapshot.result.remoteRevision
      || baseline.remoteChangeSequence !== checked.snapshot.verificationSnapshot.result.remoteChangeSequence) {
      return finish(operationKind, 'local_operation_prepare_prerequisite_missing')
    }
    const operationId = createUuidV4()
    if (!operationId) return finish(operationKind, 'local_operation_prepare_state_unknown')
    const nextMemos = checked.stored.memos.some((item) => item.date === memo.date)
      ? checked.stored.memos.map((item) => item.date === memo.date ? { ...memo } : { ...item })
      : [...checked.stored.memos.map((item) => ({ ...item })), { ...memo }]
    const localSave = replaceStoredDayMemosVerified(window.localStorage, nextMemos, checked.stored.serialized)
    if (localSave !== 'saved') {
      return finish(operationKind, 'local_operation_prepare_persistence_failed', { operationIdGenerated: true })
    }
    const pendingOperation: DayMemoPendingOperationV5 = {
      kind: 'upsert',
      operationMode: 'normal',
      date: memo.date,
      operationId,
      baseRevision: baseline.remoteRevision,
      preparedLocalUpdatedAt: memo.updatedAt,
      preparedAt: new Date().toISOString(),
      status: 'prepared',
    }
    const nextMetadata: DayMemoSyncMetadataV5 = { ...checked.metadata, pendingOperation }
    const metadataSave = isDayMemoSyncMetadataV5(nextMetadata)
      ? replaceDayMemoSyncMetadataV2(window.localStorage, nextMetadata, checked.loaded.raw)
      : 'metadata_invalid'
    if (metadataSave !== 'saved') {
      const currentLocal = readDayMemoStorageSnapshot(window.localStorage)
      const rollback = currentLocal.status === 'ready'
        ? replaceStoredDayMemosVerified(window.localStorage, checked.stored.memos, currentLocal.serialized)
        : 'rollback_failed'
      return finish(operationKind, 'local_operation_prepare_persistence_failed', {
        operationIdGenerated: true,
        dayMemoChanged: rollback !== 'saved',
      })
    }
    adoptVerifiedStoredDayMemos(nextMemos)
    return finish(operationKind, 'local_operation_prepared', {
      operationIdGenerated: true,
      pendingCreated: true,
      dayMemoChanged: true,
    })
  }, [adoptVerifiedStoredDayMemos, finish, validateCurrent])

  const prepareDelete = useCallback((date: string): boolean => {
    const operationKind = 'local_delete_prepare' as const
    const checked = validateCurrent(operationKind)
    if ('error' in checked && checked.error) return finish(operationKind, checked.error)
    if (date !== checked.snapshot.result.date) return finish(operationKind, 'local_operation_prepare_target_mismatch')
    const baseline = checked.metadata.baselines[date]
    const memo = checked.stored.memos.find((item) => item.date === date)
    if (!baseline || baseline.deletedAt !== null || !memo || baseline.baselineLocalUpdatedAt !== memo.updatedAt
      || baseline.remoteRevision !== checked.snapshot.verificationSnapshot.result.remoteRevision
      || baseline.remoteChangeSequence !== checked.snapshot.verificationSnapshot.result.remoteChangeSequence) {
      return finish(operationKind, 'local_operation_prepare_prerequisite_missing')
    }
    if (!window.confirm(`${date}の日記・メモをこの端末から削除し、新しい同期削除操作として準備しますか？\n\nこの時点では同期先から削除しません。`)) return false
    const operationId = createUuidV4()
    if (!operationId) return finish(operationKind, 'local_operation_prepare_state_unknown')
    const preparedAt = new Date().toISOString()
    const pendingOperation: DayMemoPendingOperationV5 = {
      kind: 'delete',
      date,
      operationId,
      baseRevision: baseline.remoteRevision,
      preparedAt,
      clientDeletedAt: preparedAt,
      status: 'prepared',
    }
    const nextMetadata: DayMemoSyncMetadataV5 = {
      ...checked.metadata,
      localDeleteIntents: {
        ...checked.metadata.localDeleteIntents,
        [date]: {
          date,
          operationId,
          baselineRevision: baseline.remoteRevision,
          baselineChangeSequence: baseline.remoteChangeSequence,
          deletedLocalUpdatedAt: memo.updatedAt,
          createdAt: preparedAt,
          status: 'prepared',
        },
      },
      pendingOperation,
    }
    if (!isDayMemoSyncMetadataV5(nextMetadata)) return finish(operationKind, 'local_operation_prepare_state_unknown')
    const metadataSave = replaceDayMemoSyncMetadataV2(window.localStorage, nextMetadata, checked.loaded.raw)
    if (metadataSave !== 'saved') {
      return finish(operationKind, 'local_operation_prepare_persistence_failed', { operationIdGenerated: true })
    }
    const nextMemos = checked.stored.memos.filter((item) => item.date !== date)
    const localSave = replaceStoredDayMemosVerified(window.localStorage, nextMemos, checked.stored.serialized)
    if (localSave !== 'saved') {
      const metadataRollback = replaceDayMemoSyncMetadataV2(window.localStorage, checked.metadata, JSON.stringify(nextMetadata))
      return finish(operationKind, 'local_operation_prepare_persistence_failed', {
        operationIdGenerated: true,
        pendingCreated: metadataRollback !== 'saved',
        localDeleteIntentCreated: metadataRollback !== 'saved',
      })
    }
    adoptVerifiedStoredDayMemos(nextMemos)
    return finish(operationKind, 'local_operation_prepared', {
      operationIdGenerated: true,
      pendingCreated: true,
      localDeleteIntentCreated: true,
      dayMemoChanged: true,
    })
  }, [adoptVerifiedStoredDayMemos, finish, validateCurrent])

  const discard = useCallback(() => setResult(null), [])

  return {
    eligible,
    result,
    prepareEdit,
    prepareSave,
    prepareDelete,
    discard,
    normalDeleteConnectionResult,
    connectNormalDeletePreparation,
    getConnectedNormalDeletePreparationInput,
  }
}
