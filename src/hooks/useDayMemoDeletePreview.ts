import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { SyncConnection } from '../types/sync'
import { readDayMemoStorageSnapshot } from '../utils/dayMemoStorage'
import { pullAllDayMemoSyncRecords } from '../utils/dayMemoSyncPull'
import { loadDayMemoSyncMetadataAny } from '../utils/dayMemoSyncStorage'
import { isUuid } from '../utils/syncConnectionStorage'
import type { DayMemoLocalDeleteIntentV3, DayMemoRemoteBaselineV3 } from '../types/dayMemoSync'

export type DayMemoDeleteClassification = 'local_deleted_candidate' | 'local_missing_unconfirmed' | 'remote_deleted_candidate' | 'remote_deleted_local_missing' | 'delete_conflict' | 'delete_unknown'
export interface DayMemoDeletePreviewItem { date: string; classification: DayMemoDeleteClassification; baselineRevision: number | null; remoteRevision: number | null; baselineChangeSequence: number | null; remoteChangeSequence: number | null }
export interface DayMemoDeletePreviewSummary { intentCount: number; localDeletedCandidateCount: number; localMissingUnconfirmedCount: number; remoteDeletedCandidateCount: number; remoteDeletedLocalMissingCount: number; deleteConflictCount: number; deleteUnknownCount: number }
export interface DayMemoDeleteUploadCandidateSnapshot {
  workspaceId: string
  metadataRaw: string
  localStorageSerialized: string
  date: string
  intent: DayMemoLocalDeleteIntentV3
  baseline: DayMemoRemoteBaselineV3
  previousChangeSequence: number
}
export type DayMemoDeletePreviewState = 'unavailable' | 'idle' | 'checking' | 'preview_ready' | 'no_intents' | 'blocked' | 'error'

interface Input { isConfigured: boolean; isSignedIn: boolean; connection: SyncConnection | null }
function summarize(items: DayMemoDeletePreviewItem[], intentCount: number): DayMemoDeletePreviewSummary {
  const count = (kind: DayMemoDeleteClassification) => items.filter((item) => item.classification === kind).length
  return { intentCount, localDeletedCandidateCount: count('local_deleted_candidate'), localMissingUnconfirmedCount: count('local_missing_unconfirmed'), remoteDeletedCandidateCount: count('remote_deleted_candidate'), remoteDeletedLocalMissingCount: count('remote_deleted_local_missing'), deleteConflictCount: count('delete_conflict'), deleteUnknownCount: count('delete_unknown') }
}

