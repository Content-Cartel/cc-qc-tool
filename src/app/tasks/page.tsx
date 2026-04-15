'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { ListTodo, RefreshCw } from 'lucide-react'
import Nav from '@/components/nav'
import TaskKanban from '@/components/task-kanban'
import { useAuth } from '@/hooks/use-supabase-auth'
import { createClient } from '@/lib/supabase/client'
import { EDITOR_KANBAN_COLUMNS } from '@/lib/constants'
import type { Task, TaskStatus } from '@/lib/supabase/types'

export default function EditorTasksPage() {
  const supabase = createClient()
  const { userId, user, loading: authLoading } = useAuth()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  const loadTasks = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    const { data } = await supabase
      .from('tasks')
      .select('*, clients(name)')
      .eq('editor_id', userId)
      .in('status', ['queued', 'in_progress', 'in_review', 'revision_needed'])
      .order('deadline', { ascending: true })

    if (data) {
      setTasks(data.map((t: Record<string, unknown>) => ({
        ...t,
        client_name: (t as unknown as { clients?: { name: string } }).clients?.name || 'Unknown',
      })) as Task[])
    }
    setLoading(false)
  }, [supabase, userId])

  useEffect(() => {
    if (!authLoading && userId) {
      loadTasks()

      // Realtime subscription
      const channel = supabase
        .channel('editor-tasks')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `editor_id=eq.${userId}` }, () => {
          loadTasks()
        })
        .subscribe()

      return () => { supabase.removeChannel(channel) }
    }
  }, [supabase, userId, authLoading, loadTasks])

  const handleStatusChange = useCallback(async (taskId: string, newStatus: TaskStatus) => {
    // Optimistic update
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t))

    const { error } = await supabase
      .from('tasks')
      .update({ status: newStatus })
      .eq('id', taskId)

    if (error) {
      // Revert on error
      loadTasks()
      return
    }

    // Log activity
    await supabase.from('task_activity_log').insert({
      task_id: taskId,
      actor_id: userId,
      action: 'status_change',
      new_value: newStatus,
    })

    // Slack notifications (fire-and-forget)
    if (newStatus === 'in_review') {
      fetch('/api/tasks/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'submitted_for_review', task_id: taskId }),
      }).catch(() => {})
    }
  }, [supabase, userId, loadTasks])

  const activeTasks = tasks.filter(t => t.status !== 'approved')
  const overdueCount = tasks.filter(t => new Date(t.deadline) < new Date() && t.status !== 'approved').length

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <Nav />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>
                My Tasks
              </h1>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                {activeTasks.length} active tasks
                {overdueCount > 0 && (
                  <span style={{ color: 'var(--red)' }}> · {overdueCount} overdue</span>
                )}
              </p>
            </div>
            <button onClick={loadTasks} className="btn-ghost text-xs flex items-center gap-1.5">
              <RefreshCw size={12} />
              Refresh
            </button>
          </div>

          {/* Loading */}
          {(loading || authLoading) ? (
            <div className="flex gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex-1 min-w-[260px]">
                  <div className="h-6 w-24 mb-3 rounded animate-shimmer" />
                  <div className="space-y-2">
                    <div className="card p-3 h-32 animate-shimmer" />
                    <div className="card p-3 h-24 animate-shimmer" />
                  </div>
                </div>
              ))}
            </div>
          ) : tasks.length === 0 ? (
            <div className="text-center py-16">
              <ListTodo size={32} className="mx-auto mb-3" style={{ color: 'var(--text-3)' }} />
              <h2 className="text-sm font-medium mb-1" style={{ color: 'var(--text-2)' }}>No tasks assigned</h2>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>Tasks will appear here when assigned by the PM.</p>
            </div>
          ) : (
            <TaskKanban
              tasks={tasks}
              columns={EDITOR_KANBAN_COLUMNS}
              onStatusChange={handleStatusChange}
            />
          )}
        </motion.div>
      </main>
    </div>
  )
}
