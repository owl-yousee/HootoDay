import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { SyncConnection } from '../types/sync'
import { isStoredDayMemo, readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords } from '../utils/dayMemoSyncPull'
import { loadDayMemoSyncMetadataAny } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import type { DayMemoRemoteActiveAdoptionResult } from './useDayMemoRemoteActiveAdoption'
import { inspectRemoteAdoptionConsistency, type DayMemoRemoteConsistencySummary } from './useDayMemoRemoteAdoptionPreflight'
import type { DayMemoRemoteTombstoneAdoptionResult } from './useDayMemoRemoteTombstoneAdoption'

export type DayMemoRemoteAdoptionVerificationClassification =
  | 'adoption_verified_normal'
  | 'adoption_verified_target_only'
  | 'adoption_pending_remaining'
  | 'adoption_target_mismatch'
  | 'adoption_cursor_invalid'
  | 'adoption_state_unknown'

export type DayMemoRemoteAdoptionVerificationState = 'idle' | 'checking' | 'checked'

type AdoptionTarget =
  | { kind: 'remote_active'; date: string; revision: number; changeSequence: number }
  | { kind: 'remote_tombstone' | 'metadata_only_tombstone'; date: string; revision: number; changeSequence: number }

export interface DayMemoRemoteAdoptionVerificationResult {
  scope: 'adoption_target' | 'overall'
  classification: DayMemoRemoteAdoptionVerificationClassification
  adoptionKind: AdoptionTarget['kind'] | 'overall'
  date: string | null
  remoteRevision: number | null
  remoteChangeSequence: number | null
  localState: 'active_match' | 'deleted_match' | 'mismatch' | 'overall_valid' | 'unknown'
  baselineState: 'match' | 'mismatch' | 'overall_valid' | 'unknown'
  pendingResolved: boolean
  targetIntentResolved: boolean
  otherIntentCount: number
  cursorValid: boolean
  outside: DayMemoRemoteConsistencySummary
  checkedAt: string
  nextAction: string
}

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  activeResult: DayMemoRemoteActiveAdoptionResult | null
  tombstoneResult: DayMemoRemoteTombstoneAdoptionResult | null
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

function emptySummary(): DayMemoRemoteConsistencySummary {
  return { remoteOnly: 0, localOnly: 0, contentMismatch: 0, updatedAtMismatch: 0, stateMismatch: 0, baselineMissing: 0, revisionMismatch: 0, total: 0 }
}

function chooseTarget(active: DayMemoRemoteActiveAdoptionResult | null, tombstone: DayMemoRemoteTombstoneAdoptionResult | null): AdoptionTarget | null {
  if (active && tombstone) return null
  if (active) return { kind: 'remote_active', date: active.date, revision: active.remoteRevision, changeSequence: active.remoteChangeSequence }
  if (tombstone) return {
    kind: tombstone.localEffect === 'metadata_only' ? 'metadata_only_tombstone' : 'remote_tombstone',
    date: tombstone.date,
    revision: tombstone.remoteRevision,
    changeSequence: tombstone.remoteChangeSequence,
  }
  return null
}

function nextAction(classification: DayMemoRemoteAdoptionVerificationClassification): string {
  if (classification === 'adoption_verified_normal') return 'remote採用後の同期状態は正常です。追加操作は不要です。'
  if (classification === 'adoption_verified_target_only') return '採用したDayMemoは一致していますが、他の同期不一致が残っています。read-only確認を行ってください。'
  if (classification === 'adoption_pending_remaining') return '採用後に解消されるはずの未完了状態が残っています。read-only recovery checkで確認してください。'
  if (classification === 'adoption_target_mismatch') return '採用対象の状態が一致していません。自動再反映せず、競合確認またはrecovery checkを行ってください。'
  if (classification === 'adoption_cursor_invalid') return '同期位置の整合を確認できません。自動修正せずrecovery checkを行ってください。'
  return '状態を安全に確認できませんでした。自動再試行せず、必要な場合だけ明示操作で再確認してください。'
}

