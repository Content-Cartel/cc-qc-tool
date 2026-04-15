'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { CheckCircle, Upload } from 'lucide-react'
import Nav from '@/components/nav'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-supabase-auth'
import type { ContentType } from '@/lib/supabase/types'
import { notifyAgent } from '@/lib/notify-agent'

interface ClientOption {
  id: number
  name: string
  phase: string
}

export default function SubmitPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
        <Nav />
        <main className="max-w-lg mx-auto px-4 py-8">
          <div className="card p-6 animate-shimmer h-96" />
        </main>
      </div>
    }>
      <SubmitForm />
    </Suspense>
  )
}

function SubmitForm() {
  const supabase = createClient()
  const { user, userId, isPM } = useAuth()
  const searchParams = useSearchParams()
  const revisionOf = searchParams.get('revision_of')

  const [clients, setClients] = useState<ClientOption[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  const [clientId, setClientId] = useState<number | ''>('')
  const [contentType, setContentType] = useState<ContentType>('lf_video')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [externalUrl, setExternalUrl] = useState('')
  const [error, setError] = useState('')

  const loadClients = useCallback(async () => {
    if (isPM) {
      // PM/Admin see all active clients
      const { data } = await supabase
        .from('clients')
        .select('id, name, phase')
        .in('phase', ['production', 'active', 'onboarding'])
        .order('name')
      setClients(data || [])
    } else if (userId) {
      // Editors only see clients assigned to them
      const { data: assignments } = await supabase
        .from('editor_assignments')
        .select('client_id, clients(id, name, phase)')
        .eq('editor_id', userId)

      if (assignments) {
        const assignedClients = assignments
          .map((a: Record<string, unknown>) => (a as unknown as { clients: ClientOption }).clients)
          .filter(Boolean)
          .sort((a: ClientOption, b: ClientOption) => a.name.localeCompare(b.name))
        setClients(assignedClients)
      }
    }
  }, [supabase, isPM, userId])

  // If resubmitting, load original submission data
  useEffect(() => {
    loadClients()
    if (revisionOf) {
      supabase.from('qc_submissions').select('*').eq('id', revisionOf).single().then(({ data }) => {
        if (data) {
          setClientId(data.client_id)
          setContentType(data.content_type)
          setTitle(`${data.title} (Revised)`)
          setDescription(data.description || '')
        }
      })
    }
  }, [loadClients, supabase, revisionOf])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      const userName = user || 'Unknown'

      if (!clientId) { setError('Please select a client'); setSubmitting(false); return }
      if (!externalUrl.trim()) { setError('Please provide a Google Drive link'); setSubmitting(false); return }

      const payload: Record<string, unknown> = {
        submitted_by_name: userName,
        client_id: clientId,
        content_type: contentType,
        title: title.trim(),
        description: description.trim() || null,
        external_url: externalUrl.trim(),
        status: revisionOf ? 'resubmitted' : 'pending',
        current_pipeline_stage: 'editor_polish',
      }

      if (revisionOf) {
        payload.revision_of = revisionOf
      }

      const { error: insertError } = await supabase.from('qc_submissions').insert(payload)

      if (insertError) { setError(`Submission failed: ${insertError.message}`); setSubmitting(false); return }

      // Notify the AI agent about new submission
      if (clientId) {
        notifyAgent({
          event: 'qc_ready',
          client_id: clientId as number,
          submission_id: 'new',
          file_name: title.trim(),
          uploader: userName,
          content_type: contentType,
        })
      }

      // If resubmission, update original's revision count
      if (revisionOf) {
        try {
          await supabase.rpc('increment_revision_count', { submission_id: revisionOf })
        } catch {
          // RPC may not exist yet, non-critical
        }
      }

      setSuccess(true)
      setTitle('')
      setDescription('')
      setExternalUrl('')
      setClientId('')
      setTimeout(() => setSuccess(false), 3000)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }

    setSubmitting(false)
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <Nav />
      <main className="max-w-lg mx-auto px-4 py-8">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--text)' }}>
            {revisionOf ? 'Resubmit for QC' : 'Submit Video for QC'}
          </h1>
          <p className="text-xs mb-6" style={{ color: 'var(--text-3)' }}>
            {revisionOf ? 'Upload your revised video for re-review' : 'Submit your completed edit for quality check'}
          </p>

          {success && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 rounded-lg flex items-center gap-3"
              style={{ background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.25)' }}
            >
              <CheckCircle size={18} style={{ color: 'var(--green)' }} />
              <span className="text-sm font-medium" style={{ color: 'var(--green)' }}>
                Submitted successfully!
              </span>
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="card p-6 space-y-5">
            <div>
              <label className="label">Client</label>
              <select
                value={clientId}
                onChange={(e) => setClientId(Number(e.target.value))}
                className="input"
                required
              >
                <option value="">Select a client...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Video Type</label>
              <select
                value={contentType}
                onChange={(e) => setContentType(e.target.value as ContentType)}
                className="input"
              >
                <option value="lf_video">Long-Form Video</option>
                <option value="sf_video">Short-Form Video</option>
              </select>
            </div>

            <div>
              <label className="label">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input"
                placeholder="e.g., Episode 42 Final Edit"
                required
              />
            </div>

            <div>
              <label className="label">Description (optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="input"
                rows={3}
                placeholder="Any notes about this submission..."
              />
            </div>

            <div>
              <label className="label">Google Drive Link</label>
              <input
                type="url"
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
                className="input"
                placeholder="https://drive.google.com/file/d/..."
                required
              />
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                Paste the Google Drive share link to your video file.
              </p>
            </div>

            {error && (
              <p className="text-sm" style={{ color: 'var(--red)' }}>{error}</p>
            )}

            <button type="submit" disabled={submitting} className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
              <Upload size={14} />
              {submitting ? 'Submitting...' : (revisionOf ? 'Resubmit for QC' : 'Submit for QC')}
            </button>
          </form>
        </motion.div>
      </main>
    </div>
  )
}
