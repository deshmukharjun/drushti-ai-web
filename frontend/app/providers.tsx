'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client'

export { supabase, isSupabaseConfigured }

/** When true, login page shows “continue without auth” and middleware skips session check. */
export const isDevAuthBypassEnabled =
  process.env.NEXT_PUBLIC_ENABLE_DEV_AUTH_BYPASS === 'true'

interface AuthContextType {
  user: { id: string; email?: string; isGuest?: boolean } | null
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (
    email: string,
    password: string,
    fullName: string
  ) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  loginAsGuest: () => void
  loading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within Providers')
  }
  return context
}

const GUEST_USER = { id: 'guest', email: 'guest@drushti.local', isGuest: true }

export function Providers({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthContextType['user']>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (document.cookie.includes('guest-mode=true')) {
      setUser(GUEST_USER)
      setLoading(false)
      return
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? { id: session.user.id, email: session.user.email } : null)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const configError = (): Error =>
    new Error(
      'Supabase env vars are missing. In the frontend folder run: cp .env.example .env — then set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY (Dashboard → Connect). Restart npm run dev.'
    )

  const signIn = async (email: string, password: string) => {
    if (!isSupabaseConfigured) {
      return { error: configError() }
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error as Error | null }
  }

  const signUp = async (email: string, password: string, fullName: string) => {
    if (!isSupabaseConfigured) {
      return { error: configError() }
    }
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName.trim() },
      },
    })
    return { error: error as Error | null }
  }

  const signOut = async () => {
    document.cookie = 'guest-mode=; Max-Age=0; path=/'
    await supabase.auth.signOut()
    setUser(null)
  }

  const loginAsGuest = () => {
    document.cookie = 'guest-mode=true; Max-Age=86400; path=/'
    setUser(GUEST_USER)
  }

  return (
    <AuthContext.Provider value={{ user, signIn, signUp, signOut, loginAsGuest, loading }}>
      {children}
    </AuthContext.Provider>
  )
}
