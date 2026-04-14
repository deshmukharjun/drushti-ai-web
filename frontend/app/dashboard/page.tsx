'use client'

import { useState, useEffect, useCallback } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { CameraFeed } from '@/components/CameraFeed'
import { AlertPanel } from '@/components/AlertBadge'
import { cameraApi } from '@/lib/client'
import { Camera, StreamResult } from '@/lib/api'
import {
  Camera as CameraIcon,
  AlertTriangle,
  Activity,
  Shield,
  RefreshCw,
} from 'lucide-react'

interface AlertSummary {
  type: 'looking_sideways' | 'proximity_cheating' | 'talking' | 'left_seat' | 'gaze_deviation'
  count: number
  lastSeen?: string
}

export default function DashboardPage() {
  const [cameras, setCameras] = useState<Camera[]>([])
  const [alerts, setAlerts] = useState<AlertSummary[]>([])
  const [incidentCount, setIncidentCount] = useState(0)
  const [loading, setLoading] = useState(true)

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
    const interval = setInterval(fetchCameras, 10000)
    return () => clearInterval(interval)
  }, [fetchCameras])

  const handleAlert = useCallback(
    (cameraId: string, detections: StreamResult['detections']) => {
      setIncidentCount((prev) => prev + detections.length)

      // Aggregate alerts
      const newAlerts: Record<string, AlertSummary> = {}
      for (const detection of detections) {
        for (const behavior of detection.behaviors) {
          const key = behavior as AlertSummary['type']
          if (!newAlerts[key]) {
            newAlerts[key] = { type: key, count: 0 }
          }
          newAlerts[key].count++
          newAlerts[key].lastSeen = new Date().toLocaleTimeString()
        }
      }

      setAlerts((prev) => {
        const merged = [...prev]
        for (const [key, alert] of Object.entries(newAlerts)) {
          const existing = merged.find((a) => a.type === key)
          if (existing) {
            existing.count += alert.count
            existing.lastSeen = alert.lastSeen
          } else {
            merged.push(alert)
          }
        }
        return merged
      })
    },
    []
  )

  const activeCameras = cameras.filter((c) => c.status === 'active').length

  return (
    <div className="flex min-h-screen bg-drushti-surface-muted">
      <Sidebar />

      <main className="flex-1 ml-64 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-drushti-on">Dashboard</h1>
            <p className="text-drushti-muted mt-1">Anti-Cheat Environment — Real-time exam surveillance</p>
          </div>
          <button
            onClick={fetchCameras}
            className="flex items-center gap-2 px-4 py-2 rounded-drushti-lg border border-drushti-outline/60 bg-white text-drushti-on hover:bg-drushti-surface-muted transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            icon={<CameraIcon className="w-5 h-5" />}
            label="Total Cameras"
            value={cameras.length}
            color="blue"
          />
          <StatCard
            icon={<Activity className="w-5 h-5" />}
            label="Active Streams"
            value={activeCameras}
            color="green"
          />
          <StatCard
            icon={<AlertTriangle className="w-5 h-5" />}
            label="Incidents Today"
            value={incidentCount}
            color="red"
          />
          <StatCard
            icon={<Shield className="w-5 h-5" />}
            label="Alert Types"
            value={alerts.length}
            color="purple"
          />
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
          {/* Camera Grid */}
          <div className="xl:col-span-3">
            <h2 className="text-lg font-semibold text-drushti-on mb-4">Camera Feeds</h2>
            {loading ? (
              <div className="camera-grid">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="camera-tile skeleton" />
                ))}
              </div>
            ) : cameras.length === 0 ? (
              <div className="text-center py-20 rounded-drushti-lg border border-drushti-outline/40 bg-white">
                <CameraIcon className="w-12 h-12 mx-auto text-drushti-outline mb-4" />
                <p className="text-drushti-muted text-lg">No cameras registered</p>
                <p className="text-drushti-hint text-sm mt-1">
                  Go to the Cameras page to add your first camera
                </p>
              </div>
            ) : (
              <div className="camera-grid">
                {cameras.map((cam) => (
                  <CameraFeed
                    key={cam.id}
                    camera={cam}
                    onAlert={handleAlert}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Alert Sidebar */}
          <div className="xl:col-span-1">
            <AlertPanel alerts={alerts} />
          </div>
        </div>
      </main>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: number
  color: 'blue' | 'green' | 'red' | 'purple'
}) {
  const colors = {
    blue: 'border-drushti-outline/50 text-drushti-navy bg-drushti-surface-card',
    green: 'border-emerald-200 text-emerald-900 bg-emerald-50',
    red: 'border-red-200 text-red-900 bg-red-50',
    purple: 'border-violet-200 text-violet-900 bg-violet-50',
  }

  return (
    <div
      className={`border rounded-drushti-lg p-5 shadow-sm transition-all hover:shadow-md ${colors[color]}`}
    >
      <div className="flex items-center gap-3 mb-2 opacity-80">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="text-3xl font-bold text-drushti-on">{value}</div>
    </div>
  )
}
