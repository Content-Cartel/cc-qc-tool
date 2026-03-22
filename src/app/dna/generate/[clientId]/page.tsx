'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  Dna,
  ArrowLeft,
  Globe,
  Youtube,
  FileText,
  MessageSquare,
  Check,
  AlertCircle,
  Loader2,
  ChevronRight,
  Phone,
  Video,
} from 'lucide-react'
import Nav from '@/components/nav'
import { createClient } from '@/lib/supabase/client'

type Stage = 'input' | 'collecting' | 'generating' | 'complete'

interface CollectionStep {
  id: string
  label: string
  status: 'pending' | 'active' | 'done' | 'skipped'
  detail: string
}

interface CompletionData {
  dna_id: string
  version: number
  sources: Record<string, string>
}

interface TranscriptSummary {
  fathom: { title: string; recorded_at: string; word_count: number; relevance_tag: string }[]
  youtube: { title: string; word_count: number; video_id: string }[]
  totals: { fathom: number; youtube: number; total_words: number }
  fathom_configured: boolean
}

interface FormData {
  websiteUrl: string
  youtubeUrl: string
  context: string
  transcript: string
}

function renderStreamedMarkdown(md: string): React.ReactNode[] {
  const lines = md.split('\n')
  const elements: React.ReactNode[] = []
  let listItems: string[] = []
  let elementKey = 0

  function inlineFormat(text: string): string {
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong style="color: var(--text)">$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(
        /`(.+?)`/g,
        '<code style="background: var(--surface-2); padding: 1px 4px; border-radius: 3px; font-size: 11px;">$1</code>'
      )
  }

  function flushList() {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`list-${elementKey++}`} className="space-y-1 mb-3 ml-4">
          {listItems.map((item, j) => (
            <li
              key={j}
              className="text-xs flex items-start gap-1.5"
              style={{ color: 'var(--text-2)' }}
            >
              <span
                className="mt-1.5 w-1 h-1 rounded-full shrink-0"
                style={{ background: 'var(--gold)' }}
              />
              <span dangerouslySetInnerHTML={{ __html: inlineFormat(item) }} />
            </li>
          ))}
        </ul>
      )
      listItems = []
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('# ')) {
      flushList()
      elements.push(
        <h1
          key={`h1-${elementKey++}`}
          className="text-lg font-bold mb-4 mt-6 pb-2"
          style={{ color: 'var(--gold)', borderBottom: '1px solid var(--border)' }}
        >
          {line.slice(2)}
        </h1>
      )
    } else if (line.startsWith('## ')) {
      flushList()
      elements.push(
        <h2
          key={`h2-${elementKey++}`}
          className="text-base font-bold mb-3 mt-5"
          style={{ color: 'var(--text)' }}
        >
          {line.slice(3)}
        </h2>
      )
    } else if (line.startsWith('### ')) {
      flushList()
      elements.push(
        <h3
          key={`h3-${elementKey++}`}
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
          key={`p-${elementKey++}`}
          className="text-xs mb-2 leading-relaxed"
          style={{ color: 'var(--text-2)' }}
          dangerouslySetInnerHTML={{ __html: inlineFormat(line) }}
        />
      )
    }
  }
  flushList()
  return elements
}

