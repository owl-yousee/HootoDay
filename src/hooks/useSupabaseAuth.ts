import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isSupabaseConfigured,
  supabaseClient,
  supabaseConfigurationIssue,
} from '../lib/supabaseClient'

export type SupabaseConfigurationState =
  | 'missing'
  | 'partial'
  | 'invalid_url'
  | 'configured'

export type SupabaseAuthState =
  | 'unavailable'
  | 'checking'
  | 'signed_out'
  | 'signing_in'
  | 'signed_in'
  | 'error'

const SESSION_CHECK_ERROR_MESSAGE =
  '認証状態を確認できませんでした。通信状態を確認して、もう一度お試しください。'
const SIGN_IN_ERROR_MESSAGE =
  '匿名認証を開始できませんでした。通信状態を確認して、もう一度お試しください。'

const configurationState: SupabaseConfigurationState = isSupabaseConfigured
  ? 'configured'
  : (supabaseConfigurationIssue ?? 'missing')

export function useSupabaseAuth() {
  const [authState, setAuthState] = useState<SupabaseAuthState>(
    isSupabaseConfigured ? 'checking' : 'unavailable',
  )
  const [safeErrorMessage, setSafeErrorMessage] = useState<string | null>(null)
  const signInInFlightRef = useRef(false)

  useEffect(() => {
    if (!supabaseClient) {
      setAuthState('unavailable')
      setSafeErrorMessage(null)
      return
    }

    let isActive = true
    const { data: authListener } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (!isActive || signInInFlightRef.current) return
      setAuthState(session ? 'signed_in' : 'signed_out')
      setSafeErrorMessage(null)
    })

    void supabaseClient.auth.getSession().then(({ data, error }) => {
      if (!isActive) return

      if (error) {
        setAuthState('error')
        setSafeErrorMessage(SESSION_CHECK_ERROR_MESSAGE)
        return
      }

      setAuthState(data.session ? 'signed_in' : 'signed_out')
      setSafeErrorMessage(null)
    })

    return () => {
      isActive = false
      authListener.subscription.unsubscribe()
    }
  }, [])

  const signInAnonymously = useCallback(async () => {
    if (!supabaseClient || signInInFlightRef.current) return

    signInInFlightRef.current = true
    setAuthState('signing_in')
    setSafeErrorMessage(null)

    try {
      const { data, error } = await supabaseClient.auth.signInAnonymously()

      if (error || !data.session) {
        setAuthState('error')
        setSafeErrorMessage(SIGN_IN_ERROR_MESSAGE)
        return
      }

      setAuthState('signed_in')
    } catch {
      setAuthState('error')
      setSafeErrorMessage(SIGN_IN_ERROR_MESSAGE)
    } finally {
      signInInFlightRef.current = false
    }
  }, [])

  return {
    configurationState,
    authState,
    isConfigured: isSupabaseConfigured,
    isSignedIn: authState === 'signed_in',
    signInAnonymously,
    safeErrorMessage,
  }
}
