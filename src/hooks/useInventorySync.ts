import { useCallback, useRef, useState } from 'react'
import type { SyncConnection } from '../types/sync'
import type {
  InventorySyncBaseline,
  InventorySyncPendingOperation,
  InventorySyncSaveRequest,
  InventorySyncSnapshot,
} from '../types/inventorySync'
import type { InventorySyncApplyResult } from '../utils/inventorySyncApply'
import {
  INVENTORY_SYNC_BASELINE_STORAGE_KEY,
  INVENTORY_SYNC_METADATA_STORAGE_KEY,
  INVENTORY_SYNC_PENDING_STORAGE_KEY,
  loadInventorySyncBaseline,
  loadInventorySyncMetadata,
  loadInventorySyncPendingOperation,
  saveInventorySyncConfirmedState,
  saveInventorySyncMetadata,
  saveInventorySyncPendingState,
} from '../utils/inventorySyncStorage'
import {
  createInventorySyncBaseline,
  createInventorySyncPendingOperation,
  inventoryContentFingerprint,
  isInventorySyncSnapshot,
} from '../utils/inventorySyncSnapshot'
import {
  fetchInventoryRemoteSnapshot,
  saveInventoryRemoteSnapshot,
  verifyInventoryRemoteReadBack,
} from '../utils/inventorySyncRemote'
import {
  classifyInventorySyncConflicts,
  inventoryRemoteMatchesBaseline,
  isInventorySnapshotEmpty,
  type InventorySyncConflictSummary,
} from '../utils/inventorySyncState'
import { createUuidV4 } from '../utils/uuid'

export type InventorySyncUiStatus =
  | 'unconfirmed' | 'checking' | 'initial_upload_ready' | 'initial_download_ready'
  | 'synced' | 'local_changed' | 'remote_changed' | 'conflict'
  | 'pending_check' | 'pending_resend_ready' | 'working' | 'completed' | 'attention'

export type InventorySyncUiState = {
  status: InventorySyncUiStatus
  message: string
  lastCheckedAt: string | null
  remoteRevision: number | null
  conflictSummary: InventorySyncConflictSummary | null
  recoveryRequired: boolean
}

type Options = {
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
  getSnapshot: (workspaceId: string, revision: number) => InventorySyncSnapshot
  getStoredSnapshot: (workspaceId: string, revision: number) => InventorySyncSnapshot | null
  applySnapshot: (snapshot: InventorySyncSnapshot) => InventorySyncApplyResult
  isEditing: boolean
}

type Inspection = {
  ui: InventorySyncUiState
  workspaceId: string
  local: InventorySyncSnapshot
  remote: InventorySyncSnapshot | null
  baseline: InventorySyncBaseline | null
  pending: InventorySyncPendingOperation | null
}

const initialUi: InventorySyncUiState = {
  status: 'unconfirmed',
  message: '販売・在庫の同期状態はまだ確認していません。',
  lastCheckedAt: null,
  remoteRevision: null,
  conflictSummary: null,
  recoveryRequired: false,
}

const attention = (message: string, recoveryRequired = false): InventorySyncUiState => ({
  ...initialUi, status: 'attention', message, recoveryRequired,
})