export function useDayMemoRemoteAdoptionVerification({ dayMemos, isConfigured, isSignedIn, connection, activeResult, tombstoneResult }: Input) {
  const [state, setState] = useState<DayMemoRemoteAdoptionVerificationState>('idle')
  const [result, setResult] = useState<DayMemoRemoteAdoptionVerificationResult | null>(null)
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const generation = useRef(0)
  const signature = useMemo(() => localSignature(dayMemos), [dayMemos])
  const latestSignature = useRef(signature)
  latestSignature.current = signature
  const liveEligibility = useRef({ isConfigured, isSignedIn, workspaceId: connection?.workspaceId ?? null })
  liveEligibility.current = { isConfigured, isSignedIn, workspaceId: connection?.workspaceId ?? null }
  const eligible = Boolean(isConfigured && isSignedIn && supabaseClient && connectionIsEligible(connection))
  const adoptionResultSignature = useMemo(() => JSON.stringify([activeResult, tombstoneResult]), [activeResult, tombstoneResult])

  const discard = useCallback(() => {
    generation.current += 1
    setState('idle')
    setResult(null)
    setSafeErrorMessage(null)
  }, [])

  useEffect(() => { discard() }, [adoptionResultSignature, connection?.workspaceId, discard, signature])

  const verify = useCallback(async () => {
    if (!eligible || !connection?.workspaceId || !supabaseClient || state === 'checking') return
    setState('checking')
    setResult(null)
    setSafeErrorMessage(null)
    const checkedAt = new Date().toISOString()
    const target = chooseTarget(activeResult, tombstoneResult)
    const loaded = loadDayMemoSyncMetadataAny(window.localStorage)
    const stored = readDayMemoStorageSnapshot(window.localStorage)
    if (loaded.status !== 'ready' || loaded.metadata.version !== 3
      || loaded.metadata.workspaceId !== connection.workspaceId
      || loaded.metadata.pushBlock !== null
      || stored.status !== 'ready' || localSignature(stored.memos) !== signature) {
      const classification = 'adoption_state_unknown'
      setResult({
        scope: target ? 'adoption_target' : 'overall', classification, adoptionKind: target?.kind ?? 'overall',
        date: target?.date ?? null, remoteRevision: target?.revision ?? null, remoteChangeSequence: target?.changeSequence ?? null,
        localState: 'unknown', baselineState: 'unknown', pendingResolved: false, targetIntentResolved: false,
        otherIntentCount: 0, cursorValid: false, outside: emptySummary(), checkedAt, nextAction: nextAction(classification),
      })
      setState('checked')
      return
    }

    const requestGeneration = ++generation.current
    const pulled = await pullAllDayMemoSyncRecords(
      supabaseClient,
      connection.workspaceId,
      () => generation.current === requestGeneration && latestSignature.current === signature,
    ).catch(() => null)
    const after = loadDayMemoSyncMetadataAny(window.localStorage)
    const afterStored = readDayMemoStorageSnapshot(window.localStorage)
    if (!pulled || pulled.status !== 'complete'
      || !liveEligibility.current.isConfigured || !liveEligibility.current.isSignedIn
      || liveEligibility.current.workspaceId !== connection.workspaceId
      || after.status !== 'ready' || after.metadata.version !== 3 || after.raw !== loaded.raw
      || afterStored.status !== 'ready' || afterStored.serialized !== stored.serialized
      || latestSignature.current !== signature) {
      const classification = 'adoption_state_unknown'
      setResult({
        scope: target ? 'adoption_target' : 'overall', classification, adoptionKind: target?.kind ?? 'overall',
        date: target?.date ?? null, remoteRevision: target?.revision ?? null, remoteChangeSequence: target?.changeSequence ?? null,
        localState: 'unknown', baselineState: 'unknown', pendingResolved: false, targetIntentResolved: false,
        otherIntentCount: 0, cursorValid: false, outside: emptySummary(), checkedAt, nextAction: nextAction(classification),
      })
      setSafeErrorMessage('状態を安全に確認できませんでした。永続データは変更していません。')
      setState('checked')
      return
    }

    const metadata = after.metadata
    const outside = inspectRemoteAdoptionConsistency(metadata, afterStored.memos, pulled.records, target?.date ?? null)
    const pendingResolved = metadata.pendingOperation === null
    const targetPendingRemaining = Boolean(target && metadata.pendingOperation?.date === target.date)
    const targetIntentResolved = target ? metadata.localDeleteIntents[target.date] === undefined : true
    const otherIntentCount = Object.keys(metadata.localDeleteIntents).filter((date) => date !== target?.date).length
    const cursorValid = target ? metadata.lastPulledChangeSequence >= target.changeSequence : true
    let localState: DayMemoRemoteAdoptionVerificationResult['localState'] = target ? 'mismatch' : 'overall_valid'
    let baselineState: DayMemoRemoteAdoptionVerificationResult['baselineState'] = target ? 'mismatch' : 'overall_valid'
    let targetMatches = target === null

    if (target) {
      const remoteMatches = pulled.records.filter((record) => record.entityId === target.date)
      const remote = remoteMatches.length === 1 ? remoteMatches[0] : null
      const localMatches = afterStored.memos.filter((memo) => memo.date === target.date)
      const baseline = metadata.baselines[target.date]
      if (target.kind === 'remote_active') {
        const remoteValid = Boolean(remote && remote.deletedAt === null && remote.payload && isStoredDayMemo(remote.payload)
          && remote.payload.date === target.date && remote.revision === target.revision && remote.changeSequence === target.changeSequence)
        const localValid = Boolean(remoteValid && localMatches.length === 1 && JSON.stringify(localMatches[0]) === JSON.stringify(remote?.payload))
        const baselineValid = Boolean(remoteValid && baseline && baseline.deletedAt === null
          && baseline.remoteRevision === target.revision && baseline.remoteChangeSequence === target.changeSequence
          && baseline.remoteUpdatedAt === remote?.payload?.updatedAt
          && baseline.baselineLocalUpdatedAt === remote?.payload?.updatedAt)
        localState = localValid ? 'active_match' : 'mismatch'
        baselineState = baselineValid ? 'match' : 'mismatch'
        targetMatches = remoteValid && localValid && baselineValid
      } else {
        const remoteValid = Boolean(remote && remote.deletedAt !== null && Number.isFinite(Date.parse(remote.deletedAt))
          && remote.payload === null && remote.revision === target.revision && remote.changeSequence === target.changeSequence)
        const localValid = localMatches.length === 0
        const baselineValid = Boolean(remoteValid && baseline && baseline.deletedAt === remote?.deletedAt
          && baseline.remoteRevision === target.revision && baseline.remoteChangeSequence === target.changeSequence
          && baseline.remoteUpdatedAt === remote?.serverUpdatedAt && baseline.baselineLocalUpdatedAt === null)
        localState = localValid ? 'deleted_match' : 'mismatch'
        baselineState = baselineValid ? 'match' : 'mismatch'
        targetMatches = remoteValid && localValid && baselineValid
      }
    }

    let classification: DayMemoRemoteAdoptionVerificationClassification
    if (target && (targetPendingRemaining || !targetIntentResolved)) classification = 'adoption_pending_remaining'
    else if (target && !targetMatches) classification = 'adoption_target_mismatch'
    else if (!cursorValid) classification = 'adoption_cursor_invalid'
    else {
      const globallyNormal = metadata.baselineStatus === 'confirmed' && metadata.pushBlock === null
        && pendingResolved && Object.keys(metadata.localDeleteIntents).length === 0 && outside.total === 0
      if (globallyNormal) classification = 'adoption_verified_normal'
      else if (target && targetMatches) classification = 'adoption_verified_target_only'
      else classification = 'adoption_state_unknown'
    }

    setResult({
      scope: target ? 'adoption_target' : 'overall', classification, adoptionKind: target?.kind ?? 'overall',
      date: target?.date ?? null, remoteRevision: target?.revision ?? null, remoteChangeSequence: target?.changeSequence ?? null,
      localState, baselineState, pendingResolved, targetIntentResolved, otherIntentCount, cursorValid, outside,
      checkedAt, nextAction: nextAction(classification),
    })
    setState('checked')
  }, [activeResult, connection?.workspaceId, eligible, signature, state, tombstoneResult])

  return { eligible, state, result, safeErrorMessage, verify, discard }
}
