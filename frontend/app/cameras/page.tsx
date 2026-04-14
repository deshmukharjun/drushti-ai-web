'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { CameraDevicePicker, type BrowserVideoLabel } from '@/components/CameraDevicePicker'
import { cameraApi, ApiError, videoDeviceApi } from '@/lib/client'
import { Camera, isLocalCaptureDevice } from '@/lib/api'
import { getPublicBackendBase, httpToWebSocketUrl } from '@/lib/publicBackend'
import QRCode from 'qrcode'
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
  QrCode,
  X,
} from 'lucide-react'

// Build the QR payload for a camera — scanned by Android to pair camera to an exam
function buildCameraQrPayload(cameraId: string): string {
  const base = getPublicBackendBase()
  const wsBase = httpToWebSocketUrl(base)
  return JSON.stringify({
    v: 1,
    camera_id: cameraId,
    ws_url: `${wsBase}/ws/feed/${cameraId}`,
    ingest_url: `${base}/api/cameras/${cameraId}/start`,
  })
}

function CameraQrModal({ camera, onClose }: { camera: Camera; onClose: () => void }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const payload = buildCameraQrPayload(camera.id)

  useEffect(() => {
    QRCode.toDataURL(payload, {
      width: 260,
      margin: 2,
      color: { dark: '#000F2E', light: '#FFFFFF' },
    })
      .then(setDataUrl)
      .catch(() => setDataUrl(null))
  }, [payload])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-gray-100 text-gray-400"
        >
          <X className="w-4 h-4" />
        </button>
        <QrCode className="w-8 h-8 mx-auto text-drushti-navy mb-3" />
        <h2 className="text-lg font-bold text-drushti-navy mb-1">Pair Camera</h2>
        <p className="text-sm text-gray-500 mb-1">
          Open the <strong>DrushtiAI app</strong>, go to your exam, tap{' '}
          <strong>Link Camera</strong>, then scan this code.
        </p>
        <p className="text-sm font-semibold text-drushti-navy mb-4">{camera.name}</p>
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dataUrl}
            alt="Camera pairing QR"
            className="mx-auto rounded-xl border border-gray-200 p-2 bg-white"
          />
        ) : (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-8 h-8 animate-spin text-drushti-navy" />
          </div>
        )}
        <p className="text-xs text-gray-400 mt-4 break-all font-mono bg-gray-50 p-2 rounded-lg text-left">
          {payload}
        </p>
      </div>
    </div>
  )
}

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
  const [qrCamera, setQrCamera] = useState<Camera | null>(null)

  const fetchCameras = useCallback(async () => {
    try {
      const data = await cameraApi.list()
      setCameras(data)
    } catch (err) {
      console.error('Failed to fetch cameras:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCameras()
    const interval = setInterval(fetchCameras, 8000)
    return () => clearInterval(interval)
  }, [fetchCameras])

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
      .finally(() => {
        if (!cancelled) setDevicesLoading(false)
      })
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
    try {
      if (camera.status === 'active') {
        await cameraApi.stopStream(camera.id)
      } else {
        await cameraApi.startStream(camera.id)
      }
      await fetchCameras()
    } catch (err) {
      console.error('Failed to toggle stream:', err)
    }
  }

  const statusColors: Record<string, string> = {
    active: 'bg-green-500/20 text-green-400 border-green-500/30',
    connecting: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    disconnected: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    error: 'bg-red-500/20 text-red-400 border-red-500/30',
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
              Add a camera, start the stream, then scan the QR from the DrushtiAI mobile app to link it to an exam.
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
            2. Press <strong>▶ Start</strong> to begin the live feed &nbsp;→&nbsp;
            3. Press <strong>QR</strong> on the camera card &nbsp;→&nbsp;
            4. On the mobile app, open your exam and tap <strong>Link Camera</strong>, then scan &nbsp;→&nbsp;
            5. Press <strong>Start Invigilation</strong> on the app — detection begins automatically.
          </p>
        </div>

        {/* Add Camera Form */}
        {showAddForm && (
          <div className="mb-8 bg-white/5 border border-white/10 rounded-2xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Register New Camera</h3>
            {formError && (
              <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {formError}
              </div>
            )}
            <form onSubmit={handleAddCamera} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Camera Name</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Room 101 — Overhead"
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500/50 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Location</label>
                  <input
                    type="text"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    placeholder="e.g. Building A, Floor 2"
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500/50 outline-none transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Video Source</label>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setFormData((fd) => ({ ...fd, useWebcam: true, stream_url: '0', deviceIndex: fd.deviceIndex || '0' }))}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all ${formData.useWebcam ? 'bg-blue-600/20 border-blue-500/30 text-blue-400' : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'}`}
                  >
                    <Monitor className="w-4 h-4" />
                    Webcam
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData((fd) => ({ ...fd, useWebcam: false, stream_url: '' }))}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all ${!formData.useWebcam ? 'bg-blue-600/20 border-blue-500/30 text-blue-400' : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'}`}
                  >
                    <Wifi className="w-4 h-4" />
                    IP Camera / RTSP
                  </button>
                </div>
              </div>

              {formData.useWebcam && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Camera device</label>
                  <CameraDevicePicker
                    indices={availableDevices}
                    value={formData.deviceIndex}
                    onChange={(deviceIndex) => setFormData({ ...formData, deviceIndex })}
                    loading={devicesLoading}
                    browserLabels={browserVideoLabels}
                    browserLabelsLoading={browserLabelsLoading}
                  />
                  {devicesError && <p className="text-amber-400 text-sm mt-2">{devicesError}</p>}
                </div>
              )}

              {!formData.useWebcam && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Stream URL</label>
                  <input
                    type="text"
                    required
                    value={formData.stream_url}
                    onChange={(e) => setFormData({ ...formData, stream_url: e.target.value })}
                    placeholder="rtsp://192.168.1.100:554/stream"
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500/50 outline-none transition-all font-mono text-sm"
                  />
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowAddForm(false); setFormError(null) }}
                  className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl hover:from-blue-500 hover:to-purple-500 transition-all font-medium disabled:opacity-50"
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
          <div className="text-center py-20 bg-white/5 rounded-2xl border border-white/5">
            <CameraIcon className="w-12 h-12 mx-auto text-gray-600 mb-4" />
            <p className="text-gray-400 text-lg">No cameras registered yet</p>
            <p className="text-gray-600 text-sm mt-1">Click &quot;Add Camera&quot; to get started</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cameras.map((camera) => (
              <div
                key={camera.id}
                className="bg-white/5 border border-white/10 rounded-xl p-5 flex items-center gap-4 hover:bg-white/[0.07] transition-all group"
              >
                <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                  <CameraIcon className="w-6 h-6 text-gray-400" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="text-white font-semibold truncate">{camera.name}</h3>
                    <span className={`px-2 py-0.5 text-xs rounded-full border ${statusColors[camera.status] || statusColors.disconnected}`}>
                      {camera.status}
                    </span>
                    {camera.status === 'active' && (
                      <span className="flex items-center gap-1 text-xs text-green-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
                        Live
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-1 flex-wrap">
                    <span className="text-gray-500 text-sm font-mono truncate">
                      {isLocalCaptureDevice(camera.stream_url)
                        ? `Webcam (device ${camera.stream_url})`
                        : camera.stream_url}
                    </span>
                    {camera.location && (
                      <span className="flex items-center gap-1 text-gray-500 text-sm">
                        <MapPin className="w-3 h-3" />
                        {camera.location}
                      </span>
                    )}
                  </div>
                  {camera.status !== 'active' && (
                    <p className="text-xs text-gray-600 mt-1">Start stream first, then scan QR from the mobile app</p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {/* QR button — only when streaming */}
                  {camera.status === 'active' && (
                    <button
                      onClick={() => setQrCamera(camera)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-drushti-navy/80 text-white text-xs font-medium hover:bg-drushti-navy transition-all"
                      title="Show QR to pair with mobile app"
                    >
                      <QrCode className="w-4 h-4" />
                      QR
                    </button>
                  )}

                  <button
                    onClick={() => handleToggleStream(camera)}
                    className={`p-2 rounded-lg transition-all ${
                      camera.status === 'active'
                        ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                        : 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                    }`}
                    title={camera.status === 'active' ? 'Stop Stream' : 'Start Stream'}
                  >
                    {camera.status === 'active' ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>

                  <button
                    onClick={() => handleDelete(camera.id)}
                    className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all opacity-0 group-hover:opacity-100"
                    title="Delete Camera"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* QR Modal */}
      {qrCamera && <CameraQrModal camera={qrCamera} onClose={() => setQrCamera(null)} />}
    </div>
  )
}
