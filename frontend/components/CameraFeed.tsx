'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Camera, StreamResult, isLocalCaptureDevice } from '@/lib/api'
import { createWebSocket } from '@/lib/client'
import { AlertTriangle, Video, VideoOff } from 'lucide-react'

interface CameraFeedProps {
  camera: Camera
  onAlert?: (cameraId: string, detections: StreamResult['detections']) => void
}

export function CameraFeed({ camera, onAlert }: CameraFeedProps) {
  const [isConnected, setIsConnected] = useState(false)
  const [isAlert, setIsAlert] = useState(false)
  const [lastDetection, setLastDetection] = useState<StreamResult | null>(null)
  const [frameTick, setFrameTick] = useState(0)
  const [previewError, setPreviewError] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null)

  const isActive = camera.status === 'active'
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive

  const connect = useCallback(() => {
    if (!isActiveRef.current) return

    const ws = createWebSocket(camera.id)
    wsRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
    }

    ws.onmessage = (event) => {
      try {
        const data: StreamResult = JSON.parse(event.data)

        if (data.detections && data.detections.length > 0) {
          setIsAlert(true)
          setLastDetection(data)
          onAlert?.(camera.id, data.detections)

          setTimeout(() => setIsAlert(false), 3000)
        }
      } catch (error) {
        console.error('WebSocket parse error:', error)
      }
    }

    ws.onclose = () => {
      setIsConnected(false)
      if (!isActiveRef.current) return
      reconnectTimeout.current = setTimeout(() => {
        if (isActiveRef.current) connect()
      }, 5000)
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
      ws.close()
    }
  }, [camera.id, onAlert])

  useEffect(() => {
    if (!isActive) {
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current)
        reconnectTimeout.current = null
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      setIsConnected(false)
      return
    }

    connect()

    return () => {
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current)
        reconnectTimeout.current = null
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [isActive, connect])

  // JPEG snapshots from backend (works for webcam indices, RTSP, and HTTP sources)
  useEffect(() => {
    if (!isActive) {
      setPreviewError(false)
      return
    }
    setPreviewError(false)
    const id = setInterval(() => setFrameTick((t) => t + 1), 120)
    return () => clearInterval(id)
  }, [isActive, camera.id])

  const snapshotSrc = isActive
    ? `/api/cameras/${camera.id}/snapshot.jpg?t=${frameTick}`
    : null

  const sourceLabel = isLocalCaptureDevice(camera.stream_url)
    ? `Webcam (device ${camera.stream_url})`
    : camera.stream_url

  return (
    <div className={`camera-tile ${isAlert ? 'alert' : ''}`}>
      <div className="absolute top-2 left-2 z-10">
        <div className="flex items-center gap-2 bg-black/60 text-white px-3 py-1 rounded-md text-sm">
          <span className="font-medium">{camera.name}</span>
          {camera.location && (
            <span className="text-white/60">• {camera.location}</span>
          )}
        </div>
      </div>

      <div className="absolute top-2 right-2 z-10">
        <div
          className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs ${
            isConnected ? 'bg-green-500/80 text-white' : 'bg-red-500/80 text-white'
          }`}
        >
          {isConnected ? (
            <>
              <Video className="w-3 h-3" />
              <span>Live</span>
            </>
          ) : (
            <>
              <VideoOff className="w-3 h-3" />
              <span>Offline</span>
            </>
          )}
        </div>
      </div>

      {isAlert && lastDetection && (
        <div className="absolute inset-0 z-20 bg-red-500/20 flex items-center justify-center">
          <div className="bg-red-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 shadow-lg">
            <AlertTriangle className="w-5 h-5 animate-pulse" />
            <div>
              <div className="font-bold">Alert Detected!</div>
              <div className="text-sm">
                {lastDetection.detections.map((d) => d.behaviors.join(', ')).join('; ')}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="relative w-full h-full bg-gray-900 flex items-center justify-center overflow-hidden">
        {snapshotSrc ? (
          <>
            <img
              src={snapshotSrc}
              alt={camera.name}
              className={`w-full h-full object-cover ${previewError ? 'opacity-0 absolute' : ''}`}
              onLoad={() => setPreviewError(false)}
              onError={() => setPreviewError(true)}
            />
            {previewError && (
              <div className="text-white/50 flex flex-col items-center px-4 text-center">
                <Video className="w-12 h-12 mb-2 opacity-60" />
                <span className="text-sm">Waiting for video frames…</span>
                <span className="text-xs text-white/35 mt-1 max-w-[200px] truncate" title={sourceLabel}>
                  {sourceLabel}
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="text-white/40 flex flex-col items-center px-4 text-center">
            <Video className="w-12 h-12 mb-2" />
            <span className="text-sm">Start stream to see live preview</span>
            <span className="text-xs text-white/30 mt-1">{sourceLabel}</span>
          </div>
        )}
      </div>
    </div>
  )
}
