import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { isStoredDayMemo, readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords, type RemoteDayMemoRecord } from '../utils/dayMemoSyncPull'
import { isDayMemoSyncMetadataV5, loadDayMemoSyncMetadataAny } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'

export type DayMemoNormalDifferenceClassification =
  | 'exact_match_baseline_confirmed'
  | 'exact_match_baseline_missing'
  | 'exact_body_timestamp_mismatch'
  | 'body_mismatch'
  | 'local_only'
  | 'remote_only_active'
  | 'remote_only_tombstone'
  | 'active_tombstone_mismatch'
  | 'revision_lineage_mismatch'
  | 'unknown'

export type DayMemoNormalDifferenceRecoverySafety =
  | 'normal_difference_recovery_plan_ready'
  | 'normal_difference_exact_baseline_candidates'
  | 'normal_difference_manual_resolution_required'
  | 'normal_difference_partial_baseline_unsupported'
  | 'normal_difference_pending_remaining'
  | 'normal_difference_intent_remaining'
  | 'normal_difference_push_blocked'
  | 'normal_difference_cursor_invalid'
  | 'normal_difference_workspace_mismatch'
  | 'normal_difference_metadata_invalid'
  | 'normal_difference_remote_incomplete'
  | 'normal_difference_revision_mismatch'
  | 'normal_difference_state_unknown'

export interface DayMemoNormalDifferenceRecoveryItem {
  date: string
  classification: DayMemoNormalDifferenceClassification
  localExists: boolean
  remoteState: 'active' | 'tombstone' | 'missing'
}

export interface DayMemoNormalDifferenceRecoveryPlan {
  metadataVersion: number | null
  workspaceBound: boolean
  metadataValid: boolean
  pushBlocked: boolean
  pendingCount: number
  intentCount: number
  remoteCount: number
  localCount: number
  baselineCount: number
  cursor: number | null
  fullPullMaxSequence: number | null
  cursorValid: boolean
  items: DayMemoNormalDifferenceRecoveryItem[]
  counts: Record<DayMemoNormalDifferenceClassification, number>
  exactBaselineCandidateDates: string[]
  bodyMismatchDates: string[]
  localOnlyDates: string[]
  remoteOnlyDates: string[]
  lineageOrStateMismatchCount: number
  partialBaselineSupported: boolean
  oneByOneRecoveryPossible: boolean
  recommendedOrder: string[]
  safety: DayMemoNormalDifferenceRecoverySafety
  checkedAt: string
  nextAction: string
}

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
}

export const DAY_MEMO_NORMAL_DIFFERENCE_CLASSIFICATIONS: DayMemoNormalDifferenceClassification[] = [
  'exact_match_baseline_confirmed', 'exact_match_baseline_missing', 'exact_body_timestamp_mismatch',
  'body_mismatch', 'local_only', 'remote_only_active', 'remote_only_tombstone',
  'active_tombstone_mismatch', 'revision_lineage_mismatch', 'unknown',
]

function connectionIsEligible(connection: SyncConnection | null): connection is SyncConnection & { workspaceId: string } {
  return Boolean(connection && isUuid(connection.workspaceId)
    && ((connection.deviceRole === 'parent' && connection.workspaceRole === 'owner' && connection.pairingStatus === 'owner')
      || (connection.deviceRole === 'child' && connection.workspaceRole === 'member' && connection.pairingStatus === 'member')))
}

function localSignature(memos: DayMemo[]): string {
  return JSON.stringify(memos.map((memo) => [memo.date, memo.updatedAt, memo.content]).sort(([left], [right]) => left.localeCompare(right)))
}

