'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { ArrowLeft, ExternalLink, User, Calendar, Hash, RefreshCw, Trash2, Pencil, X, ChevronDown, FileText, Copy, Loader2, AlertCircle, History, Eye, EyeOff, Search, ChevronRight, Mic, Youtube, MessageSquare, Sparkles, Check, ScanEye, XCircle, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'
import Nav from '@/components/nav'
import { StatusBadge, ContentTypeBadge, EditingLevelBadge } from '@/components/status-badge'
import { PipelineStageLabel } from '@/components/pipeline-tracker'
import PipelineTracker from '@/components/pipeline-tracker'
import QCChecklist from '@/components/qc-checklist'
import VideoPlayerNotes from '@/components/video-player-notes'
import BrandReference from '@/components/brand-reference'
import QCPreCheckCard from '@/components/qc-precheck-card'
import VersionComparison from '@/components/version-comparison'
import EditingInstructionsView from '@/components/editing-instructions-view'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { timeAgo, formatDateTime } from '@/lib/utils/date'
import { getGoogleDriveEmbedUrl } from '@/lib/utils/google-drive'
import { NOTE_CATEGORIES, STATUS_CONFIG, EDITING_LEVEL_CONFIG } from '@/lib/constants'
import type { QCChecklistKey, PipelineStageKey } from '@/lib/constants'
import type { QCNote, NoteCategory, QCChecklistResult, EditingLevel, SubmissionStatus, TranscriptStatus } from '@/lib/supabase/types'
import { notifyAgent } from '@/lib/notify-agent'

interface ClientTranscript {
  id: string
  source: 'fathom' | 'youtube'
  title: string
  transcript_text: string
  word_count: number | null
  duration_seconds: number | null
  recorded_at: string | null
  relevance_tag: string | null
}

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
  transcript: string | null
  transcript_status: TranscriptStatus | null
  metadata: Record<string, unknown> | null
  created_at: string
  clients?: { name: string } | null
}

