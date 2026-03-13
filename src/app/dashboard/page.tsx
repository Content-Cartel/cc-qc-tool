'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { RefreshCw, Clock, CheckCircle, AlertTriangle, Eye } from 'lucide-react'
import Nav from '@/components/nav'
import StatCard from '@/components/stat-card'
import SubmissionCard from '@/components/submission-card'
import { CardSkeleton } from '@/components/ui/skeleton'
import { PIPELINE_STAGES } from '@/lib/constants'
import { createClient } from '@/lib/supabase/client'
import type { QCSubmission } from '@/lib/supabase/types'

type FilterTab = 'needs_review' | 'in_progress' | 'approved' | 'all'

export default function DashboardPage() {
  const supabase = createClient()
  const [submissions, setSubmissions] = useState<QCSubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<FilterTab>('needs_review')
  const [clientFilter, setClientFilter] = useState('all')

  const loadSubmissions = useCallback(async () => {
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
    loadSubmissions()

    const channel = supabase
      .channel('qc-dash')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qc_submissions' }, () => {
        loadSubmissions()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [supabase, loadSubmissions])

  const stats = {
    pending: submissions.filter(s => s.status === 'pending' || s.status === 'resubmitted').length,
    inReview: submissions.filter(s => s.status === 'in_review').length,
    approved: submissions.filter(s => s.status === 'approved').length,
    revisions: submissions.filter(s => s.status === 'revision_requested').length,
  }

  const pipelineCounts = PIPELINE_STAGES.map(stage => ({
    ...stage,
    count: submissions.filter(s => s.current_pipeline_stage === stage.key).length,
  }))

  const tabFiltered = submissions.filter(s => {
    switch (tab) {
      case 'needs_review': return s.status === 'pending' || s.status === 'resubmitted'
      case 'in_progress': return s.status === 'in_review'
      case 'approved': return s.status === 'approved'
      default: return true
    }
  })

  const filtered = clientFilter === 'all' ? tabFiltered : tabFiltered.filter(s => s.client_name === clientFilter)
  const uniqueClients = Array.from(new Set(submissions.map(s => s.client_name || 'Unknown'))).sort()

  const tabs: { key: FilterTab; label: string; count: number }[] = [
    { key: 'needs_review', label: 'Needs Review', count: stats.pending },
    { key: 'in_progress', label: 'In Progress', count: stats.inReview },
    { key: 'approved', label: 'Approved', count: stats.approved },
    { key: 'all', label: 'All', count: submissions.length },
  ]

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <Nav />
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>QC Dashboard</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              {submissions.length} total submissions
            </p>
          </div>
          <button onClick={loadSubmissions} className="btn-secondary text-xs flex items-center gap-1.5">
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard label="Pending QC" value={stats.pending} color="blue" icon={<Clock size={16} />} />
          <StatCard label="In Review" value={stats.inReview} color="amber" icon={<Eye size={16} />} />
          <StatCard label="Approved" value={stats.approved} color="green" icon={<CheckCircle size={16} />} />
          <StatCard label="Revisions" value={stats.revisions} color="red" icon={<AlertTriangle size={16} />} />
        </div>

        {/* Pipeline overview */}
        <div className="card p-4 mb-6">
          <h2 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>
            Pipeline Overview
          </h2>
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {pipelineCounts.map((stage) => (
              <div
                key={stage.key}
                className="flex-shrink-0 flex flex-col items-center gap-1 px-3 py-2 rounded-lg min-w-[80px]"
                style={{ background: stage.count > 0 ? 'var(--surface-2)' : 'transparent' }}
              >
                <span className="text-lg font-bold" style={{ color: stage.count > 0 ? 'var(--gold)' : 'var(--text-3)' }}>
                  {stage.count}
                </span>
                <span className="text-[10px] font-medium text-center" style={{ color: 'var(--text-3)' }}>
                  {stage.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs + filter */}
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ background: 'var(--surface)' }}>
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-100"
                style={{
                  background: tab === t.key ? 'var(--surface-2)' : 'transparent',
                  color: tab === t.key ? 'var(--text)' : 'var(--text-3)',
                }}
              >
                {t.label}
                {t.count > 0 && (
                  <span className="ml-1.5 text-[10px] font-semibold" style={{ color: 'var(--gold)' }}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className="input w-auto text-xs"
            style={{ maxWidth: 180 }}
          >
            <option value="all">All Clients</option>
            {uniqueClients.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {/* Cards grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card p-12 text-center">
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>No submissions found</p>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((s, i) => (
              <SubmissionCard key={s.id} submission={s} index={i} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
