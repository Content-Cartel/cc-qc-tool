'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Plus, Clock, RefreshCw } from 'lucide-react'
import Nav from '@/components/nav'
import { StatusBadge, ContentTypeBadge } from '@/components/status-badge'
import { PipelineStageLabel } from '@/components/pipeline-tracker'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-supabase-auth'
import { timeAgo } from '@/lib/utils/date'
import type { PipelineStageKey } from '@/lib/constants'
import type { QCSubmission } from '@/lib/supabase/types'

export default function MySubmissionsPage() {
  const supabase = createClient()
  const { user } = useAuth()
  const [submissions, setSubmissions] = useState<QCSubmission[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data } = await supabase
      .from('qc_submissions')
      .select('*, clients(name)')
      .eq('submitted_by_name', user)
      .order('created_at', { ascending: false })

    if (data) {
      setSubmissions(data.map((s: Record<string, unknown>) => ({
        ...s,
        client_name: (s as unknown as { clients?: { name: string } }).clients?.name || 'Unknown',
      })) as QCSubmission[])
    }
    setLoading(false)
  }, [supabase, user])

  useEffect(() => {
    load()

    const channel = supabase
      .channel('my-submissions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qc_submissions' }, () => load())
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [supabase, load])

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <Nav />
      <main className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>My Submissions</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              {submissions.length} submission{submissions.length !== 1 ? 's' : ''}
            </p>
          </div>
          <Link href="/submit" className="btn-primary text-xs flex items-center gap-1.5">
            <Plus size={14} />
            New Submission
          </Link>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="card p-5 animate-shimmer h-24" />
            ))}
          </div>
        ) : submissions.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card p-12 text-center">
            <p className="text-sm mb-4" style={{ color: 'var(--text-3)' }}>No submissions yet</p>
            <Link href="/submit" className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} />
              Submit Your First Work
            </Link>
          </motion.div>
        ) : (
          <div className="space-y-3">
            {submissions.map((s, i) => (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <Link href={`/review/${s.id}`}>
                  <div className="card-glow p-4 group cursor-pointer">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                          {s.title}
                          {s.revision_of && (
                            <span className="ml-2 text-xs font-normal" style={{ color: 'var(--blue)' }}>
                              (Resubmission)
                            </span>
                          )}
                        </h3>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                          {s.client_name}
                        </p>

                        <div className="flex flex-wrap gap-1.5 mt-2">
                          <StatusBadge status={s.status} />
                          <ContentTypeBadge type={s.content_type} />
                          {s.current_pipeline_stage && (
                            <PipelineStageLabel stage={s.current_pipeline_stage as PipelineStageKey} />
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
                          <Clock size={11} />
                          {timeAgo(s.created_at)}
                        </span>

                        {s.status === 'revision_requested' && (
                          <Link
                            href={`/submit?revision_of=${s.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="btn-danger text-xs px-3 py-1 flex items-center gap-1"
                          >
                            <RefreshCw size={11} />
                            Resubmit
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
