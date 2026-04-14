'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Sidebar } from '@/components/Sidebar'
import { supabase, useAuth } from '@/app/providers'
import type { ExamRow } from '@/lib/examTypes'
import {
  ArrowLeft,
  Loader2,
  Trash2,
  Calendar,
  Clock,
  Users,
  Camera,
  AlertTriangle,
  CheckCircle2,
  FileText,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

type Snapshot = {
  id: string
  image_url: string
  label: string | null
  created_at: string
}

const statusColors: Record<string, string> = {
  live: 'bg-green-100 text-green-800 border-green-200',
  draft: 'bg-amber-100 text-amber-800 border-amber-200',
  completed: 'bg-gray-100 text-gray-600 border-gray-200',
}

function SnapshotModal({
  snapshots,
  index,
  onClose,
  onPrev,
  onNext,
}: {
  snapshots: Snapshot[]
  index: number
  onClose: () => void
  onPrev: () => void
  onNext: () => void
}) {
  const snap = snapshots[index]
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onPrev()
      if (e.key === 'ArrowRight') onNext()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, onPrev, onNext])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-drushti-navy rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white z-10"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="relative w-full aspect-video bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={snap.image_url}
            alt={snap.label || 'Snapshot'}
            className="w-full h-full object-contain"
          />
          {/* Prev / Next */}
          {index > 0 && (
            <button
              onClick={onPrev}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          {index < snapshots.length - 1 && (
            <button
              onClick={onNext}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="p-4 flex items-center justify-between">
          <div>
            {snap.label && (
              <p className="text-white font-medium text-sm">{snap.label}</p>
            )}
            <p className="text-white/50 text-xs mt-0.5">
              {new Date(snap.created_at).toLocaleString()} · {index + 1} of {snapshots.length}
            </p>
          </div>
          <a
            href={snap.image_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-white/60 hover:text-white underline"
          >
            Open full size
          </a>
        </div>
      </div>
    </div>
  )
}

export default function ExamDetailPage() {
  const params = useParams()
  const id = params.id as string
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [exam, setExam] = useState<ExamRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [snapshotsLoading, setSnapshotsLoading] = useState(true)
  const [modalIndex, setModalIndex] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadExam = useCallback(async () => {
    const { data, error: qErr } = await supabase.from('exams').select('*').eq('id', id).single()
    if (qErr || !data) {
      setError(qErr?.message || 'Exam not found')
      setExam(null)
    } else {
      setExam(data as ExamRow)
    }
    setLoading(false)
  }, [id])

  const loadSnapshots = useCallback(async () => {
    setSnapshotsLoading(true)
    const { data } = await supabase
      .from('cheating_snapshots')
      .select('id, image_url, label, created_at')
      .eq('exam_id', id)
      .order('created_at', { ascending: false })
    setSnapshots((data as Snapshot[]) || [])
    setSnapshotsLoading(false)
  }, [id])

  useEffect(() => {
    loadExam()
    loadSnapshots()
  }, [loadExam, loadSnapshots])

  // Poll snapshots while exam is live
  useEffect(() => {
    if (exam?.status !== 'live') return
    const interval = setInterval(loadSnapshots, 5000)
    return () => clearInterval(interval)
  }, [exam?.status, loadSnapshots])

  const remove = async () => {
    if (!confirm('Delete this exam and all its snapshots? This cannot be undone.')) return
    setDeleting(true)
    const { error: dErr } = await supabase.from('exams').delete().eq('id', id)
    if (dErr) {
      setError(dErr.message)
      setDeleting(false)
      return
    }
    router.push('/exams')
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-drushti-surface">
        <Loader2 className="w-8 h-8 animate-spin text-drushti-navy" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-drushti-surface p-6">
        <Link href="/" className="text-drushti-navy underline">Sign in</Link>
      </div>
    )
  }

  if (!exam) {
    return (
      <div className="flex min-h-screen bg-drushti-surface">
        <Sidebar />
        <main className="flex-1 ml-64 p-6">
          <p className="text-red-700">{error || 'Not found'}</p>
          <Link href="/exams" className="text-drushti-navy underline mt-4 inline-block">Back</Link>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-drushti-surface">
      <Sidebar />
      <main className="flex-1 ml-64 p-6 max-w-4xl">

        <Link
          href="/exams"
          className="inline-flex items-center gap-2 text-sm text-drushti-muted hover:text-drushti-navy mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          All Exams
        </Link>

        {error && (
          <div className="mb-4 rounded-drushti border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* Exam header */}
        <div className="rounded-drushti-lg border border-drushti-outline/50 bg-white p-6 shadow-sm mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <h1 className="text-2xl font-bold text-drushti-on truncate">{exam.subject}</h1>
                <span className={`text-xs px-2.5 py-1 rounded-full border capitalize font-medium ${statusColors[exam.status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                  {exam.status === 'live' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse mr-1.5" />}
                  {exam.status}
                </span>
              </div>

              <div className="flex flex-wrap gap-5 text-sm text-drushti-muted">
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4" />
                  {exam.exam_date}
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4" />
                  {exam.exam_time}
                </span>
                <span className="flex items-center gap-1.5">
                  <Users className="w-4 h-4" />
                  {exam.student_count} students
                </span>
                <span className="flex items-center gap-1.5">
                  <Camera className="w-4 h-4" />
                  {exam.camera_connected ? (
                    <span className="text-green-700 font-medium">Camera linked</span>
                  ) : (
                    <span className="text-drushti-muted">No camera linked</span>
                  )}
                </span>
              </div>

              {exam.room_notes && (
                <p className="mt-3 text-sm text-drushti-on bg-drushti-surface-muted rounded-drushti px-3 py-2">
                  {exam.room_notes}
                </p>
              )}
            </div>

            <button
              onClick={remove}
              disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-2 rounded-drushti border border-red-200 text-red-700 hover:bg-red-50 text-sm transition-all disabled:opacity-50"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Delete
            </button>
          </div>

          {/* Status guidance */}
          {exam.status === 'draft' && !exam.camera_connected && (
            <div className="mt-4 flex items-start gap-3 rounded-drushti bg-amber-50 border border-amber-200 px-4 py-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                No camera linked yet. Go to{' '}
                <Link href="/cameras" className="font-semibold underline">Cameras</Link>
                {' '}→ start a stream → press QR → scan from the mobile app.
              </p>
            </div>
          )}

          {exam.status === 'live' && (
            <div className="mt-4 flex items-start gap-3 rounded-drushti bg-green-50 border border-green-200 px-4 py-3">
              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
              <p className="text-sm text-green-800">
                Exam is live. Detection is running. Snapshots below update automatically.
                View all feeds on the{' '}
                <Link href="/dashboard" className="font-semibold underline">Dashboard</Link>.
              </p>
            </div>
          )}
        </div>

        {/* Snapshot gallery */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-drushti-on flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Snapshots
              {snapshots.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-drushti-surface-card text-drushti-muted text-sm font-normal">
                  {snapshots.length}
                </span>
              )}
            </h2>
            {exam.status === 'live' && (
              <span className="text-xs text-drushti-muted animate-pulse">Refreshing every 5s…</span>
            )}
          </div>

          {snapshotsLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="aspect-video skeleton rounded-drushti-lg" />
              ))}
            </div>
          ) : snapshots.length === 0 ? (
            <div className="text-center py-16 rounded-drushti-lg border border-drushti-outline/40 bg-drushti-surface-muted">
              <Camera className="w-10 h-10 mx-auto text-drushti-outline mb-3" />
              <p className="text-drushti-muted">No snapshots captured yet</p>
              {exam.status === 'live' && (
                <p className="text-drushti-hint text-sm mt-1">
                  Snapshots appear here when the detection model flags a student.
                </p>
              )}
              {exam.status === 'draft' && (
                <p className="text-drushti-hint text-sm mt-1">
                  Start the exam from the mobile app to begin capture.
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {snapshots.map((snap, i) => (
                <button
                  key={snap.id}
                  onClick={() => setModalIndex(i)}
                  className="group relative aspect-video rounded-drushti-lg overflow-hidden border border-drushti-outline/40 bg-drushti-surface-muted hover:border-drushti-navy/40 hover:shadow-md transition-all text-left"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={snap.image_url}
                    alt={snap.label || 'Snapshot'}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="absolute bottom-0 left-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {snap.label && (
                      <p className="text-white text-xs font-medium truncate">{snap.label}</p>
                    )}
                    <p className="text-white/70 text-xs">
                      {new Date(snap.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                  {snap.label && (
                    <div className="absolute top-1.5 left-1.5">
                      <span className="bg-red-500/90 text-white text-xs px-1.5 py-0.5 rounded-md">
                        {snap.label.split(',')[0]}
                      </span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Snapshot modal */}
      {modalIndex !== null && (
        <SnapshotModal
          snapshots={snapshots}
          index={modalIndex}
          onClose={() => setModalIndex(null)}
          onPrev={() => setModalIndex((i) => (i !== null && i > 0 ? i - 1 : i))}
          onNext={() => setModalIndex((i) => (i !== null && i < snapshots.length - 1 ? i + 1 : i))}
        />
      )}
    </div>
  )
}
