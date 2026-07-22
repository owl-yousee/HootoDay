import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type {
  DayMemoPullPreviewItem,
  DayMemoPullPreviewSummary,
  DayMemoSyncMetadataV5,
} from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { buildDayMemoPullPreview } from '../utils/dayMemoPullPreview'
import { pullAllDayMemoSyncRecords, type RemoteDayMemoRecord } from '../utils/dayMemoSyncPull'
import { isDayMemoSyncMetadataV5, loadDayMemoSyncMetadataAny } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import type { DayMemoNormalDifferenceClassification } from './useDayMemoNormalDifferenceRecoveryPlan'

export type DayMemoDeleteCandidateVerificationStatus = 'idle' | 'checking' | 'ready' | 'blocked' | 'failed'

export type DayMemoDeleteCandidateVerificationClassification =
  | 'delete_candidate_verification_ready'
  | 'delete_candidate_verification_prerequisite_missing'
  | 'delete_candidate_verification_metadata_invalid'
  | 'delete_candidate_verification_workspace_mismatch'
  | 'delete_candidate_verification_baseline_unconfirmed'
  | 'delete_candidate_verification_pending_remaining'
  | 'delete_candidate_verification_push_blocked'
  | 'delete_candidate_verification_intent_remaining'
  | 'delete_candidate_verification_target_invalid'
  | 'delete_candidate_verification_pull_failed'
  | 'delete_candidate_verification_pull_malformed'
  | 'delete_candidate_verification_state_changed'
  | 'delete_candidate_verification_cursor_mismatch'
  | 'delete_candidate_verification_difference_unconfirmed'
  | 'delete_candidate_verification_unknown'

export interface DayMemoDeleteCandidateVerificationResult {
  date: string
  classification: DayMemoDeleteCandidateVerificationClassification
  ready: boolean
  metadataVersion: number | null
  baselineConfirmed: boolean
  pendingAbsent: boolean
  pushBlockClear: boolean
  intentCount: number
  cursor: number | null
  fullPullMaxSequence: number | null
  cursorMatched: boolean
  previewItemCount: number
  unresolvedTombstoneCount: number | null
  differenceCount: number | null
  targetClassification: DayMemoNormalDifferenceClassification | null
  targetActiveBaseline: boolean
  targetLocalPresent: boolean
  targetComparisonSame: boolean
  fullPullCount: 0 | 1
  persistentStateChanged: false
  automaticRetry: false
  checkedAt: string
}

export interface DayMemoDeleteCandidateVerifiedSnapshot {
  targetDate: string
  workspaceId: string
  metadataFingerprint: string
  localSignature: string
  remoteFingerprint: string
  previewItems: DayMemoPullPreviewItem[]
  summary: DayMemoPullPreviewSummary
  classifications: Record<string, DayMemoNormalDifferenceClassification>
  cursor: number
  fullPullMaxSequence: number
  checkedAt: string
}

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  reactMetadata: DayMemoSyncMetadataV5 | null
}

