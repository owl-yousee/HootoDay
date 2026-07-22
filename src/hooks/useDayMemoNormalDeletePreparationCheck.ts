import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DayMemo } from '../types/dayMemo'
import type {
  DayMemoPullPreviewItem,
  DayMemoPullPreviewState,
  DayMemoPullPreviewSummary,
  DayMemoRemoteBaselineV3,
  DayMemoSyncMetadataV5,
} from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { isDayMemoSyncMetadataV5, loadDayMemoSyncMetadataAny } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import {
  isDayMemoLocalOperationDeletePreparationInput,
  type DayMemoLocalOperationDeletePreparationInput,
} from './useDayMemoLocalOperationPreparation'

export type DayMemoNormalDeletePreparationClassification =
  | 'normal_delete_preparation_ready'
  | 'normal_delete_preparation_prerequisite_missing'
  | 'normal_delete_preparation_metadata_invalid'
  | 'normal_delete_preparation_workspace_mismatch'
  | 'normal_delete_preparation_baseline_unconfirmed'
  | 'normal_delete_preparation_pending_remaining'
  | 'normal_delete_preparation_push_blocked'
  | 'normal_delete_preparation_intent_remaining'
  | 'normal_delete_preparation_difference_unconfirmed'
  | 'normal_delete_preparation_target_mismatch'
  | 'normal_delete_preparation_state_changed'

export interface DayMemoNormalDeletePreparationResult {
  date: string
  classification: DayMemoNormalDeletePreparationClassification
  ready: boolean
  metadataVersion: number | null
  baselineStatus: string | null
  baselineConfirmed: boolean
  pendingAbsent: boolean
  pushBlockClear: boolean
  intentCount: number
  differencesConfirmedAbsent: boolean
  targetBaselineConfirmed: boolean
  localStateMatched: boolean
  checkedAt: string
}

export interface DayMemoNormalDeletePreparationReadySnapshot {
  result: DayMemoNormalDeletePreparationResult
  workspaceId: string
  metadataRaw: string
  localStorageSerialized: string
  localSignature: string
  normalPreviewSignature: string
  metadata: DayMemoSyncMetadataV5
  baseline: DayMemoRemoteBaselineV3
  memo: DayMemo
}

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  reactMetadata: DayMemoSyncMetadataV5 | null
  normalPullState: DayMemoPullPreviewState
  normalPullSummary: DayMemoPullPreviewSummary | null
  normalPullItems: DayMemoPullPreviewItem[]
}

function localSignature(memos: DayMemo[]): string {
  return JSON.stringify(memos.map((memo) => [memo.date, memo.updatedAt, memo.content]).sort(([left], [right]) => left.localeCompare(right)))
}

