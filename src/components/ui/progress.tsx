'use client'

import clsx from 'clsx'

interface ProgressProps {
  value: number
  max: number
  color?: 'gold' | 'green' | 'red' | 'blue'
  size?: 'sm' | 'md'
  showLabel?: boolean
}

const colorMap = {
  gold: 'bg-[var(--gold)]',
  green: 'bg-[var(--green)]',
  red: 'bg-[var(--red)]',
  blue: 'bg-[var(--blue)]',
}

export function Progress({ value, max, color = 'gold', size = 'sm', showLabel = false }: ProgressProps) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0

  return (
    <div className="flex items-center gap-2 w-full">
      <div className={clsx(
        'flex-1 rounded-full overflow-hidden',
        size === 'sm' ? 'h-1.5' : 'h-2.5',
      )} style={{ background: 'var(--surface-2)' }}>
        <div
          className={clsx('h-full rounded-full transition-all duration-500 ease-out', colorMap[color])}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs font-medium whitespace-nowrap" style={{ color: 'var(--text-2)' }}>
          {value}/{max}
        </span>
      )}
    </div>
  )
}
