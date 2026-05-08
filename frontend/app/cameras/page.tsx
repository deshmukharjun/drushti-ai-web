'use client'

import { useState, useEffect, useCallback } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { CameraDevicePicker, type BrowserVideoLabel } from '@/components/CameraDevicePicker'
import { cameraApi, ApiError, videoDeviceApi } from '@/lib/client'
import { Camera, isLocalCaptureDevice } from '@/lib/api'
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client'
import {
  Plus,
  Trash2,
  Play,
  Square,
  Camera as CameraIcon,
  Wifi,
  Monitor,
  Loader2,
  MapPin,
  BookOpen,
} from 'lucide-react'

type ExamOption = { id: string; subject: string; examDate: string }

export default function CamerasPage() {
  const [cameras, setCameras] = useState<Camera[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    stream_url: '0',
    location: '',
    useWebcam: true,
    deviceIndex: '0',
  })
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [availableDevices, setAvailableDevices] = useState<number[]>([])
  const [devicesLoading, setDevicesLoading] = useState(false)
  const [devicesError, setDevicesError] = useState<string | null>(null)
  const [browserVideoLabels, setBrowserVideoLabels] = useState<BrowserVideoLabel[]>([])
  const [browserLabelsLoading, setBrowserLabelsLoading] = useState(false)

  // Per-camera selected exam_id (set before starting a stream)
  const [cameraExamMap, setCameraExamMap] = useState<Record<string, string>>({})
  const [examOptions, setExamOptions] = useState<ExamOption[]>([])

  const fetchCameras = useCallback(async () => {
    try {
      const data = await cameraApi.list()
      setCameras(data)
      console.debug('[Cameras] polled —', data.map(c => `${c.name}(${c.status})`).join(', ') || 'none')
    } catch (err) {
      console.error('[Cameras] fetchCameras failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCameras()
    const interval = setInterval(fetchCameras, 8000)
    return () => clearInterval(interval)
  }, [fetchCameras])

  // Load exams from Supabase so user can assign a camera to an exam
  useEffect(() => {
    if (!isSupabaseConfigured) return
    supabase
      .from('exams')
      .select('id, subject, exam_date')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (error) {
          console.error('[Cameras] Supabase exams fetch error:', error)
          return
        }
        const opts = (data ?? []).map((r: { id: string; subject: string; exam_date: string }) => ({
          id: r.id,
          subject: r.subject,
          examDate: r.exam_date,
        }))
        console.log(`[Cameras] Loaded ${opts.length} exam(s) from Supabase:`, opts.map(e => e.subject))
        setExamOptions(opts)
      })
      .catch((e) => console.error('[Cameras] Supabase exams fetch threw:', e))
  }, [])

  useEffect(() => {
    if (!showAddForm || !formData.useWebcam) return
    let cancelled = false
    setDevicesLoading(true)
    setDevicesError(null)
    videoDeviceApi
      .listAvailable(10)
      .then((res) => {
        if (cancelled) return
        setAvailableDevices(res.indices)
        setFormData((fd) => {
          const asStr = res.indices.map(String)
          const current = fd.deviceIndex
          const pick = asStr.includes(current) ? current : String(res.indices[0] ?? 0)
          return { ...fd, deviceIndex: pick }
        })
      })
      .catch((e) => {
        if (cancelled) return
        setDevicesError(e instanceof Error ? e.message : 'Could not list cameras')
        setAvailableDevices([])
      })
      .finally(() => { if (!cancelled) setDevicesLoading(false) })
    return () => { cancelled = true }
  }, [showAddForm, formData.useWebcam])

  useEffect(() => {
    if (!showAddForm || !formData.useWebcam) return
    let cancelled = false
    let stream: MediaStream | null = null
    setBrowserLabelsLoading(true)
    ;(async () => {
      try {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
          setBrowserVideoLabels([])
          return
        }
        try { stream = await navigator.mediaDevices.getUserMedia({ video: true }) } catch { /* continue */ }
        if (cancelled) return
        const devices = await navigator.mediaDevices.enumerateDevices()
        const videos = devices.filter((d) => d.kind === 'videoinput')
        setBrowserVideoLabels(
          videos.map((d, i) => ({
            index: i,
            label: (d.label && d.label.trim()) || `Unnamed camera ${i + 1}`,
          }))
        )
      } catch {
        setBrowserVideoLabels([])
      } finally {
        stream?.getTracks().forEach((t) => t.stop())
        if (!cancelled) setBrowserLabelsLoading(false)
      }
    })()
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [showAddForm, formData.useWebcam])

  const handleAddCamera = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setFormError(null)
    try {
      await cameraApi.create({
        name: formData.name,
        stream_url: formData.useWebcam ? formData.deviceIndex : formData.stream_url,
        location: formData.location,
      })
      setShowAddForm(false)
      setFormData({ name: '', stream_url: '0', location: '', useWebcam: true, deviceIndex: '0' })
      await fetchCameras()
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed to register camera'
      setFormError(message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this camera?')) return
    try {
      await cameraApi.delete(id)
      await fetchCameras()
    } catch (err) {
      console.error('Failed to delete camera:', err)
    }
  }

  const handleToggleStream = async (camera: Camera) => {
    const isOn = camera.status === 'active' || camera.status === 'connecting'
    const examId = cameraExamMap[camera.id] || undefined
    console.log(
      `[Cameras] ${isOn ? 'STOP' : 'START'} stream | id=${camera.id} name="${camera.name}" ` +
      `stream_url="${camera.stream_url}" status=${camera.status}` +
      (!isOn && examId ? ` exam_id=${examId}` : !isOn ? ' (no exam selected)' : '')
    )
    try {
      if (isOn) {
        await cameraApi.stopStream(camera.id)
        console.log(`[Cameras] stop request sent OK | id=${camera.id}`)
      } else {
        await cameraApi.startStream(camera.id, examId)
        console.log(`[Cameras] start request sent OK | id=${camera.id}`)
      }
      await fetchCameras()
    } catch (err) {
      console.error(`[Cameras] toggleStream FAILED | id=${camera.id}`, err)
    }
  }

  const statusColors: Record<string, string> = {
    active: 'bg-green-500/20 text-green-600 border-green-500/30',
    connecting: 'bg-yellow-500/20 text-yellow-600 border-yellow-500/30',
    disconnected: 'bg-gray-500/20 text-gray-500 border-gray-400/30',
    error: 'bg-red-500/20 text-red-500 border-red-400/30',
  }

  const isStreaming = (s: string) => s === 'active' || s === 'connecting'

  const linkedExamLabel = (cameraId: string) => {
    const eid = cameraExamMap[cameraId]
    if (!eid) return null
    const ex = examOptions.find((e) => e.id === eid)
    return ex ? `${ex.subject} · ${ex.examDate}` : null
  }

  return (
    <div className="flex min-h-screen bg-drushti-surface-muted">
      <Sidebar />

      <main className="flex-1 ml-64 p-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-drushti-on">Cameras</h1>
            <p className="text-drushti-muted mt-1">
              Register a camera, assign it to an exam, and start the stream — detection and snapshot alerts run entirely on this dashboard.
            </p>
          </div>
          <button
            onClick={() => { setShowAddForm(!showAddForm); setFormError(null) }}
            className="flex items-center gap-2 px-4 py-2.5 bg-drushti-navy text-white rounded-drushti-lg hover:opacity-90 transition-opacity font-medium shrink-0"
          >
            <Plus className="w-5 h-5" />
            Add Camera
          </button>
        </div>

        {/* How it works banner */}
        <div className="mb-6 rounded-drushti-lg border border-drushti-outline/40 bg-white p-4 shadow-sm">
          <p className="text-sm text-drushti-muted leading-relaxed">
            <span className="font-semibold text-drushti-on">How it works: </span>
            1. Add a camera below &nbsp;→&nbsp;
            2. Select an exam to tag (optional) &nbsp;→&nbsp;
            3. Press <strong>▶ Start</strong> — detection begins immediately &nbsp;→&nbsp;
            4. Cheating snapshots are saved to Supabase and appear on the mobile app automatically.
          </p>
        </div>

        {/* Add Camera Form */}
        {showAddForm && (
          <div className="mb-8 bg-white border border-drushti-outline/60 rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-drushti-navy mb-4">Register New Camera</h3>
            {formError && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {formError}
              </div>
            )}
            <form onSubmit={handleAddCamera} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-drushti-on mb-1.5">Camera Name</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Room 101 — Overhead"
                    className="w-full px-4 py-2.5 bg-white border border-drushti-outline rounded-xl text-drushti-on placeholder:text-drushti-hint focus:ring-2 focus:ring-drushti-navy/25 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-drushti-on mb-1.5">Location</label>
                  <input
                    type="text"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    placeholder="e.g. Building A, Floor 2"
                    className="w-full px-4 py-2.5 bg-white border border-drushti-outline rounded-xl text-drushti-on placeholder:text-drushti-hint focus:ring-2 focus:ring-drushti-navy/25 outline-none transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-drushti-on mb-2">Video Source</label>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setFormData((fd) => ({ ...fd, useWebcam: true, stream_url: '0', deviceIndex: fd.deviceIndex || '0' }))}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all ${formData.useWebcam ? 'bg-drushti-navy text-white border-drushti-navy' : 'bg-white border-drushti-outline text-drushti-muted hover:border-drushti-navy/40'}`}
                  >
                    <Monitor className="w-4 h-4" />
                    Webcam
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData((fd) => ({ ...fd, useWebcam: false, stream_url: '' }))}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all ${!formData.useWebcam ? 'bg-drushti-navy text-white border-drushti-navy' : 'bg-white border-drushti-outline text-drushti-muted hover:border-drushti-navy/40'}`}
                  >
                    <Wifi className="w-4 h-4" />
                    IP Camera / RTSP
                  </button>
                </div>
              </div>

              {formData.useWebcam && (
                <div>
                  <label className="block text-sm font-medium text-drushti-on mb-1.5">Camera device</label>
                  <CameraDevicePicker
                    indices={availableDevices}
                    value={formData.deviceIndex}
                    onChange={(deviceIndex) => setFormData({ ...formData, deviceIndex })}
                    loading={devicesLoading}
                    browserLabels={browserVideoLabels}
                    browserLabelsLoading={browserLabelsLoading}
                  />
                  {devicesError && <p className="text-amber-600 text-sm mt-2">{devicesError}</p>}
                </div>
              )}

              {!formData.useWebcam && (
                <div>
                  <label className="block text-sm font-medium text-drushti-on mb-1.5">Stream URL</label>
                  <input
                    type="text"
                    required
                    value={formData.stream_url}
                    onChange={(e) => setFormData({ ...formData, stream_url: e.target.value })}
                    placeholder="rtsp://192.168.1.100:554/Streaming/Channels/101"
                    className="w-full px-4 py-2.5 bg-white border border-drushti-outline rounded-xl text-drushti-on placeholder:text-drushti-hint focus:ring-2 focus:ring-drushti-navy/25 outline-none transition-all font-mono text-sm"
                  />
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowAddForm(false); setFormError(null) }}
                  className="px-4 py-2 text-drushti-muted hover:text-drushti-on transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-2 px-6 py-2.5 bg-drushti-navy text-white rounded-xl hover:opacity-90 transition-all font-medium disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Register Camera
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Camera List */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl skeleton" />)}
          </div>
        ) : cameras.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-drushti-outline/40 shadow-sm">
            <CameraIcon className="w-12 h-12 mx-auto text-drushti-hint mb-4" />
            <p className="text-drushti-muted text-lg">No cameras registered yet</p>
            <p className="text-drushti-hint text-sm mt-1">Click &quot;Add Camera&quot; to get started</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cameras.map((camera) => (
              <div
                key={camera.id}
                className="bg-white border border-drushti-outline/60 rounded-xl p-5 shadow-sm hover:shadow-md transition-all group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-drushti-surface-muted flex items-center justify-center shrink-0">
                    <CameraIcon className="w-6 h-6 text-drushti-muted" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className="text-drushti-on font-semibold truncate">{camera.name}</h3>
                      <span className={`px-2 py-0.5 text-xs rounded-full border ${statusColors[camera.status] || statusColors.disconnected}`}>
                        {camera.status}
                      </span>
                      {camera.status === 'active' && (
                        <span className="flex items-center gap-1 text-xs text-green-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
                          Live
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-1 flex-wrap">
                      <span className="text-drushti-muted text-sm font-mono truncate">
                        {isLocalCaptureDevice(camera.stream_url)
                          ? `Webcam (device ${camera.stream_url})`
                          : camera.stream_url}
                      </span>
                      {camera.location && (
                        <span className="flex items-center gap-1 text-drushti-muted text-sm">
                          <MapPin className="w-3 h-3" />
                          {camera.location}
                        </span>
                      )}
                    </div>

                    {/* Exam assignment — shown when not streaming */}
                    {!isStreaming(camera.status) && (
                      <div className="mt-2 flex items-center gap-2">
                        <BookOpen className="w-3.5 h-3.5 text-drushti-muted shrink-0" />
                        <select
                          value={cameraExamMap[camera.id] || ''}
                          onChange={(e) => setCameraExamMap((prev) => ({ ...prev, [camera.id]: e.target.value }))}
                          className="text-xs border border-drushti-outline rounded-lg px-2 py-1 text-drushti-on bg-white focus:ring-2 focus:ring-drushti-navy/20 outline-none max-w-xs"
                        >
                          <option value="">No exam assigned (test stream)</option>
                          {examOptions.map((ex) => (
                            <option key={ex.id} value={ex.id}>
                              {ex.subject} · {ex.examDate}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Show linked exam when streaming */}
                    {isStreaming(camera.status) && linkedExamLabel(camera.id) && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-drushti-muted">
                        <BookOpen className="w-3 h-3" />
                        Tagging: <span className="font-medium text-drushti-on">{linkedExamLabel(camera.id)}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleStream(camera)}
                      className={`p-2 rounded-lg transition-all ${
                        isStreaming(camera.status)
                          ? 'bg-red-50 text-red-500 hover:bg-red-100'
                          : 'bg-green-50 text-green-600 hover:bg-green-100'
                      }`}
                      title={isStreaming(camera.status) ? 'Stop Stream' : 'Start Stream'}
                    >
                      {isStreaming(camera.status) ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </button>

                    <button
                      onClick={() => handleDelete(camera.id)}
                      className="p-2 rounded-lg bg-red-50 text-red-400 hover:bg-red-100 transition-all opacity-0 group-hover:opacity-100"
                      title="Delete Camera"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
