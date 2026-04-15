'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Plus, RefreshCw, Users, Clock, CheckCircle, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import Nav from '@/components/nav'
import TaskKanban from '@/components/task-kanban'
import TaskCreateModal from '@/components/task-create-modal'
import StatCard from '@/components/stat-card'
import { useAuth } from '@/hooks/use-supabase-auth'
import { createClient } from '@/lib/supabase/client'
import { PM_KANBAN_COLUMNS } from '@/lib/constants'
import type { Task, TaskStatus } from '@/lib/supabase/types'

interface EditorGroup {
  editorId: string | null
  editorName: string
  tasks: Task[]
  overdueCount: number
}

export default function PMTasksPage() {
  const supabase = createClient()
  const { userId, isPM, loading: authLoading } = useAuth()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [expandedEditors, setExpandedEditors] = useState<Set<string>>(new Set())

  const loadTasks = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('tasks')
      .select('*, clients(name), profiles!tasks_editor_id_fkey(display_name)')
      .order('deadline', { ascending: true })

    if (data) {
      setTasks(data.map((t: Record<string, unknown>) => ({
        ...t,
        client_name: (t as unknown as { clients?: { name: string } }).clients?.name || 'Unknown',
        editor_name: (t as unknown as { profiles?: { display_name: string } }).profiles?.display_name || null,
      })) as Task[])
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    if (!authLoading) {
      loadTasks()

      const channel = supabase
        .channel('pm-tasks')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
          loadTasks()
        })
        .subscribe()

      return () => { supabase.removeChannel(channel) }
    }
  }, [supabase, authLoading, loadTasks])

  const handleStatusChange = useCallback(async (taskId: string, newStatus: TaskStatus) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t))

    const updatePayload: Record<string, unknown> = { status: newStatus }
    if (newStatus === 'approved') {
      updatePayload.completed_at = new Date().toISOString()
    }

    const { error } = await supabase
      .from('tasks')
      .update(updatePayload)
      .eq('id', taskId)

    if (error) {
      loadTasks()
      return
    }

    await supabase.from('task_activity_log').insert({
      task_id: taskId,
      actor_id: userId,
      action: 'status_change',
      new_value: newStatus,
    })

    // Slack notifications (fire-and-forget)
    if (newStatus === 'revision_needed') {
      fetch('/api/tasks/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'revision_requested', task_id: taskId }),
      }).catch(() => {})
    }
  }, [supabase, userId, loadTasks])

  const toggleEditor = (key: string) => {
    setExpandedEditors(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Stats
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const totalActive = tasks.filter(t => t.status !== 'approved').length
  const overdueCount = tasks.filter(t => new Date(t.deadline) < now && !['approved', 'in_review'].includes(t.status)).length
  const completedToday = tasks.filter(t => t.status === 'approved' && t.completed_at && new Date(t.completed_at) >= today).length

  // Group by editor for swimlanes
  const editorGroups: EditorGroup[] = (() => {
    const map = new Map<string, EditorGroup>()

    for (const task of tasks.filter(t => t.status !== 'approved')) {
      const key = task.editor_id || '__unassigned__'
      const name = task.editor_name || 'Unassigned'
      if (!map.has(key)) {
        map.set(key, { editorId: task.editor_id, editorName: name, tasks: [], overdueCount: 0 })
      }
      const group = map.get(key)!
      group.tasks.push(task)
      if (new Date(task.deadline) < now && !['approved', 'in_review'].includes(task.status)) {
        group.overdueCount++
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      // Unassigned at bottom
      if (!a.editorId) return 1
      if (!b.editorId) return -1
      return a.editorName.localeCompare(b.editorName)
    })
  })()

  // Auto-expand all editors on first load
  useEffect(() => {
    if (editorGroups.length > 0 && expandedEditors.size === 0) {
      setExpandedEditors(new Set(editorGroups.map(g => g.editorId || '__unassigned__')))
    }
  }, [editorGroups.length]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <Nav />
      <main className="max-w-[1400px] mx-auto px-4 py-6">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>Task Management</h1>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                Assign and track editing tasks across all editors
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={loadTasks} className="btn-ghost text-xs flex items-center gap-1.5">
                <RefreshCw size={12} />
                Refresh
              </button>
              <button onClick={() => setShowCreateModal(true)} className="btn-primary text-xs flex items-center gap-1.5">
                <Plus size={12} />
                New Task
              </button>
            </div>
          </div>

          {/* Stats Bar */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <StatCard
              label="Active Tasks"
              value={totalActive}
              icon={<Users size={16} />}
              color="blue"
            />
            <StatCard
              label="Overdue"
              value={overdueCount}
              icon={<AlertTriangle size={16} />}
              color={overdueCount > 0 ? 'red' : 'green'}
            />
            <StatCard
              label="Completed Today"
              value={completedToday}
              icon={<CheckCircle size={16} />}
              color="green"
            />
          </div>

          {/* Loading */}
          {(loading || authLoading) ? (
            <div className="space-y-4">
              {[1, 2].map(i => (
                <div key={i} className="card p-4 animate-shimmer h-48" />
              ))}
            </div>
          ) : editorGroups.length === 0 ? (
            <div className="text-center py-16 card">
              <Users size={32} className="mx-auto mb-3" style={{ color: 'var(--text-3)' }} />
              <h2 className="text-sm font-medium mb-1" style={{ color: 'var(--text-2)' }}>No active tasks</h2>
              <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>Create a task to get started.</p>
              <button onClick={() => setShowCreateModal(true)} className="btn-primary text-xs">
                <Plus size={12} className="inline mr-1" />
                Create Task
              </button>
            </div>
          ) : (
            /* Swimlanes per editor */
            <div className="space-y-4">
              {editorGroups.map((group) => {
                const key = group.editorId || '__unassigned__'
                const isExpanded = expandedEditors.has(key)

                return (
                  <div key={key} className="card overflow-hidden">
                    {/* Swimlane Header */}
                    <button
                      onClick={() => toggleEditor(key)}
                      className="w-full flex items-center justify-between p-4 hover:bg-[var(--surface-2)] transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                          style={{ background: group.editorId ? 'var(--blue)' : 'var(--text-3)', color: '#fff' }}
                        >
                          {group.editorName.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                          {group.editorName}
                        </span>
                        <span className="badge badge-neutral text-[10px]">{group.tasks.length} tasks</span>
                        {group.overdueCount > 0 && (
                          <span className="badge badge-red text-[10px]">{group.overdueCount} overdue</span>
                        )}
                      </div>
                    </button>

                    {/* Kanban (collapsed/expanded) */}
                    {isExpanded && (
                      <div className="px-4 pb-4">
                        <TaskKanban
                          tasks={group.tasks}
                          columns={PM_KANBAN_COLUMNS}
                          onStatusChange={handleStatusChange}
                          showEditor={false}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </motion.div>
      </main>

      {/* Create Task Modal */}
      {userId && (
        <TaskCreateModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onCreated={loadTasks}
          creatorId={userId}
        />
      )}
    </div>
  )
}
