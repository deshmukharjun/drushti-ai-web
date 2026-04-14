'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Sidebar } from '@/components/Sidebar'
import { supabase } from '@/app/providers'
import type { ExamRow } from '@/lib/examTypes'
import { Calendar, Clock, Users, ChevronRight, Smartphone, RefreshCw } from 'lucide-react'

type Tab = 'active' | 'completed'

const statusColors: Record<string, string> = {
  live: 'bg-green-100 text-green-800 border-green-200',
  draft: 'bg-amber-100 text-amber-800 border-amber-200',
  completed: 'bg-gray-100 text-gray-600 border-gray-200',
}

const statusDot: Record<string, string> = {
  live: 'bg-green-500 animate-pulse',
  draft: 'bg-amber-400',
  completed: 'bg-gray-400',
}

export default function ExamsPage() {
  const [exams, setExams] = useState<ExamRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('active')

  const load = useCallback(async () => {
    setErr(null)
    const { data, error } = await supabase
      .from('exams')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      setErr(error.message)
      setExams([])
    } else {
      setExams((data as ExamRow[]) || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    // Live-poll for status changes while viewing
    const interval = setInterval(load, 10000)
    return () => clearInterval(interval)
  }, [load])

  const activeExams = exams.filter((e) => e.status !== 'completed')
  const completedExams = exams.filter((e) => e.status === 'completed')
  const displayed = tab === 'active' ? activeExams : completedExams

  return (
    <div className="flex min-h-screen bg-drushti-surface">
      <Sidebar />
      <main className="flex-1 ml-64 p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-drushti-on">Exams</h1>
            <p className="text-drushti-muted mt-1">
              Exams are created from the <strong>DrushtiAI mobile app</strong>. Link a camera from the Cameras page.
            </p>
          </div>
          <button
            onClick={() => { setLoading(true); load() }}
            className="flex items-center gap-2 px-3 py-2 rounded-drushti border border-drushti-outline/60 bg-white text-drushti-on hover:bg-drushti-surface-muted transition-all text-sm"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        {err && (
          <div className="mb-4 rounded-drushti border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {err}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-drushti-outline/40">
          <button
            onClick={() => setTab('active')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all -mb-px ${
              tab === 'active'
                ? 'border-drushti-navy text-drushti-navy'
                : 'border-transparent text-drushti-muted hover:text-drushti-on'
            }`}
          >
            Active / Draft
            {activeExams.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 rounded-full bg-drushti-navy text-white text-xs">
                {activeExams.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('completed')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all -mb-px ${
              tab === 'completed'
                ? 'border-drushti-navy text-drushti-navy'
                : 'border-transparent text-drushti-muted hover:text-drushti-on'
            }`}
          >
            Completed
            {completedExams.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-700 text-xs">
                {completedExams.length}
              </span>
            )}
          </button>
        </div>

        {/* List */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-drushti-lg skeleton border border-drushti-outline/30" />
            ))}
          </div>
        ) : displayed.length === 0 ? (
          <div className="text-center py-20 rounded-drushti-lg border border-drushti-outline/40 bg-drushti-surface-muted">
            <Smartphone className="w-12 h-12 mx-auto text-drushti-outline mb-4" />
            {tab === 'active' ? (
              <>
                <p className="text-drushti-muted text-lg">No active exams</p>
                <p className="text-drushti-hint text-sm mt-2 max-w-sm mx-auto">
                  Create an exam from the <strong>DrushtiAI mobile app</strong>, then come back here to monitor it live.
                </p>
              </>
            ) : (
              <>
                <p className="text-drushti-muted text-lg">No completed exams yet</p>
                <p className="text-drushti-hint text-sm mt-2">Completed exams and their snapshots will appear here.</p>
              </>
            )}
          </div>
        ) : (
          <ul className="space-y-3">
            {displayed.map((exam) => (
              <li
                key={exam.id}
                className={`flex items-center gap-3 p-5 rounded-drushti-lg border bg-white shadow-sm hover:border-drushti-navy/40 transition-colors ${
                  exam.status === 'live'
                    ? 'border-l-4 border-l-green-500 border-drushti-outline/30'
                    : 'border-drushti-outline/50'
                }`}
              >
                <Link href={`/exams/${exam.id}`} className="flex items-center gap-4 flex-1 min-w-0">
                  {/* Status dot */}
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDot[exam.status] || 'bg-gray-400'}`} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="font-semibold text-drushti-on truncate">{exam.subject}</h2>
                      <span className={`text-xs px-2 py-0.5 rounded-full border capitalize ${statusColors[exam.status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                        {exam.status}
                      </span>
                      {exam.camera_connected && (
                        <span className="text-xs text-green-700 font-medium">📷 Camera linked</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-4 mt-1.5 text-sm text-drushti-muted">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {exam.exam_date}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {exam.exam_time}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" />
                        {exam.student_count} students
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-drushti-hint shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}

        {/* Info box */}
        <div className="mt-8 rounded-drushti-lg border border-drushti-outline/40 bg-drushti-surface-muted p-4">
          <p className="text-sm text-drushti-muted">
            <strong className="text-drushti-on">📱 Create exams on mobile.</strong>
            {' '}Open the DrushtiAI app → New Exam → fill in details → Start. Then go to{' '}
            <Link href="/cameras" className="text-drushti-navy underline">Cameras</Link>
            {' '}on this dashboard, start a stream, and show the QR to link.
          </p>
        </div>
      </main>
    </div>
  )
}
