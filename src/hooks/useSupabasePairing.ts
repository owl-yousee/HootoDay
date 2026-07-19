import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabaseClient'
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

const PAIRING_CODE_VALID_MINUTES = 10
const RECOVERY_MESSAGE = '接続コードが発行された可能性があります。状態を確認してから、必要に応じて再度お試しください。'

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
