'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Dna, ExternalLink, RefreshCw, Sparkles, Check, Clock, FileText, Loader2, X, Copy, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import Nav from '@/components/nav'
import { createClient } from '@/lib/supabase/client'

interface ClientRow {
  id: number
  name: string
  phase: string
  dna_doc_url: string | null
  prompt_version: number
  prompt_generated_at: string | null
  has_transcripts: boolean
  transcript_count: number
}

export default function DNADashboardPage() {
  const supabase = createClient()
  const [clients, setClients] = useState<ClientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [generatingFor, setGeneratingFor] = useState<number | null>(null)
  const [showPromptModal, setShowPromptModal] = useState(false)
  const [promptContent, setPromptContent] = useState('')
  const [promptClientName, setPromptClientName] = useState('')
  const [promptStreaming, setPromptStreaming] = useState(false)

  const loadClients = useCallback(async () => {
    setLoading(true)

    const [{ data: clientData }, { data: settings }, { data: prompts }, { data: transcripts }] = await Promise.all([
      supabase.from('clients').select('id, name, phase').in('phase', ['production', 'active', 'onboarding', 'special']).order('name'),
      supabase.from('client_settings').select('client_id, dna_doc_url'),
      supabase.from('client_prompts').select('client_id, version, created_at').eq('prompt_type', 'content_generation').order('version', { ascending: false }),
      supabase.from('client_transcripts').select('client_id').not('relevance_tag', 'in', '("onboarding","strategy")'),
    ])

    if (!clientData) { setLoading(false); return }

    const settingsMap: Record<number, string> = {}
    for (const s of (settings || [])) {
      settingsMap[s.client_id] = s.dna_doc_url || ''
    }

    // Latest prompt per client
    const promptMap: Record<number, { version: number; created_at: string }> = {}
    for (const p of (prompts || [])) {
      if (!promptMap[p.client_id]) {
        promptMap[p.client_id] = { version: p.version, created_at: p.created_at }
      }
    }

    // Transcript counts per client (content only)
    const transcriptCounts: Record<number, number> = {}
    for (const t of (transcripts || [])) {
      transcriptCounts[t.client_id] = (transcriptCounts[t.client_id] || 0) + 1
    }

    setClients(clientData.map(c => ({
      ...c,
      dna_doc_url: settingsMap[c.id] || null,
      prompt_version: promptMap[c.id]?.version || 0,
      prompt_generated_at: promptMap[c.id]?.created_at || null,
      has_transcripts: (transcriptCounts[c.id] || 0) > 0,
      transcript_count: transcriptCounts[c.id] || 0,
    })))
    setLoading(false)
  }, [supabase])

  useEffect(() => { loadClients() }, [loadClients])

  async function handleGeneratePrompt(clientId: number, clientName: string) {
    setGeneratingFor(clientId)
    setShowPromptModal(true)
    setPromptStreaming(true)
    setPromptContent('')
    setPromptClientName(clientName)

    try {
      const res = await fetch('/api/content/generate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `Server error (${res.status})` }))
        setPromptContent(`Error: ${err.error || 'Generation failed'}`)
        setPromptStreaming(false)
        setGeneratingFor(null)
        return
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      let buffer = ''
      let lastProgress = ''

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const segments = buffer.split('\n\n')
          buffer = segments.pop() || ''

          for (const segment of segments) {
            if (segment.startsWith('data: ')) {
              try {
                const event = JSON.parse(segment.slice(6))
                if (event.type === 'text') {
                  accumulated += event.content
                  setPromptContent(accumulated)
                } else if (event.type === 'progress') {
                  lastProgress = event.message as string
                  if (!accumulated) {
                    setPromptContent(lastProgress)
                  }
                } else if (event.type === 'error') {
                  setPromptContent(`Error: ${event.message || 'Generation failed'}`)
                } else if (event.type === 'done') {
                  if (event.content) {
                    setPromptContent(event.content as string)
                  }
                }
              } catch { /* skip */ }
            }
          }
        }
      }
    } catch {
      setPromptContent('Error generating prompt. Please try again.')
    } finally {
      setPromptStreaming(false)
      setGeneratingFor(null)
      loadClients()
    }
  }

  async function handleViewPrompt(clientId: number, clientName: string) {
    setShowPromptModal(true)
    setPromptClientName(clientName)
    setPromptContent('Loading...')
    setPromptStreaming(false)

    const { data } = await supabase
      .from('client_prompts')
      .select('system_prompt')
      .eq('client_id', clientId)
      .eq('prompt_type', 'content_generation')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()

    setPromptContent(data?.system_prompt || 'No prompt found.')
  }

  const withPrompt = clients.filter(c => c.prompt_version > 0)
  const withoutPrompt = clients.filter(c => c.prompt_version === 0)

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <Nav />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text)' }}>
              <Dna size={20} style={{ color: 'var(--gold)' }} />
              Client DNA & Prompts
            </h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
              DNA docs (manual) + master prompts (auto-generated from transcripts)
            </p>
          </div>
          <button onClick={loadClients} className="btn-ghost text-xs flex items-center gap-1.5">
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>

        {/* Stats */}
        {!loading && clients.length > 0 && (
          <div className="grid grid-cols-4 gap-3 mb-6">
            <div className="card p-3 text-center">
              <p className="text-2xl font-bold" style={{ color: 'var(--text)' }}>{clients.length}</p>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Clients</p>
            </div>
            <div className="card p-3 text-center">
              <p className="text-2xl font-bold" style={{ color: 'var(--green)' }}>{withPrompt.length}</p>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Have Prompts</p>
            </div>
            <div className="card p-3 text-center">
              <p className="text-2xl font-bold" style={{ color: 'var(--blue)' }}>{clients.filter(c => c.dna_doc_url && c.dna_doc_url.includes('docs.google.com')).length}</p>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>DNA Docs</p>
            </div>
            <div className="card p-3 text-center">
              <p className="text-2xl font-bold" style={{ color: 'var(--amber)' }}>{clients.filter(c => c.has_transcripts).length}</p>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Have Transcripts</p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="card p-4 animate-shimmer h-32" />
            ))}
          </div>
        ) : (
          <>
            {/* Needs Prompt */}
            {withoutPrompt.length > 0 && (
              <div className="mb-6">
                <h2 className="text-xs font-medium uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                  <AlertCircle size={12} style={{ color: 'var(--amber)' }} />
                  Needs Prompt ({withoutPrompt.length})
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {withoutPrompt.map((client, i) => (
                    <motion.div key={client.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                      <div className="card p-4" style={{ borderColor: 'rgba(245, 158, 11, 0.3)' }}>
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{client.name}</span>
                          <span className="badge badge-neutral text-[10px]">{client.phase}</span>
                        </div>
                        <button
                          onClick={() => handleGeneratePrompt(client.id, client.name)}
                          disabled={generatingFor === client.id}
                          className="w-full flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-lg transition-all"
                          style={{ background: 'rgba(212, 168, 67, 0.1)', color: 'var(--gold)', border: '1px solid rgba(212, 168, 67, 0.3)' }}
                        >
                          {generatingFor === client.id ? (
                            <><Loader2 size={12} className="animate-spin" /> Generating...</>
                          ) : (
                            <><Sparkles size={12} /> Generate Prompt</>
                          )}
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* Has Prompt */}
            {withPrompt.length > 0 && (
              <div>
                <h2 className="text-xs font-medium uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                  <Check size={12} style={{ color: 'var(--green)' }} />
                  Active ({withPrompt.length})
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {withPrompt.map((client, i) => (
                    <motion.div key={client.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                      <div className="card-glow p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{client.name}</span>
                          <span className="badge badge-green text-[10px]">Prompt v{client.prompt_version}</span>
                        </div>

                        {/* Status indicators */}
                        <div className="space-y-1.5 mb-3">
                          {/* DNA Doc */}
                          <div className="flex items-center justify-between">
                            <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>DNA Doc</span>
                            <div className="flex items-center gap-2">
                              {client.dna_doc_url && client.dna_doc_url.includes('docs.google.com') ? (
                                <a href={client.dna_doc_url} target="_blank" rel="noopener noreferrer"
                                  className="text-[10px] flex items-center gap-1 font-medium" style={{ color: 'var(--blue)' }}>
                                  <ExternalLink size={9} /> Open Doc
                                </a>
                              ) : (
                                <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>Not linked</span>
                              )}
                            </div>
                          </div>

                          {/* Transcripts */}
                          <div className="flex items-center justify-between">
                            <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>YouTube Transcripts</span>
                            <span className="text-[10px] font-medium" style={{ color: client.has_transcripts ? 'var(--green)' : 'var(--text-3)' }}>
                              {client.transcript_count > 0 ? `${client.transcript_count} videos` : 'None'}
                            </span>
                          </div>

                          {/* Prompt age */}
                          {client.prompt_generated_at && (
                            <div className="flex items-center justify-between">
                              <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>Prompt Generated</span>
                              <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                                <Clock size={9} className="inline mr-0.5" />
                                {new Date(client.prompt_generated_at).toLocaleDateString()}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleViewPrompt(client.id, client.name)}
                            className="flex items-center gap-1 text-xs font-medium"
                            style={{ color: 'var(--gold)' }}
                          >
                            <FileText size={11} />
                            View Prompt
                          </button>
                          <button
                            onClick={() => handleGeneratePrompt(client.id, client.name)}
                            disabled={generatingFor === client.id}
                            className="flex items-center gap-1 text-xs font-medium"
                            style={{ color: 'var(--text-3)' }}
                          >
                            {generatingFor === client.id ? (
                              <><Loader2 size={11} className="animate-spin" /> Generating...</>
                            ) : (
                              <><RefreshCw size={11} /> Regenerate</>
                            )}
                          </button>
                          <Link
                            href={`/dna/${client.id}`}
                            className="flex items-center gap-1 text-xs font-medium ml-auto"
                            style={{ color: 'var(--text-3)' }}
                          >
                            <Dna size={11} />
                            Old DNA
                          </Link>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Prompt Modal */}
      {showPromptModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={(e) => { if (e.target === e.currentTarget && !promptStreaming) setShowPromptModal(false) }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="card p-6 w-full max-w-3xl max-h-[90vh] flex flex-col"
            style={{ boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles size={16} style={{ color: 'var(--gold)' }} />
                <h3 className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                  {promptClientName} — Master Prompt
                </h3>
              </div>
              {!promptStreaming && (
                <button onClick={() => setShowPromptModal(false)} className="p-1 rounded hover:bg-[var(--surface-2)]">
                  <X size={14} style={{ color: 'var(--text-3)' }} />
                </button>
              )}
            </div>

            {promptStreaming && (
              <div className="flex items-center gap-2 mb-3">
                <Loader2 size={14} className="animate-spin" style={{ color: 'var(--gold)' }} />
                <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Generating with Claude Opus...</p>
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto mb-4">
              <pre className="text-xs leading-relaxed whitespace-pre-wrap rounded-lg p-4"
                style={{ color: 'var(--text-2)', background: 'var(--surface-2)', minHeight: '300px' }}>
                {promptContent || 'Loading...'}
              </pre>
            </div>

            {!promptStreaming && promptContent && promptContent !== 'Loading...' && (
              <div className="flex items-center justify-between">
                <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                  {promptContent.length.toLocaleString()} characters
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => navigator.clipboard.writeText(promptContent)}
                    className="btn-ghost text-xs flex items-center gap-1.5"
                  >
                    <Copy size={12} /> Copy
                  </button>
                  <button onClick={() => setShowPromptModal(false)} className="btn-primary text-xs">Done</button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </div>
  )
}