export function useInventorySync(options: Options) {
  const [ui, setUi] = useState<InventorySyncUiState>(initialUi)
  const attemptRunning = useRef(false)

  const inspect = useCallback(async (): Promise<Inspection | null> => {
    const connection = options.connection
    if (!options.isConfigured || !options.isSignedIn || !connection?.workspaceId || !connection.deviceRole) {
      setUi(attention('クラウド接続と端末のペアリングを確認してください。'))
      return null
    }
    const storage = localStorage
    const workspaceId = connection.workspaceId
    const rawMetadata = storage.getItem(INVENTORY_SYNC_METADATA_STORAGE_KEY)
    const rawBaseline = storage.getItem(INVENTORY_SYNC_BASELINE_STORAGE_KEY)
    const rawPending = storage.getItem(INVENTORY_SYNC_PENDING_STORAGE_KEY)
    const metadata = loadInventorySyncMetadata(storage)
    const baseline = loadInventorySyncBaseline(storage, workspaceId)
    const pending = loadInventorySyncPendingOperation(storage, workspaceId)
    if ((rawMetadata !== null && !metadata) || (rawBaseline !== null && !baseline) ||
      (rawPending !== null && !pending)) {
      setUi(attention('保存済みの同期状態を安全に読み取れません。バックアップを確認してください。', true))
      return null
    }
    if ((metadata && metadata.workspaceId !== workspaceId) ||
      (rawBaseline !== null && !baseline) || (rawPending !== null && !pending)) {
      setUi(attention('別の共有先の同期状態が保存されています。自動的には置き換えません。', true))
      return null
    }
    if ((baseline && !metadata) ||
      (metadata?.state === 'confirmed' &&
        (!baseline || metadata.lastRemoteRevision !== baseline.revision)) ||
      (pending && metadata?.state !== 'pending' && metadata?.state !== 'conflict')) {
      setUi(attention('保存済みのbaseline、pending、metadataの組合せが一致しません。', true))
      return null
    }
    const local = options.getSnapshot(workspaceId, baseline?.revision ?? 0)
    const storedLocal = options.getStoredSnapshot(workspaceId, baseline?.revision ?? 0)
    if (!isInventorySyncSnapshot(local) || !storedLocal ||
      inventoryContentFingerprint(local) !== inventoryContentFingerprint(storedLocal)) {
      setUi(attention('端末内の販売・在庫データを安全に確認できません。', true))
      return null
    }
    const fetched = await fetchInventoryRemoteSnapshot(workspaceId)
    if (fetched.status !== 'success') {
      setUi(attention('同期先を読み取れませんでした。通信と接続状態を確認してください。'))
      return null
    }
    const remote = fetched.data.snapshot
    const now = new Date().toISOString()
    const baseUi = {
      ...initialUi,
      lastCheckedAt: now,
      remoteRevision: fetched.data.revision,
    }

    if (pending) {
      if (remote && inventoryContentFingerprint(remote) === pending.targetContentFingerprint) {
        const confirmed = createInventorySyncBaseline(remote, now)
        if (!confirmed || saveInventorySyncConfirmedState(storage, confirmed).status !== 'saved') {
          setUi(attention('送信結果は確認できましたが、端末側の同期状態を確定できません。', true))
          return null
        }
        const next = { ...baseUi, status: 'completed' as const, message: '前回の送信結果を確認し、同期状態を整理しました。' }
        setUi(next)
        return { ui: next, workspaceId, local, remote, baseline: confirmed, pending: null }
      }
      const remoteMatchesPendingBase = pending.baseRevision === null
        ? remote === null
        : Boolean(baseline && remote && pending.baseRevision === baseline.revision &&
          inventoryRemoteMatchesBaseline(baseline, remote))
      if (remoteMatchesPendingBase && inventoryContentFingerprint(local) === pending.targetContentFingerprint) {
        const next = { ...baseUi, status: 'pending_resend_ready' as const, message: '前回と同じ操作IDで再送できます。自動再送はしません。' }
        setUi(next)
        return { ui: next, workspaceId, local, remote, baseline, pending }
      }
      const next = { ...baseUi, status: 'conflict' as const, message: '保留中の操作と同期先の状態が一致しません。自動送信せず停止しました。' }
      setUi(next)
      return { ui: next, workspaceId, local, remote, baseline, pending }
    }

    if (!baseline) {
      if (!remote) {
        const status = connection.deviceRole === 'parent' ? 'initial_upload_ready' : 'attention'
        const message = connection.deviceRole === 'parent'
          ? 'このPCの販売・在庫データを最初の正本として送信できます。'
          : '同期先に正本がありません。PCから初回送信してください。'
        const next = { ...baseUi, status, message } as InventorySyncUiState
        setUi(next)
        return { ui: next, workspaceId, local, remote, baseline, pending }
      }
      if (connection.deviceRole === 'child' && isInventorySnapshotEmpty(local)) {
        const next = { ...baseUi, status: 'initial_download_ready' as const, message: 'PCの販売・在庫データをこの端末へ取り込めます。' }
        setUi(next)
        return { ui: next, workspaceId, local, remote, baseline, pending }
      }
      const next = { ...baseUi, status: 'attention' as const, message: '端末と同期先の両方に未確認データがあります。自動的には統合しません。' }
      setUi(next)
      return { ui: next, workspaceId, local, remote, baseline, pending }
    }
    if (!remote) {
      const next = { ...baseUi, status: 'attention' as const, message: '同期済みbaselineに対応する同期先データがありません。' }
      setUi(next)
      return { ui: next, workspaceId, local, remote, baseline, pending }
    }
    const localChanged = inventoryContentFingerprint(local) !== baseline.contentFingerprint
    const remoteChanged = !inventoryRemoteMatchesBaseline(baseline, remote)
    let next: InventorySyncUiState
    if (!localChanged && !remoteChanged) {
      const metadataResult = saveInventorySyncMetadata(storage, {
        version: 1,
        workspaceId,
        state: 'confirmed',
        lastRemoteRevision: baseline.revision,
        lastCheckedAt: now,
      })
      if (metadataResult.status !== 'saved') {
        setUi(attention('同期内容は一致していますが、確認時刻を保存できませんでした。', metadataResult.rollbackFailed))
        return null
      }
      next = { ...baseUi, status: 'synced', message: '販売・在庫データは同期済みです。' }
    } else if (localChanged && !remoteChanged) {
      next = { ...baseUi, status: 'local_changed', message: 'この端末の変更を同期先へ送信できます。' }
    } else if (!localChanged && remoteChanged) {
      next = { ...baseUi, status: 'remote_changed', message: '同期先の変更をこの端末へ取り込めます。' }
    } else {
      const conflictSummary = classifyInventorySyncConflicts(baseline, local, remote)
      next = {
        ...baseUi,
        status: 'conflict',
        message: conflictSummary.conflicts > 0
          ? '同じ販売・在庫記録が両端末で変更されています。自動統合せず停止しました。'
          : '両端末に変更があります。安全な統合は次Phaseで行います。',
        conflictSummary,
      }
    }
    setUi(next)
    return { ui: next, workspaceId, local, remote, baseline, pending }
  }, [options])

  const check = useCallback(async () => {
    if (attemptRunning.current) return
    attemptRunning.current = true
    setUi(current => ({ ...current, status: 'checking', message: '最新状態を確認しています。' }))
    try {
      await inspect()
    } finally {
      attemptRunning.current = false
    }
  }, [inspect])

  const applyRemote = useCallback(async (expected: 'initial_download_ready' | 'remote_changed') => {
    if (attemptRunning.current) return
    attemptRunning.current = true
    try {
    if (options.isEditing) {
      setUi(attention('編集中のフォームを閉じてから取り込んでください。'))
      return
    }
    setUi(current => ({ ...current, status: 'working', message: '同期先の最新状態を再確認しています。' }))
    const state = await inspect()
    if (!state || state.ui.status !== expected || !state.remote) return
    const previous = state.local
    const applied = options.applySnapshot(state.remote)
    if (applied.status !== 'applied') {
      setUi(attention('端末内データの置き換えと確認に失敗しました。', applied.rollbackFailed))
      return
    }
    const confirmed = createInventorySyncBaseline(state.remote, new Date().toISOString())
    if (!confirmed || saveInventorySyncConfirmedState(localStorage, confirmed).status !== 'saved') {
      const rollback = options.applySnapshot(previous)
      setUi(attention('同期状態を保存できなかったため、端末内データを元へ戻しました。', rollback.status !== 'applied'))
      return
    }
    setUi({ ...initialUi, status: 'completed', message: '同期先の販売・在庫データを取り込み、read-backを確認しました。', lastCheckedAt: confirmed.confirmedAt, remoteRevision: confirmed.revision })
    } finally {
      attemptRunning.current = false
    }
  }, [inspect, options])

  const send = useCallback(async (expected: 'initial_upload_ready' | 'local_changed' | 'pending_resend_ready') => {
    if (attemptRunning.current) return
    attemptRunning.current = true
    try {
    setUi(current => ({ ...current, status: 'working', message: '送信直前の状態を再確認しています。' }))
    const state = await inspect()
    if (!state || state.ui.status !== expected) return
    const baseRevision = expected === 'initial_upload_ready' ? null : state.baseline?.revision ?? null
    const operationId = state.pending?.operationId ?? createUuidV4()
    if (!operationId || (expected !== 'initial_upload_ready' && baseRevision === null)) {
      setUi(attention('送信準備を安全に作成できません。'))
      return
    }
    const snapshot = options.getSnapshot(state.workspaceId, baseRevision ?? 0)
    if (!isInventorySyncSnapshot(snapshot)) {
      setUi(attention('送信対象データを安全に再確認できません。'))
      return
    }
    const fingerprint = inventoryContentFingerprint(snapshot)
    const pending = state.pending ?? createInventorySyncPendingOperation({
      operationId,
      workspaceId: state.workspaceId,
      operationType: baseRevision === null ? 'initial_upload' : 'push_snapshot',
      baseRevision,
      targetContentFingerprint: fingerprint,
      createdAt: new Date().toISOString(),
    })
    if (!pending || pending.targetContentFingerprint !== fingerprint ||
      saveInventorySyncPendingState(localStorage, pending).status !== 'saved') {
      setUi(attention('送信前の保留状態を安全に保存できません。', true))
      return
    }
    const request: InventorySyncSaveRequest = {
      workspaceId: state.workspaceId,
      operationId,
      baseRevision,
      snapshot,
      contentFingerprint: fingerprint,
    }
    const saved = await saveInventoryRemoteSnapshot(request)
    if (saved.status !== 'success') {
      setUi({ ...attention('送信結果を確認できません。保留状態を維持しています。'), status: 'pending_check' })
      return
    }
    if (saved.data.status === 'conflict') {
      saveInventorySyncMetadata(localStorage, {
        version: 1, workspaceId: state.workspaceId, state: 'conflict',
        lastRemoteRevision: saved.data.currentRevision, lastCheckedAt: new Date().toISOString(),
      })
      setUi({ ...attention('同期先が変更されていたため送信せず停止しました。'), status: 'conflict' })
      return
    }
    const fetched = await fetchInventoryRemoteSnapshot(state.workspaceId)
    if (fetched.status !== 'success' || !verifyInventoryRemoteReadBack(request, saved.data, fetched.data) ||
      !fetched.data.snapshot) {
      setUi({ ...attention('送信後のread-backを確認できません。保留状態を維持しています。'), status: 'pending_check' })
      return
    }
    const confirmed = createInventorySyncBaseline(fetched.data.snapshot, new Date().toISOString())
    if (!confirmed || saveInventorySyncConfirmedState(localStorage, confirmed).status !== 'saved') {
      setUi({ ...attention('送信結果は確認できましたが、端末側の確定に失敗しました。', true), status: 'pending_check' })
      return
    }
    setUi({ ...initialUi, status: 'completed', message: '販売・在庫データを送信し、read-backを確認しました。', lastCheckedAt: confirmed.confirmedAt, remoteRevision: confirmed.revision })
    } finally {
      attemptRunning.current = false
    }
  }, [inspect, options])

  return {
    ui,
    check,
    initialUpload: () => send('initial_upload_ready'),
    push: () => send('local_changed'),
    resend: () => send('pending_resend_ready'),
    initialDownload: () => applyRemote('initial_download_ready'),
    pull: () => applyRemote('remote_changed'),
  }
}
