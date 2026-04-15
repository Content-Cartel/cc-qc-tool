'use client'

import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, ChevronDown, ChevronUp, FileText, ExternalLink } from 'lucide-react'
import DeadlineCountdown from '@/components/deadline-countdown'
import { TASK_PRIORITY_CONFIG, TASK_CONTENT_TYPE_CONFIG } from '@/lib/constants'
import type { Task, TaskPriority, TaskContentType } from '@/lib/supabase/types'

interface TaskCardProps {
  task: Task
  isDragging?: boolean
  showEditor?: boolean
}

export default function TaskCard({ task, isDragging = false, showEditor = false }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.5 : 1,
  }

  const priorityConfig = TASK_PRIORITY_CONFIG[task.priority as TaskPriority]
  const contentTypeConfig = TASK_CONTENT_TYPE_CONFIG[task.content_type as TaskContentType]

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`card p-3 ${isDragging ? 'shadow-lg ring-1' : ''}`}
    >
      {/* Drag Handle + Header */}
      <div className="flex items-start gap-2">
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 p-0.5 rounded cursor-grab active:cursor-grabbing hover:bg-[var(--surface-2)] transition-colors flex-shrink-0"
        >
          <GripVertical size={14} style={{ color: 'var(--text-3)' }} />
        </button>
        <div className="flex-1 min-w-0">
          {/* Title */}
          <h3 className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>
            {task.title}
          </h3>

          {/* Meta row */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {/* Client */}
            <span className="badge badge-gold text-[10px]">
              {task.client_name || task.clients?.name || 'Unknown'}
            </span>
            {/* Content Type */}
            <span className={`badge badge-${contentTypeConfig.color} text-[10px]`}>
              {contentTypeConfig.label}
            </span>
            {/* Priority (only if not normal) */}
            {task.priority !== 'normal' && (
              <span className={`badge badge-${priorityConfig.color} text-[10px]`}>
                {priorityConfig.label}
              </span>
            )}
            {/* Editor (in PM view) */}
            {showEditor && task.editor_name && (
              <span className="badge badge-neutral text-[10px]">
                {task.editor_name}
              </span>
            )}
          </div>

          {/* Deadline */}
          <div className="mt-2">
            <DeadlineCountdown deadline={task.deadline} compact />
          </div>

          {/* Source file link */}
          {task.source_file_url && (
            <a
              href={task.source_file_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-2 text-[11px] hover:underline"
              style={{ color: 'var(--blue)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink size={10} />
              Source file
            </a>
          )}

          {/* Editing Instructions (expandable) */}
          {task.editing_instructions && (
            <div className="mt-2">
              <button
                onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
                className="flex items-center gap-1 text-[11px] font-medium transition-colors"
                style={{ color: 'var(--text-3)' }}
              >
                <FileText size={10} />
                Editing Instructions
                {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              </button>
              {expanded && (
                <div
                  className="mt-1.5 p-2.5 rounded-md text-xs leading-relaxed whitespace-pre-wrap"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
                >
                  {task.editing_instructions}
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          {task.notes && !expanded && (
            <p className="mt-1.5 text-[11px] truncate" style={{ color: 'var(--text-3)' }}>
              {task.notes}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
