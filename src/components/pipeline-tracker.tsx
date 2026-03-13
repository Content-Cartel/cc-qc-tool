'use client'

import { PIPELINE_STAGES, type PipelineStageKey } from '@/lib/constants'
import { Film, Sparkles, Scissors, FileText, Pen, CheckSquare, Package, Globe } from 'lucide-react'
import clsx from 'clsx'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const iconMap: Record<string, any> = {
  Film, Sparkles, Scissors, FileText, Pen, CheckSquare, Package, Globe,
}

interface PipelineTrackerProps {
  currentStage: PipelineStageKey
  compact?: boolean
  onAdvance?: (nextStage: PipelineStageKey) => void
}

export default function PipelineTracker({ currentStage, compact = false, onAdvance }: PipelineTrackerProps) {
  const currentIdx = PIPELINE_STAGES.findIndex(s => s.key === currentStage)

  return (
    <div className={clsx('flex items-center', compact ? 'gap-1' : 'gap-0.5')}>
      {PIPELINE_STAGES.map((stage, i) => {
        const Icon = iconMap[stage.icon]
        const isCompleted = i < currentIdx
        const isCurrent = i === currentIdx
        const isFuture = i > currentIdx
        const isNext = i === currentIdx + 1

        return (
          <div key={stage.key} className="flex items-center">
            {/* Stage dot/icon */}
            <div
              onClick={() => isNext && onAdvance ? onAdvance(stage.key) : undefined}
              className={clsx(
                'flex items-center justify-center rounded-full transition-all duration-200',
                compact ? 'w-7 h-7' : 'w-9 h-9',
                isCompleted && 'bg-[var(--gold)]',
                isCurrent && 'bg-[var(--surface-2)] border-2 border-[var(--gold)] animate-pulse-gold',
                isFuture && 'bg-[var(--surface-2)] border border-[var(--border)]',
                isNext && onAdvance && 'cursor-pointer hover:border-[var(--gold)]',
              )}
              title={`${stage.label}${isCurrent ? ' (current)' : isCompleted ? ' (done)' : ''}`}
            >
              {Icon && (
                <Icon
                  size={compact ? 12 : 16}
                  className={clsx(
                    isCompleted && 'text-black',
                    isCurrent && 'text-[var(--gold)]',
                    isFuture && 'text-[var(--text-3)]',
                  )}
                />
              )}
            </div>

            {/* Connector line */}
            {i < PIPELINE_STAGES.length - 1 && (
              <div
                className={clsx(compact ? 'w-2' : 'w-4', 'h-0.5 transition-all duration-200')}
                style={{
                  background: i < currentIdx ? 'var(--gold)' : 'var(--border)',
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function PipelineStageLabel({ stage }: { stage: PipelineStageKey }) {
  const s = PIPELINE_STAGES.find(p => p.key === stage)
  if (!s) return null
  return (
    <span className="badge badge-gold text-xs">
      {s.label}
    </span>
  )
}
