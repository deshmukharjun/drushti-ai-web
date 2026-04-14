'use client'

import { useState, useEffect, useCallback } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { settingsApi } from '@/lib/client'
import { DetectionSettings } from '@/lib/api'
import { Settings as SettingsIcon, Save, RotateCcw, Loader2, CheckCircle } from 'lucide-react'

interface SliderConfig {
  key: keyof DetectionSettings
  label: string
  description: string
  min: number
  max: number
  step: number
  unit: string
}

const sliders: SliderConfig[] = [
  {
    key: 'yaw_threshold',
    label: 'Head Yaw Threshold',
    description: 'Head turn angle (degrees) to flag as looking sideways',
    min: 5,
    max: 45,
    step: 1,
    unit: '°',
  },
  {
    key: 'look_duration',
    label: 'Look Duration',
    description: 'How long someone must look away before triggering alert',
    min: 0.1,
    max: 5.0,
    step: 0.1,
    unit: 's',
  },
  {
    key: 'proximity_pix',
    label: 'Proximity Distance',
    description: 'Pixel distance threshold for proximity alerts',
    min: 50,
    max: 500,
    step: 10,
    unit: 'px',
  },
  {
    key: 'proximity_duration',
    label: 'Proximity Duration',
    description: 'How long two people must be close before alert',
    min: 0.5,
    max: 10.0,
    step: 0.5,
    unit: 's',
  },
  {
    key: 'frame_skip',
    label: 'Frame Skip',
    description: 'Process every Nth frame (higher = faster, less accurate)',
    min: 1,
    max: 30,
    step: 1,
    unit: 'frames',
  },
  {
    key: 'confidence_threshold',
    label: 'Detection Confidence',
    description: 'Minimum YOLO confidence threshold for person detection',
    min: 0.1,
    max: 0.9,
    step: 0.05,
    unit: '',
  },
  {
    key: 'gaze_threshold',
    label: 'Gaze Deviation Threshold',
    description: 'Normalized eye gaze deviation to considered suspicious',
    min: 0.1,
    max: 0.8,
    step: 0.05,
    unit: '',
  },
]

export default function SettingsPage() {
  const [settings, setSettings] = useState<DetectionSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [originalSettings, setOriginalSettings] = useState<DetectionSettings | null>(null)

  const fetchSettings = useCallback(async () => {
    try {
      const data = await settingsApi.get()
      setSettings(data)
      setOriginalSettings(data)
    } catch (err) {
      console.error('Failed to fetch settings:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const handleChange = (key: keyof DetectionSettings, value: number) => {
    if (!settings) return
    setSettings({ ...settings, [key]: value })
    setSaved(false)
  }

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const updated = await settingsApi.update(settings)
      setSettings(updated)
      setOriginalSettings(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      console.error('Failed to save settings:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    if (originalSettings) {
      setSettings({ ...originalSettings })
      setSaved(false)
    }
  }

  const hasChanges =
    settings && originalSettings && JSON.stringify(settings) !== JSON.stringify(originalSettings)

  return (
    <div className="flex min-h-screen bg-drushti-surface-muted">
      <Sidebar />

      <main className="flex-1 ml-64 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-drushti-on">Settings</h1>
            <p className="text-drushti-muted mt-1">Configure detection thresholds and parameters</p>
          </div>
          <div className="flex items-center gap-3">
            {hasChanges && (
              <button
                onClick={handleReset}
                className="flex items-center gap-2 px-4 py-2 text-drushti-muted hover:text-drushti-on transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Reset
              </button>
            )}
            <button
              id="save-settings-btn"
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className="flex items-center gap-2 px-5 py-2.5 bg-drushti-navy text-white rounded-drushti-lg hover:opacity-90 transition-opacity font-medium disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : saved ? (
                <CheckCircle className="w-4 h-4" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {saved ? 'Saved!' : 'Save Changes'}
            </button>
          </div>
        </div>

        {/* Settings Grid */}
        {loading || !settings ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 rounded-xl skeleton" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {sliders.map((config) => (
              <div
                key={config.key}
                className="bg-white border border-drushti-outline/50 rounded-drushti-lg p-5 shadow-sm hover:border-drushti-outline transition-all"
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-drushti-on font-medium">{config.label}</h3>
                    <p className="text-drushti-muted text-sm">{config.description}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-bold text-drushti-navy">
                      {typeof settings[config.key] === 'number'
                        ? Number(settings[config.key]).toFixed(
                            config.step < 1 ? (config.step < 0.1 ? 2 : 1) : 0
                          )
                        : settings[config.key]}
                    </span>
                    <span className="text-drushti-muted text-sm ml-1">{config.unit}</span>
                  </div>
                </div>
                <input
                  type="range"
                  min={config.min}
                  max={config.max}
                  step={config.step}
                  value={settings[config.key]}
                  onChange={(e) => handleChange(config.key, parseFloat(e.target.value))}
                  className="w-full h-2 rounded-full appearance-none cursor-pointer
                    bg-drushti-surface-muted
                    [&::-webkit-slider-thumb]:appearance-none
                    [&::-webkit-slider-thumb]:w-5
                    [&::-webkit-slider-thumb]:h-5
                    [&::-webkit-slider-thumb]:rounded-full
                    [&::-webkit-slider-thumb]:bg-drushti-navy
                    [&::-webkit-slider-thumb]:shadow-md
                    [&::-webkit-slider-thumb]:cursor-pointer
                    [&::-webkit-slider-thumb]:transition-all
                    [&::-webkit-slider-thumb]:hover:scale-110
                  "
                />
                <div className="flex justify-between text-xs text-drushti-hint mt-1">
                  <span>
                    {config.min}
                    {config.unit}
                  </span>
                  <span>
                    {config.max}
                    {config.unit}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