export function classifyDayMemoNormalDifference(
  local: DayMemo | null,
  remote: RemoteDayMemoRecord | null,
  baseline: DayMemoSyncMetadataV5['baselines'][string] | null,
): DayMemoNormalDifferenceClassification {
  if (!remote) {
    if (baseline) return 'revision_lineage_mismatch'
    return local ? 'local_only' : 'unknown'
  }
  if (remote.deletedAt !== null) {
    if (local) return 'active_tombstone_mismatch'
    if (!baseline) return 'remote_only_tombstone'
    return baseline.deletedAt === remote.deletedAt
      && baseline.remoteRevision === remote.revision
      && baseline.remoteChangeSequence === remote.changeSequence
      && baseline.remoteUpdatedAt === remote.serverUpdatedAt
      && baseline.baselineLocalUpdatedAt === null
      ? 'exact_match_baseline_confirmed'
      : 'revision_lineage_mismatch'
  }
  if (!remote.payload) return 'unknown'
  if (!local) return 'remote_only_active'
  if (local.content !== remote.payload.content) return 'body_mismatch'
  if (local.updatedAt !== remote.payload.updatedAt) return 'exact_body_timestamp_mismatch'
  if (!baseline) return 'exact_match_baseline_missing'
  return baseline.deletedAt === null
    && baseline.remoteRevision === remote.revision
    && baseline.remoteChangeSequence === remote.changeSequence
    && baseline.remoteUpdatedAt === remote.payload.updatedAt
    && baseline.baselineLocalUpdatedAt === local.updatedAt
    ? 'exact_match_baseline_confirmed'
    : 'revision_lineage_mismatch'
}

function nextAction(safety: DayMemoNormalDifferenceRecoverySafety): string {
  if (safety === 'normal_difference_exact_baseline_candidates') return '次Phaseで完全一致の日付だけを1件ずつbaseline補完候補として確認できます。'
  if (safety === 'normal_difference_manual_resolution_required') return '本文相違、remote-only、local-onlyを種類別に1件ずつ確認してください。'
  if (safety === 'normal_difference_recovery_plan_ready') return '差異はありません。全体baselineとcursorの整合確認へ進めます。'
  if (safety === 'normal_difference_push_blocked') return '復旧計画は確認できますが、pushBlock解除前に永続操作を開始しないでください。'
  return '状態を変更せず、安全条件を再確認してください。'
}