function connectionIsEligible(connection: SyncConnection | null): connection is SyncConnection & { workspaceId: string } {
  return Boolean(connection && isUuid(connection.workspaceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}

function localSignature(memos: DayMemo[]): string {
  return JSON.stringify(memos.map((memo) => [memo.date, memo.updatedAt, memo.content])
    .sort(([left], [right]) => left.localeCompare(right)))
}

function remoteFingerprint(records: RemoteDayMemoRecord[]): string {
  return JSON.stringify(records)
}

function copyItems(items: DayMemoPullPreviewItem[]): DayMemoPullPreviewItem[] {
  return items.map((item) => ({ ...item }))
}

export function useDayMemoDeleteCandidateVerification(input: Input) {
  const [status, setStatus] = useState<DayMemoDeleteCandidateVerificationStatus>('idle')
  const [result, setResult] = useState<DayMemoDeleteCandidateVerificationResult | null>(null)
  const [verifiedSnapshot, setVerifiedSnapshot] = useState<DayMemoDeleteCandidateVerifiedSnapshot | null>(null)
  const runIdRef = useRef(0)
  const inFlightRef = useRef(false)
  const currentLocalSignature = useMemo(() => localSignature(input.dayMemos), [input.dayMemos])
  const reactMetadataFingerprint = useMemo(() => JSON.stringify(input.reactMetadata), [input.reactMetadata])
  const latestRef = useRef({ ...input, localSignature: currentLocalSignature, reactMetadataFingerprint })
  latestRef.current = { ...input, localSignature: currentLocalSignature, reactMetadataFingerprint }
  const eligible = Boolean(input.isConfigured && input.isSignedIn && supabaseClient
    && connectionIsEligible(input.connection))

  const finish = useCallback((
    classification: DayMemoDeleteCandidateVerificationClassification,
    date: string,
    values: Partial<DayMemoDeleteCandidateVerificationResult> = {},
  ) => {
    const ready = classification === 'delete_candidate_verification_ready'
    const next: DayMemoDeleteCandidateVerificationResult = {
      date,
      classification,
      ready,
      metadataVersion: null,
      baselineConfirmed: false,
      pendingAbsent: false,
      pushBlockClear: false,
      intentCount: 0,
      cursor: null,
      fullPullMaxSequence: null,
      cursorMatched: false,
      previewItemCount: 0,
      unresolvedTombstoneCount: null,
      differenceCount: null,
      targetClassification: null,
      targetActiveBaseline: false,
      targetLocalPresent: false,
      targetComparisonSame: false,
      fullPullCount: 0,
      persistentStateChanged: false,
      automaticRetry: false,
      checkedAt: new Date().toISOString(),
      ...values,
    }
    setResult(next)
    setStatus(ready ? 'ready' : classification === 'delete_candidate_verification_unknown' ? 'failed' : 'blocked')
    if (!ready) setVerifiedSnapshot(null)
    return next
  }, [])

  const discard = useCallback(() => {
    runIdRef.current += 1
    inFlightRef.current = false
    setStatus('idle')
    setResult(null)
    setVerifiedSnapshot(null)
  }, [])

  useEffect(() => {
    discard()
  }, [currentLocalSignature, discard, input.connection?.workspaceId, reactMetadataFingerprint])

  const checkCandidate = useCallback(async (date: string): Promise<void> => {
    if (inFlightRef.current) return
    setVerifiedSnapshot(null)
    setResult(null)
    if (!eligible || !supabaseClient || !connectionIsEligible(input.connection)) {
      finish('delete_candidate_verification_prerequisite_missing', date)
      return
    }

    const runId = ++runIdRef.current
    inFlightRef.current = true
    setStatus('checking')
    try {
      const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
      const stored = readDayMemoStorageSnapshot(window.localStorage)
      if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata)
        || stored.status !== 'ready' || !input.reactMetadata) {
        finish('delete_candidate_verification_metadata_invalid', date)
        return
      }
      const metadata = loaded.metadata
      const intentCount = Object.keys(metadata.localDeleteIntents).length
      const common = {
        metadataVersion: 5,
        baselineConfirmed: metadata.baselineStatus === 'confirmed' && metadata.baselineConfirmedAt !== null,
        pendingAbsent: metadata.pendingOperation === null,
        pushBlockClear: metadata.pushBlock === null,
        intentCount,
        cursor: metadata.lastPulledChangeSequence,
      }
      if (metadata.workspaceId !== input.connection.workspaceId) {
        finish('delete_candidate_verification_workspace_mismatch', date, common)
        return
      }
      if (JSON.stringify(metadata) !== reactMetadataFingerprint || stored.serialized === null
        || localSignature(stored.memos) !== currentLocalSignature) {
        finish('delete_candidate_verification_state_changed', date, common)
        return
      }
      if (metadata.baselineStatus !== 'confirmed' || metadata.baselineConfirmedAt === null) {
        finish('delete_candidate_verification_baseline_unconfirmed', date, common)
        return
      }
      if (metadata.pendingOperation !== null) {
        finish('delete_candidate_verification_pending_remaining', date, common)
        return
      }
      if (metadata.pushBlock !== null) {
        finish('delete_candidate_verification_push_blocked', date, common)
        return
      }
      if (intentCount !== 0) {
        finish('delete_candidate_verification_intent_remaining', date, common)
        return
      }
      const baseline = metadata.baselines[date]
      const targetMemos = stored.memos.filter((memo) => memo.date === date)
      if (!baseline || baseline.deletedAt !== null || targetMemos.length !== 1) {
        finish('delete_candidate_verification_target_invalid', date, {
          ...common,
          targetActiveBaseline: Boolean(baseline?.deletedAt === null),
          targetLocalPresent: targetMemos.length === 1,
        })
        return
      }

      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, input.connection.workspaceId,
        () => runIdRef.current === runId).catch(() => null)
      if (runIdRef.current !== runId) return
      if (!pulled) {
        finish('delete_candidate_verification_pull_failed', date, { ...common, fullPullCount: 1 })
        return
      }
      if (pulled.status !== 'complete') {
        finish(pulled.status === 'validation_error' || pulled.status === 'limit_reached'
          ? 'delete_candidate_verification_pull_malformed'
          : 'delete_candidate_verification_pull_failed', date, { ...common, fullPullCount: 1 })
        return
      }

      const latest = latestRef.current
      const after = loadDayMemoSyncMetadataAny(window.localStorage)
      const afterStored = readDayMemoStorageSnapshot(window.localStorage)
      if (runIdRef.current !== runId || !latest.isConfigured || !latest.isSignedIn
        || !connectionIsEligible(latest.connection) || latest.connection.workspaceId !== input.connection.workspaceId
        || after.status !== 'ready' || after.raw !== loaded.raw
        || afterStored.status !== 'ready' || afterStored.serialized !== stored.serialized
        || latest.reactMetadataFingerprint !== JSON.stringify(metadata)
        || latest.localSignature !== currentLocalSignature) {
        finish('delete_candidate_verification_state_changed', date, { ...common, fullPullCount: 1 })
        return
      }

      const preview = buildDayMemoPullPreview(pulled.records, stored.memos, metadata)
      if (!preview) {
        finish('delete_candidate_verification_pull_malformed', date, {
          ...common,
          fullPullCount: 1,
          fullPullMaxSequence: pulled.maxChangeSequence,
        })
        return
      }
      const differenceCount = preview.summary.localOnlyCount + preview.summary.remoteOnlyCount
        + preview.summary.differentCount + preview.summary.unresolvedTombstoneCount
      const targetItem = preview.items.find((item) => item.date === date)
      const targetClassification = preview.classifications[date] ?? null
      const remoteCommon = {
        ...common,
        fullPullCount: 1 as const,
        fullPullMaxSequence: pulled.maxChangeSequence,
        cursorMatched: pulled.maxChangeSequence === metadata.lastPulledChangeSequence,
        previewItemCount: preview.items.length,
        unresolvedTombstoneCount: preview.summary.unresolvedTombstoneCount,
        differenceCount,
        targetClassification,
        targetActiveBaseline: baseline.deletedAt === null,
        targetLocalPresent: targetMemos.length === 1,
        targetComparisonSame: targetItem?.comparison === 'same',
      }
      if (pulled.maxChangeSequence !== metadata.lastPulledChangeSequence) {
        finish('delete_candidate_verification_cursor_mismatch', date, remoteCommon)
        return
      }
      const allConfirmed = differenceCount === 0
        && preview.summary.remoteTombstoneLocalExistsCount === 0
        && preview.summary.remoteTombstoneLocalMissingCount === 0
        && preview.summary.sameCount === Object.keys(metadata.baselines).length
        && preview.items.length === preview.summary.sameCount
        && Object.values(preview.classifications).every((value) => value === 'exact_match_baseline_confirmed')
      if (!allConfirmed || preview.summary.unresolvedTombstoneCount !== 0
        || !targetItem || targetItem.comparison !== 'same'
        || targetClassification !== 'exact_match_baseline_confirmed') {
        finish('delete_candidate_verification_difference_unconfirmed', date, remoteCommon)
        return
      }

      const next = finish('delete_candidate_verification_ready', date, remoteCommon)
      setVerifiedSnapshot({
        targetDate: date,
        workspaceId: input.connection.workspaceId,
        metadataFingerprint: loaded.raw,
        localSignature: currentLocalSignature,
        remoteFingerprint: remoteFingerprint(pulled.records),
        previewItems: copyItems(preview.items),
        summary: { ...preview.summary },
        classifications: { ...preview.classifications },
        cursor: metadata.lastPulledChangeSequence,
        fullPullMaxSequence: pulled.maxChangeSequence,
        checkedAt: next.checkedAt,
      })
    } catch {
      finish('delete_candidate_verification_unknown', date)
    } finally {
      inFlightRef.current = false
    }
  }, [currentLocalSignature, eligible, finish, input.connection, input.reactMetadata, reactMetadataFingerprint])

  return {
    eligible,
    status,
    result,
    verifiedSnapshot,
    checkCandidate,
    discard,
  }
}
