'use client'

import { useState, useEffect } from 'react'
import { ExternalLink, FileText, Palette, ChevronDown, ChevronUp, Dna } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

interface BrandReferenceProps {
  clientId: number
  clientName: string
  contentType: string
}

interface ClientSettings {
  dna_doc_url?: string
  brand_colors?: string
  brand_fonts?: string
}

export default function BrandReference({ clientId, clientName, contentType }: BrandReferenceProps) {
  const supabase = createClient()
  const [settings, setSettings] = useState<ClientSettings | null>(null)
  const [dnaSnippet, setDnaSnippet] = useState<{ dos: string[]; donts: string[]; voice: string } | null>(null)
  const [showDna, setShowDna] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      // Load client settings and latest DNA in parallel
      const [settingsRes, dnaRes] = await Promise.all([
        supabase.from('client_settings').select('dna_doc_url').eq('client_id', clientId).maybeSingle(),
        supabase.from('client_dna').select('dna_markdown').eq('client_id', clientId).order('version', { ascending: false }).limit(1).maybeSingle(),
      ])

      if (settingsRes.data) setSettings(settingsRes.data as ClientSettings)

      // Extract key sections from DNA markdown
      if (dnaRes.data?.dna_markdown) {
        const md = dnaRes.data.dna_markdown as string
        const dos: string[] = []
        const donts: string[] = []
        let voice = ''

        // Extract DO items
        const doMatch = md.match(/\*\*DO:?\*\*[\s\S]*?(?=\*\*DON'?T|###|$)/i)
        if (doMatch) {
          const lines = doMatch[0].split('\n')
          for (const line of lines) {
            const item = line.replace(/^[-*]\s*/, '').trim()
            if (item && !item.startsWith('**') && item.length > 5) dos.push(item)
          }
        }

        // Extract DON'T items
        const dontMatch = md.match(/\*\*DON'?T:?\*\*[\s\S]*?(?=###|$)/i)
        if (dontMatch) {
          const lines = dontMatch[0].split('\n')
          for (const line of lines) {
            const item = line.replace(/^[-*]\s*/, '').trim()
            if (item && !item.startsWith('**') && item.length > 5) donts.push(item)
          }
        }

        // Extract voice
        const voiceMatch = md.match(/\*\*Voice:?\*\*\s*(.+)/i)
        if (voiceMatch) voice = voiceMatch[1].trim()

        if (dos.length > 0 || donts.length > 0 || voice) {
          setDnaSnippet({ dos: dos.slice(0, 5), donts: donts.slice(0, 5), voice })
        }
      }

      setLoading(false)
    }
    loadData()
  }, [supabase, clientId])

  const contentGuidelines: Record<string, { label: string; tips: string[] }> = {
    lf_video: {
      label: 'Long-Form Video',
      tips: [
        'Check intro hook (first 30 seconds)',
        'Verify CTA placement and script',
        'Confirm end screen + cards setup',
        'Review chapter markers / timestamps',
        'Thumbnail matches content tone',
      ],
    },
    sf_video: {
      label: 'Short-Form Video',
      tips: [
        'Hook within first 3 seconds',
        'Vertical format (9:16) confirmed',
        'Captions/subtitles are accurate',
        'No watermarks from other platforms',
        'CTA in caption or on-screen',
      ],
    },
  }

  const guide = contentGuidelines[contentType] || contentGuidelines.lf_video

  return (
    <div className="card p-4">
      <h3 className="text-xs font-medium uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
        <Palette size={11} />
        Brand Reference
      </h3>

      {/* Client name */}
      <div className="mb-3">
        <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
          {clientName}
        </span>
      </div>

      {/* DNA Profile link */}
      {!loading && (
        <Link
          href={`/dna/${clientId}`}
          className="flex items-center gap-2 p-2.5 rounded-lg mb-3 transition-all"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            color: 'var(--gold)',
          }}
        >
          <Dna size={14} />
          <span className="text-xs font-medium">Client DNA Profile</span>
          <ExternalLink size={10} className="ml-auto" />
        </Link>
      )}

      {/* Legacy Google Doc link */}
      {!loading && settings?.dna_doc_url && (
        <a
          href={settings.dna_doc_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 p-2.5 rounded-lg mb-3 transition-all"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            color: 'var(--text-2)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--gold)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
        >
          <FileText size={14} />
          <span className="text-xs font-medium">DNA Google Doc</span>
          <ExternalLink size={10} className="ml-auto" />
        </a>
      )}

      {/* Inline DNA snippet */}
      {dnaSnippet && (
        <div className="mb-3">
          <button
            onClick={() => setShowDna(!showDna)}
            className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider w-full"
            style={{ color: 'var(--gold-dim)' }}
          >
            {showDna ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            Quick DNA Reference
          </button>

          {showDna && (
            <div className="mt-2 space-y-2 animate-fade-in">
              {dnaSnippet.voice && (
                <div className="text-[11px] p-2 rounded" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                  <strong style={{ color: 'var(--text)' }}>Voice:</strong> {dnaSnippet.voice}
                </div>
              )}
              {dnaSnippet.dos.length > 0 && (
                <div>
                  <span className="text-[10px] font-medium" style={{ color: 'var(--green)' }}>DO:</span>
                  <ul className="mt-1 space-y-0.5">
                    {dnaSnippet.dos.map((item, i) => (
                      <li key={i} className="text-[10px] flex items-start gap-1" style={{ color: 'var(--text-2)' }}>
                        <span style={{ color: 'var(--green)' }}>+</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {dnaSnippet.donts.length > 0 && (
                <div>
                  <span className="text-[10px] font-medium" style={{ color: 'var(--red)' }}>DON&apos;T:</span>
                  <ul className="mt-1 space-y-0.5">
                    {dnaSnippet.donts.map((item, i) => (
                      <li key={i} className="text-[10px] flex items-start gap-1" style={{ color: 'var(--text-2)' }}>
                        <span style={{ color: 'var(--red)' }}>-</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Content type guidelines */}
      <div className="mt-3">
        <h4 className="text-[10px] font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>
          {guide.label} Checklist
        </h4>
        <ul className="space-y-1.5">
          {guide.tips.map((tip, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-[10px] mt-0.5 shrink-0" style={{ color: 'var(--text-3)' }}>
                {i + 1}.
              </span>
              <span className="text-xs" style={{ color: 'var(--text-2)' }}>
                {tip}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
