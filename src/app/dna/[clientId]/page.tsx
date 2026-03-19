'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Dna, ArrowLeft, Copy, Check, RefreshCw, Clock,
  ChevronDown, ChevronUp, FileText,
  Zap, AlertTriangle, X, Loader2, Target,
} from 'lucide-react'
import Nav from '@/components/nav'
import { createClient } from '@/lib/supabase/client'
import { parseDNASections, getSectionIcon, extractEditorBrief, extractOCIBrief, extractStrategyBrief } from '@/lib/dna/parser'
import type { ClientDNA } from '@/lib/dna/types'
import type { ParsedDNA, DNASection } from '@/lib/dna/parser'

function scoreColor(score: number): string {
  if (score > 70) return 'var(--green)'
  if (score >= 40) return 'var(--amber)'
  return 'var(--red)'
}

function confidenceBadge(confidence: DNASection['confidence']) {
  switch (confidence) {
    case 'high':
      return <span className="badge badge-green text-[10px]">High Confidence</span>
    case 'partial':
      return <span className="badge badge-amber text-[10px]">Partial Data</span>
    case 'low':
      return <span className="badge badge-red text-[10px]">Needs Data</span>
  }
}

function confidenceDot(confidence: DNASection['confidence']) {
  const color =
    confidence === 'high' ? 'var(--green)' :
    confidence === 'partial' ? 'var(--amber)' : 'var(--red)'
  return (
    <span
      className="w-2 h-2 rounded-full shrink-0"
      style={{ background: color }}
    />
  )
}

function inlineFormat(text: string): string {
  return text
    .replace(/\[NEEDS DATA[^\]]*\]/gi, (m) =>
      `<span class="badge badge-red" style="font-size:10px;display:inline-flex;vertical-align:middle;">${m.replace(/^\[|\]$/g, '')}</span>`
    )
    .replace(/\[NEEDS CONFIRMATION[^\]]*\]/gi, (m) =>
      `<span class="badge badge-amber" style="font-size:10px;display:inline-flex;vertical-align:middle;">${m.replace(/^\[|\]$/g, '')}</span>`
    )
    .replace(/\[INFERRED[^\]]*\]/gi, (m) =>
      `<span class="badge badge-blue" style="font-size:10px;display:inline-flex;vertical-align:middle;">${m.replace(/^\[|\]$/g, '')}</span>`
    )
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color: var(--text)">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code style="background: var(--surface-2); padding: 1px 4px; border-radius: 3px; font-size: 11px;">$1</code>')
}

