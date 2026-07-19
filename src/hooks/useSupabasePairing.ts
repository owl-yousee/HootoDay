import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { ConnectAsMemberResult } from './useSupabaseWorkspace'
import type { SyncConnection } from '../types/sync'
import { isUuid } from '../utils/syncConnectionStorage'

export type SupabasePairingState =
  | 'unavailable'
  | 'idle'
  | 'issuing'
  | 'issued'
  | 'expired'
  | 'recovery_required'

interface PairingCodeResult {
  pairingCode: string
  expiresAt: string
}

interface UseSupabasePairingOptions {
  isConfigured: boolean
  isSignedIn: boolean
  connection: SyncConnection | null
}

export type SupabasePairingJoinState =
  | 'unavailable'
  | 'ready'
  | 'joining'
  | 'joined'
  | 'input_error'
  | 'invalid_code'
  | 'expired_code'
  | 'used_code'
  | 'already_connected'
  | 'rpc_error'
  | 'return_empty'
  | 'return_multiple'
  | 'return_unknown'
  | 'return_invalid_uuid'
  | 'metadata_invalid'
  | 'storage_unavailable'
  | 'precondition_failed'
  | 'unexpected_failure'
  | 'recovering'
  | 'membership_not_found'
  | 'multiple_memberships'
  | 'recovery_invalid_response'
  | 'recovery_query_error'

interface UseSupabasePairingJoinOptions extends UseSupabasePairingOptions {
  connectAsMember: (workspaceId: string) => ConnectAsMemberResult
}

