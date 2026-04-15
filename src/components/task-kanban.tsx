'use client'

import { useState, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import TaskCard from '@/components/task-card'
import { TASK_STATUS_CONFIG } from '@/lib/constants'
import type { Task, TaskStatus } from '@/lib/supabase/types'
import { getDeadlineSortValue } from '@/components/deadline-countdown'

interface TaskKanbanProps {
  tasks: Task[]
  columns: readonly string[]
  onStatusChange: (taskId: string, newStatus: TaskStatus) => Promise<void>
  showEditor?: boolean
}

function KanbanColumn({
  status,
  tasks,
  showEditor,
}: {
  status: string
  tasks: Task[]
  showEditor: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const config = TASK_STATUS_CONFIG[status as keyof typeof TASK_STATUS_CONFIG]
  const color = `var(--${config.color})`

  // Sort: overdue first, then by deadline
  const sortedTasks = [...tasks].sort((a, b) => {
    return getDeadlineSortValue(a.deadline) - getDeadlineSortValue(b.deadline)
  })

  return (
    <div
      ref={setNodeRef}
      className="flex-1 min-w-[260px] max-w-[320px]"
    >
      {/* Column Header */}
      <div
        className="flex items-center gap-2 mb-3 px-1"
      >
        <div
          className="w-2 h-2 rounded-full"
          style={{ background: color }}
        />
        <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-2)' }}>
          {config.label}
        </h3>
        <span
          className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
          style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
        >
          {tasks.length}
        </span>
      </div>

      {/* Cards */}
      <div
        className={`space-y-2 min-h-[100px] p-2 rounded-lg transition-colors ${isOver ? 'ring-1' : ''}`}
        style={{
          background: isOver ? 'var(--surface-2)' : 'var(--surface)',
          borderColor: isOver ? color : 'transparent',
          border: `1px solid ${isOver ? color + '40' : 'var(--border)'}`,
        }}
      >
        <SortableContext items={sortedTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {sortedTasks.map((task) => (
            <TaskCard key={task.id} task={task} showEditor={showEditor} />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <div className="flex items-center justify-center h-20 text-xs" style={{ color: 'var(--text-3)' }}>
            No tasks
          </div>
        )}
      </div>
    </div>
  )
}

export default function TaskKanban({ tasks, columns, onStatusChange, showEditor = false }: TaskKanbanProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const task = tasks.find(t => t.id === event.active.id)
    setActiveTask(task || null)
  }, [tasks])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveTask(null)

    if (!over) return

    const taskId = active.id as string
    const task = tasks.find(t => t.id === taskId)
    if (!task) return

    // Determine the target column (status)
    let targetStatus: string | null = null

    // Check if dropped on a column directly
    if (columns.includes(over.id as string)) {
      targetStatus = over.id as string
    } else {
      // Dropped on another task — find which column that task is in
      const overTask = tasks.find(t => t.id === over.id)
      if (overTask) {
        targetStatus = overTask.status
      }
    }

    if (targetStatus && targetStatus !== task.status) {
      await onStatusChange(taskId, targetStatus as TaskStatus)
    }
  }, [tasks, columns, onStatusChange])

  // Group tasks by status
  const tasksByStatus = columns.reduce((acc, col) => {
    acc[col] = tasks.filter(t => t.status === col)
    return acc
  }, {} as Record<string, Task[]>)

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((col) => (
          <KanbanColumn
            key={col}
            status={col}
            tasks={tasksByStatus[col] || []}
            showEditor={showEditor}
          />
        ))}
      </div>

      <DragOverlay>
        {activeTask && (
          <div className="w-[280px]">
            <TaskCard task={activeTask} isDragging showEditor={showEditor} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
