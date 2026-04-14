import { createBrowserClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrlRaw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ''
const supabaseKeyRaw = (
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ''
).trim()

export const isSupabaseConfigured =
  supabaseUrlRaw.length > 0 &&
  supabaseKeyRaw.length > 0 &&
  !supabaseUrlRaw.includes('placeholder')

const fallbackUrl = 'https://placeholder.supabase.co'
const fallbackKey = 'placeholder-key'

/** Cookie-backed client in production so middleware can read the session; localStorage-only would never set sb-* cookies. */
export const supabase: SupabaseClient = isSupabaseConfigured
  ? createBrowserClient(supabaseUrlRaw, supabaseKeyRaw)
  : createClient(fallbackUrl, fallbackKey)
