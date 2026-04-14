'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown, Check, Loader2 } from 'lucide-react'

export type BrowserVideoLabel = { index: number; label: string }

type CameraDevicePickerProps = {
  /** OpenCV indices reported by the Python backend */
  indices: number[]
  value: string
  onChange: (deviceIndex: string) => void
  disabled?: boolean
  loading?: boolean
  /** Friendly names from the browser (same machine); paired by index when possible */
  browserLabels: BrowserVideoLabel[]
  browserLabelsLoading?: boolean
}

function labelForIndex(
  idx: number,
  browserLabels: BrowserVideoLabel[]
): { title: string; subtitle: string } {
  const match = browserLabels.find((b) => b.index === idx)
  const name = match?.label?.trim()
  if (name && name.length > 0) {
    return {
      title: name,
      subtitle: `Backend index ${idx}`,
    }
  }
  if (idx === 0) {
    return {
      title: 'Default camera',
      subtitle: 'Usually built-in webcam · index 0',
    }
  }
  return {
    title: `Camera ${idx}`,
    subtitle: 'Often USB or external · verify in preview',
  }
}

export function CameraDevicePicker({
  indices,
  value,
  onChange,
  disabled,
  loading,
  browserLabels,
  browserLabelsLoading,
}: CameraDevicePickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  const selectedIdx = Number.parseInt(value, 10)
  const selectedMeta = Number.isFinite(selectedIdx)
    ? labelForIndex(selectedIdx, browserLabels)
    : { title: 'Select camera', subtitle: '' }

  const busy = disabled || loading

  return (
    <div ref={rootRef} className="relative w-full max-w-md space-y-2">
      <button
        type="button"
        id="camera-device"
        disabled={busy}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !busy && indices.length > 0 && setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-zinc-900/90 px-4 py-3 text-left text-white shadow-inner transition-colors hover:border-white/20 focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <div className="min-w-0 flex-1">
          {loading ? (
            <span className="flex items-center gap-2 text-gray-400">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              Scanning devices on server…
            </span>
          ) : indices.length === 0 ? (
            <div>
              <div className="truncate font-medium text-amber-200/90">
                No devices reported by backend
              </div>
              <div className="truncate text-xs text-gray-500">
                Set index below or reconnect the camera — using index {value}
              </div>
            </div>
          ) : (
            <div>
              <div className="truncate font-medium">{selectedMeta.title}</div>
              {selectedMeta.subtitle && (
                <div className="truncate text-xs text-gray-500">{selectedMeta.subtitle}</div>
              )}
              {browserLabelsLoading && (
                <div className="mt-1 text-xs text-gray-600">Loading friendly names…</div>
              )}
            </div>
          )}
        </div>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''} ${indices.length === 0 ? 'opacity-30' : ''}`}
        />
      </button>

      {!loading && indices.length === 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-zinc-900/60 px-4 py-2">
          <label htmlFor="camera-index-fallback" className="text-sm text-gray-400 shrink-0">
            Index
          </label>
          <input
            id="camera-index-fallback"
            type="number"
            min={0}
            max={31}
            value={value}
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') {
                onChange('0')
                return
              }
              const n = Number.parseInt(raw, 10)
              if (!Number.isFinite(n) || n < 0 || n > 31) return
              onChange(String(n))
            }}
            className="w-24 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        </div>
      )}

      {open && !busy && indices.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-50 mt-2 max-h-64 w-full overflow-auto rounded-xl border border-white/10 bg-zinc-950 py-1 shadow-xl ring-1 ring-black/40"
        >
          {indices.map((idx) => {
            const { title, subtitle } = labelForIndex(idx, browserLabels)
            const isSel = String(idx) === value
            return (
              <li key={idx} role="option" aria-selected={isSel}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(String(idx))
                    close()
                  }}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
                    isSel
                      ? 'bg-blue-600/25 text-white'
                      : 'text-gray-200 hover:bg-white/10'
                  }`}
                >
                  <span className="mt-0.5 shrink-0 text-blue-400">
                    {isSel ? <Check className="h-4 w-4" /> : <span className="inline-block h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{title}</span>
                    <span className="block truncate text-xs text-gray-500">{subtitle}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
