import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type SupabaseConfigurationIssue = 'missing' | 'partial' | 'invalid_url'

interface SupabaseConfiguration {
  url: string
  publishableKey: string
}

interface SupabaseConfigurationResult {
  configuration: SupabaseConfiguration | null
  issue: SupabaseConfigurationIssue | null
}

function readSupabaseConfiguration(): SupabaseConfigurationResult {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''

  if (!url && !publishableKey) {
    return { configuration: null, issue: 'missing' }
  }

  if (!url || !publishableKey) {
    return { configuration: null, issue: 'partial' }
  }

  try {
    const parsedUrl = new URL(url)

    if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname) {
      return { configuration: null, issue: 'invalid_url' }
    }
  } catch {
    return { configuration: null, issue: 'invalid_url' }
  }

  return {
    configuration: { url, publishableKey },
    issue: null,
  }
}

const configurationResult = readSupabaseConfiguration()

export const supabaseConfigurationIssue = configurationResult.issue
export const isSupabaseConfigured = configurationResult.configuration !== null
export const supabaseClient: SupabaseClient | null = configurationResult.configuration
  ? createClient(
      configurationResult.configuration.url,
      configurationResult.configuration.publishableKey,
    )
  : null
