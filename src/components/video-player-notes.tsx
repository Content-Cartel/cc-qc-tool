'use client'

import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Pause, MessageSquare, Check, Clock, Pencil, Trash2, X, PenTool } from 'lucide-react'
import { NOTE_CATEGORIES } from '@/lib/constants'
import AnnotationCanvas from '@/components/annotation-canvas'
import type { QCNote, NoteCategory } from '@/lib/supabase/types'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ReactPlayer = require('react-player').default

interface VideoPlayerNotesProps {
  url: string
  notes: QCNote[]
  onAddNote: (note: string, timestampSeconds: number, category: NoteCategory) => Promise<void>
  onResolveNote: (noteId: string) => Promise<void>
  onEditNote?: (noteId: string, newText: string) => Promise<void>
  onDeleteNote?: (noteId: string) => Promise<void>
  onSaveAnnotation?: (imageDataUrl: string, timestampSeconds: number) => Promise<void>
  readOnly?: boolean
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const CATEGORY_COLORS: Record<string, string> = {
  creative: 'var(--gold)',
  technical: 'var(--blue)',
  brand: '#a855f7',
  copy: '#ec4899',
  audio: '#14b8a6',
  other: 'var(--text-3)',
}

export default function VideoPlayerNotes({
  url,
  notes,
  onAddNote,
  onResolveNote,
  onEditNote,
  onDeleteNote,
  onSaveAnnotation,
  readOnly = false,
}: VideoPlayerNotesProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerRef = useRef<any>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [noteCategory, setNoteCategory] = useState<NoteCategory>('creative')
  const [noteTimestamp, setNoteTimestamp] = useState(0)
  const [submittingNote, setSubmittingNote] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null)
  const [annotationMode, setAnnotationMode] = useState(false)

  // Google Drive iframes don't expose playback API, so use manual timestamp input
  const isGoogleDrive = url.includes('drive.google.com')

  // Whether we have ReactPlayer active (auto-timestamp available)
  const hasReactPlayer = !isGoogleDrive
  // Whether we're in iframe mode (manual timestamp needed)
  const isIframeFallback = isGoogleDrive

  // Manual timestamp input state (for iframe fallback)
  const [manualMinutes, setManualMinutes] = useState(0)
  const [manualSeconds, setManualSeconds] = useState(0)

  const handleProgress = useCallback((state: { playedSeconds: number }) => {
    setCurrentTime(state.playedSeconds)
  }, [])

  const handleDuration = useCallback((dur: number) => {
    setDuration(dur)
  }, [])

  const handleAddNoteClick = () => {
    if (hasReactPlayer) {
      setPlaying(false)
      setNoteTimestamp(currentTime)
    } else {
      // iframe fallback: reset manual inputs
      setManualMinutes(0)
      setManualSeconds(0)
    }
    setShowNoteForm(true)
  }

  const handleSubmitNote = async () => {
    if (!noteText.trim()) return
    setSubmittingNote(true)
    const timestamp = isIframeFallback
      ? manualMinutes * 60 + manualSeconds
      : noteTimestamp
    await onAddNote(noteText.trim(), timestamp, noteCategory)
    setNoteText('')
    setShowNoteForm(false)
    setSubmittingNote(false)
  }

  const handleSeekToNote = (seconds: number) => {
    if (playerRef.current && hasReactPlayer) {
      playerRef.current.seekTo(seconds, 'seconds')
      setCurrentTime(seconds)
    }
  }

  const sortedNotes = [...notes]
    .filter(n => n.timestamp_seconds !== null)
    .sort((a, b) => (a.timestamp_seconds || 0) - (b.timestamp_seconds || 0))

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  // Determine the video source URL for ReactPlayer
  const reactPlayerUrl = url