function renderSectionMarkdown(md: string): React.ReactNode[] {
  const lines = md.split('\n')
  const elements: React.ReactNode[] = []
  let listItems: string[] = []
  let tableRows: string[][] = []
  let inTable = false

  function flushList() {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`list-${elements.length}`} className="space-y-1.5 mb-3 ml-4">
          {listItems.map((item, j) => (
            <li key={j} className="text-xs flex items-start gap-1.5" style={{ color: 'var(--text-2)' }}>
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--gold)' }} />
              <span dangerouslySetInnerHTML={{ __html: inlineFormat(item) }} />
            </li>
          ))}
        </ul>
      )
      listItems = []
    }
  }

  function flushTable() {
    if (tableRows.length > 0) {
      const headerRow = tableRows[0]
      const dataRows = tableRows.slice(1).filter(r => !r.every(c => /^[-:]+$/.test(c.trim())))
      elements.push(
        <div key={`table-${elements.length}`} className="overflow-x-auto mb-3">
          <table className="w-full text-xs" style={{ borderColor: 'var(--border)' }}>
            <thead>
              <tr>
                {headerRow.map((cell, ci) => (
                  <th
                    key={ci}
                    className="text-left px-3 py-2 font-semibold"
                    style={{
                      color: 'var(--text)',
                      borderBottom: '1px solid var(--border)',
                      background: 'var(--surface-2)',
                    }}
                  >
                    <span dangerouslySetInnerHTML={{ __html: inlineFormat(cell.trim()) }} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataRows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="px-3 py-2"
                      style={{
                        color: 'var(--text-2)',
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      <span dangerouslySetInnerHTML={{ __html: inlineFormat(cell.trim()) }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      tableRows = []
      inTable = false
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Skip the section header line (## N. TITLE) — we render these as card titles
    if (/^## \d+\.\s+/.test(line)) continue

    // Table row
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      flushList()
      inTable = true
      const cells = line.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
      tableRows.push(cells)
      continue
    } else if (inTable) {
      flushTable()
    }

    if (line.startsWith('### ')) {
      flushList()
      elements.push(
        <h3
          key={`h3-${i}`}
          className="text-sm font-semibold mb-2 mt-4"
          style={{ color: 'var(--gold-dim)' }}
        >
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
        <p
          key={`p-${i}`}
          className="text-xs mb-2 leading-relaxed"
          style={{ color: 'var(--text-2)' }}
          dangerouslySetInnerHTML={{ __html: inlineFormat(line) }}
        />
      )
    }
  }
  flushList()
  flushTable()
  return elements
}

export default function DNAViewerPage() {
  const params = useParams()
  const router = useRouter()
  const clientId = Number(params.clientId)
  const supabase = createClient()

  const [clientName, setClientName] = useState('')
  const [versions, setVersions] = useState<ClientDNA[]>([])
  const [selectedVersion, setSelectedVersion] = useState<ClientDNA | null>(null)
  const [parsed, setParsed] = useState<ParsedDNA | null>(null)
  const [activeSection, setActiveSection] = useState(0)
  const [loading, setLoading] = useState(true)

  const [showRegenModal, setShowRegenModal] = useState(false)
  const [regenSection, setRegenSection] = useState(0)
  const [regenContext, setRegenContext] = useState('')
  const [regenerating, setRegenerating] = useState(false)

  const [showEditModal, setShowEditModal] = useState(false)
  const [editSection, setEditSection] = useState(0)
  const [editMarkdown, setEditMarkdown] = useState('')
  const [saving, setSaving] = useState(false)

  const [copied, setCopied] = useState('')
  const [showVersionDropdown, setShowVersionDropdown] = useState(false)

  const sectionRefs = useRef<Record<number, HTMLDivElement | null>>({})

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

  useEffect(() => {
    if (selectedVersion) {
      const result = parseDNASections(selectedVersion.dna_markdown)
      setParsed(result)
      if (result.sections.length > 0) {
        setActiveSection(result.sections[0].number)
      }
    }
  }, [selectedVersion])

  function scrollToSection(sectionNumber: number) {
    setActiveSection(sectionNumber)
    const el = sectionRefs.current[sectionNumber]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  function handleCopy(type: 'markdown' | 'editor' | 'json' | 'oci' | 'strategy') {
    if (!selectedVersion || !parsed) return
    let text = ''
    if (type === 'markdown') {
      text = selectedVersion.dna_markdown
    } else if (type === 'editor') {
      text = extractEditorBrief(parsed.sections)
    } else if (type === 'oci') {
      text = extractOCIBrief(parsed.sections)
    } else if (type === 'strategy') {
      text = extractStrategyBrief(parsed.sections)
    } else if (type === 'json') {
      text = JSON.stringify(selectedVersion.dna_json ?? parsed, null, 2)
    }
    navigator.clipboard.writeText(text)
    setCopied(type)
    setTimeout(() => setCopied(''), 2000)
  }

  function openRegenModal(sectionNum: number) {
    setRegenSection(sectionNum)
    setRegenContext('')
    setShowRegenModal(true)
  }

  function openEditModal(sectionNum: number) {
    const section = parsed?.sections.find(s => s.number === sectionNum)
    if (!section) return
    setEditSection(sectionNum)
    setEditMarkdown(section.markdown)
    setShowEditModal(true)
  }

  async function handleSaveEdit() {
    if (!selectedVersion || !editMarkdown) return
    setSaving(true)
    try {
      const res = await fetch('/api/dna/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dna_id: selectedVersion.id,
          section_number: editSection,
          new_markdown: editMarkdown,
          edited_by: 'manual edit',
        }),
      })
      if (res.ok) {
        setShowEditModal(false)
        await load()
      }
    } catch {
      // silently handle
    } finally {
      setSaving(false)
    }
  }

  async function handleRegenerate() {
    if (!selectedVersion) return
    setRegenerating(true)
    try {
      const res = await fetch('/api/dna/regenerate-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dna_id: selectedVersion.id,
          section_number: regenSection,
          additional_context: regenContext,
        }),
      })
      if (res.ok) {
        setShowRegenModal(false)
        await load()
      }
    } catch {
      // silently handle
    } finally {
      setRegenerating(false)
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
        <Nav />
        <main className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex gap-6">
            <div className="hidden lg:block w-64 shrink-0">
              <div className="card p-4 animate-shimmer h-80" />
            </div>
            <div className="flex-1">
              <div className="card p-6 animate-shimmer h-20 mb-4" />
              <div className="card p-6 animate-shimmer h-64 mb-4" />
              <div className="card p-6 animate-shimmer h-64" />
            </div>
          </div>
        </main>
      </div>
    )
  }

  // No DNA found
  if (!selectedVersion || !parsed) {
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

  const {
    sections,
    overallScore,
    highConfCount,
  } = parsed

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <Nav />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Mobile tab bar */}
        <div className="lg:hidden mb-4 overflow-x-auto">
          <div className="flex gap-1 pb-2" style={{ minWidth: 'max-content' }}>
            {sections.map((sec) => (
              <button
                key={sec.number}
                onClick={() => scrollToSection(sec.number)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs whitespace-nowrap transition-colors"
                style={{
                  background: activeSection === sec.number ? 'var(--surface-2)' : 'transparent',
                  color: activeSection === sec.number ? 'var(--text)' : 'var(--text-3)',
                  borderLeft: activeSection === sec.number ? '2px solid var(--gold)' : '2px solid transparent',
                }}
              >
                <span>{getSectionIcon(sec.slug)}</span>
                <span>{sec.title}</span>
                {confidenceDot(sec.confidence)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-6">
          {/* Left sidebar - desktop only */}
          <aside className="hidden lg:block w-64 shrink-0">
            <div className="sticky top-20 space-y-4">
              {/* Overall DNA Health */}
              <div className="card p-5">
                <div className="flex flex-col items-center mb-4">
                  <div className="relative w-20 h-20 mb-3">
                    <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                      <circle
                        cx="40" cy="40" r="34"
                        fill="none"
                        stroke="var(--surface-2)"
                        strokeWidth="6"
                      />
                      <circle
                        cx="40" cy="40" r="34"
                        fill="none"
                        stroke={scoreColor(overallScore)}
                        strokeWidth="6"
                        strokeLinecap="round"
                        strokeDasharray={`${(overallScore / 100) * 213.6} 213.6`}
                        className="transition-all duration-700"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span
                        className="text-xl font-bold"
                        style={{ color: scoreColor(overallScore) }}
                      >
                        {overallScore}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs font-medium" style={{ color: 'var(--text)' }}>
                    DNA Health Score
                  </p>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>
                    {highConfCount}/{sections.length} High Confidence
                  </p>
                </div>
              </div>

              {/* Section nav */}
              <div className="card p-2">
                <p className="text-[10px] uppercase tracking-wider font-medium px-3 py-2" style={{ color: 'var(--text-3)' }}>
                  Sections
                </p>
                <nav className="space-y-0.5">
                  {sections.map((sec) => (
                    <button
                      key={sec.number}
                      onClick={() => scrollToSection(sec.number)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs transition-all text-left"
                      style={{
                        background: activeSection === sec.number ? 'var(--surface-2)' : 'transparent',
                        color: activeSection === sec.number ? 'var(--text)' : 'var(--text-2)',
                        borderLeft: activeSection === sec.number ? '2px solid var(--gold)' : '2px solid transparent',
                      }}
                    >
                      <span className="text-sm">{getSectionIcon(sec.slug)}</span>
                      <span className="flex-1 truncate">{sec.title}</span>
                      {confidenceDot(sec.confidence)}
                    </button>
                  ))}
                </nav>
              </div>

              {/* Version selector */}
              {versions.length > 1 && (
                <div className="card p-3">
                  <button
                    onClick={() => setShowVersionDropdown(!showVersionDropdown)}
                    className="w-full flex items-center justify-between text-xs"
                    style={{ color: 'var(--text-2)' }}
                  >
                    <span className="flex items-center gap-1.5">
                      <Clock size={12} />
                      Version {selectedVersion.version}
                    </span>
                    {showVersionDropdown ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                  <AnimatePresence>
                    {showVersionDropdown && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-2 space-y-0.5">
                          {versions.map((v) => (
                            <button
                              key={v.id}
                              onClick={() => {
                                setSelectedVersion(v)
                                setShowVersionDropdown(false)
                              }}
                              className="w-full flex items-center justify-between px-2 py-1.5 rounded text-[11px] transition-colors"
                              style={{
                                background: v.id === selectedVersion.id ? 'var(--surface-2)' : 'transparent',
                                color: v.id === selectedVersion.id ? 'var(--text)' : 'var(--text-3)',
                              }}
                            >
                              <span>v{v.version}</span>
                              <span>{new Date(v.created_at).toLocaleDateString()}</span>
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </aside>

          {/* Right content area */}
          <div className="flex-1 min-w-0">
            {/* Header bar */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="card p-4 mb-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
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
                      <span className="badge badge-green text-[10px]">v{selectedVersion.version}</span>
                      <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                        <Clock size={10} className="inline mr-1" />
                        Generated {new Date(selectedVersion.created_at).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => handleCopy('strategy')}
                    className="btn-ghost text-xs flex items-center gap-1.5"
                  >
                    {copied === 'strategy' ? <Check size={12} /> : <Target size={12} />}
                    {copied === 'strategy' ? 'Copied!' : 'Strategy Brief'}
                  </button>
                  <button
                    onClick={() => handleCopy('editor')}
                    className="btn-ghost text-xs flex items-center gap-1.5"
                  >
                    {copied === 'editor' ? <Check size={12} /> : <FileText size={12} />}
                    {copied === 'editor' ? 'Copied!' : 'Editor Brief'}
                  </button>
                  <button
                    onClick={() => handleCopy('oci')}
                    className="btn-ghost text-xs flex items-center gap-1.5"
                  >
                    {copied === 'oci' ? <Check size={12} /> : <Zap size={12} />}
                    {copied === 'oci' ? 'Copied!' : 'OCI Brief'}
                  </button>
                  <button
                    onClick={() => handleCopy('markdown')}
                    className="btn-ghost text-xs flex items-center gap-1.5"
                  >
                    {copied === 'markdown' ? <Check size={12} /> : <Copy size={12} />}
                    {copied === 'markdown' ? 'Copied!' : 'Full Copy'}
                  </button>
                  <button
                    onClick={() => router.push(`/dna/generate/${clientId}`)}
                    className="btn-primary text-xs flex items-center gap-1.5"
                  >
                    <RefreshCw size={12} />
                    Regenerate
                  </button>
                </div>
              </div>
            </motion.div>

            {/* Sections */}
            <div className="space-y-4">
              {sections.map((sec, idx) => (
                <motion.div
                  key={sec.number}
                  ref={(el) => { sectionRefs.current[sec.number] = el }}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.04 }}
                  className="card p-5 sm:p-6 scroll-mt-24"
                  onMouseEnter={() => setActiveSection(sec.number)}
                >
                  {/* Section header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{getSectionIcon(sec.slug)}</span>
                      <div>
                        <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text)' }}>
                          <span style={{ color: 'var(--text-3)' }}>{sec.number}.</span>
                          {sec.title}
                        </h2>
                        <div className="flex items-center gap-2 mt-1">
                          {confidenceBadge(sec.confidence)}
                          {sec.gapCount > 0 && (
                            <span className="text-[10px] flex items-center gap-1" style={{ color: 'var(--amber)' }}>
                              <AlertTriangle size={10} />
                              {sec.gapCount} gap{sec.gapCount !== 1 ? 's' : ''} found
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Section content */}
                  <div className="mb-4">
                    {renderSectionMarkdown(sec.markdown)}
                  </div>

                  {/* Section footer */}
                  <div className="flex items-center justify-end gap-2 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                    <button
                      onClick={() => openEditModal(sec.number)}
                      className="btn-ghost text-[11px] flex items-center gap-1.5"
                    >
                      <FileText size={11} />
                      Edit Section
                    </button>
                    <button
                      onClick={() => openRegenModal(sec.number)}
                      className="btn-ghost text-[11px] flex items-center gap-1.5"
                    >
                      <RefreshCw size={11} />
                      Regenerate Section
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Sources */}
            {selectedVersion.sources && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: sections.length * 0.04 + 0.1 }}
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
          </div>
        </div>
      </main>

      {/* Regenerate Section Modal */}
      <AnimatePresence>
        {showRegenModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowRegenModal(false) }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="card p-6 w-full max-w-md"
              style={{ boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                  Regenerate Section {regenSection}: {sections.find(s => s.number === regenSection)?.title}
                </h3>
                <button
                  onClick={() => setShowRegenModal(false)}
                  className="p-1 rounded hover:bg-[var(--surface-2)] transition-colors"
                >
                  <X size={14} style={{ color: 'var(--text-3)' }} />
                </button>
              </div>

              <div className="mb-4">
                <label className="label text-xs mb-1.5 block">
                  Add more context for this section
                </label>
                <textarea
                  value={regenContext}
                  onChange={(e) => setRegenContext(e.target.value)}
                  className="input w-full text-xs"
                  rows={4}
                  placeholder="Provide additional details, corrections, or data to improve this section..."
                  disabled={regenerating}
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowRegenModal(false)}
                  className="btn-ghost text-xs"
                  disabled={regenerating}
                >
                  Cancel
                </button>
                <button
                  onClick={handleRegenerate}
                  className="btn-primary text-xs flex items-center gap-1.5"
                  disabled={regenerating}
                >
                  {regenerating ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      Regenerating...
                    </>
                  ) : (
                    <>
                      <RefreshCw size={12} />
                      Regenerate
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Section Modal */}
      <AnimatePresence>
        {showEditModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowEditModal(false) }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="card p-6 w-full max-w-2xl max-h-[85vh] flex flex-col"
              style={{ boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                  Edit Section {editSection}: {sections.find(s => s.number === editSection)?.title}
                </h3>
                <button
                  onClick={() => setShowEditModal(false)}
                  className="p-1 rounded hover:bg-[var(--surface-2)] transition-colors"
                >
                  <X size={14} style={{ color: 'var(--text-3)' }} />
                </button>
              </div>

              <p className="text-[11px] mb-3" style={{ color: 'var(--text-3)' }}>
                Edit the markdown directly. Changes save as a new version so nothing is lost.
              </p>

              <div className="flex-1 min-h-0 mb-4">
                <textarea
                  value={editMarkdown}
                  onChange={(e) => setEditMarkdown(e.target.value)}
                  className="input w-full h-full text-xs font-mono"
                  style={{ minHeight: '400px', resize: 'vertical' }}
                  disabled={saving}
                  spellCheck={false}
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowEditModal(false)}
                  className="btn-ghost text-xs"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="btn-primary text-xs flex items-center gap-1.5"
                  disabled={saving}
                >
                  {saving ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check size={12} />
                      Save Edit
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
