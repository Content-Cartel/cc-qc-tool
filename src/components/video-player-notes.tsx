'use client'

import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Pause, MessageSquare, Check, Clock } from 'lucide-react'
import { NOTE_CATEGORIES } from '@/lib/constants'
import type { QCNote, NoteCategory } from '@/lib/supabase/types'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ReactPlayer = require('react-player').default

interface VideoPlayerNotesProps {
  url: string
  notes: QCNote[]
  onAddNote: (note: string, timestampSeconds: number, category: NoteCategory) => Promise<void>
  onResolveNote: (noteId: string) => Promise<void>
  readOnly?: boolean
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export default function VideoPlayerNotes({
  url,
  notes,
  onAddNote,
  onResolveNote,
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

  const handleProgress = useCallback((state: { playedSeconds: number }) => {
    setCurrentTime(state.playedSeconds)
  }, [])

  const handleDuration = useCallback((dur: number) => {
    setDuration(dur)
  }, [])

  const handleAddNoteClick = () => {
    setPlaying(false)
    setNoteTimestamp(currentTime)
    setShowNoteForm(true)
  }

  const handleSubmitNote = async () => {
    if (!noteText.trim()) return
    setSubmittingNote(true)
    await onAddNote(noteText.trim(), noteTimestamp, noteCategory)
    setNoteText('')
    setShowNoteForm(false)
    setSubmittingNote(false)
  }

  const handleSeekToNote = (seconds: number) => {
    if (playerRef.current) {
      playerRef.current.seekTo(seconds, 'seconds')
      setCurrentTime(seconds)
    }
  }

  const sortedNotes = [...notes]
    .filter(n => n.timestamp_seconds !== null)
    .sort((a, b) => (a.timestamp_seconds || 0) - (b.timestamp_seconds || 0))

  const isGoogleDrive = url.includes('drive.google.com')
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="space-y-4">
      {/* Video Player */}
      <div className="relative rounded-lg overflow-hidden" style={{ background: '#000' }}>
        <div className="aspect-video">
          {isGoogleDrive ? (
            <iframe
              src={url.replace('/view', '/preview').replace('/edit', '/preview')}
              className="w-full h-full"
              allow="autoplay"
              allowFullScreen
            />
          ) : (
            <ReactPlayer
              ref={playerRef}
              url={url}
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

        {/* Note markers on progress bar */}
        {!isGoogleDrive && duration > 0 && sortedNotes.length > 0 && (
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
            {!isGoogleDrive && (
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
          <button onClick={handleAddNoteClick} className="btn-primary text-xs flex items-center gap-1.5">
            <MessageSquare size={12} />
            {!isGoogleDrive ? `Note at ${formatTimestamp(currentTime)}` : 'Add Note'}
          </button>
        </div>
      )}

      {/* Progress bar */}
      {!isGoogleDrive && !readOnly && (
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
              <span className="badge badge-gold text-xs">
                {formatTimestamp(noteTimestamp)}
              </span>
            </div>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              className="input"
              rows={3}
              placeholder="Describe the issue or feedback..."
              autoFocus
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
                  </div>
                </div>
                {!readOnly && !note.is_resolved && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onResolveNote(note.id)
                    }}
                    className="text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: 'var(--text-3)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--green)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-3)')}
                    title="Mark as resolved"
                  >
                    <Check size={14} />
                  </button>
                )}
                {note.is_resolved && (
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
