'use client'

import { useState, useEffect, useCallback } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { IncidentTable } from '@/components/IncidentTable'
import { incidentApi } from '@/lib/client'
import { Incident } from '@/lib/api'
import { AlertTriangle, Loader2 } from 'lucide-react'

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [loading, setLoading] = useState(true)
  const [snapshotModal, setSnapshotModal] = useState<Incident | null>(null)

  const fetchIncidents = useCallback(async () => {
    try {
      const data = await incidentApi.list({ limit: 500 })
      setIncidents(data)
    } catch (err) {
      console.error('Failed to fetch incidents:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchIncidents()
    const interval = setInterval(fetchIncidents, 5000)
    return () => clearInterval(interval)
  }, [fetchIncidents])

  const handleExport = async () => {
    try {
      const data = await incidentApi.exportCsv()
      const blob = new Blob([data.csv], { type: 'text/csv' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `incidents_${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to export CSV:', err)
    }
  }

  const handleViewSnapshot = (incident: Incident) => {
    setSnapshotModal(incident)
  }

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

  const snapshotSrc = (url?: string) => {
    if (!url) return ''
    if (url.startsWith('http://') || url.startsWith('https://')) return url
    return `${backendUrl}${url}`
  }

  return (
    <div className="flex min-h-screen bg-drushti-surface-muted">
      <Sidebar />

      <main className="flex-1 ml-64 p-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-drushti-on">Incidents</h1>
          <p className="text-drushti-muted mt-1">
            Review all detected cheating incidents
          </p>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-drushti-navy animate-spin" />
          </div>
        ) : incidents.length === 0 ? (
          <div className="text-center py-20 rounded-drushti-lg border border-drushti-outline/40 bg-white">
            <AlertTriangle className="w-12 h-12 mx-auto text-drushti-outline mb-4" />
            <p className="text-drushti-muted text-lg">No incidents recorded yet</p>
            <p className="text-drushti-hint text-sm mt-1">
              Incidents will appear here when cheating behaviors are detected
            </p>
          </div>
        ) : (
          <div className="rounded-drushti-lg border border-drushti-outline/50 bg-white overflow-hidden shadow-sm">
            <IncidentTable
              incidents={incidents}
              onExport={handleExport}
              onViewSnapshot={handleViewSnapshot}
            />
          </div>
        )}

        {/* Snapshot Modal */}
        {snapshotModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => setSnapshotModal(null)}
          >
            <div
              className="bg-white border border-drushti-outline/50 rounded-drushti-lg p-6 max-w-2xl w-full mx-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-drushti-on mb-4">
                Incident Snapshot
              </h3>
              {snapshotModal.snapshot_url && (
                <img
                  src={snapshotSrc(snapshotModal.snapshot_url)}
                  alt="Incident snapshot"
                  className="w-full rounded-xl mb-4"
                />
              )}
              <div className="flex flex-wrap gap-2 mb-4">
                {snapshotModal.behaviors.map((b, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 bg-red-50 text-red-800 rounded-drushti text-sm"
                  >
                    {b.replace('_', ' ')}
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-between text-sm text-drushti-muted">
                <span>Confidence: {(snapshotModal.confidence * 100).toFixed(0)}%</span>
                <span>{new Date(snapshotModal.detected_at).toLocaleString()}</span>
              </div>
              <button
                onClick={() => setSnapshotModal(null)}
                className="mt-4 w-full py-2 rounded-drushti border border-drushti-outline text-drushti-on hover:bg-drushti-surface-muted transition-all"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
