'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Dna, ArrowLeft, Copy, Check, RefreshCw, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import Nav from '@/components/nav'
import { createClient } from '@/lib/supabase/client'
import type { ClientDNA } from '@/lib/dna/types'

export default function DNAViewerPage() {
  const params = useParams()
  const router = useRouter()
  const clientId = Number(params.clientId)
  const supabase = createClient()

  const [clientName, setClientName] = useState('')
  const [versions, setVersions] = useState<ClientDNA[]>([])
  const [selectedVersion, setSelectedVersion] = useState<ClientDNA | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [showVersions, setShowVersions] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)

    const [{ data: client }, { data: dnaData }] = await Promise.all([
      supabase.from('clients').select('name').eq('id', clientId).single(),
      supabase.from('client_dna').select('*').eq('client_id', clientId).order('version', { ascending: false }),
    ])

    if (client) setClientName(client.name)
    if (dnaData && dnaData.length > 0) {
      setVersions(dnaData as ClientDNA[])
      setSelectedVersion(dnaData[0] as ClientDNA)
    }
    setLoading(false)
  }, [supabase, clientId])

  useEffect(() => { load() }, [load])

  function copyMarkdown() {
    if (!selectedVersion) return
    navigator.clipboard.writeText(selectedVersion.dna_markdown)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Simple markdown renderer
  function renderMarkdown(md: string) {
    const lines = md.split('\n')
    const elements: React.ReactNode[] = []
    let listItems: string[] = []

    function flushList() {
      if (listItems.length > 0) {
        elements.push(
          <ul key={`list-${elements.length}`} className="space-y-1 mb-3 ml-4">
            {listItems.map((item, j) => (
              <li key={j} className="text-xs flex items-start gap-1.5" style={{ color: 'var(--text-2)' }}>
                <span className="mt-1.5 w-1 h-1 rounded-full shrink-0" style={{ background: 'var(--gold)' }} />
                <span dangerouslySetInnerHTML={{ __html: inlineFormat(item) }} />
              </li>
            ))}
          </ul>
        )
        listItems = []
      }
    }

    function inlineFormat(text: string): string {
      return text
        .replace(/\*\*(.+?)\*\*/g, '<strong style="color: var(--text)">$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code style="background: var(--surface-2); padding: 1px 4px; border-radius: 3px; font-size: 11px;">$1</code>')
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      if (line.startsWith('# ')) {
        flushList()
        elements.push(
          <h1 key={i} className="text-lg font-bold mb-4 mt-6 pb-2" style={{ color: 'var(--gold)', borderBottom: '1px solid var(--border)' }}>
            {line.slice(2)}
          </h1>
        )
      } else if (line.startsWith('## ')) {
        flushList()
        elements.push(
          <h2 key={i} className="text-base font-bold mb-3 mt-5" style={{ color: 'var(--text)' }}>
            {line.slice(3)}
          </h2>
        )
      } else if (line.startsWith('### ')) {
        flushList()
        elements.push(
          <h3 key={i} className="text-sm font-semibold mb-2 mt-4" style={{ color: 'var(--gold-dim)' }}>
            {line.slice(4)}
          </h3>
        )
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        listItems.push(line.slice(2))
      } else if (line.match(/^\d+\.\s/)) {
        listItems.push(line.replace(/^\d+\.\s/, ''))
      } else if (line.trim() === '') {
        flushList()
      } else {
        flushList()
        elements.push(
          <p key={i} className="text-xs mb-2 leading-relaxed" style={{ color: 'var(--text-2)' }}
             dangerouslySetInnerHTML={{ __html: inlineFormat(line) }} />
        )
      }
    }
    flushList()
    return elements
  }

  if (loading) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
        <Nav />
        <main className="max-w-4xl mx-auto px-4 py-6">
          <div className="card p-8 animate-shimmer h-96" />
        </main>
      </div>
    )
  }

  if (!selectedVersion) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
        <Nav />
        <main className="max-w-4xl mx-auto px-4 py-6">
          <div className="card p-8 text-center">
            <Dna size={32} className="mx-auto mb-3" style={{ color: 'var(--text-3)' }} />
            <p className="text-sm mb-4" style={{ color: 'var(--text-2)' }}>
              No DNA profile found for {clientName || 'this client'}
            </p>
            <button onClick={() => router.push('/dna')} className="btn-primary text-xs">
              Go to DNA Dashboard
            </button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <Nav />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/dna')}
                className="p-1.5 rounded-md hover:bg-[var(--surface-2)] transition-colors"
              >
                <ArrowLeft size={16} style={{ color: 'var(--text-3)' }} />
              </button>
              <div>
                <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: 'var(--text)' }}>
                  <Dna size={18} style={{ color: 'var(--gold)' }} />
                  {clientName}
                </h1>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                    <Clock size={10} className="inline mr-1" />
                    Generated {new Date(selectedVersion.created_at).toLocaleString()}
                  </span>
                  <span className="badge badge-green text-[10px]">v{selectedVersion.version}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {versions.length > 1 && (
                <button
                  onClick={() => setShowVersions(!showVersions)}
                  className="btn-ghost text-xs flex items-center gap-1"
                >
                  {showVersions ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  {versions.length} versions
                </button>
              )}
              <button
                onClick={copyMarkdown}
                className="btn-secondary text-xs flex items-center gap-1.5"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy MD'}
              </button>
              <button
                onClick={() => router.push('/dna')}
                className="btn-primary text-xs flex items-center gap-1.5"
              >
                <RefreshCw size={12} />
                Regenerate
              </button>
            </div>
          </div>

          {/* Version selector */}
          {showVersions && (
            <div className="card p-3 mb-4 animate-fade-in">
              <div className="space-y-1">
                {versions.map(v => (
                  <button
                    key={v.id}
                    onClick={() => { setSelectedVersion(v); setShowVersions(false) }}
                    className="w-full flex items-center justify-between p-2 rounded-lg text-xs transition-colors"
                    style={{
                      background: v.id === selectedVersion.id ? 'var(--surface-2)' : 'transparent',
                      color: v.id === selectedVersion.id ? 'var(--text)' : 'var(--text-2)',
                    }}
                  >
                    <span className="font-medium">Version {v.version}</span>
                    <span style={{ color: 'var(--text-3)' }}>
                      {new Date(v.created_at).toLocaleDateString()}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </motion.div>

        {/* DNA Content */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="card p-6 sm:p-8"
        >
          {renderMarkdown(selectedVersion.dna_markdown)}
        </motion.div>

        {/* Sources */}
        {selectedVersion.sources && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="card p-4 mt-4"
          >
            <h3 className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>
              Data Sources Used
            </h3>
            <div className="flex flex-wrap gap-2">
              {selectedVersion.website_url && (
                <span className="badge badge-blue text-[10px]">Website: {selectedVersion.website_url}</span>
              )}
              {selectedVersion.youtube_url && (
                <span className="badge badge-red text-[10px]">YouTube: {selectedVersion.youtube_url}</span>
              )}
              {(selectedVersion.sources as unknown as Record<string, string | null>)?.transcript_excerpt && (
                <span className="badge badge-purple text-[10px]">Transcript provided</span>
              )}
              {selectedVersion.context && (
                <span className="badge badge-amber text-[10px]">Context provided</span>
              )}
            </div>
          </motion.div>
        )}
      </main>
    </div>
  )
}
