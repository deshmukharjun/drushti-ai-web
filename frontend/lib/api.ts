// API types for Drushti AI — Anti-Cheat Environment

export interface Camera {
  id: string
  name: string
  stream_url: string
  location: string
  is_active: boolean
  status: 'disconnected' | 'connecting' | 'active' | 'error'
  created_at: string
}

export interface Incident {
  id?: string
  camera_id: string
  behaviors: string[]
  confidence: number
  snapshot_url?: string
  detected_at: string
}

export interface DetectionResult {
  cheating_detected: boolean
  behaviors: string[]
  confidence: number
  face_detected: boolean
  timestamp: string
  track_id?: number
  yaw?: number
  pitch?: number
  roll?: number
  snapshot_path?: string
}

export interface StreamResult {
  camera_id: string
  timestamp: string
  detections: DetectionResult[]
  error?: string
}

export interface DetectionSettings {
  yaw_threshold: number
  look_duration: number
  proximity_pix: number
  proximity_duration: number
  frame_skip: number
  confidence_threshold: number
  gaze_threshold: number
}

export interface CameraStatus {
  id: string
  name: string
  status: string
  is_active: boolean
}

/** True if stream_url is a numeric OpenCV device index (local webcam). */
export function isLocalCaptureDevice(streamUrl: string): boolean {
  return /^\d+$/.test(streamUrl.trim())
}