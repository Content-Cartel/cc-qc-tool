'use client'

import React from 'react'

interface StoryBeat {
  beat?: string
  section?: string
  what_happens?: string
  attention_risk?: string
}

interface Instruction {
  timestamp?: string
  action?: string
  details?: string
  duration?: string
  why?: string
  type?: string
  priority?: string
}

interface BRoll {
  source?: string
  url?: string
  what_to_capture?: string
  how_to_use?: string
  duration_on_screen?: string
  why_this_source?: string
  timestamp?: string
}

interface Graphic {
  graphic_type?: string
  exact_text?: string
  position?: string
  style?: string
  hold_time?: string
  appears_at?: string
  purpose?: string
}

interface MusicCue {
  what?: string
  when?: string
  mood?: string
  why?: string
}

interface RetentionNotes {
  hook_assessment?: string
  dropoff_risks?: string[]
  open_loop_opportunities?: string[]
  cta_approach?: string
}

interface Overview {
  topic?: string
  target_audience?: string
  content_type?: string
  pacing_feel?: string
  creator_style?: string
}

interface Blueprint {
  video_overview?: Overview
  story_architecture?: StoryBeat[]
  strongest_moment?: string
  instructions?: Instruction[]
  broll_research?: BRoll[]
  graphics_checklist?: Graphic[]
  music_timeline?: MusicCue[]
  retention_notes?: RetentionNotes
  general_notes?: string[]
}

/**
 * Parse a timestamp string into seconds for sorting.
 * Accepts "M:SS", "MM:SS", "H:MM:SS", "45", or free-form quotes.
 * Unparseable values return Infinity so they sort to the end.
 */
function parseTimestamp(value?: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY
  const match = value.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (match) {
    const a = parseInt(match[1], 10)
    const b = parseInt(match[2], 10)
    const c = match[3] ? parseInt(match[3], 10) : null
    if (c !== null) return a * 3600 + b * 60 + c
    return a * 60 + b
  }
  const plain = value.match(/^\s*(\d+(?:\.\d+)?)\s*s?\s*$/)
  if (plain) return parseFloat(plain[1])
  return Number.POSITIVE_INFINITY
}

function sortByTime<T>(items: T[] | undefined, key: (item: T) => string | undefined): T[] {
  if (!items) return []
  return [...items]
    .map((item, originalIndex) => ({ item, originalIndex, seconds: parseTimestamp(key(item)) }))
    .sort((a, b) => {
      if (a.seconds !== b.seconds) return a.seconds - b.seconds
      return a.originalIndex - b.originalIndex
    })
    .map(x => x.item)
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h4
      className="text-[11px] font-semibold uppercase tracking-wider pt-2 pb-1"
      style={{ color: 'var(--text-2)', borderBottom: '1px solid var(--border)' }}
    >
      {children}
    </h4>
  )
}

function LabelledLine({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="text-[11px] leading-relaxed">
      <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>{label}: </span>
      <span style={{ color: 'var(--text)' }}>{value}</span>
    </div>
  )
}

function Pill({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'gold' | 'red' }) {
  const palette =
    tone === 'gold'
      ? { bg: 'rgba(212, 168, 67, 0.15)', color: 'var(--gold)' }
      : tone === 'red'
        ? { bg: 'rgba(239, 68, 68, 0.12)', color: 'var(--red)' }
        : { bg: 'var(--surface-2)', color: 'var(--text-3)' }
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider"
      style={{ background: palette.bg, color: palette.color }}
    >
      {children}
    </span>
  )
}

