'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { History, CheckCircle2, XCircle, ArrowRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getGoogleDriveEmbedUrl } from '@/lib/utils/google-drive'
import { timeAgo } from '@/lib/utils/date'
import { QC_CHECKLIST_ITEMS } from '@/lib/constants'
import type { QCNote, QCChecklistResult } from '@/lib/supabase/types'

interface VersionInfo {
  id: string
  title: string
  created_at: string
  external_url: string | null
}

interface VersionComparisonProps {
  currentVersion: VersionInfo
  previousVersion: VersionInfo
  onClose: () => void
}

export default function VersionComparison({
  currentVersion,
  previousVersion,
  onClose,
}: VersionComparisonProps) {
  const supabase = createClient()
  const [prevNotes, setPrevNotes] = useState<QCNote[]>([])
  const [prevChecklist, setPrevChecklist] = useState<QCChecklistResult | null>(null)
  const [currChecklist, setCurrChecklist] = useState<QCChecklistResult | null>(null)
  const [loading, setLoading] = useState(true)

  const loadComparisonData = useCallback(async () => {
    setLoading(true)

    const [notesRes, prevCheckRes, currCheckRes] = await Promise.all([
      supabase
        .from('qc_notes')
        .select('*')
        .eq('submission_id', previousVersion.id)
        .order('timestamp_seconds', { ascending: true, nullsFirst: false }),
      supabase
        .from('qc_checklist_results')
        .select('*')
        .eq('submission_id', previousVersion.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('qc_checklist_results')
        .select('*')
        .eq('submission_id', currentVersion.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    setPrevNotes((notesRes.data || []) as QCNote[])
    if (prevCheckRes.data) setPrevChecklist(prevCheckRes.data as QCChecklistResult)
    if (currCheckRes.data) setCurrChecklist(currCheckRes.data as QCChecklistResult)
    setLoading(false)
  }, [supabase, previousVersion.id, currentVersion.id])

  useEffect(() => {
    loadComparisonData()
  }, [loadComparisonData])

  const prevEmbedUrl = previousVersion.external_url ? getGoogleDriveEmbedUrl(previousVersion.external_url) : null
  const currEmbedUrl = currentVersion.external_url ? getGoogleDriveEmbedUrl(currentVersion.external_url) : null

  return (
    <div className="card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History size={14} style={{ color: 'var(--gold)' }} />
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--gold)' }}>
            Version Comparison
          </h3>
        </div>
        <button onClick={onClose} className="text-xs" style={{ color: 'var(--text-3)' }}>
          Close
        </button>
      </div>

      {/* Side-by-side videos */}
      <div className="grid grid-cols-2 gap-3">
        {/* Previous */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <span className="w-2 h-2 rounded-full" style={{ background: 'var(--amber)' }} />
            <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--amber)' }}>
              Previous
            </span>
            <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
              {timeAgo(previousVersion.created_at)}
            </span>
          </div>
          {prevEmbedUrl ? (
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
                <iframe src={prevEmbedUrl} className="absolute inset-0 w-full h-full" allow="autoplay; encrypted-media" allowFullScreen />
              </div>
            </div>
          ) : (
            <div className="rounded-lg p-8 text-center text-xs" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>
              No video available
            </div>
          )}
        </div>

        {/* Current */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <span className="w-2 h-2 rounded-full" style={{ background: 'var(--green)' }} />
            <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--green)' }}>
              Current
            </span>
            <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
              {timeAgo(currentVersion.created_at)}
            </span>
          </div>
          {currEmbedUrl ? (
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
                <iframe src={currEmbedUrl} className="absolute inset-0 w-full h-full" allow="autoplay; encrypted-media" allowFullScreen />
              </div>
            </div>
          ) : (
            <div className="rounded-lg p-8 text-center text-xs" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>
              No video available
            </div>
          )}
        </div>
      </div>

      {/* Checklist Diff */}
      {(prevChecklist || currChecklist) && !loading && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>
            Checklist Changes
          </h4>
          <div className="space-y-1">
            {QC_CHECKLIST_ITEMS.map(item => {
              const prevVal = prevChecklist ? (prevChecklist as unknown as Record<string, unknown>)[item.key] as boolean : undefined
              const currVal = currChecklist ? (currChecklist as unknown as Record<string, unknown>)[item.key] as boolean : undefined

              // Determine change type
              let changeType: 'fixed' | 'regressed' | 'unchanged' | 'new' = 'unchanged'
              if (prevVal === false && currVal === true) changeType = 'fixed'
              else if (prevVal === true && currVal === false) changeType = 'regressed'
              else if (prevVal === undefined && currVal !== undefined) changeType = 'new'

              if (changeType === 'unchanged') return null

              return (
                <div
                  key={item.key}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px]"
                  style={{
                    background: changeType === 'fixed'
                      ? 'rgba(34, 197, 94, 0.08)'
                      : changeType === 'regressed'
                        ? 'rgba(239, 68, 68, 0.08)'
                        : 'var(--surface-2)',
                    border: changeType === 'fixed'
                      ? '1px solid rgba(34, 197, 94, 0.2)'
                      : changeType === 'regressed'
                        ? '1px solid rgba(239, 68, 68, 0.2)'
                        : '1px solid var(--border)',
                  }}
                >
                  {changeType === 'fixed' ? (
                    <CheckCircle2 size={12} style={{ color: 'var(--green)' }} />
                  ) : changeType === 'regressed' ? (
                    <XCircle size={12} style={{ color: 'var(--red)' }} />
                  ) : null}
                  <span style={{ color: 'var(--text-2)' }}>{item.label}</span>
                  <ArrowRight size={10} style={{ color: 'var(--text-3)' }} />
                  <span style={{
                    color: changeType === 'fixed' ? 'var(--green)' : changeType === 'regressed' ? 'var(--red)' : 'var(--text-2)',
                    fontWeight: 600,
                  }}>
                    {changeType === 'fixed' ? 'Fixed' : changeType === 'regressed' ? 'Regressed' : 'New'}
                  </span>
                </div>
              )
            })}
            {/* If nothing changed */}
            {QC_CHECKLIST_ITEMS.every(item => {
              const prev = prevChecklist ? (prevChecklist as unknown as Record<string, unknown>)[item.key] : undefined
              const curr = currChecklist ? (currChecklist as unknown as Record<string, unknown>)[item.key] : undefined
              return prev === curr
            }) && (
              <p className="text-[10px] py-1" style={{ color: 'var(--text-3)' }}>No checklist changes between versions</p>
            )}
          </div>
        </div>
      )}

      {/* Previous Notes */}
      {prevNotes.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>
            Previous Notes ({prevNotes.length})
          </h4>
          <div className="space-y-1.5">
            {prevNotes.map(note => {
              // Check if a matching note exists in current version's notes (resolved)
              const isResolved = note.is_resolved
              return (
                <div
                  key={note.id}
                  className="px-2.5 py-2 rounded-md text-[11px]"
                  style={{
                    background: isResolved ? 'rgba(34, 197, 94, 0.05)' : 'rgba(239, 68, 68, 0.05)',
                    border: isResolved ? '1px solid rgba(34, 197, 94, 0.15)' : '1px solid rgba(239, 68, 68, 0.15)',
                    textDecoration: isResolved ? 'line-through' : 'none',
                    opacity: isResolved ? 0.7 : 1,
                  }}
                >
                  <div className="flex items-center gap-2">
                    {note.timestamp_seconds !== null && (
                      <span className="text-[10px] font-mono" style={{ color: 'var(--text-3)' }}>
                        {Math.floor(note.timestamp_seconds / 60)}:{String(note.timestamp_seconds % 60).padStart(2, '0')}
                      </span>
                    )}
                    <span style={{ color: isResolved ? 'var(--green)' : 'var(--text-2)' }}>
                      {note.note}
                    </span>
                    {isResolved && (
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{
                        background: 'rgba(34, 197, 94, 0.15)', color: 'var(--green)',
                      }}>
                        Resolved
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>
                      {note.author_name} · {note.category}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {loading && (
        <div className="text-center py-4 text-xs" style={{ color: 'var(--text-3)' }}>
          Loading comparison data...
        </div>
      )}
    </div>
  )
}