function HighlightedText({ text, search }: { text: string; search: string }) {
  if (!search.trim()) return <>{text}</>
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === search.toLowerCase() ? (
          <mark key={i} style={{ background: 'rgba(212, 168, 67, 0.3)', color: 'var(--text)', borderRadius: '2px', padding: '0 1px' }}>
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  )
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
  const [transcribing, setTranscribing] = useState(false)
  const [transcriptError, setTranscriptError] = useState<string | null>(null)
  const [showManualTranscript, setShowManualTranscript] = useState(false)
  const [manualTranscript, setManualTranscript] = useState('')
  const [copied, setCopied] = useState(false)
  const [versionHistory, setVersionHistory] = useState<{id: string, title: string, created_at: string, external_url: string | null}[]>([])
  const [showPreviousVersion, setShowPreviousVersion] = useState(false)
  const [clientTranscripts, setClientTranscripts] = useState<ClientTranscript[]>([])
  const [transcriptTab, setTranscriptTab] = useState<'submission' | 'client'>('submission')
  const [transcriptSearch, setTranscriptSearch] = useState('')
  const [expandedTranscripts, setExpandedTranscripts] = useState<Set<string>>(new Set())
  const [transcriptExpanded, setTranscriptExpanded] = useState(false)
  const [showPostGenerator, setShowPostGenerator] = useState(false)
  const [postPlatforms, setPostPlatforms] = useState<Set<string>>(new Set(['linkedin', 'twitter', 'facebook']))
  const [generatingPosts, setGeneratingPosts] = useState(false)
  const [generatedPosts, setGeneratedPosts] = useState('')
  const [postGenSource, setPostGenSource] = useState<{ type: 'submission' | 'client'; id: string; title: string } | null>(null)
  const [postsSaved, setPostsSaved] = useState(false)
  const [postsCopied, setPostsCopied] = useState(false)
  // Editing Instructions (V2 Editorial Director) state
  const [generatingInstructions, setGeneratingInstructions] = useState(false)
  const [instructionsError, setInstructionsError] = useState<string | null>(null)
  const [editingInstructions, setEditingInstructions] = useState<Record<string, unknown> | null>(null)
  const [instructionsCopied, setInstructionsCopied] = useState(false)
  const [instructionsExpanded, setInstructionsExpanded] = useState(true)
  // Spelling check state
  const [spellingChecking, setSpellingChecking] = useState(false)
  const [spellingError, setSpellingError] = useState<string | null>(null)
  const [spellingResults, setSpellingResults] = useState<Array<{
    id: string
    frame_timestamp_seconds: number
    detected_text: string
    issue_description: string
    suggested_fix: string
    confidence: number
    status: string
  }>>([])
  const [spellingLoaded, setSpellingLoaded] = useState(false)
  // Video metadata state
  const [videoInfo, setVideoInfo] = useState<{
    width: number; height: number; duration_seconds: number; aspect_ratio: string;
    is_portrait: boolean; mime_type: string; file_size_bytes: number; file_name: string;
    resolution_check: { expected_orientation: string; actual_orientation: string; is_correct: boolean; message: string };
    fetched_at: string;
  } | null>(null)
  const [videoInfoLoading, setVideoInfoLoading] = useState(false)
  const [videoInfoError, setVideoInfoError] = useState<string | null>(null)

  const userName = user || 'PM'

  const loadSubmission = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('qc_submissions')
      .select('*, clients(name)')
      .eq('id', submissionId)
      .single()

    if (data) {
      const sub = {
        ...data,
        client_name: (data as unknown as { clients?: { name: string } }).clients?.name || 'Unknown',
      } as SubmissionDetail
      setSubmission(sub)

      // Seed editing instructions from the submission row (may be null)
      const savedInstructions = (data as unknown as { editing_instructions?: Record<string, unknown> | null }).editing_instructions
      if (savedInstructions && typeof savedInstructions === 'object') {
        setEditingInstructions(savedInstructions)
      }

      // Fetch version history if this is part of a revision chain
      const rootId = sub.revision_of || sub.id
      // Check if rootId itself is a revision (walk up one level)
      let actualRoot = rootId
      if (sub.revision_of) {
        const { data: parentSub } = await supabase
          .from('qc_submissions')
          .select('id, revision_of')
          .eq('id', rootId)
          .single()
        if (parentSub?.revision_of) actualRoot = parentSub.revision_of
      }
      // Get all versions: root + all revisions of root
      const { data: versions } = await supabase
        .from('qc_submissions')
        .select('id, title, created_at, external_url')
        .or(`id.eq.${actualRoot},revision_of.eq.${actualRoot}`)
        .order('created_at', { ascending: true })
      setVersionHistory(versions || [])
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

  const loadClientTranscripts = useCallback(async (clientId: number) => {
    const { data } = await supabase
      .from('client_transcripts')
      .select('id, source, title, transcript_text, word_count, duration_seconds, recorded_at, relevance_tag')
      .eq('client_id', clientId)
      .order('recorded_at', { ascending: false })
      .limit(20)

    setClientTranscripts((data || []) as ClientTranscript[])
  }, [supabase])

  useEffect(() => {
    loadSubmission()
    loadNotes()
    loadChecklist()
  }, [loadSubmission, loadNotes, loadChecklist])

  const loadSpellingResults = useCallback(async () => {
    const { data } = await supabase
      .from('spelling_check_results')
      .select('*')
      .eq('submission_id', submissionId)
      .order('frame_timestamp_seconds', { ascending: true })

    setSpellingResults(data || [])
    setSpellingLoaded(true)
  }, [supabase, submissionId])

  // Fetch video metadata once when submission first loads
  const videoInfoFetchedRef = React.useRef(false)

  const fetchVideoMetadata = useCallback(async () => {
    if (!submission?.external_url || !submission?.id) return
    if (videoInfoFetchedRef.current) return
    // Check if already cached in metadata
    const cached = (submission.metadata as Record<string, unknown>)?.video_info
    if (cached) {
      setVideoInfo(cached as typeof videoInfo)
      videoInfoFetchedRef.current = true
      return
    }
    videoInfoFetchedRef.current = true
    setVideoInfoLoading(true)
    setVideoInfoError(null)
    try {
      const res = await fetch('/api/video-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submission_id: submission.id }),
      })
      const data = await res.json()
      if (res.ok && data.video_info) {
        setVideoInfo(data.video_info)
      } else {
        setVideoInfoError(data.error || 'Could not fetch video metadata')
        videoInfoFetchedRef.current = false // allow retry
      }
    } catch {
      setVideoInfoError('Failed to fetch video metadata')
      videoInfoFetchedRef.current = false // allow retry
    } finally {
      setVideoInfoLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission?.id, submission?.external_url])

  useEffect(() => {
    if (submission) {
      fetchVideoMetadata()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission?.id, fetchVideoMetadata])

  useEffect(() => {
    if (submission?.client_id) {
      loadClientTranscripts(submission.client_id)
    }
  }, [submission?.client_id, loadClientTranscripts])

  useEffect(() => {
    loadSpellingResults()
  }, [loadSpellingResults])

  const handleAddNote = useCallback(async (note: string, timestampSeconds: number, category: NoteCategory) => {
    await supabase.from('qc_notes').insert({
      submission_id: submissionId,
      author_name: userName,
      note,
      timestamp_seconds: timestampSeconds,
      category,
    })
    await loadNotes()
  }, [supabase, submissionId, userName, loadNotes])

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

  const handleResolveNote = useCallback(async (noteId: string) => {
    await supabase
      .from('qc_notes')
      .update({ is_resolved: true, resolved_at: new Date().toISOString() })
      .eq('id', noteId)
    await loadNotes()
  }, [supabase, loadNotes])

  const handleEditNote = useCallback(async (noteId: string, newText: string) => {
    await supabase
      .from('qc_notes')
      .update({ note: newText })
      .eq('id', noteId)
    await loadNotes()
  }, [supabase, loadNotes])

  const handleDeleteNote = useCallback(async (noteId: string) => {
    await supabase
      .from('qc_notes')
      .delete()
      .eq('id', noteId)
    await loadNotes()
  }, [supabase, loadNotes])

  const handleSaveAnnotation = useCallback(async (imageDataUrl: string, timestampSeconds: number) => {
    await supabase.from('qc_notes').insert({
      submission_id: submissionId,
      author_name: userName,
      note: `[Annotation at ${Math.floor(timestampSeconds / 60)}:${String(Math.floor(timestampSeconds % 60)).padStart(2, '0')}]`,
      timestamp_seconds: timestampSeconds,
      category: 'creative' as NoteCategory,
    })
    await loadNotes()
  }, [supabase, submissionId, userName, loadNotes])

  async function handleRunSpellingCheck() {
    if (!submission) return
    setSpellingChecking(true)
    setSpellingError(null)
    try {
      const res = await fetch('/api/spelling-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submission_id: submissionId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSpellingError(data.error || 'Spelling check failed')
      } else {
        await loadSpellingResults()
      }
    } catch (err) {
      setSpellingError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSpellingChecking(false)
    }
  }

  async function handleDismissSpelling(resultId: string) {
    await supabase
      .from('spelling_check_results')
      .update({ status: 'dismissed', dismissed_by: userName })
      .eq('id', resultId)
    await loadSpellingResults()
  }

  async function handleConfirmSpelling(resultId: string) {
    await supabase
      .from('spelling_check_results')
      .update({ status: 'confirmed' })
      .eq('id', resultId)
    await loadSpellingResults()
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

    // Update submission status + auto-move to package if approved
    const newStatus = overallPass ? 'approved' : 'revision_requested'
    await supabase
      .from('qc_submissions')
      .update({
        status: newStatus,
        pm_decision: newStatus,
        pm_reviewed_by_name: userName,
        pm_reviewed_at: new Date().toISOString(),
        qc_score: passedCount,
        ...(overallPass ? { current_pipeline_stage: 'package' } : {}),
      })
      .eq('id', submissionId)

    // Notify the AI agent about QC result (includes Drive link for Slack)
    if (submission) {
      const failedItems = Object.entries(results)
        .filter(([, passed]) => !passed)
        .map(([key]) => key.replace(/_/g, ' '))
      notifyAgent({
        event: 'qc_done',
        client_id: submission.client_id,
        submission_id: submissionId,
        result: overallPass ? 'approved' : 'revision_requested',
        notes: overallPass
          ? [`Passed QC: ${passedCount}/10`]
          : [`Failed items: ${failedItems.join(', ')}`],
        content_title: submission.title,
        external_url: submission.external_url || undefined,
      })

      // Notify editor in-app about QC result
      if (overallPass) {
        await supabase.from('notifications').insert({
          user_name: submission.submitted_by_name,
          submission_id: submissionId,
          message: `Your video "${submission.title}" has been approved — ready for packaging.${submission.external_url ? ` Link: ${submission.external_url}` : ''}`,
          type: 'approved',
        })
      } else {
        await supabase.from('notifications').insert({
          user_name: submission.submitted_by_name,
          submission_id: submissionId,
          message: `Your video "${submission.title}" needs revision. Failed: ${failedItems.join(', ')}`,
          type: 'revision_requested',
        })
      }
    }

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

    // Notify the AI agent about stage change
    if (submission) {
      notifyAgent({
        event: 'stage_change',
        client_id: submission.client_id,
        submission_id: submissionId,
        from: submission.current_pipeline_stage,
        to: nextStage,
        content_title: submission.title,
      })
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

    // Notify the AI agent
    notifyAgent({
      event: 'qc_done',
      client_id: submission.client_id,
      submission_id: submissionId,
      result: newStatus,
      notes: [`Status manually changed to ${statusLabel} by ${userName}`],
      content_title: submission.title,
    })

    // Auto-advance pipeline stage based on status change
    // Approved always moves to package regardless of current stage
    const stageMap: Record<string, string | Record<string, string>> = {
      approved: 'package',
      revision_requested: { qc_review: 'editor_polish' },
      resubmitted: { editor_polish: 'qc_review' },
    }
    const mapping = stageMap[newStatus]
    const nextStage = typeof mapping === 'string'
      ? mapping
      : mapping?.[submission.current_pipeline_stage]
    if (nextStage) {
      await supabase
        .from('qc_submissions')
        .update({ current_pipeline_stage: nextStage })
        .eq('id', submissionId)
      await supabase.from('pipeline_stages').insert({
        submission_id: submissionId,
        stage: nextStage,
        entered_at: new Date().toISOString(),
      })
      notifyAgent({
        event: 'stage_change',
        client_id: submission.client_id,
        submission_id: submissionId,
        from: submission.current_pipeline_stage,
        to: nextStage,
        content_title: submission.title,
      })
    }

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

  const transcriptChannelRef = React.useRef<ReturnType<typeof supabase.channel> | null>(null)

  // Cleanup realtime channel on unmount
  useEffect(() => {
    return () => {
      if (transcriptChannelRef.current) {
        supabase.removeChannel(transcriptChannelRef.current)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleGenerateTranscript() {
    if (!submission) return
    setTranscribing(true)
    setTranscriptError(null)
    try {
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submission_id: submissionId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setTranscriptError(data.error || 'Transcription failed')
        setTranscribing(false)
        return
      }

      // Listen for Railway to finish via Supabase Realtime
      if (transcriptChannelRef.current) {
        supabase.removeChannel(transcriptChannelRef.current)
      }

      const channel = supabase
        .channel(`transcript-${submissionId}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'qc_submissions',
          filter: `id=eq.${submissionId}`,
        }, (payload) => {
          const row = payload.new as Record<string, unknown>
          const status = row.transcript_status as string
          if (status === 'completed' || status === 'failed') {
            supabase.removeChannel(channel)
            transcriptChannelRef.current = null
            setSubmission(prev => prev ? {
              ...prev,
              transcript: String(row.transcript || ''),
              transcript_status: status as TranscriptStatus,
              metadata: (row.metadata as Record<string, unknown>) || null,
            } : prev)
            setTranscribing(false)
            if (status === 'failed') {
              setTranscriptError(String((row.metadata as Record<string, unknown>)?.transcription_error || 'Transcription failed'))
            }
          }
        })
        .subscribe()

      transcriptChannelRef.current = channel

      // Safety timeout: 10 minutes
      setTimeout(() => {
        if (transcriptChannelRef.current) {
          supabase.removeChannel(transcriptChannelRef.current)
          transcriptChannelRef.current = null
          setTranscriptError('Transcription is taking longer than expected — check back in a few minutes')
          setTranscribing(false)
        }
      }, 10 * 60 * 1000)
    } catch {
      setTranscriptError('Network error — try again')
      setTranscribing(false)
    }
  }

  async function handleSaveManualTranscript() {
    if (!manualTranscript.trim()) return
    await supabase
      .from('qc_submissions')
      .update({
        transcript: manualTranscript.trim(),
        transcript_status: 'completed',
      })
      .eq('id', submissionId)
    setShowManualTranscript(false)
    setManualTranscript('')
    await loadSubmission()
  }

  function handleCopyTranscript() {
    if (!submission?.transcript) return
    navigator.clipboard.writeText(submission.transcript)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleGeneratePosts() {
    if (!submission || postPlatforms.size === 0) return

    setGeneratingPosts(true)
    setGeneratedPosts('')
    setPostsSaved(false)

    const body: Record<string, unknown> = {
      client_id: submission.client_id,
      platforms: Array.from(postPlatforms),
    }

    if (postGenSource?.type === 'client') {
      body.transcript_id = postGenSource.id
    } else {
      body.submission_id = submissionId
    }

    try {
      const res = await fetch('/api/content/generate-posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json()
        setGeneratedPosts(`Error: ${err.error || 'Generation failed'}`)
        setGeneratingPosts(false)
        return
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      let buffer = ''

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
                  setGeneratedPosts(accumulated)
                } else if (event.type === 'error') {
                  setGeneratedPosts(`Error: ${event.message || 'Generation failed'}`)
                }
              } catch {
                // skip malformed JSON
              }
            }
          }
        }
      }
    } catch {
      setGeneratedPosts('Network error — please try again.')
    } finally {
      setGeneratingPosts(false)
    }
  }

  async function handleSavePosts() {
    if (!submission || !generatedPosts) return
    try {
      await fetch('/api/content/save-posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: submission.client_id,
          transcript_title: postGenSource?.title || submission.title,
          platforms: Array.from(postPlatforms),
          content: generatedPosts,
          generated_by: userName,
        }),
      })
      setPostsSaved(true)
    } catch {
      // fail silently
    }
  }

  function handleCopyPosts() {
    navigator.clipboard.writeText(generatedPosts)
    setPostsCopied(true)
    setTimeout(() => setPostsCopied(false), 2000)
  }

  async function handleGenerateEditingInstructions() {
    if (!submission) return
    setGeneratingInstructions(true)
    setInstructionsError(null)

    try {
      const res = await fetch('/api/content/generate-editing-instructions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submission_id: submissionId }),
      })

      if (!res.ok) {
        const err = await res.json()
        setInstructionsError(err.error || 'Generation failed')
        setGeneratingInstructions(false)
        return
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

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
                if (event.type === 'done' && event.blueprint) {
                  setEditingInstructions(event.blueprint as Record<string, unknown>)
                  setInstructionsExpanded(true)
                } else if (event.type === 'error') {
                  setInstructionsError(event.message || 'Generation failed')
                }
              } catch {
                // skip malformed
              }
            }
          }
        }
      }
    } catch {
      setInstructionsError('Network error — please try again.')
    } finally {
      setGeneratingInstructions(false)
    }
  }

  function handleCopyInstructions() {
    if (!editingInstructions) return
    navigator.clipboard.writeText(JSON.stringify(editingInstructions, null, 2))
    setInstructionsCopied(true)
    setTimeout(() => setInstructionsCopied(false), 2000)
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
                {/* Video Resolution Badge */}
                {videoInfo && (
                  <span
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1"
                    style={{
                      background: videoInfo.resolution_check.is_correct
                        ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.2)',
                      color: videoInfo.resolution_check.is_correct
                        ? 'var(--green)' : 'var(--red)',
                      border: videoInfo.resolution_check.is_correct
                        ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(239, 68, 68, 0.4)',
                    }}
                    title={videoInfo.resolution_check.message}
                  >
                    {videoInfo.resolution_check.is_correct ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                    {videoInfo.width}x{videoInfo.height}
                  </span>
                )}
                {videoInfoLoading && (
                  <span className="text-[10px] flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
                    <Loader2 size={10} className="animate-spin" />
                    Checking resolution...
                  </span>
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
              {/* Version Comparison (side-by-side) */}
              {showPreviousVersion && submission.revision_of && (() => {
                const currentIdx = versionHistory.findIndex(v => v.id === submissionId)
                const prevVersion = currentIdx > 0 ? versionHistory[currentIdx - 1] : null
                if (!prevVersion) return null
                return (
                  <VersionComparison
                    currentVersion={{ id: submission.id, title: submission.title, created_at: submission.created_at, external_url: submission.external_url }}
                    previousVersion={prevVersion}
                    onClose={() => setShowPreviousVersion(false)}
                  />
                )
              })()}

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
                  canResolve={true}
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

              {/* Transcript Section */}
              <div className="card p-4">
                {/* Header with tabs */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <h3 className="text-xs font-medium uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                      <FileText size={12} />
                      Transcripts
                    </h3>
                    <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                      <button
                        onClick={() => setTranscriptTab('submission')}
                        className="text-[10px] px-2.5 py-1 transition-colors"
                        style={{
                          background: transcriptTab === 'submission' ? 'var(--surface-2)' : 'transparent',
                          color: transcriptTab === 'submission' ? 'var(--text)' : 'var(--text-3)',
                          fontWeight: transcriptTab === 'submission' ? 600 : 400,
                        }}
                      >
                        This Video
                      </button>
                      <button
                        onClick={() => setTranscriptTab('client')}
                        className="text-[10px] px-2.5 py-1 transition-colors"
                        style={{
                          background: transcriptTab === 'client' ? 'var(--surface-2)' : 'transparent',
                          color: transcriptTab === 'client' ? 'var(--text)' : 'var(--text-3)',
                          fontWeight: transcriptTab === 'client' ? 600 : 400,
                          borderLeft: '1px solid var(--border)',
                        }}
                      >
                        Client Library ({clientTranscripts.length})
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {transcriptTab === 'submission' && submission.transcript && (
                      <button
                        onClick={handleCopyTranscript}
                        className="text-[10px] flex items-center gap-1 px-2 py-1 rounded transition-colors"
                        style={{ color: copied ? 'var(--green)' : 'var(--text-3)', background: 'var(--surface-2)' }}
                      >
                        <Copy size={10} />
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    )}
                    {transcriptTab === 'submission' && !submission.transcript && !showManualTranscript && (
                      <button
                        onClick={() => setShowManualTranscript(true)}
                        className="text-[10px] px-2 py-1 rounded transition-colors"
                        style={{ color: 'var(--text-3)', background: 'var(--surface-2)' }}
                      >
                        Paste manually
                      </button>
                    )}
                  </div>
                </div>

                {/* Search bar (shown when there's content) */}
                {((transcriptTab === 'submission' && submission.transcript) || (transcriptTab === 'client' && clientTranscripts.length > 0)) && (
                  <div className="relative mb-3">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
                    <input
                      type="text"
                      value={transcriptSearch}
                      onChange={(e) => setTranscriptSearch(e.target.value)}
                      placeholder="Search transcripts..."
                      className="input w-full text-xs pl-7 py-1.5"
                    />
                    {transcriptSearch && (
                      <button
                        onClick={() => setTranscriptSearch('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2"
                        style={{ color: 'var(--text-3)' }}
                      >
                        <X size={10} />
                      </button>
                    )}
                  </div>
                )}

                {/* Submission transcript tab */}
                {transcriptTab === 'submission' && (
                  <>
                    {/* Completed transcript */}
                    {submission.transcript && (() => {
                      const text = submission.transcript
                      const searchLower = transcriptSearch.toLowerCase()
                      const hasSearch = searchLower.length > 0
                      const matchCount = hasSearch ? (text.toLowerCase().match(new RegExp(searchLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length : 0

                      // Build timestamped chunks from Deepgram words
                      const dgWords = ((submission.metadata as Record<string, unknown>)?.deepgram_words || []) as Array<{ word: string; start: number; end: number; punctuated_word?: string }>
                      const timestampedChunks: Array<{ time: number; text: string }> = []
                      if (dgWords.length > 0) {
                        let chunkStart = 0
                        let chunkWords: string[] = []
                        for (const w of dgWords) {
                          if (w.start - chunkStart >= 10 && chunkWords.length > 0) {
                            timestampedChunks.push({ time: chunkStart, text: chunkWords.join(' ') })
                            chunkStart = w.start
                            chunkWords = []
                          }
                          chunkWords.push(w.punctuated_word || w.word)
                        }
                        if (chunkWords.length > 0) {
                          timestampedChunks.push({ time: chunkStart, text: chunkWords.join(' ') })
                        }
                      }

                      const formatTs = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

                      return (
                        <div>
                          {/* Source label */}
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1" style={{
                              background: submission.transcript_status === 'completed' ? 'rgba(34, 197, 94, 0.1)' : 'var(--surface-2)',
                              color: submission.transcript_status === 'completed' ? 'var(--green)' : 'var(--text-3)',
                            }}>
                              <Mic size={8} />
                              {submission.transcript_status === 'completed' ? 'Whisper' : 'Manual'}
                            </span>
                            <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                              {text.split(/\s+/).length.toLocaleString()} words
                            </span>
                            {timestampedChunks.length > 0 && (
                              <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                                Timestamped
                              </span>
                            )}
                            {hasSearch && (
                              <span className="text-[10px] font-medium" style={{ color: matchCount > 0 ? 'var(--gold)' : 'var(--red)' }}>
                                {matchCount} match{matchCount !== 1 ? 'es' : ''}
                              </span>
                            )}
                          </div>
                          <div
                            className={`text-xs leading-relaxed overflow-y-auto rounded-lg p-3 transition-all ${transcriptExpanded ? 'max-h-[600px]' : 'max-h-48'}`}
                            style={{ color: 'var(--text-2)', background: 'var(--surface-2)' }}
                          >
                            {timestampedChunks.length > 0 ? (
                              <div className="space-y-2">
                                {timestampedChunks.map((chunk, i) => (
                                  <div key={i} className="flex gap-2">
                                    <span
                                      className="text-[10px] font-mono shrink-0 mt-0.5 px-1 py-0.5 rounded cursor-pointer hover:opacity-80"
                                      style={{ color: 'var(--gold)', background: 'rgba(212, 168, 67, 0.1)' }}
                                      title={`Jump to ${formatTs(chunk.time)}`}
                                    >
                                      {formatTs(chunk.time)}
                                    </span>
                                    <span>
                                      {hasSearch && matchCount > 0 ? (
                                        <HighlightedText text={chunk.text} search={transcriptSearch} />
                                      ) : (
                                        chunk.text
                                      )}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : hasSearch && matchCount > 0 ? (
                              <HighlightedText text={text} search={transcriptSearch} />
                            ) : (
                              text
                            )}
                          </div>
                          {text.length > 800 && (
                            <button
                              onClick={() => setTranscriptExpanded(!transcriptExpanded)}
                              className="text-[10px] mt-1.5 flex items-center gap-1 transition-colors"
                              style={{ color: 'var(--blue)' }}
                            >
                              {transcriptExpanded ? 'Show less' : 'Show more'}
                              <ChevronRight size={10} style={{ transform: transcriptExpanded ? 'rotate(-90deg)' : 'rotate(90deg)', transition: 'transform 0.2s' }} />
                            </button>
                          )}
                        </div>
                      )
                    })()}

                    {/* No transcript yet */}
                    {!submission.transcript && !showManualTranscript && (
                      <div className="text-center py-6">
                        {transcribing || submission.transcript_status === 'processing' ? (
                          <div className="flex flex-col items-center gap-2">
                            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--gold)' }} />
                            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                              Transcribing video — this may take a few minutes...
                            </p>
                          </div>
                        ) : transcriptError || submission.transcript_status === 'failed' ? (
                          <div className="flex flex-col items-center gap-2">
                            <AlertCircle size={20} style={{ color: 'var(--red)' }} />
                            <p className="text-xs" style={{ color: 'var(--red)' }}>
                              {transcriptError
                                || String((submission.metadata as Record<string, unknown>)?.transcription_error || '')
                                || 'Transcription failed'}
                            </p>
                            <div className="flex gap-2">
                              <button onClick={handleGenerateTranscript} className="btn-secondary text-xs">
                                Retry
                              </button>
                              <button
                                onClick={() => { setShowManualTranscript(true); setTranscriptError(null) }}
                                className="btn-secondary text-xs"
                              >
                                Paste manually
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-2">
                            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                              No transcript yet
                            </p>
                            {submission.external_url && (
                              <button
                                onClick={() => handleGenerateTranscript()}
                                className="btn-primary text-xs flex items-center gap-1.5"
                              >
                                <Mic size={12} />
                                Generate Transcript
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Manual paste form */}
                    {showManualTranscript && !submission.transcript && (
                      <div className="space-y-2">
                        <textarea
                          value={manualTranscript}
                          onChange={(e) => setManualTranscript(e.target.value)}
                          className="input w-full text-xs"
                          rows={6}
                          placeholder="Paste transcript here..."
                          autoFocus
                        />
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => { setShowManualTranscript(false); setManualTranscript('') }}
                            className="btn-secondary text-xs"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleSaveManualTranscript}
                            className="btn-primary text-xs"
                            disabled={!manualTranscript.trim()}
                          >
                            Save Transcript
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Client transcripts tab */}
                {transcriptTab === 'client' && (
                  <>
                    {clientTranscripts.length === 0 ? (
                      <div className="text-center py-6">
                        <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                          No client transcripts found. Ingest Fathom calls or YouTube videos to populate.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {clientTranscripts
                          .filter(t => {
                            if (!transcriptSearch) return true
                            const s = transcriptSearch.toLowerCase()
                            return t.title.toLowerCase().includes(s) || t.transcript_text?.toLowerCase().includes(s)
                          })
                          .map((t) => {
                            const isExpanded = expandedTranscripts.has(t.id)
                            return (
                              <div key={t.id} className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                                <button
                                  onClick={() => {
                                    const next = new Set(expandedTranscripts)
                                    if (isExpanded) next.delete(t.id)
                                    else next.add(t.id)
                                    setExpandedTranscripts(next)
                                  }}
                                  className="w-full flex items-center gap-2 p-2.5 text-left transition-colors"
                                  style={{ background: isExpanded ? 'var(--surface-2)' : 'transparent' }}
                                >
                                  <ChevronRight
                                    size={12}
                                    style={{
                                      color: 'var(--text-3)',
                                      transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                      transition: 'transform 0.2s',
                                      flexShrink: 0,
                                    }}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium truncate" style={{ color: 'var(--text)' }}>
                                      {t.title}
                                    </p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                      <span className="text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1" style={{
                                        background: t.source === 'fathom' ? 'rgba(99, 102, 241, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                        color: t.source === 'fathom' ? 'rgb(99, 102, 241)' : 'rgb(239, 68, 68)',
                                      }}>
                                        {t.source === 'fathom' ? <MessageSquare size={8} /> : <Youtube size={8} />}
                                        {t.source === 'fathom' ? 'Fathom' : 'YouTube'}
                                      </span>
                                      {t.relevance_tag && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>
                                          {t.relevance_tag}
                                        </span>
                                      )}
                                      {t.word_count && (
                                        <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                                          {t.word_count.toLocaleString()} words
                                        </span>
                                      )}
                                      {t.recorded_at && (
                                        <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                                          {timeAgo(t.recorded_at)}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </button>
                                {isExpanded && t.transcript_text && (
                                  <div className="px-3 pb-3">
                                    <div className="flex justify-end mb-1.5">
                                      <button
                                        onClick={() => {
                                          navigator.clipboard.writeText(t.transcript_text)
                                          setCopied(true)
                                          setTimeout(() => setCopied(false), 2000)
                                        }}
                                        className="text-[10px] flex items-center gap-1 px-2 py-1 rounded transition-colors"
                                        style={{ color: 'var(--text-3)', background: 'var(--surface-2)' }}
                                      >
                                        <Copy size={10} />
                                        Copy
                                      </button>
                                    </div>
                                    <div
                                      className="text-xs leading-relaxed max-h-64 overflow-y-auto rounded-lg p-3"
                                      style={{ color: 'var(--text-2)', background: 'var(--surface-2)' }}
                                    >
                                      {transcriptSearch ? (
                                        <HighlightedText text={t.transcript_text} search={transcriptSearch} />
                                      ) : (
                                        t.transcript_text
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Editing Instructions (V2 Editorial Director) */}
              {isPM && submission.transcript && submission.transcript_status === 'completed' && (
                <div className="card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles size={14} style={{ color: 'var(--gold)' }} />
                      <h3 className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                        Editing Instructions
                      </h3>
                    </div>
                    {editingInstructions && (
                      <button
                        onClick={() => setInstructionsExpanded(v => !v)}
                        className="text-[10px] flex items-center gap-1 px-2 py-1 rounded transition-colors"
                        style={{ color: 'var(--text-3)', background: 'var(--surface-2)' }}
                      >
                        {instructionsExpanded ? <EyeOff size={10} /> : <Eye size={10} />}
                        {instructionsExpanded ? 'Collapse' : 'Expand'}
                      </button>
                    )}
                  </div>

                  {!editingInstructions ? (
                    <div className="space-y-2">
                      <button
                        onClick={handleGenerateEditingInstructions}
                        disabled={generatingInstructions}
                        className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-xs font-medium transition-all"
                        style={{ background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(212, 168, 67, 0.1))', color: 'var(--text)', border: '1px solid var(--border)' }}
                      >
                        {generatingInstructions ? (
                          <>
                            <Loader2 size={14} className="animate-spin" />
                            Editorial Director is analyzing the transcript...
                          </>
                        ) : (
                          <>
                            <Sparkles size={14} style={{ color: 'var(--gold)' }} />
                            Generate Editing Instructions
                          </>
                        )}
                      </button>
                      {instructionsError && (
                        <div className="flex items-start gap-2 p-2 rounded text-xs" style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--red)' }}>
                          <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
                          <span>{instructionsError}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="flex gap-2">
                        <button
                          onClick={handleCopyInstructions}
                          className="btn-secondary text-xs flex items-center gap-1.5 flex-1"
                        >
                          {instructionsCopied ? <Check size={12} style={{ color: 'var(--green)' }} /> : <Copy size={12} />}
                          {instructionsCopied ? 'Copied JSON' : 'Copy JSON'}
                        </button>
                        <button
                          onClick={handleGenerateEditingInstructions}
                          disabled={generatingInstructions}
                          className="btn-secondary text-xs flex items-center gap-1.5"
                        >
                          {generatingInstructions ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                          {generatingInstructions ? 'Regenerating...' : 'Regenerate'}
                        </button>
                      </div>

                      {instructionsExpanded && (
                        <EditingInstructionsView blueprint={editingInstructions} />
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Post Generator */}
              {isPM && (submission.transcript || clientTranscripts.length > 0) && (
                <div className="card p-4">
                  {!showPostGenerator ? (
                    <button
                      onClick={() => {
                        if (submission.transcript) {
                          setPostGenSource({ type: 'submission', id: submissionId, title: submission.title })
                        }
                        setShowPostGenerator(true)
                      }}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-xs font-medium transition-all"
                      style={{ background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(212, 168, 67, 0.1))', color: 'var(--text)', border: '1px solid var(--border)' }}
                    >
                      <Sparkles size={14} style={{ color: 'var(--gold)' }} />
                      Generate Written Posts from Transcript
                    </button>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-medium uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                          <Sparkles size={12} style={{ color: 'var(--gold)' }} />
                          Generate Written Posts
                        </h3>
                        <button onClick={() => { setShowPostGenerator(false); setGeneratedPosts(''); setPostsSaved(false) }} style={{ color: 'var(--text-3)' }}>
                          <X size={14} />
                        </button>
                      </div>

                      {/* Source selection */}
                      <div>
                        <label className="text-[10px] uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-3)' }}>Source Transcript</label>
                        <select
                          className="input w-full text-xs"
                          value={postGenSource ? `${postGenSource.type}:${postGenSource.id}` : ''}
                          onChange={(e) => {
                            const [type, id] = e.target.value.split(':')
                            if (type === 'submission') {
                              setPostGenSource({ type: 'submission', id, title: submission.title })
                            } else {
                              const t = clientTranscripts.find(ct => ct.id === id)
                              if (t) setPostGenSource({ type: 'client', id, title: t.title })
                            }
                          }}
                        >
                          <option value="">Select transcript...</option>
                          {submission.transcript && (
                            <option value={`submission:${submissionId}`}>
                              This video — {submission.title}
                            </option>
                          )}
                          {clientTranscripts.filter(t => t.transcript_text).map(t => (
                            <option key={t.id} value={`client:${t.id}`}>
                              [{t.source === 'fathom' ? 'Fathom' : 'YouTube'}] {t.title}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Platform selection */}
                      <div>
                        <label className="text-[10px] uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-3)' }}>Platforms</label>
                        <div className="flex gap-2">
                          {[
                            { key: 'linkedin', label: 'LinkedIn' },
                            { key: 'twitter', label: 'X (Twitter)' },
                            { key: 'facebook', label: 'Facebook' },
                          ].map(p => (
                            <button
                              key={p.key}
                              onClick={() => {
                                const next = new Set(postPlatforms)
                                if (next.has(p.key)) next.delete(p.key)
                                else next.add(p.key)
                                setPostPlatforms(next)
                              }}
                              className="text-[10px] px-3 py-1.5 rounded-lg transition-all font-medium"
                              style={{
                                background: postPlatforms.has(p.key) ? 'var(--surface-2)' : 'transparent',
                                color: postPlatforms.has(p.key) ? 'var(--text)' : 'var(--text-3)',
                                border: postPlatforms.has(p.key) ? '1px solid var(--gold)' : '1px solid var(--border)',
                              }}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Generate button */}
                      {!generatedPosts && (
                        <button
                          onClick={handleGeneratePosts}
                          disabled={generatingPosts || !postGenSource || postPlatforms.size === 0}
                          className="btn-primary w-full text-xs flex items-center justify-center gap-2 py-2.5"
                        >
                          {generatingPosts ? (
                            <>
                              <Loader2 size={14} className="animate-spin" />
                              Generating...
                            </>
                          ) : (
                            <>
                              <Sparkles size={14} />
                              Generate Posts
                            </>
                          )}
                        </button>
                      )}

                      {/* Generated output */}
                      {generatedPosts && (
                        <div className="space-y-3">
                          <div
                            className="text-xs leading-relaxed max-h-[500px] overflow-y-auto rounded-lg p-4 whitespace-pre-wrap"
                            style={{ color: 'var(--text)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}
                          >
                            {generatedPosts}
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={handleCopyPosts}
                              className="btn-secondary text-xs flex items-center gap-1.5 flex-1"
                            >
                              {postsCopied ? <Check size={12} style={{ color: 'var(--green)' }} /> : <Copy size={12} />}
                              {postsCopied ? 'Copied' : 'Copy All'}
                            </button>
                            <button
                              onClick={handleSavePosts}
                              disabled={postsSaved}
                              className="btn-primary text-xs flex items-center gap-1.5 flex-1"
                            >
                              {postsSaved ? (
                                <>
                                  <Check size={12} />
                                  Saved
                                </>
                              ) : (
                                <>
                                  <FileText size={12} />
                                  Save Draft
                                </>
                              )}
                            </button>
                            <button
                              onClick={() => { setGeneratedPosts(''); setPostsSaved(false) }}
                              className="btn-secondary text-xs flex items-center gap-1.5"
                            >
                              <RefreshCw size={12} />
                              Regenerate
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
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
                                {note.category === 'client_feedback' ? (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(212, 168, 67, 0.15)', color: 'var(--gold)', border: '1px solid rgba(212, 168, 67, 0.3)' }}>Client</span>
                                ) : (
                                  <span className="badge badge-neutral text-[10px]">{note.category || 'general'}</span>
                                )}
                                <span className="text-xs" style={{ color: 'var(--text-3)' }}>{note.author_name}</span>
                                <div className="flex items-center gap-1 ml-auto">
                                  {!note.is_resolved && note.category !== 'client_feedback' && (
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

              {/* AI Pre-Check Card */}
              {(spellingLoaded || (submission.metadata as Record<string, unknown>)?.deepgram_words) && (
                <QCPreCheckCard
                  spellingResults={spellingResults}
                  deepgramWords={((submission.metadata as Record<string, unknown>)?.deepgram_words || []) as Array<{ word: string; start: number; end: number; confidence: number; punctuated_word?: string }>}
                />
              )}

              {/* Video Info */}
              {(videoInfo || videoInfoLoading || videoInfoError) && (
                <div className="card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-medium uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                      <Search size={13} />
                      Video Info
                    </h3>
                    {videoInfo && !videoInfo.resolution_check.is_correct && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{
                        background: 'rgba(239, 68, 68, 0.15)', color: 'var(--red)',
                      }}>
                        WRONG RESOLUTION
                      </span>
                    )}
                  </div>

                  {videoInfoLoading && (
                    <div className="flex items-center gap-2 py-3">
                      <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-3)' }} />
                      <span className="text-xs" style={{ color: 'var(--text-3)' }}>Fetching video metadata...</span>
                    </div>
                  )}

                  {videoInfoError && (
                    <div className="text-xs py-2 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                      <AlertCircle size={12} />
                      {videoInfoError}
                      <button
                        onClick={fetchVideoMetadata}
                        className="underline ml-1"
                        style={{ color: 'var(--blue)' }}
                      >
                        Retry
                      </button>
                    </div>
                  )}

                  {videoInfo && (
                    <div className="space-y-2">
                      {/* Resolution — primary focus */}
                      <div
                        className="rounded-lg p-3 text-center"
                        style={{
                          background: videoInfo.resolution_check.is_correct
                            ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                          border: videoInfo.resolution_check.is_correct
                            ? '1px solid rgba(34, 197, 94, 0.25)' : '1px solid rgba(239, 68, 68, 0.3)',
                        }}
                      >
                        <div className="text-lg font-bold" style={{
                          color: videoInfo.resolution_check.is_correct ? 'var(--green)' : 'var(--red)',
                        }}>
                          {videoInfo.width} x {videoInfo.height}
                        </div>
                        <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                          {videoInfo.aspect_ratio} — {videoInfo.resolution_check.message}
                        </div>
                      </div>

                      {/* Secondary details */}
                      <dl className="space-y-1.5 pt-1">
                        {videoInfo.duration_seconds > 0 && (
                          <div className="flex items-center justify-between text-xs">
                            <dt style={{ color: 'var(--text-3)' }}>Duration</dt>
                            <dd className="font-medium" style={{ color: 'var(--text-2)' }}>
                              {Math.floor(videoInfo.duration_seconds / 60)}m {videoInfo.duration_seconds % 60}s
                            </dd>
                          </div>
                        )}
                        {videoInfo.file_size_bytes > 0 && (
                          <div className="flex items-center justify-between text-xs">
                            <dt style={{ color: 'var(--text-3)' }}>File Size</dt>
                            <dd className="font-medium" style={{ color: 'var(--text-2)' }}>
                              {videoInfo.file_size_bytes > 1073741824
                                ? `${(videoInfo.file_size_bytes / 1073741824).toFixed(1)} GB`
                                : `${(videoInfo.file_size_bytes / 1048576).toFixed(1)} MB`}
                            </dd>
                          </div>
                        )}
                        <div className="flex items-center justify-between text-xs">
                          <dt style={{ color: 'var(--text-3)' }}>Orientation</dt>
                          <dd className="font-medium" style={{ color: 'var(--text-2)' }}>
                            {videoInfo.is_portrait ? 'Portrait' : 'Landscape'}
                            {' '}
                            <span style={{ color: 'var(--text-3)' }}>
                              (expected: {videoInfo.resolution_check.expected_orientation})
                            </span>
                          </dd>
                        </div>
                      </dl>
                    </div>
                  )}
                </div>
              )}

              {/* Spelling Check */}
              {isPM && (
                <div className="card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-medium uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                      <ScanEye size={14} />
                      Spelling Check
                    </h3>
                    <button
                      onClick={handleRunSpellingCheck}
                      disabled={spellingChecking || !submission.external_url}
                      className="text-[10px] font-medium px-2.5 py-1 rounded-md transition-all flex items-center gap-1"
                      style={{
                        background: spellingChecking ? 'var(--surface-2)' : 'var(--gold)',
                        color: spellingChecking ? 'var(--text-3)' : 'var(--bg)',
                        opacity: spellingChecking ? 0.7 : 1,
                      }}
                    >
                      {spellingChecking ? (
                        <><Loader2 size={10} className="animate-spin" /> Analyzing...</>
                      ) : (
                        <><ScanEye size={10} /> Run Check</>
                      )}
                    </button>
                  </div>

                  {spellingError && (
                    <div className="rounded-lg p-2.5 mb-3 flex items-start gap-2 text-xs" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)' }}>
                      <AlertCircle size={12} className="mt-0.5 shrink-0" />
                      {spellingError}
                    </div>
                  )}

                  {spellingLoaded && spellingResults.length === 0 && !spellingChecking && (
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                      {spellingLoaded ? 'No spelling issues found. Click "Run Check" to scan video frames.' : 'Loading...'}
                    </p>
                  )}

                  {spellingResults.length > 0 && (
                    <div className="space-y-2">
                      {spellingResults.map((result) => (
                        <div
                          key={result.id}
                          className="rounded-lg p-2.5 text-xs"
                          style={{
                            background: result.status === 'dismissed' ? 'var(--surface-1)' : result.status === 'confirmed' ? 'rgba(239,68,68,0.08)' : 'rgba(212,168,67,0.08)',
                            border: `1px solid ${result.status === 'dismissed' ? 'var(--border)' : result.status === 'confirmed' ? 'var(--red)' : 'var(--gold)'}`,
                            opacity: result.status === 'dismissed' ? 0.5 : 1,
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1.5">
                                <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded flex items-center gap-1" style={{ background: 'var(--surface-2)', color: 'var(--gold)', border: '1px solid var(--gold)', opacity: 0.9 }}>
                                  ▶ {Math.floor(result.frame_timestamp_seconds / 60)}:{String(Math.floor(result.frame_timestamp_seconds % 60)).padStart(2, '0')}
                                </span>
                                <span className="font-medium" style={{ color: 'var(--text)' }}>
                                  &quot;{result.detected_text}&quot;
                                </span>
                              </div>
                              <p style={{ color: 'var(--text-2)' }}>{result.issue_description}</p>
                              <p className="mt-1">
                                <span style={{ color: 'var(--text-3)' }}>Correct: </span>
                                <span className="font-semibold" style={{ color: 'var(--green)' }}>{result.suggested_fix}</span>
                              </p>
                            </div>
                            {result.status === 'flagged' && (
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={() => handleConfirmSpelling(result.id)}
                                  className="p-1 rounded hover:bg-red-500/10 transition-colors"
                                  title="Confirm issue"
                                >
                                  <CheckCircle2 size={14} style={{ color: 'var(--red)' }} />
                                </button>
                                <button
                                  onClick={() => handleDismissSpelling(result.id)}
                                  className="p-1 rounded hover:bg-green-500/10 transition-colors"
                                  title="Dismiss (not an issue)"
                                >
                                  <XCircle size={14} style={{ color: 'var(--text-3)' }} />
                                </button>
                              </div>
                            )}
                            {result.status !== 'flagged' && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{
                                background: result.status === 'confirmed' ? 'rgba(239,68,68,0.15)' : 'var(--surface-2)',
                                color: result.status === 'confirmed' ? 'var(--red)' : 'var(--text-3)',
                              }}>
                                {result.status === 'confirmed' ? 'Confirmed' : 'Dismissed'}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
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

              {/* Version History */}
              {versionHistory.length > 1 && (
                <div className="card p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <History size={13} style={{ color: 'var(--gold)' }} />
                    <h3 className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                      Version History ({versionHistory.length})
                    </h3>
                  </div>

                  <div className="space-y-1.5">
                    {versionHistory.map((v, i) => {
                      const isCurrent = v.id === submissionId
                      return (
                        <Link
                          key={v.id}
                          href={`/review/${v.id}`}
                          className="flex items-center gap-2 p-2 rounded-lg text-xs transition-all"
                          style={{
                            background: isCurrent ? 'var(--surface-2)' : 'transparent',
                            border: isCurrent ? '1px solid var(--gold)' : '1px solid transparent',
                          }}
                        >
                          <span
                            className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                            style={{
                              background: isCurrent ? 'var(--gold)' : 'var(--surface-2)',
                              color: isCurrent ? '#000' : 'var(--text-3)',
                            }}
                          >
                            {i === 0 ? 'O' : `${i}`}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium" style={{ color: isCurrent ? 'var(--text)' : 'var(--text-2)' }}>
                              {i === 0 ? 'Original' : `Revision ${i}`}
                            </p>
                            <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                              {timeAgo(v.created_at)}
                            </p>
                          </div>
                          {isCurrent && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(212, 168, 67, 0.15)', color: 'var(--gold)' }}>
                              Viewing
                            </span>
                          )}
                        </Link>
                      )
                    })}
                  </div>

                  {/* Compare with Previous button */}
                  {submission.revision_of && (
                    <button
                      onClick={() => setShowPreviousVersion(!showPreviousVersion)}
                      className="mt-3 w-full text-xs flex items-center justify-center gap-1.5 py-2 rounded-lg transition-all"
                      style={{
                        background: showPreviousVersion ? 'rgba(212, 168, 67, 0.15)' : 'var(--surface-2)',
                        color: showPreviousVersion ? 'var(--gold)' : 'var(--text-2)',
                        border: showPreviousVersion ? '1px solid rgba(212, 168, 67, 0.3)' : '1px solid var(--border)',
                      }}
                    >
                      {showPreviousVersion ? <EyeOff size={12} /> : <Eye size={12} />}
                      {showPreviousVersion ? 'Hide Previous Version' : 'Compare with Previous'}
                    </button>
                  )}
                </div>
              )}

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
                          {note.category === 'client_feedback' ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(212, 168, 67, 0.15)', color: 'var(--gold)', border: '1px solid rgba(212, 168, 67, 0.3)' }}>Client</span>
                          ) : (
                            <span className="badge badge-neutral text-[10px]">{note.category || 'general'}</span>
                          )}
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
