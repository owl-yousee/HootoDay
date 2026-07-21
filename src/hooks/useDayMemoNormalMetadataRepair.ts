import { useCallback, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { DayMemo } from '../types/dayMemo'
import type { DayMemoSyncMetadataV5 } from '../types/dayMemoSync'
import type { SyncConnection } from '../types/sync'
import { isStoredDayMemo, readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords } from '../utils/dayMemoSyncPull'
import { isDayMemoSyncMetadataV5, loadDayMemoSyncMetadataAny, replaceDayMemoSyncMetadataV2 } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import { classifyDayMemoNormalDifference, type DayMemoNormalDifferenceClassification } from './useDayMemoNormalDifferenceRecoveryPlan'

export type DayMemoNormalMetadataRepairStage = 'idle' | 'repair_ready' | 'repaired' | 'blocked'
export type DayMemoNormalMetadataRepairSafety =
  | 'normal_sync_metadata_repair_ready' | 'normal_sync_metadata_repaired'
  | 'metadata_invalid' | 'baseline_status_unexpected' | 'pending_or_blocked'
  | 'workspace_mismatch' | 'full_pull_failed' | 'cursor_mismatch'
  | 'difference_not_repairable' | 'candidate_invalid' | 'source_changed'
  | 'save_failed' | 'readback_failed' | 'rollback_failed' | 'state_unknown'

export interface DayMemoNormalMetadataRepairResult {
  stage: DayMemoNormalMetadataRepairStage
  safety: DayMemoNormalMetadataRepairSafety
  baselineCandidateCount: number
  localOnlyCandidateCount: number
  currentCursor: number | null
  candidateCursor: number | null
  currentBaselineStatus: string | null
  persistentChanged: boolean
  checkedAt: string
}

interface Input {
  dayMemos: DayMemo[]
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  reactMetadata: DayMemoSyncMetadataV5 | null
  adoptVerifiedMetadata: (metadata: DayMemoSyncMetadataV5) => void
}

interface Snapshot {
  token: string
  runId: number
  metadataRaw: string
  localRaw: string
  workspaceId: string
  localSignature: string
  remoteSignature: string
  baselineFingerprint: string
  candidateFingerprint: string
  source: DayMemoSyncMetadataV5
  candidate: DayMemoSyncMetadataV5
  localOnlyDates: string[]
  consumed: boolean
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const localSignature = (memos: DayMemo[]) => JSON.stringify(memos.map((memo) => [memo.date, memo.updatedAt, memo.content]).sort())
const connectionEligible = (value: SyncConnection | null): value is SyncConnection & { workspaceId: string } => Boolean(value && isUuid(value.workspaceId)
  && ((value.deviceRole === 'parent' && value.workspaceRole === 'owner' && value.pairingStatus === 'owner')
    || (value.deviceRole === 'child' && value.workspaceRole === 'member' && value.pairingStatus === 'member')))

export function useDayMemoNormalMetadataRepair(input: Input) {
  const [stage, setStage] = useState<DayMemoNormalMetadataRepairStage>('idle')
  const [result, setResult] = useState<DayMemoNormalMetadataRepairResult | null>(null)
  const [running, setRunning] = useState(false)
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const snapshotRef = useRef<Snapshot | null>(null)
  const runRef = useRef(0)
  const inFlightRef = useRef(false)
  const reactLocalSignature = useMemo(() => localSignature(input.dayMemos), [input.dayMemos])
  const loaded = input.connection?.workspaceId ? loadDayMemoSyncMetadataAny(window.localStorage) : null
  const eligible = Boolean(input.isConfigured && input.isSignedIn && connectionEligible(input.connection)
    && loaded?.status === 'ready' && loaded.metadata.version === 5 && loaded.metadata.baselineStatus === 'mismatch')

  const finish = useCallback((nextStage: DayMemoNormalMetadataRepairStage, safety: DayMemoNormalMetadataRepairSafety,
    baselineCandidateCount = 0, localOnlyCandidateCount = 0, currentCursor: number | null = null,
    candidateCursor: number | null = null, currentBaselineStatus: string | null = null, persistentChanged = false) => {
    setStage(nextStage)
    setResult({ stage: nextStage, safety, baselineCandidateCount, localOnlyCandidateCount, currentCursor,
      candidateCursor, currentBaselineStatus, persistentChanged, checkedAt: new Date().toISOString() })
  }, [])
  const block = useCallback((safety: DayMemoNormalMetadataRepairSafety, message = '同期metadataを安全に再確定できないため停止しました。') => {
    snapshotRef.current = null
    finish('blocked', safety)
    setSafeErrorMessage(message)
  }, [finish])

  const check = useCallback(async () => {
    if (!eligible || !supabaseClient || !connectionEligible(input.connection) || inFlightRef.current) return
    inFlightRef.current = true
    setRunning(true)
    setSafeErrorMessage(null)
    setResult(null)
    snapshotRef.current = null
    const run = ++runRef.current
    try {
      const before = loadDayMemoSyncMetadataAny(window.localStorage)
      const stored = readDayMemoStorageSnapshot(window.localStorage)
      if (before.status !== 'ready' || !isDayMemoSyncMetadataV5(before.metadata) || stored.status !== 'ready'
        || !stored.memos.every(isStoredDayMemo) || localSignature(stored.memos) !== reactLocalSignature
        || !input.reactMetadata || !same(before.metadata, input.reactMetadata)) return block('metadata_invalid')
      const metadata = before.metadata
      if (metadata.workspaceId !== input.connection.workspaceId) return block('workspace_mismatch')
      if (metadata.baselineStatus !== 'mismatch') return block('baseline_status_unexpected')
      if (metadata.pendingOperation || metadata.pushBlock || Object.keys(metadata.localDeleteIntents).length) return block('pending_or_blocked')
      if (!Number.isSafeInteger(metadata.lastPulledChangeSequence) || metadata.lastPulledChangeSequence < 0) return block('metadata_invalid')

      const pulled = await pullAllDayMemoSyncRecords(supabaseClient, input.connection.workspaceId, () => runRef.current === run).catch(() => null)
      if (!pulled || pulled.status !== 'complete') return block('full_pull_failed')
      const after = loadDayMemoSyncMetadataAny(window.localStorage)
      const afterStored = readDayMemoStorageSnapshot(window.localStorage)
      if (after.status !== 'ready' || after.raw !== before.raw || afterStored.status !== 'ready'
        || afterStored.serialized !== stored.serialized || localSignature(input.dayMemos) !== reactLocalSignature) return block('source_changed')
      if (pulled.maxChangeSequence !== metadata.lastPulledChangeSequence) return block('cursor_mismatch')

      const localByDate = new Map(stored.memos.map((memo) => [memo.date, memo]))
      const remoteByDate = new Map(pulled.records.map((record) => [record.entityId, record]))
      const dates = [...new Set([...localByDate.keys(), ...remoteByDate.keys()])].sort()
      const classifications = dates.map((date) => ({
        date,
        value: classifyDayMemoNormalDifference(localByDate.get(date) ?? null, remoteByDate.get(date) ?? null, null),
      }))
      const allowed = new Set<DayMemoNormalDifferenceClassification>(['exact_match_baseline_missing', 'local_only'])
      const exactDates = classifications.filter((item) => item.value === 'exact_match_baseline_missing').map((item) => item.date)
      const localOnlyDates = classifications.filter((item) => item.value === 'local_only').map((item) => item.date)
      if (classifications.some((item) => !allowed.has(item.value)) || exactDates.length === 0 || localOnlyDates.length !== 1) {
        return block('difference_not_repairable')
      }
      const baselines: DayMemoSyncMetadataV5['baselines'] = {}
      for (const date of exactDates) {
        const local = localByDate.get(date)
        const remote = remoteByDate.get(date)
        if (!local || !remote || !remote.payload || remote.deletedAt !== null) return block('difference_not_repairable')
        baselines[date] = { date, remoteRevision: remote.revision, remoteChangeSequence: remote.changeSequence,
          remoteUpdatedAt: remote.payload.updatedAt, baselineLocalUpdatedAt: local.updatedAt, deletedAt: null }
      }
      if (localOnlyDates.some((date) => baselines[date] || remoteByDate.has(date))) return block('candidate_invalid')
      const confirmedAt = new Date().toISOString()
      const candidate: DayMemoSyncMetadataV5 = { ...metadata, baselines, lastPulledChangeSequence: pulled.maxChangeSequence,
        baselineStatus: 'confirmed', baselineConfirmedAt: confirmedAt, pendingOperation: null }
      if (!isDayMemoSyncMetadataV5(candidate)) return block('candidate_invalid')
      snapshotRef.current = { token: crypto.randomUUID(), runId: run, metadataRaw: before.raw, localRaw: stored.serialized,
        workspaceId: metadata.workspaceId, localSignature: reactLocalSignature, remoteSignature: JSON.stringify(pulled.records),
        baselineFingerprint: JSON.stringify(baselines), candidateFingerprint: JSON.stringify(candidate),
        source: metadata, candidate, localOnlyDates, consumed: false }
      finish('repair_ready', 'normal_sync_metadata_repair_ready', exactDates.length, localOnlyDates.length,
        metadata.lastPulledChangeSequence, pulled.maxChangeSequence, metadata.baselineStatus)
    } catch {
      block('state_unknown')
    } finally {
      inFlightRef.current = false
      setRunning(false)
    }
  }, [block, eligible, finish, input.connection, input.dayMemos, input.reactMetadata, reactLocalSignature])

  const save = useCallback(() => {
    const snapshot = snapshotRef.current
    if (!snapshot || snapshot.consumed || stage !== 'repair_ready' || running) return
    if (!window.confirm('確認済みのbaselineとcursorをmetadataへ一括保存しますか？ local-onlyは送信しません。')) return
    const fresh = loadDayMemoSyncMetadataAny(window.localStorage)
    const stored = readDayMemoStorageSnapshot(window.localStorage)
    if (fresh.status !== 'ready' || !isDayMemoSyncMetadataV5(fresh.metadata) || fresh.raw !== snapshot.metadataRaw
      || stored.status !== 'ready' || stored.serialized !== snapshot.localRaw || localSignature(input.dayMemos) !== snapshot.localSignature
      || !connectionEligible(input.connection) || input.connection.workspaceId !== snapshot.workspaceId
      || !input.isConfigured || !input.isSignedIn || fresh.metadata.baselineStatus !== 'mismatch'
      || fresh.metadata.pendingOperation || fresh.metadata.pushBlock || Object.keys(fresh.metadata.localDeleteIntents).length
      || !isDayMemoSyncMetadataV5(snapshot.candidate) || !same(fresh.metadata, snapshot.source)
      || snapshot.baselineFingerprint !== JSON.stringify(snapshot.candidate.baselines)
      || snapshot.candidateFingerprint !== JSON.stringify(snapshot.candidate)
      || snapshot.localOnlyDates.some((date) => snapshot.candidate.baselines[date])) return block('source_changed')
    snapshot.consumed = true
    const saved = replaceDayMemoSyncMetadataV2(window.localStorage, snapshot.candidate, snapshot.metadataRaw)
    if (saved !== 'saved') return block(saved === 'rollback_failed' ? 'rollback_failed' : 'save_failed')
    const readBack = loadDayMemoSyncMetadataAny(window.localStorage)
    if (readBack.status !== 'ready' || !isDayMemoSyncMetadataV5(readBack.metadata) || !same(readBack.metadata, snapshot.candidate)) {
      const rollback = readBack.status === 'ready'
        ? replaceDayMemoSyncMetadataV2(window.localStorage, snapshot.source, readBack.raw) : 'rollback_failed'
      return block(rollback === 'saved' ? 'readback_failed' : 'rollback_failed')
    }
    input.adoptVerifiedMetadata(readBack.metadata)
    finish('repaired', 'normal_sync_metadata_repaired', Object.keys(readBack.metadata.baselines).length,
      snapshot.localOnlyDates.length, snapshot.source.lastPulledChangeSequence, readBack.metadata.lastPulledChangeSequence,
      readBack.metadata.baselineStatus, true)
  }, [block, finish, input, running, stage])

  const discard = useCallback(() => {
    if (running) return
    runRef.current += 1
    snapshotRef.current = null
    setStage('idle')
    setResult(null)
    setSafeErrorMessage(null)
  }, [running])

  return { stage, result, running, safeErrorMessage, eligible, canSave: stage === 'repair_ready', check, save, discard }
}