  return (
    <div className="space-y-4">
      {/* Video Player */}
      <div className="relative rounded-lg overflow-hidden" style={{ background: '#000' }}>
        <div className="aspect-video">
          {isIframeFallback ? (
            <iframe
              src={url.replace('/view', '/preview').replace('/edit', '/preview')}
              className="w-full h-full"
              allow="autoplay"
              allowFullScreen
            />
          ) : (
            <ReactPlayer
              ref={playerRef}
              url={reactPlayerUrl}
              playing={playing}
              controls
              width="100%"
              height="100%"
              onProgress={handleProgress}
              onDuration={handleDuration}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
          )}
        </div>

        {/* Annotation canvas overlay */}
        <AnnotationCanvas
          active={annotationMode}
          onSave={(dataUrl) => {
            if (onSaveAnnotation) {
              const timestamp = isIframeFallback ? 0 : currentTime
              onSaveAnnotation(dataUrl, timestamp)
            }
            setAnnotationMode(false)
          }}
          onClose={() => setAnnotationMode(false)}
        />

        {/* Note markers on progress bar */}
        {hasReactPlayer && duration > 0 && sortedNotes.length > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 pointer-events-none">
            {sortedNotes.map(note => {
              const position = ((note.timestamp_seconds || 0) / duration) * 100
              return (
                <div
                  key={note.id}
                  className="absolute top-0 w-1.5 h-full rounded-full"
                  style={{
                    left: `${position}%`,
                    background: note.is_resolved ? 'var(--green)' : 'var(--gold)',
                    transform: 'translateX(-50%)',
                  }}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* Controls bar */}
      {!readOnly && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {hasReactPlayer && (
              <>
                <button
                  onClick={() => setPlaying(!playing)}
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
                  style={{ background: 'var(--surface-2)', color: 'var(--text)' }}
                >
                  {playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
                </button>
                <span className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>
                  {formatTimestamp(currentTime)} / {formatTimestamp(duration)}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (hasReactPlayer) setPlaying(false)
                setAnnotationMode(!annotationMode)
              }}
              className={`text-xs flex items-center gap-1.5 ${annotationMode ? 'btn-primary' : 'btn-secondary'}`}
              title="Draw on video"
            >
              <PenTool size={12} />
              Annotate
            </button>
            <button onClick={handleAddNoteClick} className="btn-primary text-xs flex items-center gap-1.5">
              <MessageSquare size={12} />
              {hasReactPlayer ? `Note at ${formatTimestamp(currentTime)}` : 'Add Note'}
            </button>
          </div>
        </div>
      )}

      {/* Progress bar */}
      {hasReactPlayer && !readOnly && (
        <div className="w-full h-1 rounded-full" style={{ background: 'var(--surface-2)' }}>
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${progress}%`, background: 'var(--gold)' }}
          />
        </div>
      )}

      {/* Note Form */}
      <AnimatePresence>
        {showNoteForm && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="card p-4 space-y-3"
            style={{ borderColor: 'var(--gold)', borderWidth: '1px' }}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Note at</span>
              {isIframeFallback ? (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={99}
                    value={manualMinutes}
                    onChange={(e) => setManualMinutes(Math.max(0, Math.min(99, parseInt(e.target.value) || 0)))}
                    className="input w-12 text-center text-xs font-mono py-1 px-1"
                    style={{ borderColor: 'var(--gold)' }}
                  />
                  <span className="text-xs font-mono font-bold" style={{ color: 'var(--gold)' }}>:</span>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={manualSeconds}
                    onChange={(e) => setManualSeconds(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                    className="input w-12 text-center text-xs font-mono py-1 px-1"
                    style={{ borderColor: 'var(--gold)' }}
                  />
                </div>
              ) : (
                <span className="badge badge-gold text-xs">
                  {formatTimestamp(noteTimestamp)}
                </span>
              )}
            </div>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              className="input"
              rows={3}
              placeholder="Describe the issue or feedback... (Cmd+Enter to save)"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && noteText.trim()) {
                  handleSubmitNote()
                }
              }}
            />
            <div className="flex items-center gap-3">
              <select
                value={noteCategory}
                onChange={(e) => setNoteCategory(e.target.value as NoteCategory)}
                className="input w-auto text-xs"
              >
                {NOTE_CATEGORIES.map(c => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
              <div className="flex gap-2 ml-auto">
                <button onClick={() => setShowNoteForm(false)} className="btn-secondary text-xs">
                  Cancel
                </button>
                <button
                  onClick={handleSubmitNote}
                  disabled={submittingNote || !noteText.trim()}
                  className="btn-primary text-xs"
                >
                  {submittingNote ? 'Saving...' : 'Save Note'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Timestamped Notes List */}
      {sortedNotes.length > 0 && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>
            Timestamped Notes ({sortedNotes.length})
          </h3>
          <div className="space-y-1.5">
            {sortedNotes.map((note, i) => (
              <motion.div
                key={note.id}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                className="p-3 rounded-lg flex items-start gap-3 cursor-pointer transition-all duration-100 group"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderLeft: `3px solid ${CATEGORY_COLORS[note.category || 'other']}`,
                  opacity: note.is_resolved ? 0.5 : 1,
                }}
                onClick={() => note.timestamp_seconds !== null && handleSeekToNote(note.timestamp_seconds)}
                onMouseEnter={(e) => {
                  if (!note.is_resolved) e.currentTarget.style.borderColor = 'var(--border-2)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)'
                }}
              >
                <button
                  className="badge badge-gold text-xs mt-0.5 shrink-0 flex items-center gap-1"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (note.timestamp_seconds !== null) handleSeekToNote(note.timestamp_seconds)
                  }}
                >
                  <Clock size={9} />
                  {formatTimestamp(note.timestamp_seconds!)}
                </button>
                <div className="flex-1 min-w-0">
                  {editingNoteId === note.id ? (
                    <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="input flex-1 text-sm py-1"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && editText.trim() && onEditNote) {
                            onEditNote(note.id, editText.trim())
                            setEditingNoteId(null)
                          }
                          if (e.key === 'Escape') setEditingNoteId(null)
                        }}
                      />
                      <button
                        onClick={() => {
                          if (editText.trim() && onEditNote) {
                            onEditNote(note.id, editText.trim())
                            setEditingNoteId(null)
                          }
                        }}
                        className="btn-primary text-[10px] px-2 py-1"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingNoteId(null)}
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
                          color: note.is_resolved ? 'var(--text-3)' : 'var(--text)',
                          textDecoration: note.is_resolved ? 'line-through' : 'none',
                        }}
                      >
                        {note.note}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="badge badge-neutral text-[10px]">{note.category || 'general'}</span>
                        <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{note.author_name || 'PM'}</span>
                        <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>&middot; {timeAgo(note.created_at)}</span>
                      </div>
                    </>
                  )}
                </div>
                {!readOnly && editingNoteId !== note.id && (
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!note.is_resolved && (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingNoteId(note.id)
                            setEditText(note.note)
                          }}
                          className="p-1 rounded transition-colors"
                          style={{ color: 'var(--text-3)' }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--blue)')}
                          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-3)')}
                          title="Edit note"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onResolveNote(note.id)
                          }}
                          className="p-1 rounded transition-colors"
                          style={{ color: 'var(--text-3)' }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--green)')}
                          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-3)')}
                          title="Mark as resolved"
                        >
                          <Check size={12} />
                        </button>
                      </>
                    )}
                    {deletingNoteId === note.id ? (
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <span className="text-[10px]" style={{ color: 'var(--red)' }}>Delete?</span>
                        <button
                          onClick={() => {
                            if (onDeleteNote) onDeleteNote(note.id)
                            setDeletingNoteId(null)
                          }}
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--red)', color: '#fff' }}
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setDeletingNoteId(null)}
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeletingNoteId(note.id)
                        }}
                        className="p-1 rounded transition-colors"
                        style={{ color: 'var(--text-3)' }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--red)')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-3)')}
                        title="Delete note"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                )}
                {note.is_resolved && editingNoteId !== note.id && readOnly && (
                  <span className="text-[10px] shrink-0" style={{ color: 'var(--green)' }}>Resolved</span>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
