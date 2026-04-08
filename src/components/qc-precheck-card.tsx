'use client'

import React, { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, Volume2, Type } from 'lucide-react'
import { analyzeAudioFromWords, getAudioSummary, type AudioIssue } from '@/lib/ai/audio-analyzer'

interface SpellingResult {
  id: string
  frame_timestamp_seconds: number
  detected_text: string
  issue_description: string
  suggested_fix: string
  confidence: number
  status: string
}

interface DeepgramWord {
  word: string
  start: number
  end: number
  confidence: number
  punctuated_word?: string
}

interface QCPreCheckCardProps {
  spellingResults: SpellingResult[]
  deepgramWords: DeepgramWord[]
  onSeekToTimestamp?: (seconds: number) => void
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const SEVERITY_COLORS = {
  high: { bg: 'rgba(239, 68, 68, 0.1)', color: 'var(--red)', border: 'rgba(239, 68, 68, 0.25)' },
  medium: { bg: 'rgba(245, 158, 11, 0.1)', color: 'var(--amber)', border: 'rgba(245, 158, 11, 0.25)' },
  low: { bg: 'rgba(107, 114, 128, 0.08)', color: 'var(--text-3)', border: 'rgba(107, 114, 128, 0.15)' },
}

export default function QCPreCheckCard({ spellingResults, deepgramWords, onSeekToTimestamp }: QCPreCheckCardProps) {
  const [spellingExpanded, setSpellingExpanded] = useState(false)
  const [audioExpanded, setAudioExpanded] = useState(false)

  // Compute audio issues from Deepgram words
  const audioIssues = useMemo(() => analyzeAudioFromWords(deepgramWords), [deepgramWords])
  const audioSummary = useMemo(() => getAudioSummary(audioIssues), [audioIssues])

  // Filter to only flagged spelling results
  const flaggedSpelling = spellingResults.filter(r => r.status === 'flagged')

  const totalIssues = flaggedSpelling.length + audioSummary.total
  const hasHighSeverity = audioSummary.high > 0 || flaggedSpelling.length > 0
  const hasAnyIssues = totalIssues > 0

  // Don't render if no data to analyze
  if (!deepgramWords.length && !spellingResults.length) return null

  const statusDot = hasHighSeverity
    ? 'var(--red)'
    : hasAnyIssues
      ? 'var(--amber)'
      : 'var(--green)'

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
          <span
            className="w-2 h-2 rounded-full inline-block"
            style={{ background: statusDot }}
          />
          AI Pre-Check
        </h3>
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{
          background: hasHighSeverity ? 'rgba(239, 68, 68, 0.1)' : hasAnyIssues ? 'rgba(245, 158, 11, 0.1)' : 'rgba(34, 197, 94, 0.1)',
          color: hasHighSeverity ? 'var(--red)' : hasAnyIssues ? 'var(--amber)' : 'var(--green)',
        }}>
          {totalIssues === 0 ? 'All Clear' : `${totalIssues} issue${totalIssues !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Spelling Risks Section */}
      {spellingResults.length > 0 && (
        <div className="mb-2">
          <button
            onClick={() => setSpellingExpanded(!spellingExpanded)}
            className="w-full flex items-center justify-between py-1.5 text-xs"
            style={{ color: 'var(--text-2)' }}
          >
            <span className="flex items-center gap-1.5">
              {spellingExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <Type size={12} />
              Spelling Risks ({flaggedSpelling.length} flagged)
            </span>
          </button>

          {spellingExpanded && (
            <div className="space-y-1.5 mt-1 pl-5">
              {flaggedSpelling.length === 0 ? (
                <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>No active spelling flags</p>
              ) : (
                flaggedSpelling.map(r => (
                  <div
                    key={r.id}
                    className="flex items-start gap-2 p-2 rounded-md text-[11px] cursor-pointer transition-all hover:opacity-80"
                    style={{ background: 'rgba(239, 68, 68, 0.06)', border: '1px solid rgba(239, 68, 68, 0.15)' }}
                    onClick={() => onSeekToTimestamp?.(r.frame_timestamp_seconds)}
                  >
                    <span className="text-[10px] font-mono shrink-0 mt-0.5" style={{ color: 'var(--text-3)' }}>
                      {formatTimestamp(r.frame_timestamp_seconds)}
                    </span>
                    <div className="min-w-0">
                      <span style={{ color: 'var(--text)' }}>&quot;{r.detected_text}&quot;</span>
                      <span className="ml-1" style={{ color: 'var(--text-3)' }}>→</span>
                      <span className="ml-1 font-medium" style={{ color: 'var(--green)' }}>{r.suggested_fix}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Audio Issues Section */}
      {deepgramWords.length > 0 && (
        <div>
          <button
            onClick={() => setAudioExpanded(!audioExpanded)}
            className="w-full flex items-center justify-between py-1.5 text-xs"
            style={{ color: 'var(--text-2)' }}
          >
            <span className="flex items-center gap-1.5">
              {audioExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <Volume2 size={12} />
              Audio Analysis ({audioSummary.total} issue{audioSummary.total !== 1 ? 's' : ''})
            </span>
            {audioSummary.high > 0 && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{
                background: 'rgba(239, 68, 68, 0.1)', color: 'var(--red)',
              }}>
                {audioSummary.high} high
              </span>
            )}
          </button>

          {audioExpanded && (
            <div className="space-y-1.5 mt-1 pl-5">
              {audioIssues.length === 0 ? (
                <div className="flex items-center gap-1.5 py-1 text-[10px]" style={{ color: 'var(--green)' }}>
                  <CheckCircle2 size={11} />
                  No audio issues detected
                </div>
              ) : (
                audioIssues.map((issue, i) => (
                  <AudioIssueRow
                    key={`${issue.type}-${issue.start_seconds}-${i}`}
                    issue={issue}
                    onSeek={onSeekToTimestamp}
                  />
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* All clear message */}
      {!hasAnyIssues && deepgramWords.length > 0 && (
        <div className="flex items-center gap-1.5 py-2 text-xs" style={{ color: 'var(--green)' }}>
          <CheckCircle2 size={13} />
          No issues detected — looking good!
        </div>
      )}
    </div>
  )
}

function AudioIssueRow({ issue, onSeek }: { issue: AudioIssue; onSeek?: (s: number) => void }) {
  const colors = SEVERITY_COLORS[issue.severity]
  return (
    <div
      className="flex items-start gap-2 p-2 rounded-md text-[11px] cursor-pointer transition-all hover:opacity-80"
      style={{ background: colors.bg, border: `1px solid ${colors.border}` }}
      onClick={() => onSeek?.(issue.start_seconds)}
    >
      <span className="text-[10px] font-mono shrink-0 mt-0.5" style={{ color: 'var(--text-3)' }}>
        {formatTimestamp(issue.start_seconds)}
      </span>
      <div className="flex-1 min-w-0">
        <span style={{ color: 'var(--text-2)' }}>{issue.description}</span>
      </div>
      <span className="text-[9px] font-medium uppercase shrink-0 px-1 py-0.5 rounded" style={{
        color: colors.color,
      }}>
        {issue.severity}
      </span>
    </div>
  )
}
