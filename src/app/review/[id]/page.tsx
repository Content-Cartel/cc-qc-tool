'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { ArrowLeft, ExternalLink, User, Calendar, Hash, RefreshCw, Trash2, Pencil, X, ChevronDown } from 'lucide-react'
import Nav from '@/components/nav'
import { StatusBadge, ContentTypeBadge, EditingLevelBadge } from '@/components/status-badge'
import { PipelineStageLabel } from '@/components/pipeline-tracker'
import PipelineTracker from '@/components/pipeline-tracker'
import QCChecklist from '@/components/qc-checklist'
import VideoPlayerNotes from '@/components/video-player-notes'
import BrandReference from '@/components/brand-reference'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { timeAgo, formatDateTime } from '@/lib/utils/date'
import { getGoogleDriveEmbedUrl } from '@/lib/utils/google-drive'
import { NOTE_CATEGORIES, STATUS_CONFIG, EDITING_LEVEL_CONFIG } from '@/lib/constants'
import type { QCChecklistKey, PipelineStageKey } from '@/lib/constants'
import type { QCNote, NoteCategory, QCChecklistResult, EditingLevel, SubmissionStatus } from '@/lib/supabase/types'

interface SubmissionDetail {
  id: string
  title: string
  description: string | null
  status: string
  content_type: string
  submitted_by_name: string
  pm_reviewed_by_name: string | null
  pm_reviewed_at: string | null
  revision_of: string | null
  revision_count: number
  external_url: string | null
  client_id: number
  client_name: string
  current_pipeline_stage: PipelineStageKey
  editing_level: EditingLevel | null
  deadline: string | null
  qc_score: number | null
  created_at: string
  clients?: { name: string } | null
}

