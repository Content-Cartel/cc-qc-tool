'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Dna, Plus, Check, Clock, AlertCircle, ExternalLink, RefreshCw, X } from 'lucide-react'
import Link from 'next/link'
import Nav from '@/components/nav'
import { createClient } from '@/lib/supabase/client'
import type { ClientDNA } from '@/lib/dna/types'

interface ClientWithDNA {
  id: number
  name: string
  phase: string
  latestDna: ClientDNA | null
}

export default function DNADashboardPage() {
  const supabase = createClient()
  const [clients, setClients] = useState<ClientWithDNA[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [selectedClient, setSelectedClient] = useState<{ id: number; name: string } | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Form fields
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [context, setContext] = useState('')
  const [transcript, setTranscript] = useState('')

  const loadClients = useCallback(async () => {
    setLoading(true)

    // Load clients
    const { data: clientData } = await supabase
      .from('clients')
      .select('id, name, phase')
      .in('phase', ['production', 'active', 'onboarding'])
      .order('name')

    if (!clientData) {
      setLoading(false)
      return
    }

    // Load latest DNA for each client
    const { data: dnaData } = await supabase
      .from('client_dna')
      .select('*')
      .order('version', { ascending: false })

    // Map: keep only latest version per client
    const dnaByClient = new Map<number, ClientDNA>()
    if (dnaData) {
      for (const dna of dnaData) {
        if (!dnaByClient.has(dna.client_id)) {
          dnaByClient.set(dna.client_id, dna as ClientDNA)
        }
      }
    }

    setClients(clientData.map(c => ({
      ...c,
      latestDna: dnaByClient.get(c.id) || null,
    })))
    setLoading(false)
  }, [supabase])

  useEffect(() => { loadClients() }, [loadClients])

  function openGenerateModal(client: { id: number; name: string }, existingDna?: ClientDNA | null) {
    setSelectedClient(client)
    setWebsiteUrl(existingDna?.website_url || '')
    setYoutubeUrl(existingDna?.youtube_url || '')
    setContext(existingDna?.context || '')
    setTranscript('')
    setError('')
    setSuccess('')
    setShowModal(true)
  }

  async function handleGenerate() {
    if (!selectedClient) return
    if (!websiteUrl && !youtubeUrl && !context && !transcript) {
      setError('Provide at least one data source')
      return
    }

    setGenerating(true)
    setError('')
    setSuccess('')

    try {
      const res = await fetch('/api/dna/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: selectedClient.id,
          client_name: selectedClient.name,
          website_url: websiteUrl || undefined,
          youtube_url: youtubeUrl || undefined,
          context: context || undefined,
          transcript: transcript || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Generation failed')
        setGenerating(false)
        return
      }

      setSuccess('DNA profile generated successfully!')
      setGenerating(false)
      await loadClients()

      // Auto-close after success
      setTimeout(() => {
        setShowModal(false)
        setSuccess('')
      }, 1500)
    } catch {
      setError('Network error — try again')
      setGenerating(false)
    }
  }

  const withDna = clients.filter(c => c.latestDna)
  const withoutDna = clients.filter(c => !c.latestDna)

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <Nav />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text)' }}>
              <Dna size={20} style={{ color: 'var(--gold)' }} />
              Client DNA Profiles
            </h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
              Generate and manage brand DNA for each client
            </p>
          </div>
          <button
            onClick={loadClients}
            className="btn-ghost text-xs flex items-center gap-1.5"
          >
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="card p-4 animate-shimmer h-32" />
            ))}
          </div>
        ) : (
          <>
            {/* Clients without DNA */}
            {withoutDna.length > 0 && (
              <div className="mb-6">
                <h2 className="text-xs font-medium uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                  <AlertCircle size={12} style={{ color: 'var(--amber)' }} />
                  Needs DNA ({withoutDna.length})
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {withoutDna.map((client, i) => (
                    <motion.div
                      key={client.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                    >
                      <div
                        className="card p-4 cursor-pointer"
                        onClick={() => openGenerateModal(client)}
                        style={{ borderColor: 'rgba(245, 158, 11, 0.3)' }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                            {client.name}
                          </span>
                          <span className="badge badge-neutral text-[10px]">{client.phase}</span>
                        </div>
                        <button className="flex items-center gap-1.5 text-xs font-medium mt-2" style={{ color: 'var(--gold)' }}>
                          <Plus size={12} />
                          Generate DNA
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* Clients with DNA */}
            {withDna.length > 0 && (
              <div>
                <h2 className="text-xs font-medium uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                  <Check size={12} style={{ color: 'var(--green)' }} />
                  DNA Generated ({withDna.length})
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {withDna.map((client, i) => (
                    <motion.div
                      key={client.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                    >
                      <div className="card-glow p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                            {client.name}
                          </span>
                          <span className="badge badge-green text-[10px]">v{client.latestDna!.version}</span>
                        </div>
                        <div className="text-[10px] mb-3" style={{ color: 'var(--text-3)' }}>
                          <Clock size={10} className="inline mr-1" />
                          {new Date(client.latestDna!.created_at).toLocaleDateString()}
                        </div>
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/dna/${client.id}`}
                            className="flex items-center gap-1 text-xs font-medium"
                            style={{ color: 'var(--gold)' }}
                          >
                            <ExternalLink size={11} />
                            View
                          </Link>
                          <button
                            onClick={() => openGenerateModal(client, client.latestDna)}
                            className="flex items-center gap-1 text-xs font-medium"
                            style={{ color: 'var(--text-3)' }}
                          >
                            <RefreshCw size={11} />
                            Regenerate
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {clients.length === 0 && (
              <div className="card p-8 text-center">
                <Dna size={32} className="mx-auto mb-3" style={{ color: 'var(--text-3)' }} />
                <p className="text-sm" style={{ color: 'var(--text-2)' }}>No clients found</p>
              </div>
            )}
          </>
        )}
      </main>

      {/* Generate Modal */}
      {showModal && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="card p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold flex items-center gap-2" style={{ color: 'var(--text)' }}>
                <Dna size={16} style={{ color: 'var(--gold)' }} />
                Generate DNA — {selectedClient.name}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-[var(--surface-2)]">
                <X size={16} style={{ color: 'var(--text-3)' }} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="label">Website URL</label>
                <input
                  type="url"
                  className="input text-xs"
                  placeholder="https://example.com"
                  value={websiteUrl}
                  onChange={e => setWebsiteUrl(e.target.value)}
                  disabled={generating}
                />
              </div>

              <div>
                <label className="label">YouTube Channel URL</label>
                <input
                  type="url"
                  className="input text-xs"
                  placeholder="https://youtube.com/@channel"
                  value={youtubeUrl}
                  onChange={e => setYoutubeUrl(e.target.value)}
                  disabled={generating}
                />
              </div>

              <div>
                <label className="label">Additional Context</label>
                <textarea
                  className="input text-xs"
                  rows={3}
                  placeholder="Key info about the client — niche, CEO name, target audience, anything editors should know..."
                  value={context}
                  onChange={e => setContext(e.target.value)}
                  disabled={generating}
                />
              </div>

              <div>
                <label className="label">
                  Onboarding Transcript
                  <span className="text-[10px] ml-1 font-normal" style={{ color: 'var(--text-3)' }}>(optional but powerful)</span>
                </label>
                <textarea
                  className="input text-xs"
                  rows={4}
                  placeholder="Paste onboarding call transcript here..."
                  value={transcript}
                  onChange={e => setTranscript(e.target.value)}
                  disabled={generating}
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 text-xs p-3 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)' }}>
                  <AlertCircle size={14} />
                  {error}
                </div>
              )}

              {success && (
                <div className="flex items-center gap-2 text-xs p-3 rounded-lg" style={{ background: 'rgba(34,197,94,0.1)', color: 'var(--green)' }}>
                  <Check size={14} />
                  {success}
                </div>
              )}

              <button
                onClick={handleGenerate}
                disabled={generating}
                className="btn-primary w-full text-sm flex items-center justify-center gap-2"
              >
                {generating ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    Generating DNA... (1-2 min)
                  </>
                ) : (
                  <>
                    <Dna size={14} />
                    Generate DNA Profile
                  </>
                )}
              </button>

              {generating && (
                <p className="text-[10px] text-center" style={{ color: 'var(--text-3)' }}>
                  Scraping website + YouTube, then sending to Claude for analysis. This can take up to 2 minutes.
                </p>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}
