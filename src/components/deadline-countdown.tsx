'use client'

import { useState, useEffect } from 'react'
import { Clock, AlertTriangle } from 'lucide-react'

interface DeadlineCountdownProps {
  deadline: string
  compact?: boolean
}

function getTimeRemaining(deadline: string) {
  const now = new Date().getTime()
  const end = new Date(deadline).getTime()
  const diff = end - now

  if (diff <= 0) {
    const overdueDiff = Math.abs(diff)
    const hours = Math.floor(overdueDiff / (1000 * 60 * 60))
    const mins = Math.floor((overdueDiff % (1000 * 60 * 60)) / (1000 * 60))
    return {
      isOverdue: true,
      hours: 0,
      minutes: 0,
      totalHours: 0,
      label: hours > 0 ? `${hours}h ${mins}m overdue` : `${mins}m overdue`,
    }
  }

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  let label: string
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const remainingHours = hours % 24
    label = `${days}d ${remainingHours}h`
  } else if (hours > 0) {
    label = `${hours}h ${minutes}m`
  } else {
    label = `${minutes}m`
  }

  return {
    isOverdue: false,
    hours,
    minutes,
    totalHours: hours + minutes / 60,
    label,
  }
}

function getDeadlineColor(totalHours: number, isOverdue: boolean): string {
  if (isOverdue) return 'var(--red)'
  if (totalHours < 4) return 'var(--red)'
  if (totalHours < 12) return 'var(--amber)'
  return 'var(--green)'
}

function getDeadlineClass(totalHours: number, isOverdue: boolean): string {
  if (isOverdue) return 'animate-pulse'
  if (totalHours < 4) return ''
  return ''
}

export default function DeadlineCountdown({ deadline, compact = false }: DeadlineCountdownProps) {
  const [remaining, setRemaining] = useState(getTimeRemaining(deadline))

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(getTimeRemaining(deadline))
    }, 30000) // Update every 30 seconds

    return () => clearInterval(interval)
  }, [deadline])

  const color = getDeadlineColor(remaining.totalHours, remaining.isOverdue)
  const animClass = getDeadlineClass(remaining.totalHours, remaining.isOverdue)

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[11px] font-medium ${animClass}`}
        style={{ color }}
      >
        {remaining.isOverdue ? <AlertTriangle size={10} /> : <Clock size={10} />}
        {remaining.label}
      </span>
    )
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${animClass}`}
      style={{
        color,
        background: remaining.isOverdue
          ? 'rgba(239, 68, 68, 0.15)'
          : remaining.totalHours < 4
            ? 'rgba(239, 68, 68, 0.1)'
            : remaining.totalHours < 12
              ? 'rgba(245, 158, 11, 0.1)'
              : 'rgba(34, 197, 94, 0.1)',
        border: `1px solid ${color}25`,
      }}
    >
      {remaining.isOverdue ? <AlertTriangle size={12} /> : <Clock size={12} />}
      {remaining.label}
    </div>
  )
}

// Export for use in sorting
export function getDeadlineSortValue(deadline: string): number {
  const now = new Date().getTime()
  const end = new Date(deadline).getTime()
  const diff = end - now
  // Overdue tasks get negative values (sort to top)
  return diff
}