export function useDayMemoDeletePreview({ isConfigured, isSignedIn, connection }: Input) {
  const [state, setState] = useState<DayMemoDeletePreviewState>('unavailable')
  const [items, setItems] = useState<DayMemoDeletePreviewItem[]>([])
  const [summary, setSummary] = useState<DayMemoDeletePreviewSummary | null>(null)
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const runIdRef = useRef(0)
  const uploadCandidateRef = useRef<DayMemoDeleteUploadCandidateSnapshot | null>(null)
  const eligible = Boolean(isConfigured && isSignedIn && connection?.workspaceId && isUuid(connection.workspaceId))
  const discardPreview = useCallback(() => { runIdRef.current += 1; uploadCandidateRef.current = null; setItems([]); setSummary(null); setSafeErrorMessage(null); setState(eligible ? 'idle' : 'unavailable') }, [eligible])
  useEffect(() => { discardPreview() }, [discardPreview, connection?.workspaceId])

  const previewDeletes = useCallback(async () => {
    if (!eligible || !connection?.workspaceId || !supabaseClient || state === 'checking') return
    const runId = runIdRef.current + 1
    runIdRef.current = runId
    uploadCandidateRef.current = null
    setState('checking'); setItems([]); setSummary(null); setSafeErrorMessage(null)
    const before = loadDayMemoSyncMetadataAny(window.localStorage)
    const storedBefore = readDayMemoStorageSnapshot(window.localStorage)
    if (before.status !== 'ready' || before.metadata.version !== 5 || before.metadata.workspaceId !== connection.workspaceId
      || before.metadata.baselineStatus !== 'confirmed' || before.metadata.pendingOperation !== null || before.metadata.pushBlock !== null
      || storedBefore.status !== 'ready') {
      setState('blocked'); setSafeErrorMessage('削除候補を安全に確認できる状態ではありません。'); return
    }
    const metadata = before.metadata
    const localMemos = storedBefore.memos
    const intentDates = Object.keys(metadata.localDeleteIntents).sort()
    if (intentDates.length === 0) { setSummary(summarize([], 0)); setState('no_intents'); return }
    const pull = await pullAllDayMemoSyncRecords(supabaseClient, connection.workspaceId, () => runIdRef.current === runId)
    if (runIdRef.current !== runId) return
    if (pull.status !== 'complete') {
      const unknown = intentDates.map((date) => { const baseline = metadata.baselines[date]; return { date, classification: 'delete_unknown' as const, baselineRevision: baseline?.remoteRevision ?? null, remoteRevision: null, baselineChangeSequence: baseline?.remoteChangeSequence ?? null, remoteChangeSequence: null } })
      setItems(unknown); setSummary(summarize(unknown, intentDates.length)); setState('error'); setSafeErrorMessage('同期先の完全な確認に失敗しました。削除送信は行いません。'); return
    }
    const after = loadDayMemoSyncMetadataAny(window.localStorage)
    const storedAfter = readDayMemoStorageSnapshot(window.localStorage)
    if (after.status !== 'ready' || after.metadata.version !== 5 || after.raw !== before.raw || storedAfter.status !== 'ready' || storedAfter.serialized !== storedBefore.serialized) {
      setState('error'); setSafeErrorMessage('確認中に端末状態が変化したため、結果を破棄しました。'); return
    }
    const remoteByDate = new Map(pull.records.map((record) => [record.entityId, record]))
    const relevantDates = new Set([...Object.keys(metadata.baselines).filter((date) => !localMemos.some((memo) => memo.date === date)), ...intentDates, ...pull.records.filter((record) => record.deletedAt !== null && !localMemos.some((memo) => memo.date === record.entityId)).map((record) => record.entityId)])
    const classified = [...relevantDates].sort().map((date): DayMemoDeletePreviewItem => {
      const intent = metadata.localDeleteIntents[date]
      const baseline = metadata.baselines[date]
      const remote = remoteByDate.get(date)
      const localMissing = !localMemos.some((memo) => memo.date === date)
      let classification: DayMemoDeleteClassification = 'delete_unknown'
      if (remote && remote.deletedAt !== null && localMissing) classification = intent ? 'remote_deleted_candidate' : 'remote_deleted_local_missing'
      else if (!intent && baseline && localMissing) classification = 'local_missing_unconfirmed'
      else if (intent && baseline?.deletedAt === null && localMissing && remote?.deletedAt === null && remote.payload
        && remote.revision === intent.baselineRevision && remote.changeSequence === intent.baselineChangeSequence
        && remote.payload.updatedAt === baseline.remoteUpdatedAt) classification = 'local_deleted_candidate'
      else if (intent && remote) classification = 'delete_conflict'
      return { date, classification, baselineRevision: baseline?.remoteRevision ?? null, remoteRevision: remote?.revision ?? null, baselineChangeSequence: baseline?.remoteChangeSequence ?? null, remoteChangeSequence: remote?.changeSequence ?? null }
    })
    const nextSummary = summarize(classified, intentDates.length)
    if (nextSummary.intentCount === 1 && nextSummary.localDeletedCandidateCount === 1
      && nextSummary.localMissingUnconfirmedCount === 0 && nextSummary.remoteDeletedCandidateCount === 0
      && nextSummary.remoteDeletedLocalMissingCount === 0 && nextSummary.deleteConflictCount === 0
      && nextSummary.deleteUnknownCount === 0) {
      const candidate = classified.find((item) => item.classification === 'local_deleted_candidate')!
      const intent = metadata.localDeleteIntents[candidate.date]
      const baseline = metadata.baselines[candidate.date]
      uploadCandidateRef.current = {
        workspaceId: connection.workspaceId,
        metadataRaw: before.raw,
        localStorageSerialized: storedBefore.serialized,
        date: candidate.date,
        intent: { ...intent },
        baseline: { ...baseline },
        previousChangeSequence: pull.maxChangeSequence,
      }
    }
    setItems(classified); setSummary(nextSummary); setState('preview_ready')
  }, [connection?.workspaceId, eligible, state])
  const getSingleDeleteCandidateSnapshot = useCallback(() => uploadCandidateRef.current, [])
  return { eligible, state, items, summary, safeErrorMessage, previewDeletes, discardPreview, getSingleDeleteCandidateSnapshot }
}
