'use client'

import { useState, useEffect } from 'react'
import { ExternalLink, FileText, Palette } from 'lucide-react'
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
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadSettings() {
      const { data } = await supabase
        .from('client_settings')
        .select('dna_doc_url')
        .eq('client_id', clientId)
        .maybeSingle()

      if (data) setSettings(data as ClientSettings)
      setLoading(false)
    }
    loadSettings()
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

      {/* DNA doc link */}
      {!loading && settings?.dna_doc_url && (
        <a
          href={settings.dna_doc_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 p-2.5 rounded-lg mb-3 transition-all"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            color: 'var(--gold)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--gold)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
        >
          <FileText size={14} />
          <span className="text-xs font-medium">Client DNA Profile</span>
          <ExternalLink size={10} className="ml-auto" />
        </a>
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