const PAIRING_CODE_VALID_MINUTES = 10
const RECOVERY_MESSAGE = '接続コードが発行された可能性があります。状態を確認してから、必要に応じて再度お試しください。'
const CHILD_DEVICE_LABEL = 'hootoday-child-iphone'
const JOIN_ERROR_MESSAGES: Partial<Record<SupabasePairingJoinState, string>> = {
  input_error: '接続コードを確認してください。英数字だけを入力できます。',
  invalid_code: '接続コードが正しくないか、期限切れ、または使用済みです。親機でコードを確認してください。',
  expired_code: '接続コードの有効期限が切れています。親機で新しいコードを発行してください。',
  used_code: 'この接続コードはすでに使用されています。親機で新しいコードを発行してください。',
  already_connected: 'この端末はすでにworkspaceへ接続されています。',
  rpc_error: '接続処理に失敗しました。通信状態を確認してください。',
  return_empty: 'workspaceへの参加が完了した可能性がありますが、結果を安全に確認できませんでした。接続コードを再送せず、参加状態を確認してください。',
  return_multiple: 'workspaceへの参加結果が複数返されたため、安全に確認できませんでした。接続コードを再送しないでください。',
  return_unknown: 'workspaceへの参加結果を安全に確認できませんでした。接続コードを再送せず、参加状態を確認してください。',
  return_invalid_uuid: 'workspaceへの参加結果を安全に検証できませんでした。接続コードを再送しないでください。',
  metadata_invalid: '参加状態は確認できましたが、この端末の接続情報を安全に作成できませんでした。',
  storage_unavailable: '参加状態は確認できましたが、この端末へ接続情報を保存できませんでした。',
  precondition_failed: 'この端末の現在の接続状態では、安全に参加情報を保存できませんでした。',
  unexpected_failure: '参加状態は確認できましたが、接続情報の保存中に問題が発生しました。',
  membership_not_found: 'この端末の参加状態を確認できませんでした。接続コードは再送せず、確認が必要です。',
  multiple_memberships: '複数の参加状態が見つかったため、安全に復旧できませんでした。',
  recovery_invalid_response: '参加状態の確認結果を安全に検証できませんでした。',
  recovery_query_error: '参加状態の確認に失敗しました。',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizePairingResult(data: unknown): PairingCodeResult | null {
  const row = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data

  if (!isRecord(row)) return null

  const pairingCode = typeof row.pairing_code === 'string' ? row.pairing_code.trim() : ''
  const expiresAtValue = typeof row.expires_at === 'string' ? row.expires_at : ''
  const expiresAtTime = Date.parse(expiresAtValue)

  if (!pairingCode
    || !Number.isFinite(expiresAtTime)
    || expiresAtTime <= Date.now()
    || typeof row.code_id !== 'string'
    || !isUuid(row.code_id)) {
    return null
  }

  return { pairingCode, expiresAt: new Date(expiresAtTime).toISOString() }
}

type ConsumedWorkspaceResult =
  | { status: 'valid'; workspaceId: string; shape: 'scalar' | 'array' | 'object' }
  | { status: 'empty' | 'multiple' | 'unknown' | 'invalid_uuid' }

function normalizeConsumedWorkspaceObject(
  data: Record<string, unknown>,
  shape: 'array' | 'object',
): ConsumedWorkspaceResult {
  const keys = Object.keys(data)
  if (keys.length !== 1) return { status: 'unknown' }

  const key = keys[0]
  if (key !== 'consume_app_pairing_code' && key !== 'workspace_id') return { status: 'unknown' }

  const value = data[key]
  return isUuid(value)
    ? { status: 'valid', workspaceId: value, shape }
    : { status: 'invalid_uuid' }
}

function normalizeConsumedWorkspaceId(data: unknown): ConsumedWorkspaceResult {
  if (isUuid(data)) return { status: 'valid', workspaceId: data, shape: 'scalar' }
  if (data === null || data === undefined) return { status: 'empty' }
  if (typeof data === 'string') return { status: 'invalid_uuid' }

  if (Array.isArray(data)) {
    if (data.length === 0) return { status: 'empty' }
    if (data.length > 1) return { status: 'multiple' }
    const row = data[0]
    if (isUuid(row)) return { status: 'valid', workspaceId: row, shape: 'array' }
    if (!isRecord(row)) return { status: 'unknown' }
    return normalizeConsumedWorkspaceObject(row, 'array')
  }

  if (!isRecord(data)) return { status: 'unknown' }
  return normalizeConsumedWorkspaceObject(data, 'object')
}

const POST_RPC_RECOVERY_STATES = new Set<SupabasePairingJoinState>([
  'return_empty',
  'return_multiple',
  'return_unknown',
  'return_invalid_uuid',
  'metadata_invalid',
  'storage_unavailable',
  'precondition_failed',
  'unexpected_failure',
])

function classifyJoinError(message: string): SupabasePairingJoinState {
  const normalizedMessage = message.toLowerCase()
  const mentionsInvalid = normalizedMessage.includes('invalid') || normalizedMessage.includes('not found')
  const mentionsExpired = normalizedMessage.includes('expired')
  const mentionsUsed = normalizedMessage.includes('already used') || normalizedMessage.includes('used')

  if ([mentionsInvalid, mentionsExpired, mentionsUsed].filter(Boolean).length > 1) return 'invalid_code'
  if (normalizedMessage.includes('expired')) return 'expired_code'
  if (normalizedMessage.includes('already used') || normalizedMessage.includes('used')) return 'used_code'
  if (normalizedMessage.includes('already') && normalizedMessage.includes('member')) return 'already_connected'
  if (normalizedMessage.includes('invalid')
    || normalizedMessage.includes('not found')
    || normalizedMessage.includes('pairing code')) {
    return 'invalid_code'
  }
  return 'rpc_error'
}

export function useSupabasePairing({
  isConfigured,
  isSignedIn,
  connection,
}: UseSupabasePairingOptions) {
  const isEligible = Boolean(
    supabaseClient
    && isConfigured
    && isSignedIn
    && connection
    && isUuid(connection.workspaceId)
    && connection.deviceRole === 'parent'
    && connection.workspaceRole === 'owner'
    && connection.pairingStatus === 'owner',
  )
  const [pairingState, setPairingState] = useState<SupabasePairingState>(
    isEligible ? 'idle' : 'unavailable',
  )
  const [pairingResult, setPairingResult] = useState<PairingCodeResult | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const issuingRef = useRef(false)

  useEffect(() => {
    if (!isEligible) {
      setPairingResult(null)
      setPairingState('unavailable')
      return
    }

    setPairingState((current) => current === 'unavailable' ? 'idle' : current)
  }, [isEligible])

  useEffect(() => {
    if (pairingState !== 'issued' || !pairingResult) return

    const expiresAtTime = Date.parse(pairingResult.expiresAt)
    const updateRemainingTime = () => {
      const currentTime = Date.now()
      setNow(currentTime)
      if (currentTime >= expiresAtTime) {
        setPairingResult(null)
        setPairingState('expired')
      }
    }

    updateRemainingTime()
    const intervalId = window.setInterval(updateRemainingTime, 1000)
    return () => window.clearInterval(intervalId)
  }, [pairingResult, pairingState])

  const issuePairingCode = useCallback(async () => {
    if (!isEligible
      || !supabaseClient
      || !connection?.workspaceId
      || issuingRef.current
      || (pairingState !== 'idle' && pairingState !== 'expired')) {
      return
    }

    issuingRef.current = true
    setPairingResult(null)
    setPairingState('issuing')

    try {
      const { data, error } = await supabaseClient.rpc('create_app_pairing_code', {
        target_workspace_id: connection.workspaceId,
        valid_minutes: PAIRING_CODE_VALID_MINUTES,
      })

      if (error) {
        setPairingState('recovery_required')
        return
      }

      const normalizedResult = normalizePairingResult(data)
      if (!normalizedResult) {
        setPairingState('recovery_required')
        return
      }

      setNow(Date.now())
      setPairingResult(normalizedResult)
      setPairingState('issued')
    } catch {
      setPairingState('recovery_required')
    } finally {
      issuingRef.current = false
    }
  }, [connection?.workspaceId, isEligible, pairingState])

  const remainingSeconds = useMemo(() => {
    if (!pairingResult) return 0
    return Math.max(0, Math.ceil((Date.parse(pairingResult.expiresAt) - now) / 1000))
  }, [now, pairingResult])

  return {
    pairingState,
    pairingCode: pairingResult?.pairingCode ?? null,
    expiresAt: pairingResult?.expiresAt ?? null,
    remainingSeconds,
    issuePairingCode,
    safeErrorMessage: pairingState === 'recovery_required' ? RECOVERY_MESSAGE : null,
  }
}

export function useSupabasePairingJoin({
  isConfigured,
  isSignedIn,
  connection,
  connectAsMember,
}: UseSupabasePairingJoinOptions) {
  const canJoin = Boolean(
    supabaseClient
    && isConfigured
    && isSignedIn
    && connection
    && connection.workspaceId === null
    && connection.deviceRole === null
    && connection.workspaceRole === null
    && connection.pairingStatus === 'unpaired',
  )
  const [inputCode, setInputCodeState] = useState('')
  const [joinState, setJoinState] = useState<SupabasePairingJoinState>(
    canJoin ? 'ready' : 'unavailable',
  )
  const [joinedByRecovery, setJoinedByRecovery] = useState(false)
  const actionInFlightRef = useRef(false)

  useEffect(() => {
    setJoinState((current) => current === 'joined' ? current : (canJoin ? 'ready' : 'unavailable'))
    if (!canJoin) setInputCodeState('')
  }, [canJoin])

  const setInputCode = useCallback((value: string) => {
    if (actionInFlightRef.current || POST_RPC_RECOVERY_STATES.has(joinState) || joinState === 'joined') return
    setInputCodeState(value)
    setJoinState(canJoin ? 'ready' : 'unavailable')
  }, [canJoin, joinState])

  const joinWorkspace = useCallback(async () => {
    if (!canJoin
      || !supabaseClient
      || !connection
      || actionInFlightRef.current
      || joinState === 'joining'
      || POST_RPC_RECOVERY_STATES.has(joinState)
      || joinState === 'joined') {
      return
    }

    const normalizedCode = inputCode.trim()
    if (!normalizedCode || normalizedCode.length > 128 || !/^[A-Za-z0-9]+$/.test(normalizedCode)) {
      setJoinState('input_error')
      return
    }

    actionInFlightRef.current = true
    setJoinState('joining')

    try {
      const { data, error } = await supabaseClient.rpc('consume_app_pairing_code', {
        input_code: normalizedCode,
        device_label: CHILD_DEVICE_LABEL,
      })

      if (error) {
        setJoinState(classifyJoinError(error.message))
        return
      }

      const consumedResult = normalizeConsumedWorkspaceId(data)
      if (consumedResult.status !== 'valid') {
        const resultState: Record<Exclude<ConsumedWorkspaceResult['status'], 'valid'>, SupabasePairingJoinState> = {
          empty: 'return_empty',
          multiple: 'return_multiple',
          unknown: 'return_unknown',
          invalid_uuid: 'return_invalid_uuid',
        }
        setJoinState(resultState[consumedResult.status])
        return
      }

      const connectResult = connectAsMember(consumedResult.workspaceId)
      if (connectResult !== 'saved') {
        setJoinState(connectResult)
        return
      }

      setInputCodeState('')
      setJoinedByRecovery(false)
      setJoinState('joined')
    } catch {
      setJoinState('rpc_error')
    } finally {
      actionInFlightRef.current = false
    }
  }, [canJoin, connectAsMember, connection, inputCode, joinState])

  const recoverMembership = useCallback(async () => {
    if (!canJoin || !supabaseClient || !connection || actionInFlightRef.current) return

    actionInFlightRef.current = true
    setJoinState('recovering')

    try {
      const { data: userData, error: userError } = await supabaseClient.auth.getUser()
      const user = userData.user
      if (userError || !user || user.is_anonymous !== true) {
        setJoinState('recovery_query_error')
        return
      }

      const { data, error } = await supabaseClient
        .from('app_workspace_members')
        .select('workspace_id, role')
        .eq('user_id', user.id)
        .eq('role', 'member')

      if (error) {
        setJoinState('recovery_query_error')
        return
      }
      if (!Array.isArray(data)) {
        setJoinState('recovery_invalid_response')
        return
      }
      if (data.length === 0) {
        setJoinState('membership_not_found')
        return
      }
      if (data.length > 1) {
        setJoinState('multiple_memberships')
        return
      }

      const membership = data[0]
      if (!isRecord(membership)
        || membership.role !== 'member'
        || !isUuid(membership.workspace_id)) {
        setJoinState('recovery_invalid_response')
        return
      }

      const connectResult = connectAsMember(membership.workspace_id)
      if (connectResult !== 'saved') {
        setJoinState(connectResult)
        return
      }

      setInputCodeState('')
      setJoinedByRecovery(true)
      setJoinState('joined')
    } catch {
      setJoinState('recovery_query_error')
    } finally {
      actionInFlightRef.current = false
    }
  }, [canJoin, connectAsMember, connection])

  const safeErrorMessage = joinState in JOIN_ERROR_MESSAGES
    ? JOIN_ERROR_MESSAGES[joinState as keyof typeof JOIN_ERROR_MESSAGES]
    : null

  return {
    inputCode,
    setInputCode,
    joinState,
    joinWorkspace,
    recoverMembership,
    joinedByRecovery,
    safeErrorMessage,
    recoveryRequired: POST_RPC_RECOVERY_STATES.has(joinState),
    inputLocked: joinState === 'joining'
      || joinState === 'recovering'
      || POST_RPC_RECOVERY_STATES.has(joinState)
      || joinState === 'joined',
    canRecover: canJoin && joinState !== 'joining' && joinState !== 'recovering' && joinState !== 'joined',
    canSubmit: canJoin
      && inputCode.trim().length > 0
      && joinState !== 'joining'
      && joinState !== 'recovering'
      && !POST_RPC_RECOVERY_STATES.has(joinState)
      && joinState !== 'joined',
  }
}