export default function EditingInstructionsView({ blueprint }: { blueprint: Record<string, unknown> }) {
  const bp = blueprint as unknown as Blueprint

  const sortedInstructions = sortByTime(bp.instructions, (i) => i.timestamp)
  const sortedBroll = sortByTime(bp.broll_research, (b) => b.timestamp)
  const sortedGraphics = sortByTime(bp.graphics_checklist, (g) => g.appears_at)
  const sortedMusic = sortByTime(bp.music_timeline, (m) => m.when)

  return (
    <div
      className="rounded-lg p-4 space-y-5 max-h-[640px] overflow-y-auto"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
    >
      {/* 1. Video Overview */}
      {bp.video_overview && (
        <section className="space-y-1.5">
          <SectionHeader>1. Video Overview</SectionHeader>
          <LabelledLine label="Topic" value={bp.video_overview.topic} />
          <LabelledLine label="Target Audience" value={bp.video_overview.target_audience} />
          <LabelledLine label="Content Type" value={bp.video_overview.content_type} />
          <LabelledLine label="Pacing Feel" value={bp.video_overview.pacing_feel} />
          <LabelledLine label="Creator Style" value={bp.video_overview.creator_style} />
        </section>
      )}

      {/* 2. Story Architecture */}
      {bp.story_architecture && bp.story_architecture.length > 0 && (
        <section className="space-y-2">
          <SectionHeader>2. Story Architecture</SectionHeader>
          <div className="space-y-2">
            {bp.story_architecture.map((beat, i) => (
              <div
                key={i}
                className="p-2 rounded text-[11px] leading-relaxed"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span style={{ color: 'var(--text)', fontWeight: 600 }}>{beat.beat}</span>
                  {beat.section && <Pill>{beat.section}</Pill>}
                </div>
                {beat.what_happens && <div style={{ color: 'var(--text-2)' }}>{beat.what_happens}</div>}
                {beat.attention_risk && (
                  <div className="mt-1 flex items-start gap-1.5">
                    <Pill tone="red">attention risk</Pill>
                    <span style={{ color: 'var(--text-3)' }}>{beat.attention_risk}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
          {bp.strongest_moment && (
            <div
              className="p-2 rounded text-[11px] italic"
              style={{ background: 'rgba(212, 168, 67, 0.08)', color: 'var(--text)', border: '1px solid var(--border)' }}
            >
              <span style={{ color: 'var(--gold)', fontWeight: 600 }}>Strongest moment: </span>
              &ldquo;{bp.strongest_moment}&rdquo;
            </div>
          )}
        </section>
      )}

      {/* 3. Section-by-Section Blueprint */}
      {sortedInstructions.length > 0 && (
        <section className="space-y-2">
          <SectionHeader>3. Section-by-Section Blueprint ({sortedInstructions.length})</SectionHeader>
          <div className="space-y-2">
            {sortedInstructions.map((inst, i) => (
              <div
                key={i}
                className="p-2 rounded space-y-1"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-mono" style={{ color: 'var(--text-3)' }}>#{i + 1}</span>
                  {inst.type && <Pill>{inst.type.replace(/_/g, ' ')}</Pill>}
                  {inst.priority === 'high' && <Pill tone="gold">high priority</Pill>}
                  {inst.timestamp && (
                    <span className="font-mono text-[10px]" style={{ color: 'var(--gold)' }}>{inst.timestamp}</span>
                  )}
                </div>
                <LabelledLine label="Action" value={inst.action} />
                <LabelledLine label="Details" value={inst.details} />
                <LabelledLine label="Duration" value={inst.duration} />
                <LabelledLine label="Why" value={inst.why} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 4. B-Roll Research */}
      {sortedBroll.length > 0 && (
        <section className="space-y-2">
          <SectionHeader>4. B-Roll Research ({sortedBroll.length})</SectionHeader>
          <div className="space-y-2">
            {sortedBroll.map((b, i) => (
              <div
                key={i}
                className="p-2 rounded space-y-1"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono" style={{ color: 'var(--text-3)' }}>#{i + 1}</span>
                  {b.source && <span className="text-[11px]" style={{ color: 'var(--text)', fontWeight: 600 }}>{b.source}</span>}
                  {b.timestamp && <Pill>{b.timestamp}</Pill>}
                </div>
                {b.url && (
                  <a
                    href={b.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-[10px] font-mono truncate hover:underline"
                    style={{ color: 'var(--gold)' }}
                  >
                    {b.url}
                  </a>
                )}
                <LabelledLine label="What to capture" value={b.what_to_capture} />
                <LabelledLine label="How to use" value={b.how_to_use} />
                <LabelledLine label="Duration on screen" value={b.duration_on_screen} />
                <LabelledLine label="Why this source" value={b.why_this_source} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 5. Graphics Checklist */}
      {sortedGraphics.length > 0 && (
        <section className="space-y-2">
          <SectionHeader>5. Graphics &amp; Overlays ({sortedGraphics.length})</SectionHeader>
          <div className="space-y-2">
            {sortedGraphics.map((g, i) => (
              <div
                key={i}
                className="p-2 rounded space-y-1"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-mono" style={{ color: 'var(--text-3)' }}>#{i + 1}</span>
                  {g.graphic_type && <Pill>{g.graphic_type.replace(/_/g, ' ')}</Pill>}
                  {g.position && <Pill>{g.position.replace(/_/g, ' ')}</Pill>}
                  {g.appears_at && (
                    <span className="font-mono text-[10px]" style={{ color: 'var(--gold)' }}>{g.appears_at}</span>
                  )}
                </div>
                {g.exact_text && (
                  <div
                    className="text-[12px] font-semibold p-1.5 rounded"
                    style={{ background: 'var(--surface-2)', color: 'var(--text)' }}
                  >
                    &ldquo;{g.exact_text}&rdquo;
                  </div>
                )}
                <LabelledLine label="Style" value={g.style} />
                <LabelledLine label="Hold time" value={g.hold_time} />
                <LabelledLine label="Purpose" value={g.purpose} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 6. Music Timeline */}
      {sortedMusic.length > 0 && (
        <section className="space-y-2">
          <SectionHeader>6. Music &amp; Audio Timeline ({sortedMusic.length})</SectionHeader>
          <div className="space-y-2">
            {sortedMusic.map((m, i) => (
              <div
                key={i}
                className="p-2 rounded space-y-1"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-mono" style={{ color: 'var(--text-3)' }}>#{i + 1}</span>
                  {m.when && (
                    <span className="font-mono text-[10px]" style={{ color: 'var(--gold)' }}>{m.when}</span>
                  )}
                </div>
                <LabelledLine label="What" value={m.what} />
                <LabelledLine label="Mood" value={m.mood} />
                <LabelledLine label="Why" value={m.why} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 7. Retention Notes */}
      {bp.retention_notes && (
        <section className="space-y-2">
          <SectionHeader>7. Retention &amp; Hook Notes</SectionHeader>
          {bp.retention_notes.hook_assessment && (
            <div className="text-[11px]">
              <div style={{ color: 'var(--text-3)', fontWeight: 600 }} className="mb-0.5">Hook Assessment</div>
              <div style={{ color: 'var(--text)' }}>{bp.retention_notes.hook_assessment}</div>
            </div>
          )}
          {bp.retention_notes.dropoff_risks && bp.retention_notes.dropoff_risks.length > 0 && (
            <div className="text-[11px]">
              <div style={{ color: 'var(--text-3)', fontWeight: 600 }} className="mb-0.5">Drop-off Risks</div>
              <ul className="list-disc pl-5 space-y-0.5">
                {bp.retention_notes.dropoff_risks.map((r, i) => (
                  <li key={i} style={{ color: 'var(--text)' }}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {bp.retention_notes.open_loop_opportunities && bp.retention_notes.open_loop_opportunities.length > 0 && (
            <div className="text-[11px]">
              <div style={{ color: 'var(--text-3)', fontWeight: 600 }} className="mb-0.5">Open Loop Opportunities</div>
              <ul className="list-disc pl-5 space-y-0.5">
                {bp.retention_notes.open_loop_opportunities.map((r, i) => (
                  <li key={i} style={{ color: 'var(--text)' }}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {bp.retention_notes.cta_approach && (
            <div className="text-[11px]">
              <div style={{ color: 'var(--text-3)', fontWeight: 600 }} className="mb-0.5">CTA Approach</div>
              <div style={{ color: 'var(--text)' }}>{bp.retention_notes.cta_approach}</div>
            </div>
          )}
        </section>
      )}

      {bp.general_notes && bp.general_notes.length > 0 && (
        <section className="space-y-1">
          <SectionHeader>Notes</SectionHeader>
          <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
            {bp.general_notes.map((n, i) => (
              <li key={i} style={{ color: 'var(--text-2)' }}>{n}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
