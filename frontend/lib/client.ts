// API Client for Drushti AI — Anti-Cheat Environment Backend

import { Camera, Incident, DetectionSettings } from './api'

/** Direct backend origin (WebSockets and MJPEG cannot use Next.js rewrites). */
export function getBackendOrigin(): string {
  return process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'
}

function httpToWebSocketUrl(httpUrl: string): string {
  if (httpUrl.startsWith('https://')) return `wss://${httpUrl.slice(8)}`
  if (httpUrl.startsWith('http://')) return `ws://${httpUrl.slice(7)}`
  return httpUrl
}

/**
 * Browser: same-origin `/api/*` so next.config.js rewrites proxy to FastAPI (avoids CORS).
 * Server (SSR): full backend URL if we ever call APIs from RSC.
 */
function getRestApiBase(): string {
  if (typeof window === 'undefined') return getBackendOrigin()
  return ''
}

function formatApiDetail(detail: unknown): string {
  if (detail == null) return 'Request failed'
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((e: { msg?: string }) => e?.msg || JSON.stringify(e))
      .join('; ')
  }
  if (typeof detail === 'object' && detail !== null && 'message' in detail) {
    return String((detail as { message: unknown }).message)
  }
  try {
    return JSON.stringify(detail)
  } catch {
    return 'Request failed'
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const base = getRestApiBase()
  let response: Response
  try {
    response = await fetch(`${base}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })
  } catch {
    throw new ApiError(
      0,
      'Cannot reach the API. Start the backend from the project root: py -3 -m uvicorn backend.main:app --reload'
    )
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }))
    const message = formatApiDetail(error.detail ?? error.message)
    throw new ApiError(response.status, message)
  }

  return response.json()
}

// Camera API
export const cameraApi = {
  list: () => fetchApi<Camera[]>('/api/cameras'),

  get: (id: string) => fetchApi<Camera>(`/api/cameras/${id}`),

  create: (data: { name: string; stream_url: string; location?: string }) =>
    fetchApi<Camera>('/api/cameras', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    fetchApi<{ message: string }>(`/api/cameras/${id}`, { method: 'DELETE' }),

  startStream: (id: string, examId?: string) => {
    const q =
      examId && examId.trim() !== ''
        ? `?exam_id=${encodeURIComponent(examId.trim())}`
        : ''
    return fetchApi<{ message: string }>(`/api/cameras/${id}/start${q}`, {
      method: 'POST',
    })
  },

  stopStream: (id: string) =>
    fetchApi<{ message: string }>(`/api/cameras/${id}/stop`, { method: 'POST' }),
}

/** Local capture devices available on the machine running the Python backend. */
export const videoDeviceApi = {
  listAvailable: (maxIndex = 10) =>
    fetchApi<{ indices: number[] }>(
      `/api/cameras/devices/available?max_index=${maxIndex}`
    ),
}

// Incidents API
export const incidentApi = {
  list: (params?: { camera_id?: string; behavior?: string; limit?: number }) => {
    const query = new URLSearchParams()
    if (params?.camera_id) query.set('camera_id', params.camera_id)
    if (params?.behavior) query.set('behavior', params.behavior)
    if (params?.limit) query.set('limit', params.limit.toString())
    return fetchApi<Incident[]>(`/api/incidents?${query.toString()}`)
  },

  get: (id: string) => fetchApi<Incident>(`/api/incidents/${id}`),

  exportCsv: () => fetchApi<{ csv: string }>('/api/incidents/export/csv'),
}

// Settings API
export const settingsApi = {
  get: () => fetchApi<DetectionSettings>('/api/settings'),

  update: (settings: Partial<DetectionSettings>) =>
    fetchApi<DetectionSettings>('/api/settings', {
      method: 'POST',
      body: JSON.stringify(settings),
    }),
}

// WebSocket connection factory
export function createWebSocket(cameraId: string): WebSocket {
  const wsBase = httpToWebSocketUrl(getBackendOrigin())
  return new WebSocket(`${wsBase}/ws/feed/${cameraId}`)
}

export function createStatusWebSocket(): WebSocket {
  const wsBase = httpToWebSocketUrl(getBackendOrigin())
  return new WebSocket(`${wsBase}/ws/status`)
}