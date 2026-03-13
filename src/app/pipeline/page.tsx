'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { RefreshCw, ArrowRight } from 'lucide-react'
import Nav from '@/components/nav'
import { StatusBadge, ContentTypeBadge } from '@/components/status-badge'
import { PIPELINE_STAGES } from '@/lib/constants'
import type { PipelineStageKey } from '@/lib/constants'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { timeAgo } from '@/lib/utils/date'
import type { QCSubmission } from '@/lib/supabase/types'

export default function PipelinePage() {
  const supabase = createClient()
  const { isPM } = useAuth()
  const [submissions, setSubmissions] = useState<QCSubmission[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('qc_submissions')
      .select('*, clients(name)')
      .order('created_at', { ascending: false })

    if (data) {
      setSubmissions(data.map((s: Record<string, unknown>) => ({
        ...s,
        client_name: (s as unknown as { clients?: { name: string } }).clients?.name || 'Unknown',
      })) as QCSubmission[])
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    load()

    const channel = supabase
      .channel('pipeline-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qc_submissions' }, () => load())
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [supabase, load])

  async function handleAdvance(submissionId: string, nextStage: PipelineStageKey) {
    await supabase
      .from('qc_submissions')
      .update({ current_pipeline_stage: nextStage })
      .eq('id', submissionId)

    try {
      await supabase.from('pipeline_stages').insert({
        submission_id: submissionId,
        stage: nextStage,
        entered_at: new Date().toISOString(),
      })
    } catch {
      // pipeline_stages table may not exist yet
    }

    await load()
  }

  const columns = PIPELINE_STAGES.map(stage => ({
    ...stage,
    items: submissions.filter(s => s.current_pipeline_stage === stage.key),
  }))

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <Nav />
      <main className="max-w-full mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>Pipeline Board</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              {submissions.length} submissions across {PIPELINE_STAGES.length} stages
            </p>
          </div>
          <button onClick={load} className="btn-secondary text-xs flex items-center gap-1.5">
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>

        {/* Kanban board */}
        {loading ? (
          <div className="flex gap-3 overflow-x-auto pb-4">
            {PIPELINE_STAGES.map(stage => (
              <div key={stage.key} className="flex-shrink-0 w-64">
                <div className="card p-3 animate-shimmer h-10 mb-3" />
                <div className="space-y-2">
                  <div className="card p-4 animate-shimmer h-24" />
                  <div className="card p-4 animate-shimmer h-24" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: 'calc(100vh - 160px)' }}>
            {columns.map((col, colIdx) => {
              const nextStage = colIdx < PIPELINE_STAGES.length - 1 ? PIPELINE_STAGES[colIdx + 1] : null

              return (
                <div key={col.key} className="flex-shrink-0 w-64">
                  {/* Column header */}
                  <div
                    className="px-3 py-2.5 rounded-lg mb-3 flex items-center justify-between"
                    style={{
                      background: col.items.length > 0 ? 'var(--surface-2)' : 'var(--surface)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
                        {col.label}
                      </span>
                      {col.items.length > 0 && (
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ background: 'var(--gold)', color: '#000' }}
                        >
                          {col.items.length}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                      {col.sla}
                    </span>
                  </div>

                  {/* Column cards */}
                  <div className="space-y-2">
                    {col.items.length === 0 && (
                      <div
                        className="p-4 rounded-lg text-center border border-dashed"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}
                      >
                        <span className="text-xs">Empty</span>
                      </div>
                    )}

                    {col.items.map((item, i) => (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                      >
                        <Link href={`/review/${item.id}`}>
                          <div
                            className="p-3 rounded-lg transition-all duration-100 group cursor-pointer"
                            style={{
                              background: 'var(--surface)',
                              border: '1px solid var(--border)',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.borderColor = 'var(--border-2)'
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.borderColor = 'var(--border)'
                            }}
                          >
                            <h4 className="text-xs font-semibold truncate" style={{ color: 'var(--text)' }}>
                              {item.title}
                            </h4>
                            <p className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
                              {item.client_name} &middot; {item.submitted_by_name}
                            </p>

                            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                              <StatusBadge status={item.status} />
                              <ContentTypeBadge type={item.content_type} />
                            </div>

                            <div className="flex items-center justify-between mt-2">
                              <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                                {timeAgo(item.created_at)}
                              </span>

                              {/* Advance button (PM only) */}
                              {isPM && nextStage && (
                                <button
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    handleAdvance(item.id, nextStage.key as PipelineStageKey)
                                  }}
                                  className="text-[10px] flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded"
                                  style={{ background: 'var(--surface-2)', color: 'var(--gold)' }}
                                  title={`Move to ${nextStage.label}`}
                                >
                                  <ArrowRight size={10} />
                                  {nextStage.label}
                                </button>
                              )}
                            </div>
                          </div>
                        </Link>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