export default function DNAGeneratePage() {
  const params = useParams()
  const router = useRouter()
  const clientId = Number(params.clientId)
  const supabase = createClient()
  const streamContainerRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Core state
  const [stage, setStage] = useState<Stage>('input')
  const [clientName, setClientName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Form state
  const [formData, setFormData] = useState<FormData>({
    websiteUrl: '',
    youtubeUrl: '',
    context: '',
    transcript: '',
  })

  // Collection state
  const [collectionSteps, setCollectionSteps] = useState<CollectionStep[]>([])

  // Generation state
  const [streamedMarkdown, setStreamedMarkdown] = useState('')

  // Completion state
  const [completionData, setCompletionData] = useState<CompletionData | null>(null)

  // Transcript state
  const [transcriptSummary, setTranscriptSummary] = useState<TranscriptSummary | null>(null)
  const [includeFathom, setIncludeFathom] = useState(true)
  const [showManualTranscript, setShowManualTranscript] = useState(false)

  // Load client info and pre-fill from last DNA
  const loadClient = useCallback(async () => {
    setLoading(true)

    const [{ data: client }, { data: lastDna }] = await Promise.all([
      supabase.from('clients').select('name').eq('id', clientId).single(),
      supabase
        .from('client_dna')
        .select('website_url, youtube_url, context')
        .eq('client_id', clientId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    if (client) {
      setClientName(client.name)
    }

    if (lastDna) {
      setFormData((prev) => ({
        ...prev,
        websiteUrl: lastDna.website_url || '',
        youtubeUrl: lastDna.youtube_url || '',
        context: lastDna.context || '',
      }))
    }

    // Load available transcripts
    try {
      const res = await fetch(`/api/transcripts/${clientId}`)
      if (res.ok) {
        const data: TranscriptSummary = await res.json()
        setTranscriptSummary(data)
        // Show manual transcript input if no auto-transcripts available
        if (data.totals.fathom === 0 && data.totals.youtube === 0 && !data.fathom_configured) {
          setShowManualTranscript(true)
        }
      }
    } catch {
      // Transcript summary not critical — continue
    }

    setLoading(false)
  }, [supabase, clientId])

  useEffect(() => {
    loadClient()
  }, [loadClient])

  // Auto-scroll streaming content
  useEffect(() => {
    if (stage === 'generating' && streamContainerRef.current) {
      streamContainerRef.current.scrollTop = streamContainerRef.current.scrollHeight
    }
  }, [streamedMarkdown, stage])

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  function updateFormField(field: keyof FormData, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  function updateStep(id: string, updates: Partial<CollectionStep>) {
    setCollectionSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
    )
  }

  async function handleGenerate() {
    const { websiteUrl, youtubeUrl, context, transcript } = formData

    if (!websiteUrl && !youtubeUrl && !context && !transcript) {
      setError('Provide at least one data source')
      return
    }

    setError('')
    setStage('collecting')

    // Build initial collection steps
    const steps: CollectionStep[] = []
    if (websiteUrl) {
      steps.push({
        id: 'website',
        label: 'Scraping website...',
        status: 'pending',
        detail: websiteUrl,
      })
    }
    if (youtubeUrl) {
      steps.push({
        id: 'youtube',
        label: 'Fetching YouTube data...',
        status: 'pending',
        detail: youtubeUrl,
      })
    }
    if (includeFathom && transcriptSummary?.fathom_configured) {
      steps.push({
        id: 'fathom',
        label: 'Syncing Fathom meetings...',
        status: 'pending',
        detail: 'Pulling meeting transcripts',
      })
    }
    steps.push({
      id: 'transcripts',
      label: 'Selecting best transcripts...',
      status: 'pending',
      detail: '',
    })
    steps.push({
      id: 'generate',
      label: 'Generating DNA with Claude...',
      status: 'pending',
      detail: '',
    })
    setCollectionSteps(steps)

    // Start SSE stream
    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const response = await fetch('/api/dna/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_name: clientName,
          website_url: websiteUrl || undefined,
          youtube_url: youtubeUrl || undefined,
          context: context || undefined,
          transcript: transcript || undefined,
          include_fathom: includeFathom,
          include_transcripts: true,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Generation failed')
        setStage('input')
        return
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6))
              handleSSEEvent(event)
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }

      // Process any remaining buffer
      if (buffer.startsWith('data: ')) {
        try {
          const event = JSON.parse(buffer.slice(6))
          handleSSEEvent(event)
        } catch {
          // Skip malformed JSON
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return
      }
      setError('Network error — please try again')
      setStage('input')
    }
  }

  function handleSSEEvent(event: Record<string, unknown>) {
    const type = event.type as string

    if (type === 'progress') {
      const eventStage = event.stage as string
      const message = event.message as string

      if (eventStage === 'scraping_website') {
        updateStep('website', { status: 'active', label: 'Scraping website...' })
      } else if (eventStage === 'website_done') {
        updateStep('website', {
          status: 'done',
          label: message,
        })
      } else if (eventStage === 'scraping_youtube') {
        updateStep('youtube', { status: 'active', label: 'Fetching YouTube data...' })
      } else if (eventStage === 'youtube_done') {
        const label = message || 'YouTube data fetched'
        updateStep('youtube', {
          status: label.toLowerCase().includes('could not') ? 'skipped' : 'done',
          label,
        })
      } else if (eventStage === 'syncing_fathom') {
        updateStep('fathom', { status: 'active', label: 'Syncing Fathom meetings...' })
      } else if (eventStage === 'fathom_done') {
        updateStep('fathom', {
          status: 'done',
          label: message,
        })
      } else if (eventStage === 'selecting_transcripts') {
        updateStep('transcripts', { status: 'active', label: 'Selecting best transcripts...' })
      } else if (eventStage === 'transcripts_selected') {
        updateStep('transcripts', {
          status: 'done',
          label: message,
        })
      } else if (eventStage === 'generating') {
        updateStep('generate', { status: 'active', label: 'Generating DNA with Claude...' })
        // Transition to generating stage after a brief pause for visual flow
        setTimeout(() => setStage('generating'), 600)
      } else if (eventStage === 'saving') {
        // DNA text is done, just waiting for save
      }
    } else if (type === 'chunk') {
      const text = event.text as string
      setStreamedMarkdown((prev) => prev + text)
    } else if (type === 'error') {
      const message = event.message as string
      setError(message || 'An error occurred during generation')
      setStage('input')
    } else if (type === 'complete') {
      setCompletionData({
        dna_id: event.dna_id as string,
        version: event.version as number,
        sources: event.sources as Record<string, string>,
      })
      setStage('complete')
    }
  }

  function resetToInput() {
    setStage('input')
    setStreamedMarkdown('')
    setCollectionSteps([])
    setCompletionData(null)
    setError('')
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
        <Nav />
        <main className="max-w-3xl mx-auto px-4 py-8">
          <div className="card p-8 animate-shimmer h-96" />
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <Nav />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* ==================== STAGE 1: INPUT FORM ==================== */}
        {stage === 'input' && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={() => router.push('/dna')}
                className="p-1.5 rounded-md hover:bg-[var(--surface-2)] transition-colors"
              >
                <ArrowLeft size={16} style={{ color: 'var(--text-3)' }} />
              </button>
              <div>
                <h1
                  className="text-lg font-bold flex items-center gap-2"
                  style={{ color: 'var(--text)' }}
                >
                  <Dna size={18} style={{ color: 'var(--gold)' }} />
                  Generate DNA — {clientName}
                </h1>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                  Provide data sources to build a comprehensive brand DNA profile
                </p>
              </div>
            </div>

            {/* Form */}
            <div className="card p-6 space-y-5">
              {/* Website URL */}
              <div>
                <label className="label flex items-center gap-1.5">
                  <Globe size={12} style={{ color: 'var(--blue)' }} />
                  Website URL
                </label>
                <input
                  type="url"
                  className="input text-xs"
                  placeholder="https://example.com"
                  value={formData.websiteUrl}
                  onChange={(e) => updateFormField('websiteUrl', e.target.value)}
                />
              </div>

              {/* YouTube Channel URL */}
              <div>
                <label className="label flex items-center gap-1.5">
                  <Youtube size={12} style={{ color: 'var(--red)' }} />
                  YouTube Channel URL
                </label>
                <input
                  type="url"
                  className="input text-xs"
                  placeholder="https://youtube.com/@channel"
                  value={formData.youtubeUrl}
                  onChange={(e) => updateFormField('youtubeUrl', e.target.value)}
                />
              </div>

              {/* Additional Context */}
              <div>
                <label className="label flex items-center gap-1.5">
                  <FileText size={12} style={{ color: 'var(--amber)' }} />
                  Additional Context
                </label>
                <textarea
                  className="input text-xs"
                  rows={3}
                  placeholder="Key info about the client — niche, CEO name, target audience, content style preferences, anything editors should know..."
                  value={formData.context}
                  onChange={(e) => updateFormField('context', e.target.value)}
                />
              </div>

              {/* Transcripts Section */}
              <div className="space-y-3">
                <label className="label flex items-center gap-1.5">
                  <MessageSquare size={12} style={{ color: 'var(--purple)' }} />
                  Meeting & Video Transcripts
                </label>

                {/* Fathom Toggle */}
                {transcriptSummary?.fathom_configured && (
                  <div
                    className="p-3 rounded-lg flex items-center justify-between"
                    style={{ background: 'var(--surface-2)' }}
                  >
                    <div className="flex items-center gap-2">
                      <Phone size={14} style={{ color: 'var(--purple)' }} />
                      <div>
                        <p className="text-xs font-medium" style={{ color: 'var(--text)' }}>
                          Auto-pull from Fathom
                        </p>
                        <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                          {transcriptSummary.totals.fathom > 0
                            ? `${transcriptSummary.totals.fathom} meeting${transcriptSummary.totals.fathom > 1 ? 's' : ''} found`
                            : 'Will search for meetings during generation'}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIncludeFathom(!includeFathom)}
                      className="relative w-10 h-5 rounded-full transition-colors"
                      style={{ background: includeFathom ? 'var(--gold)' : 'var(--border)' }}
                    >
                      <div
                        className="absolute top-0.5 w-4 h-4 rounded-full transition-transform"
                        style={{
                          background: '#fff',
                          transform: includeFathom ? 'translateX(22px)' : 'translateX(2px)',
                        }}
                      />
                    </button>
                  </div>
                )}

                {/* Available Transcripts Preview */}
                {transcriptSummary && (transcriptSummary.totals.fathom > 0 || transcriptSummary.totals.youtube > 0) && (
                  <div
                    className="p-3 rounded-lg space-y-2"
                    style={{ background: 'rgba(34, 197, 94, 0.06)', border: '1px solid rgba(34, 197, 94, 0.15)' }}
                  >
                    <div className="flex items-center gap-1.5">
                      <Check size={12} style={{ color: 'var(--green)' }} />
                      <span className="text-[10px] font-medium" style={{ color: 'var(--green)' }}>
                        {transcriptSummary.totals.total_words.toLocaleString()} words of transcript data available
                      </span>
                    </div>
                    {transcriptSummary.fathom.length > 0 && (
                      <div className="space-y-1">
                        {transcriptSummary.fathom.slice(0, 3).map((m, i) => (
                          <div key={i} className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--text-3)' }}>
                            <Phone size={9} />
                            <span className="truncate">{m.title}</span>
                            <span className="badge badge-neutral text-[9px] shrink-0">{m.relevance_tag.replace('_', ' ')}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {transcriptSummary.youtube.length > 0 && (
                      <div className="space-y-1">
                        {transcriptSummary.youtube.slice(0, 3).map((v, i) => (
                          <div key={i} className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--text-3)' }}>
                            <Video size={9} />
                            <span className="truncate">{v.title}</span>
                            <span className="shrink-0">{v.word_count?.toLocaleString()} words</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Manual Transcript (collapsed by default if auto available) */}
                {!showManualTranscript && (transcriptSummary?.fathom_configured || (transcriptSummary && transcriptSummary.totals.total_words > 0)) ? (
                  <button
                    type="button"
                    onClick={() => setShowManualTranscript(true)}
                    className="text-[10px] flex items-center gap-1"
                    style={{ color: 'var(--text-3)' }}
                  >
                    <FileText size={10} />
                    Paste additional transcript manually
                  </button>
                ) : null}

                {(showManualTranscript || (!transcriptSummary?.fathom_configured && transcriptSummary?.totals.total_words === 0)) && (
                  <textarea
                    className="input text-xs"
                    rows={4}
                    placeholder="Paste onboarding call transcript here — this gives Claude deep context about the client's voice, preferences, and goals..."
                    value={formData.transcript}
                    onChange={(e) => updateFormField('transcript', e.target.value)}
                  />
                )}
              </div>

              {/* Error */}
              {error && (
                <div
                  className="flex items-center gap-2 text-xs p-3 rounded-lg animate-fade-in"
                  style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)' }}
                >
                  <AlertCircle size={14} />
                  {error}
                </div>
              )}

              {/* Generate Button */}
              <button
                onClick={handleGenerate}
                className="btn-primary w-full text-sm flex items-center justify-center gap-2 py-3"
              >
                <Dna size={16} />
                Generate DNA Profile
                <ChevronRight size={14} />
              </button>
            </div>
          </motion.div>
        )}

        {/* ==================== STAGE 2: DATA COLLECTION ==================== */}
        {stage === 'collecting' && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* Header */}
            <div className="mb-6">
              <h1
                className="text-lg font-bold flex items-center gap-2"
                style={{ color: 'var(--text)' }}
              >
                <Dna size={18} className="animate-pulse-gold" style={{ color: 'var(--gold)' }} />
                Collecting Data — {clientName}
              </h1>
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                Scraping sources and preparing data for Claude...
              </p>
            </div>

            {/* Steps */}
            <div className="card p-6 space-y-4">
              {collectionSteps.map((step, i) => (
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1, duration: 0.3 }}
                  className="flex items-start gap-3 p-3 rounded-lg transition-all duration-300"
                  style={{
                    background:
                      step.status === 'active'
                        ? 'rgba(245, 158, 11, 0.06)'
                        : step.status === 'done'
                          ? 'rgba(34, 197, 94, 0.06)'
                          : step.status === 'skipped'
                            ? 'rgba(239, 68, 68, 0.06)'
                            : 'transparent',
                  }}
                >
                  {/* Status icon */}
                  <div className="mt-0.5 shrink-0">
                    {step.status === 'pending' && (
                      <div
                        className="w-5 h-5 rounded-full border flex items-center justify-center"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        <div
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ background: 'var(--text-3)' }}
                        />
                      </div>
                    )}
                    {step.status === 'active' && (
                      <Loader2
                        size={20}
                        className="animate-spin"
                        style={{ color: 'var(--gold)' }}
                      />
                    )}
                    {step.status === 'done' && (
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center"
                        style={{ background: 'var(--green)' }}
                      >
                        <Check size={12} style={{ color: '#000' }} />
                      </div>
                    )}
                    {step.status === 'skipped' && (
                      <AlertCircle size={20} style={{ color: 'var(--amber)' }} />
                    )}
                  </div>

                  {/* Step content */}
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-sm font-medium"
                      style={{
                        color:
                          step.status === 'done'
                            ? 'var(--green)'
                            : step.status === 'active'
                              ? 'var(--gold)'
                              : step.status === 'skipped'
                                ? 'var(--amber)'
                                : 'var(--text-3)',
                      }}
                    >
                      {step.label}
                    </p>
                    {step.detail && step.status !== 'done' && (
                      <p
                        className="text-[10px] mt-0.5 truncate"
                        style={{ color: 'var(--text-3)' }}
                      >
                        {step.detail}
                      </p>
                    )}
                  </div>
                </motion.div>
              ))}

              {/* Progress hint */}
              <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                <p className="text-[10px] text-center" style={{ color: 'var(--text-3)' }}>
                  This typically takes 1-2 minutes. Do not close this page.
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* ==================== STAGE 3: AI GENERATION (STREAMING) ==================== */}
        {stage === 'generating' && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* Header */}
            <div className="mb-6">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Dna
                    size={20}
                    className="animate-pulse-gold"
                    style={{ color: 'var(--gold)' }}
                  />
                  <div
                    className="absolute -top-1 -right-1 w-2 h-2 rounded-full animate-pulse"
                    style={{ background: 'var(--gold)' }}
                  />
                </div>
                <div>
                  <h1
                    className="text-lg font-bold"
                    style={{ color: 'var(--text)' }}
                  >
                    Generating DNA with Claude...
                  </h1>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                    Analyzing data and building {clientName}&apos;s brand DNA profile
                  </p>
                </div>
              </div>

              {/* Gold progress bar */}
              <div className="mt-4 h-0.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: 'var(--gold)' }}
                  initial={{ width: '0%' }}
                  animate={{ width: '100%' }}
                  transition={{ duration: 90, ease: 'linear' }}
                />
              </div>
            </div>

            {/* Streaming content */}
            <div className="card-glow">
              <div
                ref={streamContainerRef}
                className="p-6 sm:p-8 max-h-[60vh] overflow-y-auto"
                style={{
                  scrollbarWidth: 'thin',
                  scrollbarColor: 'var(--border) transparent',
                }}
              >
                {streamedMarkdown ? (
                  <>
                    {renderStreamedMarkdown(streamedMarkdown)}
                    {/* Blinking cursor */}
                    <span
                      className="inline-block w-2 h-4 ml-0.5 animate-pulse rounded-sm"
                      style={{ background: 'var(--gold)', verticalAlign: 'text-bottom' }}
                    />
                  </>
                ) : (
                  <div className="flex items-center gap-3 py-8 justify-center">
                    <Loader2
                      size={20}
                      className="animate-spin"
                      style={{ color: 'var(--gold)' }}
                    />
                    <span className="text-sm" style={{ color: 'var(--text-3)' }}>
                      Waiting for Claude to respond...
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Footer hint */}
            <p className="text-[10px] text-center mt-3" style={{ color: 'var(--text-3)' }}>
              Claude is analyzing the scraped data and crafting a comprehensive DNA profile. This
              will auto-save when complete.
            </p>
          </motion.div>
        )}

        {/* ==================== STAGE 4: COMPLETE ==================== */}
        {stage === 'complete' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          >
            {/* Success header */}
            <div className="text-center mb-8">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: 'spring', stiffness: 200, damping: 15 }}
                className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
                style={{ background: 'rgba(34, 197, 94, 0.15)' }}
              >
                <Check size={32} style={{ color: 'var(--green)' }} />
              </motion.div>
              <h1
                className="text-xl font-bold mb-2"
                style={{ color: 'var(--text)' }}
              >
                DNA Generated Successfully!
              </h1>
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>
                {clientName}&apos;s brand DNA profile is ready
              </p>
            </div>

            {/* Summary card */}
            {completionData && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="card p-6 mb-6"
              >
                <div className="flex items-center justify-between mb-4">
                  <h2
                    className="text-sm font-semibold flex items-center gap-2"
                    style={{ color: 'var(--text)' }}
                  >
                    <Dna size={14} style={{ color: 'var(--gold)' }} />
                    Generation Summary
                  </h2>
                  <span className="badge badge-green text-[10px]">
                    v{completionData.version}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {completionData.sources.website && (
                    <div
                      className="p-3 rounded-lg"
                      style={{ background: 'var(--surface-2)' }}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <Globe size={11} style={{ color: 'var(--blue)' }} />
                        <span className="text-[10px] font-medium" style={{ color: 'var(--text-3)' }}>
                          Website
                        </span>
                      </div>
                      <p className="text-xs font-medium" style={{ color: 'var(--text)' }}>
                        {completionData.sources.website}
                      </p>
                    </div>
                  )}
                  {completionData.sources.youtube && (
                    <div
                      className="p-3 rounded-lg"
                      style={{ background: 'var(--surface-2)' }}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <Youtube size={11} style={{ color: 'var(--red)' }} />
                        <span className="text-[10px] font-medium" style={{ color: 'var(--text-3)' }}>
                          YouTube
                        </span>
                      </div>
                      <p className="text-xs font-medium" style={{ color: 'var(--text)' }}>
                        {completionData.sources.youtube}
                      </p>
                    </div>
                  )}
                  {completionData.sources.fathom && completionData.sources.fathom !== 'none' && (
                    <div
                      className="p-3 rounded-lg"
                      style={{ background: 'var(--surface-2)' }}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <Phone size={11} style={{ color: 'var(--purple)' }} />
                        <span className="text-[10px] font-medium" style={{ color: 'var(--text-3)' }}>
                          Fathom Meetings
                        </span>
                      </div>
                      <p className="text-xs font-medium" style={{ color: 'var(--text)' }}>
                        {completionData.sources.fathom}
                      </p>
                    </div>
                  )}
                  {completionData.sources.youtube_transcripts && completionData.sources.youtube_transcripts !== 'none' && (
                    <div
                      className="p-3 rounded-lg"
                      style={{ background: 'var(--surface-2)' }}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <Video size={11} style={{ color: 'var(--green)' }} />
                        <span className="text-[10px] font-medium" style={{ color: 'var(--text-3)' }}>
                          Video Transcripts
                        </span>
                      </div>
                      <p className="text-xs font-medium" style={{ color: 'var(--text)' }}>
                        {completionData.sources.youtube_transcripts}
                      </p>
                    </div>
                  )}
                  {completionData.sources.context && (
                    <div
                      className="p-3 rounded-lg"
                      style={{ background: 'var(--surface-2)' }}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <FileText size={11} style={{ color: 'var(--amber)' }} />
                        <span className="text-[10px] font-medium" style={{ color: 'var(--text-3)' }}>
                          Context
                        </span>
                      </div>
                      <p className="text-xs font-medium" style={{ color: 'var(--text)' }}>
                        {completionData.sources.context}
                      </p>
                    </div>
                  )}
                  {completionData.sources.transcript && (
                    <div
                      className="p-3 rounded-lg"
                      style={{ background: 'var(--surface-2)' }}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <MessageSquare size={11} style={{ color: 'var(--purple)' }} />
                        <span className="text-[10px] font-medium" style={{ color: 'var(--text-3)' }}>
                          Transcript
                        </span>
                      </div>
                      <p className="text-xs font-medium" style={{ color: 'var(--text)' }}>
                        {completionData.sources.transcript}
                      </p>
                    </div>
                  )}
                  {completionData.sources.model && (
                    <div
                      className="p-3 rounded-lg col-span-2"
                      style={{ background: 'var(--surface-2)' }}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <Dna size={11} style={{ color: 'var(--gold)' }} />
                        <span className="text-[10px] font-medium" style={{ color: 'var(--text-3)' }}>
                          Model
                        </span>
                      </div>
                      <p className="text-xs font-medium" style={{ color: 'var(--text)' }}>
                        {completionData.sources.model}
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* Action buttons */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="flex items-center gap-3"
            >
              <button
                onClick={() => router.push(`/dna/${clientId}`)}
                className="btn-primary flex-1 text-sm flex items-center justify-center gap-2 py-3"
              >
                <Dna size={14} />
                View DNA Profile
                <ChevronRight size={14} />
              </button>
              <button
                onClick={resetToInput}
                className="btn-secondary flex-1 text-sm flex items-center justify-center gap-2 py-3"
              >
                Generate Another Version
              </button>
            </motion.div>
          </motion.div>
        )}
      </main>
    </div>
  )
}