function connectionIsEligible(connection: SyncConnection | null): connection is SyncConnection & { workspaceId: string } {
  return Boolean(connection && isUuid(connection.workspaceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}

function copyMetadata(metadata: DayMemoSyncMetadataV5): DayMemoSyncMetadataV5 {
  return JSON.parse(JSON.stringify(metadata)) as DayMemoSyncMetadataV5
}

function itemMatchesConfirmedBaseline(
  item: DayMemoPullPreviewItem,
  baseline: DayMemoRemoteBaselineV3 | undefined,
  memo: DayMemo | undefined,
): boolean {
  if (!baseline || item.comparison !== 'same'
    || baseline.remoteRevision !== item.remoteRevision
    || baseline.remoteChangeSequence !== item.remoteChangeSequence
    || baseline.remoteUpdatedAt !== item.remoteUpdatedAt) return false
  if (baseline.deletedAt === null) {
    return !item.tombstone && item.remoteDeletedAt === null && Boolean(memo
      && baseline.baselineLocalUpdatedAt === memo.updatedAt
      && baseline.remoteUpdatedAt === memo.updatedAt)
  }
  return item.tombstone && memo === undefined
    && baseline.baselineLocalUpdatedAt === null
    && item.remoteDeletedAt !== null
    && baseline.deletedAt === item.remoteDeletedAt
}

export function useDayMemoNormalDeletePreparationCheck(input: Input) {
  const [result, setResult] = useState<DayMemoNormalDeletePreparationResult | null>(null)
  const readySnapshotRef = useRef<DayMemoNormalDeletePreparationReadySnapshot | null>(null)
  const currentLocalSignature = useMemo(() => localSignature(input.dayMemos), [input.dayMemos])
  const normalPreviewSignature = useMemo(() => JSON.stringify({
    state: input.normalPullState,
    summary: input.normalPullSummary,
    items: input.normalPullItems,
  }), [input.normalPullItems, input.normalPullState, input.normalPullSummary])

  const discard = useCallback(() => {
    readySnapshotRef.current = null
    setResult(null)
  }, [])

  useEffect(() => { discard() }, [discard, input.connection?.workspaceId, currentLocalSignature, normalPreviewSignature])

  const checkCandidate = useCallback((date: string) => {
    const checkedAt = new Date().toISOString()
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const stored = readDayMemoStorageSnapshot(window.localStorage)
    const metadata = loaded.status === 'ready' && isDayMemoSyncMetadataV5(loaded.metadata) ? loaded.metadata : null
    const common = {
      date,
      metadataVersion: metadata?.version ?? null,
      baselineStatus: metadata?.baselineStatus ?? null,
      baselineConfirmed: Boolean(metadata?.baselineStatus === 'confirmed' && metadata.baselineConfirmedAt !== null),
      pendingAbsent: metadata?.pendingOperation === null,
      pushBlockClear: metadata?.pushBlock === null,
      intentCount: metadata ? Object.keys(metadata.localDeleteIntents).length : 0,
      differencesConfirmedAbsent: false,
      targetBaselineConfirmed: false,
      localStateMatched: false,
      checkedAt,
    }
    const finish = (
      classification: DayMemoNormalDeletePreparationClassification,
      values: Partial<DayMemoNormalDeletePreparationResult> = {},
    ) => {
      const next = { ...common, ...values, classification, ready: classification === 'normal_delete_preparation_ready' }
      readySnapshotRef.current = null
      setResult(next)
      return next
    }

    if (!input.isConfigured || !input.isSignedIn || !connectionIsEligible(input.connection)) {
      return finish('normal_delete_preparation_prerequisite_missing')
    }
    if (!metadata || loaded.status !== 'ready' || stored.status !== 'ready' || !input.reactMetadata) {
      return finish('normal_delete_preparation_metadata_invalid')
    }
    if (metadata.workspaceId !== input.connection.workspaceId
      || input.reactMetadata.workspaceId !== input.connection.workspaceId) {
      return finish('normal_delete_preparation_workspace_mismatch')
    }
    if (JSON.stringify(metadata) !== JSON.stringify(input.reactMetadata)) {
      return finish('normal_delete_preparation_state_changed')
    }
    if (metadata.baselineStatus !== 'confirmed' || metadata.baselineConfirmedAt === null) {
      return finish('normal_delete_preparation_baseline_unconfirmed')
    }
    if (metadata.pendingOperation !== null) return finish('normal_delete_preparation_pending_remaining')
    if (metadata.pushBlock !== null) return finish('normal_delete_preparation_push_blocked')
    if (Object.keys(metadata.localDeleteIntents).length !== 0) return finish('normal_delete_preparation_intent_remaining')
    if (stored.serialized === null || localSignature(stored.memos) !== currentLocalSignature) {
      return finish('normal_delete_preparation_state_changed')
    }

    const summary = input.normalPullSummary
    const items = input.normalPullItems
    const allSame = input.normalPullState === 'preview_ready' && summary !== null
      && summary.localOnlyCount === 0 && summary.remoteOnlyCount === 0 && summary.differentCount === 0
      && summary.unresolvedTombstoneCount === 0 && summary.remoteTombstoneLocalExistsCount === 0
      && summary.remoteTombstoneLocalMissingCount === 0
      && summary.sameCount === Object.keys(metadata.baselines).length
      && summary.maxChangeSequence === metadata.lastPulledChangeSequence
      && items.length === summary.sameCount && items.every((item) => item.comparison === 'same')
      && items.every((item) => {
        const baseline = metadata.baselines[item.date]
        const memo = stored.memos.find((candidate) => candidate.date === item.date)
        return itemMatchesConfirmedBaseline(item, baseline, memo)
      })
    if (!allSame) return finish('normal_delete_preparation_difference_unconfirmed')

    const targetMemos = stored.memos.filter((memo) => memo.date === date)
    const targetItems = items.filter((item) => item.date === date)
    const baseline = metadata.baselines[date]
    const targetReady = targetMemos.length === 1 && targetItems.length === 1
      && targetItems[0].comparison === 'same' && !targetItems[0].tombstone
      && targetItems[0].remoteDeletedAt === null && baseline?.deletedAt === null
      && baseline.remoteRevision === targetItems[0].remoteRevision
      && baseline.remoteChangeSequence === targetItems[0].remoteChangeSequence
      && baseline.remoteUpdatedAt === targetItems[0].remoteUpdatedAt
      && baseline.remoteUpdatedAt === targetMemos[0].updatedAt
      && baseline.baselineLocalUpdatedAt === targetMemos[0].updatedAt
    if (!targetReady || !baseline) {
      return finish('normal_delete_preparation_target_mismatch', { differencesConfirmedAbsent: true })
    }

    const next = finish('normal_delete_preparation_ready', {
      differencesConfirmedAbsent: true,
      targetBaselineConfirmed: true,
      localStateMatched: true,
    })
    readySnapshotRef.current = {
      result: { ...next },
      workspaceId: input.connection.workspaceId,
      metadataRaw: loaded.raw,
      localStorageSerialized: stored.serialized,
      localSignature: currentLocalSignature,
      normalPreviewSignature,
      metadata: copyMetadata(metadata),
      baseline: { ...baseline },
      memo: { ...targetMemos[0] },
    }
    return next
  }, [currentLocalSignature, input, normalPreviewSignature])

  const getReadySnapshot = useCallback(() => {
    const snapshot = readySnapshotRef.current
    return snapshot ? {
      ...snapshot,
      result: { ...snapshot.result },
      metadata: copyMetadata(snapshot.metadata),
      baseline: { ...snapshot.baseline },
      memo: { ...snapshot.memo },
    } : null
  }, [])

  const getV5DeletePreparationInput = useCallback((): DayMemoLocalOperationDeletePreparationInput | null => {
    const snapshot = readySnapshotRef.current
    if (!snapshot || snapshot.result.classification !== 'normal_delete_preparation_ready'
      || !snapshot.result.ready || snapshot.baseline.deletedAt !== null
      || snapshot.baseline.baselineLocalUpdatedAt === null) return null

    const adapter: DayMemoLocalOperationDeletePreparationInput = {
      source: 'normal_delete_preparation',
      operationKind: 'local_delete_prepare',
      date: snapshot.result.date,
      workspaceId: snapshot.workspaceId,
      metadataRaw: snapshot.metadataRaw,
      localStorageSerialized: snapshot.localStorageSerialized,
      localSignature: snapshot.localSignature,
      baselineRevision: snapshot.baseline.remoteRevision,
      baselineChangeSequence: snapshot.baseline.remoteChangeSequence,
      baselineRemoteUpdatedAt: snapshot.baseline.remoteUpdatedAt,
      baselineLocalUpdatedAt: snapshot.baseline.baselineLocalUpdatedAt,
      memoUpdatedAt: snapshot.memo.updatedAt,
      checkedAt: snapshot.result.checkedAt,
    }
    return isDayMemoLocalOperationDeletePreparationInput(adapter) ? { ...adapter } : null
  }, [])

  return { result, checkCandidate, discard, getReadySnapshot, getV5DeletePreparationInput }
}
