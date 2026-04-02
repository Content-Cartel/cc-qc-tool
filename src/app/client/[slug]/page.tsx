'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { Clock, CheckCircle, AlertTriangle, Eye, ArrowRight } from 'lucide-react'
import ClientNav from '@/components/client-nav'
import StatCard from '@/components/stat-card'
import { useClientAuth } from '@/hooks/use-client-auth'
import { getPortalBySlug, CLIENT_STATUS_LABELS } from '@/lib/client-portal'
import { CONTENT_TYPE_CONFIG } from '@/lib/constants'
import { createClient } from '@/lib/supabase/client'
import { timeAgo } from '@/lib/utils/date'

interface ClientSubmission {
  id: string
  title: string
  status: string
  content_type: string
  created_at: string
  description: string | null
}

export default function ClientPortalPage() {
  const params = useParams()
  const slug = params.slug as string
  const config = getPortalBySlug(slug)

  const { isAuthenticated, clientName, login, logout } = useClientAuth(slug)

  // Login form state
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)

  // Dashboard state
  const [submissions, setSubmissions] = useState<ClientSubmission[]>([])
  const [loading, setLoading] = useState(true)

  const supabase = createClient()

  const loadSubmissions = useCallback(async () => {
    if (!config) return
    setLoading(true)

    // Look up client_id by name
    const { data: clientData } = await supabase
      .from('clients')
      .select('id')
      .eq('name', config.clientName)
      .single()

    if (!clientData) {
      setLoading(false)
      return
    }

    const { data } = await supabase
      .from('qc_submissions')
      .select('id, title, status, content_type, created_at, description')
      .eq('client_id', clientData.id)
      .order('created_at', { ascending: false })

    if (data) setSubmissions(data)
    setLoading(false)
  }, [config, supabase])

  useEffect(() => {
    if (isAuthenticated && config) {
      loadSubmissions()

      // Real-time updates
      const channel = supabase
        .channel('client-portal')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'qc_submissions' }, () => {
          loadSubmissions()
        })
        .subscribe()

      return () => { supabase.removeChannel(channel) }
    }
  }, [isAuthenticated, config, loadSubmissions, supabase])

  // Portal not found
  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="text-center">
          <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>Portal Not Found</h1>
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>This client portal does not exist.</p>
        </div>
      </div>
    )
  }

  // Login gate
  if (!isAuthenticated) {
    const handleLogin = (e: React.FormEvent) => {
      e.preventDefault()
      setError('')
      setLoginLoading(true)

      if (!name.trim()) {
        setError('Please enter your name')
        setLoginLoading(false)
        return
      }

      if (password !== config.password) {
        setError('Invalid password')
        setLoginLoading(false)
        return
      }

      login(name.trim())
      setLoginLoading(false)
    }

    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg)' }}>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-sm"
        >
          <div className="card p-8" style={{ borderColor: 'var(--border-2)' }}>
            <div className="text-center mb-8">
              <Image
                src="/cc-logo.png"
                alt="Content Cartel"
                width={48}
                height={48}
                className="rounded-xl mx-auto mb-4"
              />
              <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>{config.displayName}</h1>
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Client Portal — Content Cartel</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="label">Your Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input"
                  placeholder="Enter your name"
                  required
                />
              </div>
              <div>
                <label className="label">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input"
                  placeholder="Enter password"
                  required
                />
              </div>

              {error && (
                <p className="text-sm" style={{ color: 'var(--red)' }}>{error}</p>
              )}

              <button type="submit" disabled={loginLoading} className="btn-primary w-full text-sm">
                {loginLoading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          </div>
        </motion.div>
      </div>
    )
  }

  // Dashboard
  const stats = {
    pending: submissions.filter(s => s.status === 'pending' || s.status === 'resubmitted').length,
    inReview: submissions.filter(s => s.status === 'in_review' || s.status === 'follow_up').length,
    approved: submissions.filter(s => s.status === 'approved').length,
    revisions: submissions.filter(s => s.status === 'revision_requested').length,
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <ClientNav displayName={config.displayName} clientName={clientName} onLogout={logout} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>Content Overview</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
            {submissions.length} total video{submissions.length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <StatCard label="PENDING" value={stats.pending} color="blue" icon={<Clock size={16} />} />
          <StatCard label="IN REVIEW" value={stats.inReview} color="amber" icon={<Eye size={16} />} />
          <StatCard label="APPROVED" value={stats.approved} color="green" icon={<CheckCircle size={16} />} />
          <StatCard label="REVISIONS" value={stats.revisions} color="red" icon={<AlertTriangle size={16} />} />
        </div>

        {/* Video list */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="card p-4 animate-pulse" style={{ height: 120 }} />
            ))}
          </div>
        ) : submissions.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>No videos yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {submissions.map((sub, i) => {
              const statusInfo = CLIENT_STATUS_LABELS[sub.status] || { label: sub.status, color: 'blue' }
              const contentType = CONTENT_TYPE_CONFIG[sub.content_type as keyof typeof CONTENT_TYPE_CONFIG]

              return (
                <motion.div
                  key={sub.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                >
                  <Link href={`/client/${slug}/${sub.id}`}>
                    <div className="card-glow p-4 group cursor-pointer">
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>
                          {sub.title}
                        </h3>
                        <ArrowRight
                          size={14}
                          className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5"
                          style={{ color: 'var(--gold)' }}
                        />
                      </div>

                      <div className="flex flex-wrap gap-1.5 mb-3">
                        <span className={`badge badge-${statusInfo.color}`}>{statusInfo.label}</span>
                        {contentType && (
                          <span className={`badge badge-${contentType.color}`}>{contentType.label}</span>
                        )}
                      </div>

                      <div className="flex items-center justify-end text-xs" style={{ color: 'var(--text-3)' }}>
                        <span className="flex items-center gap-1">
                          <Clock size={11} />
                          {timeAgo(sub.created_at)}
                        </span>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
