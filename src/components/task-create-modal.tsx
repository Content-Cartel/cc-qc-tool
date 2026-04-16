'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { TaskContentType, TaskPriority } from '@/lib/supabase/types'

interface ClientOption { id: number; name: string }
interface EditorOption { id: string; display_name: string }

interface TaskCreateModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
  creatorId: string
}

export default function TaskCreateModal({ isOpen, onClose, onCreated, creatorId }: TaskCreateModalProps) {
  const supabase = createClient()

  const [clients, setClients] = useState<ClientOption[]>([])
  const [editors, setEditors] = useState<EditorOption[]>([])
  const [autoEditor, setAutoEditor] = useState<EditorOption | null>(null)

  const [clientId, setClientId] = useState<number | ''>('')
  const [title, setTitle] = useState('')
  const [contentType, setContentType] = useState<TaskContentType>('long_form')
  const [priority, setPriority] = useState<TaskPriority>('normal')
  const [deadlineHours, setDeadlineHours] = useState(24)
  const [sourceFileUrl, setSourceFileUrl] = useState('')
  const [editingInstructions, setEditingInstructions] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const loadData = useCallback(async () => {
    const [clientsRes, editorsRes] = await Promise.all([
      supabase.from('clients').select('id, name').in('phase', ['production', 'active', 'onboarding']).order('name'),
      supabase.from('profiles').select('id, display_name').eq('role', 'editor').order('display_name'),
    ])
    setClients((clientsRes.data || []) as ClientOption[])
    setEditors((editorsRes.data || []) as EditorOption[])
  }, [supabase])

  useEffect(() => {
    if (isOpen) loadData()
  }, [isOpen, loadData])

  // Auto-populate editor when client is selected
  useEffect(() => {
    if (!clientId) { setAutoEditor(null); return }
    const findEditor = async () => {
      const { data } = await supabase
        .from('editor_assignments')
        .select('editor_id, profiles!editor_id(id, display_name)')
        .eq('client_id', clientId)
        .limit(1)
      if (data && data.length > 0) {
        const profile = (data[0] as unknown as { profiles: EditorOption }).profiles
        setAutoEditor(profile || null)
      } else {
        setAutoEditor(null)
      }
    }
    findEditor()
  }, [clientId, supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!clientId || !title.trim()) return
    setError('')
    setSubmitting(true)

    try {
      const deadline = new Date(Date.now() + deadlineHours * 60 * 60 * 1000).toISOString()

      const { data: newTask, error: insertError } = await supabase.from('tasks').insert({
        client_id: clientId,
        editor_id: autoEditor?.id || null,
        created_by: creatorId,
        title: title.trim(),
        content_type: contentType,
        priority,
        deadline,
        source_file_url: sourceFileUrl.trim() || null,
        editing_instructions: editingInstructions.trim() || null,
        notes: notes.trim() || null,
        status: 'queued',
      }).select('id').single()

      if (insertError || !newTask) {
        setError(insertError?.message || 'Failed to create task')
        setSubmitting(false)
        return
      }

      // Slack notification (fire-and-forget)
      fetch('/api/tasks/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'task_created', task_id: newTask.id }),
      }).catch(() => {})

      // Reset form
      setClientId('')
      setTitle('')
      setContentType('long_form')
      setPriority('normal')
      setDeadlineHours(24)
      setSourceFileUrl('')
      setEditingInstructions('')
      setNotes('')
      onCreated()
      onClose()
    } catch {
      setError('Something went wrong')
    }
    setSubmitting(false)
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: 'rgba(0, 0, 0, 0.6)' }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            className="card p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto"
            style={{ borderColor: 'var(--border-2)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>
                <Plus size={16} className="inline mr-1.5" style={{ color: 'var(--gold)' }} />
                Create Task
              </h2>
              <button onClick={onClose} className="p-1 rounded hover:bg-[var(--surface-2)]">
                <X size={16} style={{ color: 'var(--text-3)' }} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="label">Client</label>
                  <select
                    value={clientId}
                    onChange={(e) => setClientId(Number(e.target.value))}
                    className="input"
                    required
                  >
                    <option value="">Select client...</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  {autoEditor && (
                    <p className="text-[11px] mt-1" style={{ color: 'var(--green)' }}>
                      Auto-assigned to {autoEditor.display_name}
                    </p>
                  )}
                  {clientId && !autoEditor && (
                    <p className="text-[11px] mt-1" style={{ color: 'var(--amber)' }}>
                      No editor assigned to this client — task will be unassigned
                    </p>
                  )}
                </div>

                <div className="col-span-2">
                  <label className="label">Title</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="input"
                    placeholder="e.g., March Monthly Recap"
                    required
                  />
                </div>

                <div>
                  <label className="label">Content Type</label>
                  <select
                    value={contentType}
                    onChange={(e) => setContentType(e.target.value as TaskContentType)}
                    className="input"
                  >
                    <option value="long_form">Long Form</option>
                    <option value="short_form">Short Form</option>
                  </select>
                </div>

                <div>
                  <label className="label">Priority</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as TaskPriority)}
                    className="input"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="label">Deadline (hours from now)</label>
                  <input
                    type="number"
                    value={deadlineHours}
                    onChange={(e) => setDeadlineHours(Number(e.target.value))}
                    className="input"
                    min={1}
                    max={168}
                  />
                </div>

                <div className="col-span-2">
                  <label className="label">Source File URL (optional)</label>
                  <input
                    type="url"
                    value={sourceFileUrl}
                    onChange={(e) => setSourceFileUrl(e.target.value)}
                    className="input"
                    placeholder="https://drive.google.com/..."
                  />
                </div>

                <div className="col-span-2">
                  <label className="label">Editing Instructions (optional)</label>
                  <textarea
                    value={editingInstructions}
                    onChange={(e) => setEditingInstructions(e.target.value)}
                    className="input"
                    rows={4}
                    placeholder="Pacing notes, cut points, B-roll suggestions, style reference..."
                  />
                </div>

                <div className="col-span-2">
                  <label className="label">Notes (optional)</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="input"
                    rows={2}
                    placeholder="Any additional notes..."
                  />
                </div>
              </div>

              {error && (
                <p className="text-sm" style={{ color: 'var(--red)' }}>{error}</p>
              )}

              <button type="submit" disabled={submitting} className="btn-primary w-full text-sm">
                {submitting ? 'Creating...' : 'Create Task'}
              </button>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
