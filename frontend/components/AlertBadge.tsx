'use client'

import { AlertTriangle, Eye, Users } from 'lucide-react'

interface AlertBadgeProps {
  type: 'looking_sideways' | 'proximity_cheating' | 'talking' | 'left_seat' | 'gaze_deviation'
  count: number
  lastSeen?: string
}

const behaviorConfig: Record<string, { label: string; icon: typeof Eye; color: string }> = {
  looking_sideways: {
    label: 'Looking Sideways',
    icon: Eye,
    color: 'bg-orange-500',
  },
  proximity_cheating: {
    label: 'Proximity Alert',
    icon: Users,
    color: 'bg-red-500',
  },
  talking: {
    label: 'Talking Detected',
    icon: AlertTriangle,
    color: 'bg-yellow-500',
  },
  left_seat: {
    label: 'Left Seat',
    icon: Users,
    color: 'bg-gray-500',
  },
  gaze_deviation: {
    label: 'Gaze Deviation',
    icon: Eye,
    color: 'bg-purple-500',
  },
}

export function AlertBadge({ type, count, lastSeen }: AlertBadgeProps) {
  const config = behaviorConfig[type] || behaviorConfig.looking_sideways
  const Icon = config.icon

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${config.color} text-white`}>
      <Icon className="w-4 h-4" />
      <div className="flex-1">
        <div className="text-sm font-medium">{config.label}</div>
        <div className="text-xs opacity-80">
          {count} incident{count !== 1 ? 's' : ''}
          {lastSeen && ` • ${lastSeen}`}
        </div>
      </div>
    </div>
  )
}

interface AlertPanelProps {
  alerts: Array<{ type: AlertBadgeProps['type']; count: number; lastSeen?: string }>
}

export function AlertPanel({ alerts }: AlertPanelProps) {
  return (
    <div className="bg-white rounded-drushti-lg border border-drushti-outline/50 p-4 shadow-sm">
      <h3 className="text-lg font-semibold text-drushti-on mb-3 flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-red-600" />
        Active Alerts
      </h3>
      {alerts.length === 0 ? (
        <div className="text-drushti-muted text-sm py-4 text-center">
          No active alerts
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert, index) => (
            <AlertBadge key={index} {...alert} />
          ))}
        </div>
      )}
    </div>
  )
}