export function useDayMemoNormalDifferenceRecoveryPlan({ dayMemos, isConfigured, isSignedIn, connection }: Input) {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<DayMemoNormalDifferenceRecoveryPlan | null>(null)
  const runIdRef = useRef(0)
  const resultMetadataRawRef = useRef<string | null>(null)
  const resultLocalSignatureRef = useRef<string | null>(null)
  const signature = useMemo(() => localSignature(dayMemos), [dayMemos])
  const current = connection?.workspaceId ? loadDayMemoSyncMetadataAny(window.localStorage) : null
  const eligible = Boolean(isConfigured && isSignedIn && supabaseClient && connectionIsEligible(connection)
    && current?.status === 'ready' && current.metadata.version === 5
    && (current.metadata.baselineStatus === 'recovery_required' || current.metadata.baselineStatus === 'mismatch'))

  const discard = useCallback(() => {
    runIdRef.current += 1
    resultMetadataRawRef.current = null
    resultLocalSignatureRef.current = null
    setResult(null)
    setChecking(false)
  }, [])
  useEffect(() => { discard() }, [current?.raw, discard, eligible, signature])

  const check = useCallback(async () => {
    if (!eligible || !supabaseClient || !connectionIsEligible(connection) || checking) return
    const runId = ++runIdRef.current
    setChecking(true)
    setResult(null)
    const checkedAt = new Date().toISOString()
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const stored = readDayMemoStorageSnapshot(window.localStorage)
    if (loaded.status !== 'ready' || !isDayMemoSyncMetadataV5(loaded.metadata)) {
      setResult({
        metadataVersion: loaded.status === 'ready' ? loaded.metadata.version : null,
        workspaceBound: false, metadataValid: false, pushBlocked: false, pendingCount: 0, intentCount: 0,
        remoteCount: 0, localCount: dayMemos.length, baselineCount: 0, cursor: null, fullPullMaxSequence: null, cursorValid: false,
        items: [], counts: Object.fromEntries(DAY_MEMO_NORMAL_DIFFERENCE_CLASSIFICATIONS.map((value) => [value, 0])) as Record<DayMemoNormalDifferenceClassification, number>,
        exactBaselineCandidateDates: [], bodyMismatchDates: [], localOnlyDates: [], remoteOnlyDates: [],
        lineageOrStateMismatchCount: 0, partialBaselineSupported: false, oneByOneRecoveryPossible: false,
        recommendedOrder: [], safety: 'normal_difference_metadata_invalid', checkedAt,
        nextAction: nextAction('normal_difference_metadata_invalid'),
      })
      setChecking(false)
      return
    }
    const metadata = loaded.metadata
    const workspaceBound = metadata.workspaceId === connection.workspaceId
    if (!workspaceBound || stored.status !== 'ready' || localSignature(stored.memos) !== signature
      || !stored.memos.every(isStoredDayMemo)) {
      const safety: DayMemoNormalDifferenceRecoverySafety = workspaceBound
        ? 'normal_difference_state_unknown' : 'normal_difference_workspace_mismatch'
      setResult({
        metadataVersion: metadata.version, workspaceBound, metadataValid: true, pushBlocked: metadata.pushBlock !== null,
        pendingCount: metadata.pendingOperation ? 1 : 0, intentCount: Object.keys(metadata.localDeleteIntents).length,
        remoteCount: 0, localCount: dayMemos.length, baselineCount: Object.keys(metadata.baselines).length,
        cursor: metadata.lastPulledChangeSequence, fullPullMaxSequence: null, cursorValid: false, items: [],
        counts: Object.fromEntries(DAY_MEMO_NORMAL_DIFFERENCE_CLASSIFICATIONS.map((value) => [value, 0])) as Record<DayMemoNormalDifferenceClassification, number>,
        exactBaselineCandidateDates: [], bodyMismatchDates: [], localOnlyDates: [], remoteOnlyDates: [],
        lineageOrStateMismatchCount: 0, partialBaselineSupported: false, oneByOneRecoveryPossible: false,
        recommendedOrder: [], safety, checkedAt, nextAction: nextAction(safety),
      })
      setChecking(false)
      return
    }
    resultMetadataRawRef.current = loaded.raw
    resultLocalSignatureRef.current = signature
    const pulled = await pullAllDayMemoSyncRecords(supabaseClient, connection.workspaceId, () => runIdRef.current === runId)
      .catch(() => null)
    if (!pulled || pulled.status !== 'complete') {
      const safety: DayMemoNormalDifferenceRecoverySafety = 'normal_difference_remote_incomplete'
      setResult({
        metadataVersion: metadata.version, workspaceBound: true, metadataValid: true, pushBlocked: metadata.pushBlock !== null,
        pendingCount: metadata.pendingOperation ? 1 : 0, intentCount: Object.keys(metadata.localDeleteIntents).length,
        remoteCount: 0, localCount: stored.memos.length, baselineCount: Object.keys(metadata.baselines).length,
        cursor: metadata.lastPulledChangeSequence, fullPullMaxSequence: null, cursorValid: false, items: [],
        counts: Object.fromEntries(DAY_MEMO_NORMAL_DIFFERENCE_CLASSIFICATIONS.map((value) => [value, 0])) as Record<DayMemoNormalDifferenceClassification, number>,
        exactBaselineCandidateDates: [], bodyMismatchDates: [], localOnlyDates: [], remoteOnlyDates: [],
        lineageOrStateMismatchCount: 0, partialBaselineSupported: false, oneByOneRecoveryPossible: false,
        recommendedOrder: [], safety, checkedAt, nextAction: nextAction(safety),
      })
      setChecking(false)
      return
    }
    const after = loadDayMemoSyncMetadataAny(window.localStorage)
    const afterStored = readDayMemoStorageSnapshot(window.localStorage)
    if (runIdRef.current !== runId || after.status !== 'ready' || after.raw !== loaded.raw
      || afterStored.status !== 'ready' || afterStored.serialized !== stored.serialized
      || localSignature(dayMemos) !== signature) {
      setChecking(false)
      return
    }
    const localByDate = new Map(stored.memos.map((memo) => [memo.date, memo]))
    const remoteByDate = new Map(pulled.records.map((record) => [record.entityId, record]))
    const dates = [...new Set([...localByDate.keys(), ...remoteByDate.keys(), ...Object.keys(metadata.baselines)])].sort()
    const items = dates.map((date): DayMemoNormalDifferenceRecoveryItem => {
      const local = localByDate.get(date) ?? null
      const remote = remoteByDate.get(date) ?? null
      return {
        date,
        classification: classifyDayMemoNormalDifference(local, remote, metadata.baselines[date] ?? null),
        localExists: local !== null,
        remoteState: remote ? (remote.deletedAt === null ? 'active' : 'tombstone') : 'missing',
      }
    })
    const counts = Object.fromEntries(DAY_MEMO_NORMAL_DIFFERENCE_CLASSIFICATIONS.map((value) => [value, items.filter((item) => item.classification === value).length])) as Record<DayMemoNormalDifferenceClassification, number>
    const exactBaselineCandidateDates = items.filter((item) => item.classification === 'exact_match_baseline_missing').map((item) => item.date)
    const candidateBaselines: DayMemoSyncMetadataV5['baselines'] = { ...metadata.baselines }
    for (const date of exactBaselineCandidateDates) {
      const local = localByDate.get(date)!
      const remote = remoteByDate.get(date)!
      candidateBaselines[date] = {
        date,
        remoteRevision: remote.revision,
        remoteChangeSequence: remote.changeSequence,
        remoteUpdatedAt: remote.payload!.updatedAt,
        baselineLocalUpdatedAt: local.updatedAt,
        deletedAt: null,
      }
    }
    const partialCandidate: DayMemoSyncMetadataV5 = {
      ...metadata,
      baselines: candidateBaselines,
      baselineStatus: 'recovery_required',
      baselineConfirmedAt: null,
    }
    const cursorValid = metadata.lastPulledChangeSequence === pulled.maxChangeSequence
    const partialBaselineSupported = exactBaselineCandidateDates.length > 0
      && cursorValid && isDayMemoSyncMetadataV5(partialCandidate)
    const lineageOrStateMismatchCount = counts.revision_lineage_mismatch + counts.active_tombstone_mismatch + counts.unknown
    let safety: DayMemoNormalDifferenceRecoverySafety
    if (metadata.pendingOperation) safety = 'normal_difference_pending_remaining'
    else if (Object.keys(metadata.localDeleteIntents).length > 0) safety = 'normal_difference_intent_remaining'
    else if (metadata.pushBlock) safety = 'normal_difference_push_blocked'
    else if (!cursorValid) safety = 'normal_difference_cursor_invalid'
    else if (lineageOrStateMismatchCount > 0) safety = 'normal_difference_revision_mismatch'
    else if (exactBaselineCandidateDates.length > 0 && !partialBaselineSupported) safety = 'normal_difference_partial_baseline_unsupported'
    else if (counts.body_mismatch + counts.local_only + counts.remote_only_active + counts.remote_only_tombstone + counts.exact_body_timestamp_mismatch > 0) safety = 'normal_difference_manual_resolution_required'
    else if (exactBaselineCandidateDates.length > 0) safety = 'normal_difference_exact_baseline_candidates'
    else safety = 'normal_difference_recovery_plan_ready'
    const recommendedOrder = [
      '完全一致・baseline欠落の日付だけを1件ずつ補完候補として再確認',
      '本文相違を1件ずつlocal／remoteの明示選択で解消',
      'remote-only activeを1件ずつlocalへ明示反映',
      'local-onlyを1件ずつ新operationとして準備・送信',
      '全差異解消後に全体baseline／cursorを再確認',
      '通常同期安全状態をconfirmedへ戻す',
    ]
    setResult({
      metadataVersion: metadata.version, workspaceBound: true, metadataValid: true, pushBlocked: metadata.pushBlock !== null,
      pendingCount: metadata.pendingOperation ? 1 : 0, intentCount: Object.keys(metadata.localDeleteIntents).length,
      remoteCount: pulled.records.length, localCount: stored.memos.length, baselineCount: Object.keys(metadata.baselines).length,
      cursor: metadata.lastPulledChangeSequence, fullPullMaxSequence: pulled.maxChangeSequence, cursorValid, items, counts, exactBaselineCandidateDates,
      bodyMismatchDates: items.filter((item) => item.classification === 'body_mismatch').map((item) => item.date),
      localOnlyDates: items.filter((item) => item.classification === 'local_only').map((item) => item.date),
      remoteOnlyDates: items.filter((item) => item.classification === 'remote_only_active' || item.classification === 'remote_only_tombstone').map((item) => item.date),
      lineageOrStateMismatchCount, partialBaselineSupported,
      oneByOneRecoveryPossible: cursorValid && lineageOrStateMismatchCount === 0 && metadata.pendingOperation === null
        && Object.keys(metadata.localDeleteIntents).length === 0,
      recommendedOrder, safety, checkedAt, nextAction: nextAction(safety),
    })
    setChecking(false)
  }, [checking, connection, dayMemos, eligible, signature])

  const resultCurrent = Boolean(result && current?.status === 'ready'
    && resultMetadataRawRef.current === current.raw && resultLocalSignatureRef.current === signature)
  return { eligible, checking, result, resultCurrent, check, discard }
}
