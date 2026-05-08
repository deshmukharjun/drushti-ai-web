'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, isSupabaseConfigured, isDevAuthBypassEnabled } from './providers'
import { Sparkles, Eye, Loader2 } from 'lucide-react'

export default function LoginPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn, signUp, loginAsGuest } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.has('password') || params.has('email')) {
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setError('')
    setInfo('')
    setLoading(true)

    try {
      if (mode === 'signup') {
        const { error: err } = await signUp(email, password, fullName)
        if (err) {
          setError(err.message || 'Sign up failed')
        } else {
          setInfo('Check your email to confirm your account, then sign in.')
          setMode('signin')
        }
      } else {
        const { error: err } = await signIn(email, password)
        if (err) {
          setError(err.message || 'Invalid credentials')
        } else {
          router.refresh()
          router.push('/dashboard')
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleDevLogin = () => {
    router.push('/dashboard')
  }

  const handleGuestLogin = () => {
    loginAsGuest()
    router.push('/dashboard')
  }

  const showDevBypass = !isSupabaseConfigured || isDevAuthBypassEnabled

  return (
    <div className="min-h-screen flex items-center justify-center bg-drushti-surface-muted p-4">
      <div className="w-full max-w-md">
        <div className="rounded-drushti-lg border border-drushti-outline/60 bg-white shadow-xl p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 mx-auto rounded-drushti-lg bg-drushti-navy flex items-center justify-center mb-4">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-drushti-navy">Drushti AI</h1>
            <p className="text-drushti-muted mt-1 text-sm">
              {mode === 'signin' ? 'Sign in to your account' : 'Create an invigilator account'}
            </p>
          </div>

          <div className="flex rounded-drushti border border-drushti-outline/50 p-1 mb-6">
            <button
              type="button"
              onClick={() => {
                setMode('signin')
                setError('')
                setInfo('')
              }}
              className={`flex-1 py-2 text-sm font-medium rounded-drushti transition-colors ${mode === 'signin' ? 'bg-drushti-navy text-white' : 'text-drushti-muted hover:text-drushti-on'
                }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup')
                setError('')
                setInfo('')
              }}
              className={`flex-1 py-2 text-sm font-medium rounded-drushti transition-colors ${mode === 'signup' ? 'bg-drushti-navy text-white' : 'text-drushti-muted hover:text-drushti-on'
                }`}
            >
              Sign up
            </button>
          </div>

          {!isSupabaseConfigured && (
            <div className="mb-6 rounded-drushti border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <p className="font-medium">Supabase URL/key are not loaded.</p>
              <p className="mt-2 text-amber-900/90">
                In <code className="rounded bg-amber-100/80 px-1">FYP Web/frontend</code> run{' '}
                <code className="rounded bg-amber-100/80 px-1">cp .env.example .env</code> (or{' '}
                <code className="rounded bg-amber-100/80 px-1">Copy-Item .env.example .env</code>), paste
                your project URL and publishable key from the Supabase dashboard, then{' '}
                <strong>stop and restart</strong> <code className="rounded bg-amber-100/80 px-1">npm run dev</code>.
              </p>
            </div>
          )}

          <form
            method="post"
            action="/"
            onSubmit={handleSubmit}
            className="space-y-4"
          >
            {mode === 'signup' && (
              <div>
                <label className="block text-sm font-medium text-drushti-on mb-1.5">Full name</label>
                <input
                  id="signup-name"
                  type="text"
                  name="name"
                  autoComplete="name"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Invigilator name"
                  className="w-full px-4 py-3 rounded-drushti border border-drushti-outline text-drushti-on placeholder:text-drushti-hint focus:outline-none focus:ring-2 focus:ring-drushti-navy/25"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-drushti-on mb-1.5">Email</label>
              <input
                id="login-email"
                type="email"
                name="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@college.edu"
                className="w-full px-4 py-3 rounded-drushti border border-drushti-outline text-drushti-on placeholder:text-drushti-hint focus:outline-none focus:ring-2 focus:ring-drushti-navy/25"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-drushti-on mb-1.5">Password</label>
              <input
                id="login-password"
                type="password"
                name="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3 rounded-drushti border border-drushti-outline text-drushti-on placeholder:text-drushti-hint focus:outline-none focus:ring-2 focus:ring-drushti-navy/25"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-drushti">
                {error}
              </div>
            )}
            {info && (
              <div className="bg-drushti-surface-card border border-drushti-outline text-drushti-on text-sm px-4 py-3 rounded-drushti">
                {info}
              </div>
            )}

            <button
              id="login-submit"
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-drushti-navy text-white font-semibold rounded-drushti hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-drushti-navy/40 transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {mode === 'signup' ? 'Creating account…' : 'Signing in…'}
                </>
              ) : (
                <>
                  <Eye className="w-5 h-5" />
                  {mode === 'signup' ? 'Sign up' : 'Sign in'}
                </>
              )}
            </button>
          </form>

          {showDevBypass && (
            <div className="mt-6 pt-4 border-t border-drushti-outline/40 text-center">
              <button
                id="dev-login"
                type="button"
                onClick={handleDevLogin}
                className="text-sm text-drushti-muted hover:text-drushti-navy transition-colors"
              >
                Continue without auth (dev mode)
              </button>
            </div>
          )}

          <div className={`${showDevBypass ? 'mt-3' : 'mt-6 pt-4 border-t border-drushti-outline/40'} text-center`}>
            <button
              id="guest-login"
              type="button"
              onClick={handleGuestLogin}
              className="text-sm text-drushti-muted hover:text-drushti-navy transition-colors"
            >
              Continue as Guest
            </button>
          </div>
        </div>

        <p className="text-center text-drushti-hint text-xs mt-6">
          Drushti AI — exam surveillance (shared Supabase with Android app)
        </p>
      </div>
    </div>
  )
}
