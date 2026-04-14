'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/app/providers'
import {
  LayoutDashboard,
  Camera,
  AlertTriangle,
  Settings,
  LogOut,
  Sparkles,
  ShieldCheck,
  GraduationCap,
} from 'lucide-react'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/cameras', label: 'Cameras', icon: Camera },
  { href: '/exams', label: 'Exams', icon: GraduationCap },
  { href: '/incidents', label: 'Incidents', icon: AlertTriangle },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const { signOut } = useAuth()

  return (
    <aside className="fixed left-0 top-0 h-full w-64 bg-drushti-navy border-r border-drushti-navyLight/50 flex flex-col z-50 shadow-lg">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-white/10">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-drushti bg-white/10 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold text-lg leading-tight">Drushti AI</h1>
            <p className="text-white/60 text-xs">Surveillance Platform</p>
          </div>
        </Link>
      </div>

      {/* Environment: Anti-Cheat */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        <div className="flex items-center gap-2 px-3 py-2 mb-2">
          <ShieldCheck className="w-4 h-4 text-white/80" />
          <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">Anti-Cheat</span>
        </div>
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + '/')
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-drushti text-sm font-medium transition-all duration-200 ${isActive
                ? 'bg-white/15 text-white'
                : 'text-white/65 hover:text-white hover:bg-white/10'
                }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'text-white' : ''}`} />
              {item.label}
              {isActive && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white" />
              )}
            </Link>
          )
        })}
      </nav>

      {/* Status Bar */}
      <div className="px-4 py-3 border-t border-white/10">
        <div className="flex items-center gap-2 mb-3 px-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-white/60">System Active</span>
        </div>
        <button
          onClick={() => signOut()}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-drushti text-sm font-medium text-white/65 hover:text-white hover:bg-red-500/20 transition-all duration-200"
        >
          <LogOut className="w-5 h-5" />
          Sign Out
        </button>
      </div>
    </aside>
  )
}
