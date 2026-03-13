'use client'

import { getStatusColor, getStatusLabel } from '@/lib/ai/scoring'
import { CONTENT_TYPE_CONFIG } from '@/lib/constants'

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${getStatusColor(status)}`}>
      {getStatusLabel(status)}
    </span>
  )
}

export function ContentTypeBadge({ type }: { type: string }) {
  const config = CONTENT_TYPE_CONFIG[type as keyof typeof CONTENT_TYPE_CONFIG]
  if (!config) return <span className="badge badge-neutral">{type}</span>
  return (
    <span className={`badge badge-${config.color}`}>
      {config.label}
    </span>
  )
}
