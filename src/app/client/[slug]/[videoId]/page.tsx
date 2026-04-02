'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowLeft, Send, MessageSquare, Clock } from 'lucide-react'
import ClientNav from '@/components/client-nav'
import { useClientAuth } from '@/hooks/use-client-auth'
import { getPortalBySlug, CLIENT_STATUS_LABELS } from '@/lib/client-portal'
import { CONTENT_TYPE_CONFIG } from '@/lib/constants'
import { createClient } from '@/lib/supabase/client'
import { getGoogleDriveEmbedUrl } from '@/lib/utils/google-drive'
import { formatDateTime } from '@/lib/utils/date'

interface ClientSubmission {
  id: string
  title: string
  status: string
  content_type: string
  created_at: string
  description: string | null
  external_url: string | null
}

interface ClientFeedback {
  id: string
  author_name: string
  note: string
  created_at: string
}

export default function ClientVideoDetailPage() {
  const params = useParams()
  const slug = params.slug as string
  const videoId = params.videoId as string
  const config = getPortalBySlug(slug)

  const { isAuthenticated, clientName, logout } = useClientAuth(slug)

  const [submission, setSubmission] = useState<ClientSubmission | null>(null)
  const [feedback, setFeedback] = useState<ClientFeedback[]>([])
  const [newFeedback, setNewFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)

  const supabase = createClient()

  const loadData = useCallback(async () => {
    if (!config) return
    setLoading(true)

    // Look up client_id
    const { data: clientData } = await supabase
      .from('clients')
      .select('id')
      .eq('name', config.clientName)
      .single()

    if (!clientData) {
      setLoading(false)
      return
    }

    // Load submission (only safe fields, verify it belongs to this client)
    const { data: subData } = await supabase
      .from('qc_submissions')
      .select('id, title, status, content_type, created_at, description, external_url')
      .eq('id', videoId)
      .eq('client_id', clientData.id)
      .single()

    if (subData) setSubmission(subData)

    // Load client feedback only
    const { data: feedbackData } = await supabase
      .from('qc_notes')
      .select('id, author_name, note, created_at')
      .eq('submission_id', videoId)
      .eq('category', 'client_feedback')
      .order('created_at', { ascending: false })

    if (feedbackData) setFeedback(feedbackData)
    setLoading(false)
  }, [config, videoId, supabase])

  useEffect(() => {
    if (isAuthenticated && config) loadData()
  }, [isAuthenticated, config, loadData])

  // Not found or not authenticated
  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>Portal not found</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="text-center">
          <p className="text-sm mb-4" style={{ color: 'var(--text-3)' }}>Please sign in first</p>
          <Link href={`/client/${slug}`} className="btn-primary text-sm">Go to Login</Link>
        </div>
      </div>
    )
  }

  const handleSubmitFeedback = async () => {
    if (!newFeedback.trim() || !clientName) return
    setSubmitting(true)

    await supabase.from('qc_notes').insert({
      submission_id: videoId,
      author_name: clientName,
      note: newFeedback.trim(),
      category: 'client_feedback',
      is_resolved: false,
    })

    setNewFeedback('')
    await loadData()
    setSubmitting(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
        <ClientNav displayName={config.displayName} clientName={clientName} onLogout={logout} />
        <div className="max-w-5xl mx-auto px-4 py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-48 rounded" style={{ background: 'var(--surface-2)' }} />
            <div className="h-96 rounded-xl" style={{ background: 'var(--surface-2)' }} />
          </div>
        </div>
      </div>
    )
  }

  if (!submission) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
        <ClientNav displayName={config.displayName} clientName={clientName} onLogout={logout} />
        <div className="max-w-5xl mx-auto px-4 py-8 text-center">
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>Video not found</p>
          <Link href={`/client/${slug}`} className="btn-primary text-sm mt-4 inline-block">Back to Dashboard</Link>
        </div>
      </div>
    )
  }

  const statusInfo = CLIENT_STATUS_LABELS[submission.status] || { label: submission.status, color: 'blue' }
  const contentType = CONTENT_TYPE_CONFIG[submission.content_type as keyof typeof CONTENT_TYPE_CONFIG]
  const embedUrl = submission.external_url ? getGoogleDriveEmbedUrl(submission.external_url) : null

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <ClientNav displayName={config.displayName} clientName={clientName} onLogout={logout} />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back link */}
        <Link
          href={`/client/${slug}`}
          className="inline-flex items-center gap-1.5 text-xs mb-6 transition-colors"
          style={{ color: 'var(--text-3)' }}
        >
          <ArrowLeft size={14} />
          Back to Dashboard
        </Link>

        {/* Title + badges */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text)' }}>
            {submission.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`badge badge-${statusInfo.color}`}>{statusInfo.label}</span>
            {contentType && (
              <span className={`badge badge-${contentType.color}`}>{contentType.label}</span>
            )}
          </div>
        </div>

        {/* Video player */}
        {embedUrl ? (
          <div className="mb-8 rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
              <iframe
                src={embedUrl}
                className="absolute inset-0 w-full h-full"
                allow="autoplay; encrypted-media"
                allowFullScreen
              />
            </div>
          </div>
        ) : submission.external_url ? (
          <div className="card p-6 mb-8 text-center">
            <p className="text-sm mb-3" style={{ color: 'var(--text-3)' }}>Video cannot be embedded directly.</p>
            <a
              href={submission.external_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary text-sm"
            >
              Open in Google Drive
            </a>
          </div>
        ) : null}

        {/* Description */}
        {submission.description && (
          <div className="card p-4 mb-8">
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>
              Description
            </h3>
            <p className="text-sm" style={{ color: 'var(--text-2)' }}>{submission.description}</p>
          </div>
        )}

        {/* Feedback section */}
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-4">
            <MessageSquare size={16} style={{ color: 'var(--gold)' }} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Your Feedback</h3>
            {feedback.length > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>
                {feedback.length}
              </span>
            )}
          </div>

          {/* New feedback input */}
          <div className="mb-6">
            <textarea
              value={newFeedback}
              onChange={(e) => setNewFeedback(e.target.value)}
              className="input w-full"
              placeholder="Leave feedback for the editing team..."
              rows={3}
              style={{ resize: 'vertical' }}
            />
            <div className="flex justify-end mt-2">
              <button
                onClick={handleSubmitFeedback}
                disabled={!newFeedback.trim() || submitting}
                className="btn-primary text-xs flex items-center gap-1.5"
              >
                <Send size={12} />
                {submitting ? 'Sending...' : 'Send Feedback'}
              </button>
            </div>
          </div>

          {/* Feedback list */}
          {feedback.length === 0 ? (
            <p className="text-xs text-center py-4" style={{ color: 'var(--text-3)' }}>
              No feedback yet. Leave a note above to share your thoughts with the editing team.
            </p>
          ) : (
            <div className="space-y-3">
              {feedback.map((fb, i) => (
                <motion.div
                  key={fb.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="rounded-lg p-3"
                  style={{ background: 'var(--surface-2)', borderLeft: '3px solid var(--gold)' }}
                >
                  <p className="text-sm mb-1.5" style={{ color: 'var(--text)' }}>{fb.note}</p>
                  <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-3)' }}>
                    <span>{fb.author_name}</span>
                    <span>&middot;</span>
                    <span className="flex items-center gap-1">
                      <Clock size={10} />
                      {formatDateTime(fb.created_at)}
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