export default function ReviewPage() {
  const router = useRouter()
  const params = useParams()
  const supabase = createClient()
  const { user, isPM } = useAuth()
  const submissionId = params.id as string

  const [submission, setSubmission] = useState<SubmissionDetail | null>(null)
  const [notes, setNotes] = useState<QCNote[]>([])
  const [existingChecklist, setExistingChecklist] = useState<QCChecklistResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [noteCategory, setNoteCategory] = useState<NoteCategory>('creative')
  const [editingGeneralNoteId, setEditingGeneralNoteId] = useState<string | null>(null)
  const [editGeneralText, setEditGeneralText] = useState('')
  const [deletingGeneralNoteId, setDeletingGeneralNoteId] = useState<string | null>(null)

  const userName = user || 'PM'

  const loadSubmission = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('qc_submissions')
      .select('*, clients(name)')
      .eq('id', submissionId)
      .single()

    if (data) {
      setSubmission({
        ...data,
        client_name: (data as unknown as { clients?: { name: string } }).clients?.name || 'Unknown',
      } as SubmissionDetail)
    }
    setLoading(false)
  }, [supabase, submissionId])

  const loadNotes = useCallback(async () => {
    const { data } = await supabase
      .from('qc_notes')
      .select('*')
      .eq('submission_id', submissionId)
      .order('timestamp_seconds', { ascending: true, nullsFirst: false })

    setNotes(data || [])
  }, [supabase, submissionId])

  const loadChecklist = useCallback(async () => {
    const { data } = await supabase
      .from('qc_checklist_results')
      .select('*')
      .eq('submission_id', submissionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (data) setExistingChecklist(data as QCChecklistResult)
  }, [supabase, submissionId])

  useEffect(() => {
    loadSubmission()
    loadNotes()
    loadChecklist()
  }, [loadSubmission, loadNotes, loadChecklist])

  async function handleAddNote(note: string, timestampSeconds: number, category: NoteCategory) {
    await supabase.from('qc_notes').insert({
      submission_id: submissionId,
      author_name: userName,
      note,
      timestamp_seconds: timestampSeconds,
      category,
    })
    await loadNotes()
  }

  async function handleAddGeneralNote() {
    if (!newNote.trim()) return
    await supabase.from('qc_notes').insert({
      submission_id: submissionId,
      author_name: userName,
      note: newNote.trim(),
      timestamp_seconds: null,
      category: noteCategory,
    })
    setNewNote('')
    await loadNotes()
  }

  async function handleResolveNote(noteId: string) {
    await supabase
      .from('qc_notes')
      .update({ is_resolved: true, resolved_at: new Date().toISOString() })
      .eq('id', noteId)
    await loadNotes()
  }

  async function handleEditNote(noteId: string, newText: string) {
    await supabase
      .from('qc_notes')
      .update({ note: newText })
      .eq('id', noteId)
    await loadNotes()
  }

  async function handleDeleteNote(noteId: string) {
    await supabase
      .from('qc_notes')
      .delete()
      .eq('id', noteId)
    await loadNotes()
  }

  async function handleSaveAnnotation(imageDataUrl: string, timestampSeconds: number) {
    await supabase.from('qc_notes').insert({
      submission_id: submissionId,
      author_name: userName,
      note: `[Annotation at ${Math.floor(timestampSeconds / 60)}:${String(Math.floor(timestampSeconds % 60)).padStart(2, '0')}]`,
      timestamp_seconds: timestampSeconds,
      category: 'creative' as NoteCategory,
    })
    await loadNotes()
  }

  async function handleDeleteSubmission() {
    if (!submission) return
    setActionLoading(true)
    // Delete associated data first
    await supabase.from('qc_notes').delete().eq('submission_id', submissionId)
    await supabase.from('qc_checklist_results').delete().eq('submission_id', submissionId)
    try {
      await supabase.from('pipeline_stages').delete().eq('submission_id', submissionId)
    } catch {
      // Table may not exist
    }
    await supabase.from('qc_submissions').delete().eq('id', submissionId)
    setActionLoading(false)
    router.push('/dashboard')
  }

  async function handleChecklistSubmit(results: Record<QCChecklistKey, boolean>, overallPass: boolean) {
    setActionLoading(true)

    const passedCount = Object.values(results).filter(Boolean).length

    // Save checklist results
    await supabase.from('qc_checklist_results').insert({
      submission_id: submissionId,
      reviewer_name: userName,
      ...results,
      total_passed: passedCount,
      total_items: 10,
      overall_pass: overallPass,
    })

    // Update submission status
    const newStatus = overallPass ? 'approved' : 'revision_requested'
    await supabase
      .from('qc_submissions')
      .update({
        status: newStatus,
        pm_decision: newStatus,
        pm_reviewed_by_name: userName,
        pm_reviewed_at: new Date().toISOString(),
        qc_score: passedCount,
      })
      .eq('id', submissionId)

    await loadSubmission()
    await loadChecklist()
    setActionLoading(false)
  }

  async function handleAdvancePipeline(nextStage: PipelineStageKey) {
    if (!submission) return
    await supabase
      .from('qc_submissions')
      .update({ current_pipeline_stage: nextStage })
      .eq('id', submissionId)

    // Track in pipeline_stages table
    try {
      await supabase.from('pipeline_stages').insert({
        submission_id: submissionId,
        stage: nextStage,
        entered_at: new Date().toISOString(),
      })
    } catch {
      // Table may not exist yet
    }

    await loadSubmission()
  }

  async function handleStatusChange(newStatus: SubmissionStatus) {
    if (!submission || submission.status === newStatus) return
    const statusLabel = STATUS_CONFIG[newStatus]?.label || newStatus
    await supabase
      .from('qc_submissions')
      .update({
        status: newStatus,
        pm_reviewed_by_name: userName,
        pm_reviewed_at: new Date().toISOString(),
      })
      .eq('id', submissionId)

    // Notify the editor
    await supabase.from('notifications').insert({
      user_name: submission.submitted_by_name,
      submission_id: submissionId,
      message: `Your video "${submission.title}" status changed to ${statusLabel}`,
      type: 'status_change',
    })

    await loadSubmission()
  }

  async function handleEditingLevelChange(level: EditingLevel) {
    if (!submission) return
    await supabase
      .from('qc_submissions')
      .update({ editing_level: level })
      .eq('id', submissionId)
    await loadSubmission()
  }

  if (loading) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
        <Nav />
        <main className="max-w-7xl mx-auto px-4 py-8">
          <div className="space-y-4">
            <div className="card p-6 animate-shimmer h-16" />
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <div className="lg:col-span-3 space-y-4">
                <div className="card animate-shimmer aspect-video" />
                <div className="card p-6 animate-shimmer h-32" />
              </div>
              <div className="lg:col-span-2 space-y-4">
                <div className="card p-6 animate-shimmer h-64" />
                <div className="card p-6 animate-shimmer h-48" />
              </div>
            </div>
          </div>
        </main>
      </div>
    )
  }

  if (!submission) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
        <Nav />
        <main className="max-w-7xl mx-auto px-4 py-8">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card p-12 text-center">
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>Submission not found.</p>
            <button onClick={() => router.back()} className="btn-secondary text-sm mt-4">
              Go Back
            </button>
          </motion.div>
        </main>
      </div>
    )
  }

  const videoUrl = submission.external_url
    ? getGoogleDriveEmbedUrl(submission.external_url) || submission.external_url
    : null

  const isReviewed = submission.status === 'approved' || submission.status === 'revision_requested'

  // Convert existing checklist result to Record<string, boolean>
  const existingChecklistData = existingChecklist ? {
    audio_quality: existingChecklist.audio_quality,
    filler_words: existingChecklist.filler_words,
    flow_pacing: existingChecklist.flow_pacing,
    branding: existingChecklist.branding,
    cta_present: existingChecklist.cta_present,
    both_versions: existingChecklist.both_versions,
    links_description: existingChecklist.links_description,
    spelling_names: existingChecklist.spelling_names,
    client_specific_rules: existingChecklist.client_specific_rules,
    thumbnail_ready: existingChecklist.thumbnail_ready,
  } : undefined

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <Nav />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          {/* Header */}
          <div className="flex items-start justify-between mb-5">
            <div>
              <button
                onClick={() => router.back()}
                className="text-xs flex items-center gap-1 mb-2 transition-colors hover:opacity-80"
                style={{ color: 'var(--text-3)' }}
              >
                <ArrowLeft size={12} />
                Back
              </button>
              <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>
                {submission.title}
                {submission.revision_of && (
                  <span className="ml-2 text-sm font-normal" style={{ color: 'var(--blue)' }}>
                    (Resubmission)
                  </span>
                )}
              </h1>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {isPM ? (
                  <div className="relative inline-flex items-center">
                    <select
                      value={submission.status}
                      onChange={(e) => handleStatusChange(e.target.value as SubmissionStatus)}
                      className="appearance-none text-xs font-medium px-2.5 py-1 pr-6 rounded-full cursor-pointer border-0 outline-none"
                      style={{
                        background: `var(--${STATUS_CONFIG[submission.status as keyof typeof STATUS_CONFIG]?.color || 'blue'})`,
                        color: '#fff',
                      }}
                    >
                      {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                        <option key={key} value={key} style={{ color: '#000' }}>{cfg.label}</option>
                      ))}
                    </select>
                    <ChevronDown size={10} className="absolute right-1.5 pointer-events-none" style={{ color: '#fff' }} />
                  </div>
                ) : (
                  <StatusBadge status={submission.status} />
                )}
                <ContentTypeBadge type={submission.content_type} />
                <EditingLevelBadge level={submission.editing_level} />
                {submission.current_pipeline_stage && (
                  <PipelineStageLabel stage={submission.current_pipeline_stage} />
                )}
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                  {submission.client_name}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Drive link */}
              {submission.external_url && (
                <a
                  href={submission.external_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary text-xs flex items-center gap-1.5"
                >
                  <ExternalLink size={12} />
                  Google Drive
                </a>
              )}

              {/* Delete submission (PM only) */}
              {isPM && !showDeleteConfirm && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="btn-secondary text-xs flex items-center gap-1.5"
                  style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
                >
                  <Trash2 size={12} />
                  Delete
                </button>
              )}
              {isPM && showDeleteConfirm && (
                <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--red)' }}>
                  <span className="text-xs" style={{ color: 'var(--red)' }}>Delete this submission?</span>
                  <button
                    onClick={handleDeleteSubmission}
                    disabled={actionLoading}
                    className="text-xs px-3 py-1 rounded"
                    style={{ background: 'var(--red)', color: '#fff' }}
                  >
                    {actionLoading ? 'Deleting...' : 'Yes, delete'}
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="btn-secondary text-xs"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Pipeline tracker (PM only) */}
          {isPM && submission.current_pipeline_stage && (
            <div className="card p-4 mb-5">
              <h3 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>
                Pipeline Stage
              </h3>
              <PipelineTracker
                currentStage={submission.current_pipeline_stage}
                onAdvance={handleAdvancePipeline}
              />
            </div>
          )}

          {/* Two-column layout */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
            {/* Left: Video + Notes */}
            <div className="lg:col-span-3 space-y-5">
              {/* Video Player */}
              {videoUrl && (
                <VideoPlayerNotes
                  url={videoUrl}
                  notes={notes}
                  onAddNote={handleAddNote}
                  onResolveNote={handleResolveNote}
                  onEditNote={handleEditNote}
                  onDeleteNote={handleDeleteNote}
                  onSaveAnnotation={handleSaveAnnotation}
                  readOnly={!isPM}
                />
              )}

              {/* No embed fallback */}
              {!videoUrl && submission.external_url && (
                <div className="card p-6 text-center">
                  <p className="text-sm mb-3" style={{ color: 'var(--text-3)' }}>
                    Video cannot be embedded directly.
                  </p>
                  <a
                    href={submission.external_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary text-sm inline-flex items-center gap-1.5"
                  >
                    <ExternalLink size={14} />
                    Open in Google Drive
                  </a>
                </div>
              )}

              {/* Description */}
              {submission.description && (
                <div className="card p-4">
                  <h3 className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>
                    Description
                  </h3>
                  <p className="text-sm" style={{ color: 'var(--text-2)' }}>{submission.description}</p>
                </div>
              )}

              {/* General Notes (PM only) */}
              {isPM && (
                <div className="card p-4 space-y-3">
                  <h3 className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                    Add General Note
                  </h3>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      className="input flex-1"
                      placeholder="Add a general note..."
                      onKeyDown={(e) => e.key === 'Enter' && handleAddGeneralNote()}
                    />
                    <select
                      value={noteCategory}
                      onChange={(e) => setNoteCategory(e.target.value as NoteCategory)}
                      className="input w-auto"
                    >
                      {NOTE_CATEGORIES.map(c => (
                        <option key={c.key} value={c.key}>{c.label}</option>
                      ))}
                    </select>
                    <button onClick={handleAddGeneralNote} className="btn-primary text-xs">
                      Add
                    </button>
                  </div>

                  {/* General notes list */}
                  {notes.filter(n => n.timestamp_seconds === null).length > 0 && (
                    <div className="space-y-2 mt-3">
                      {notes.filter(n => n.timestamp_seconds === null).map((note) => (
                        <div
                          key={note.id}
                          className="p-3 rounded-lg group"
                          style={{
                            background: 'var(--surface-2)',
                            opacity: note.is_resolved ? 0.5 : 1,
                          }}
                        >
                          {editingGeneralNoteId === note.id ? (
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={editGeneralText}
                                onChange={(e) => setEditGeneralText(e.target.value)}
                                className="input flex-1 text-sm py-1"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && editGeneralText.trim()) {
                                    handleEditNote(note.id, editGeneralText.trim())
                                    setEditingGeneralNoteId(null)
                                  }
                                  if (e.key === 'Escape') setEditingGeneralNoteId(null)
                                }}
                              />
                              <button
                                onClick={() => {
                                  if (editGeneralText.trim()) {
                                    handleEditNote(note.id, editGeneralText.trim())
                                    setEditingGeneralNoteId(null)
                                  }
                                }}
                                className="btn-primary text-[10px] px-2 py-1"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingGeneralNoteId(null)}
                                className="btn-secondary text-[10px] px-2 py-1"
                              >
                                <X size={10} />
                              </button>
                            </div>
                          ) : (
                            <>
                              <p
                                className="text-sm"
                                style={{
                                  color: 'var(--text)',
                                  textDecoration: note.is_resolved ? 'line-through' : 'none',
                                }}
                              >
                                {note.note}
                              </p>
                              <div className="flex items-center gap-2 mt-1.5">
                                <span className="badge badge-neutral text-[10px]">{note.category || 'general'}</span>
                                <span className="text-xs" style={{ color: 'var(--text-3)' }}>{note.author_name}</span>
                                <div className="flex items-center gap-1 ml-auto">
                                  {!note.is_resolved && (
                                    <>
                                      <button
                                        onClick={() => {
                                          setEditingGeneralNoteId(note.id)
                                          setEditGeneralText(note.note)
                                        }}
                                        className="p-1 rounded opacity-0 group-hover:opacity-100 transition-all"
                                        style={{ color: 'var(--text-3)' }}
                                        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--blue)')}
                                        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-3)')}
                                        title="Edit"
                                      >
                                        <Pencil size={11} />
                                      </button>
                                      <button
                                        onClick={() => handleResolveNote(note.id)}
                                        className="text-xs transition-colors"
                                        style={{ color: 'var(--text-3)' }}
                                        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--green)')}
                                        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-3)')}
                                      >
                                        Resolve
                                      </button>
                                    </>
                                  )}
                                  {note.is_resolved && (
                                    <span className="text-xs" style={{ color: 'var(--green)' }}>Resolved</span>
                                  )}
                                  {deletingGeneralNoteId === note.id ? (
                                    <div className="flex items-center gap-1">
                                      <span className="text-[10px]" style={{ color: 'var(--red)' }}>Delete?</span>
                                      <button
                                        onClick={() => {
                                          handleDeleteNote(note.id)
                                          setDeletingGeneralNoteId(null)
                                        }}
                                        className="text-[10px] px-1.5 py-0.5 rounded"
                                        style={{ background: 'var(--red)', color: '#fff' }}
                                      >
                                        Yes
                                      </button>
                                      <button
                                        onClick={() => setDeletingGeneralNoteId(null)}
                                        className="text-[10px] px-1.5 py-0.5 rounded"
                                        style={{ background: 'var(--surface)', color: 'var(--text-3)' }}
                                      >
                                        No
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => setDeletingGeneralNoteId(note.id)}
                                      className="p-1 rounded opacity-0 group-hover:opacity-100 transition-all"
                                      style={{ color: 'var(--text-3)' }}
                                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--red)')}
                                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-3)')}
                                      title="Delete"
                                    >
                                      <Trash2 size={11} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right: QC Checklist + Details */}
            <div className="lg:col-span-2 space-y-4">
              {/* QC Checklist (PM only) */}
              {isPM && (
                <div className="card p-4">
                  <QCChecklist
                    onSubmit={handleChecklistSubmit}
                    existingResults={existingChecklistData}
                    readOnly={isReviewed}
                    loading={actionLoading}
                  />
                </div>
              )}

              {/* Brand Reference */}
              <BrandReference
                clientId={submission.client_id}
                clientName={submission.client_name}
                contentType={submission.content_type}
              />

              {/* QC Score display for editors */}
              {!isPM && submission.qc_score !== null && (
                <div className="card p-4">
                  <h3 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>
                    QC Score
                  </h3>
                  <div className="text-center py-4">
                    <span className="text-3xl font-bold" style={{
                      color: submission.qc_score >= 10 ? 'var(--green)' : 'var(--red)'
                    }}>
                      {submission.qc_score}/10
                    </span>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                      {submission.qc_score >= 10 ? 'All checks passed' : `${10 - submission.qc_score} item(s) failed`}
                    </p>
                  </div>
                </div>
              )}

              {/* Editing Level (PM only) */}
              {isPM && (
                <div className="card p-4">
                  <h3 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>
                    Editing Level
                  </h3>
                  <div className="space-y-1.5">
                    {(Object.entries(EDITING_LEVEL_CONFIG) as [EditingLevel, typeof EDITING_LEVEL_CONFIG[EditingLevel]][]).map(([key, cfg]) => (
                      <button
                        key={key}
                        onClick={() => handleEditingLevelChange(key)}
                        className="w-full text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center justify-between"
                        style={{
                          background: submission.editing_level === key ? 'var(--surface-2)' : 'transparent',
                          border: submission.editing_level === key ? `1px solid var(--${cfg.color})` : '1px solid transparent',
                          color: submission.editing_level === key ? 'var(--text)' : 'var(--text-3)',
                        }}
                      >
                        <div>
                          <span className="font-medium">{cfg.label}</span>
                          <span className="ml-2 opacity-70">{cfg.description}</span>
                        </div>
                        {submission.editing_level === key && (
                          <span className="text-[10px] font-semibold" style={{ color: `var(--${cfg.color})` }}>Active</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Submission Details */}
              <div className="card p-4">
                <h3 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>
                  Details
                </h3>
                <dl className="space-y-3">
                  <div className="flex items-center justify-between">
                    <dt className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                      <Calendar size={11} />
                      Submitted
                    </dt>
                    <dd className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                      {timeAgo(submission.created_at)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                      <User size={11} />
                      Editor
                    </dt>
                    <dd className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                      {submission.submitted_by_name}
                    </dd>
                  </div>
                  {submission.pm_reviewed_at && (
                    <div className="flex items-center justify-between">
                      <dt className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                        <Calendar size={11} />
                        Reviewed
                      </dt>
                      <dd className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                        {formatDateTime(submission.pm_reviewed_at)}
                      </dd>
                    </div>
                  )}
                  {submission.pm_reviewed_by_name && (
                    <div className="flex items-center justify-between">
                      <dt className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                        <User size={11} />
                        Reviewer
                      </dt>
                      <dd className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                        {submission.pm_reviewed_by_name}
                      </dd>
                    </div>
                  )}
                  {submission.revision_count > 0 && (
                    <div className="flex items-center justify-between">
                      <dt className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                        <Hash size={11} />
                        Revision
                      </dt>
                      <dd className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                        #{submission.revision_count}
                      </dd>
                    </div>
                  )}
                </dl>

                {/* Resubmit link for revision_requested */}
                {submission.status === 'revision_requested' && !isPM && (
                  <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                    <a
                      href={`/submit?revision_of=${submission.id}`}
                      className="btn-danger w-full text-xs flex items-center justify-center gap-1.5"
                    >
                      <RefreshCw size={12} />
                      Resubmit Revised Version
                    </a>
                  </div>
                )}
              </div>

              {/* Notes summary for editors */}
              {!isPM && notes.filter(n => !n.is_resolved).length > 0 && (
                <div className="card p-4">
                  <h3 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>
                    Reviewer Notes ({notes.filter(n => !n.is_resolved).length})
                  </h3>
                  <div className="space-y-2">
                    {notes.filter(n => !n.is_resolved).map((note) => (
                      <div key={note.id} className="p-2.5 rounded-lg" style={{ background: 'var(--surface-2)' }}>
                        <p className="text-xs" style={{ color: 'var(--text)' }}>{note.note}</p>
                        <div className="flex items-center gap-2 mt-1">
                          {note.timestamp_seconds !== null && (
                            <span className="badge badge-neutral text-[10px]">
                              {Math.floor(note.timestamp_seconds / 60)}:{String(Math.floor(note.timestamp_seconds % 60)).padStart(2, '0')}
                            </span>
                          )}
                          <span className="badge badge-neutral text-[10px]">{note.category || 'general'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  )
}
