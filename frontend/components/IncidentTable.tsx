'use client'

import { useState } from 'react'
import { Incident } from '@/lib/api'
import { format } from 'date-fns'
import { Eye, Download, Filter, ChevronLeft, ChevronRight } from 'lucide-react'

interface IncidentTableProps {
  incidents: Incident[]
  onExport?: () => void
  onViewSnapshot?: (incident: Incident) => void
}

export function IncidentTable({ incidents, onExport, onViewSnapshot }: IncidentTableProps) {
  const [filter, setFilter] = useState({
    behavior: '',
    camera_id: '',
    date: '',
  })
  const [page, setPage] = useState(0)
  const pageSize = 10

  // Get unique behaviors for filter
  const behaviors = [...new Set(incidents.flatMap(i => i.behaviors))]

  // Filter incidents
  const filtered = incidents.filter(incident => {
    if (filter.behavior && !incident.behaviors.includes(filter.behavior)) return false
    if (filter.camera_id && incident.camera_id !== filter.camera_id) return false
    if (filter.date) {
      const incidentDate = new Date(incident.detected_at).toDateString()
      if (incidentDate !== new Date(filter.date).toDateString()) return false
    }
    return true
  })

  // Paginate
  const paginated = filtered.slice(page * pageSize, (page + 1) * pageSize)
  const totalPages = Math.ceil(filtered.length / pageSize)

  const behaviorColors: Record<string, string> = {
    looking_sideways: 'bg-orange-100 text-orange-800',
    proximity_cheating: 'bg-red-100 text-red-800',
    talking: 'bg-yellow-100 text-yellow-800',
    left_seat: 'bg-gray-100 text-gray-800',
    gaze_deviation: 'bg-purple-100 text-purple-800',
  }

  return (
    <div className="bg-card rounded-lg border overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b flex items-center justify-between">
        <h3 className="text-lg font-semibold">Incident Log</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={onExport}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-secondary rounded-md hover:bg-secondary/80 transition-colors"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="p-4 border-b bg-muted/50">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Filters:</span>
          </div>

          <select
            value={filter.behavior}
            onChange={(e) => setFilter({ ...filter, behavior: e.target.value })}
            className="px-3 py-1.5 text-sm border rounded-md bg-background"
          >
            <option value="">All Behaviors</option>
            {behaviors.map(b => (
              <option key={b} value={b}>{b.replace('_', ' ')}</option>
            ))}
          </select>

          <input
            type="date"
            value={filter.date}
            onChange={(e) => setFilter({ ...filter, date: e.target.value })}
            className="px-3 py-1.5 text-sm border rounded-md bg-background"
          />

          {(filter.behavior || filter.date) && (
            <button
              onClick={() => setFilter({ behavior: '', camera_id: '', date: '' })}
              className="text-sm text-destructive hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium">Time</th>
              <th className="px-4 py-3 text-left text-sm font-medium">Camera</th>
              <th className="px-4 py-3 text-left text-sm font-medium">Behaviors</th>
              <th className="px-4 py-3 text-left text-sm font-medium">Confidence</th>
              <th className="px-4 py-3 text-left text-sm font-medium">Snapshot</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No incidents found
                </td>
              </tr>
            ) : (
              paginated.map((incident, index) => (
                <tr key={incident.id || index} className="hover:bg-muted/50">
                  <td className="px-4 py-3 text-sm">
                    {format(new Date(incident.detected_at), 'HH:mm:ss')}
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(incident.detected_at), 'MMM d, yyyy')}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm font-mono">
                    {incident.camera_id.slice(0, 8)}...
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {incident.behaviors.map((behavior, i) => (
                        <span
                          key={i}
                          className={`px-2 py-0.5 rounded text-xs ${
                            behaviorColors[behavior] || 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {behavior.replace('_', ' ')}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${
                            incident.confidence > 0.8 ? 'bg-red-500' :
                            incident.confidence > 0.6 ? 'bg-orange-500' : 'bg-yellow-500'
                          }`}
                          style={{ width: `${incident.confidence * 100}%` }}
                        />
                      </div>
                      <span className="text-sm">{(incident.confidence * 100).toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {incident.snapshot_url && (
                      <button
                        onClick={() => onViewSnapshot?.(incident)}
                        className="flex items-center gap-1 px-2 py-1 text-sm text-primary hover:underline"
                      >
                        <Eye className="w-4 h-4" />
                        View
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="p-4 border-t flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="p-1 rounded hover:bg-muted disabled:opacity-50"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="p-1 rounded hover:bg-muted disabled:opacity-50"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}