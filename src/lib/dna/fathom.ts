/**
 * Fathom AI API integration for DNA generation.
 * Auto-pulls meeting transcripts and summaries for client onboarding/strategy calls.
 * Uses domain matching (primary) and title search (fallback) to find relevant meetings.
 */

import { SupabaseClient } from '@supabase/supabase-js'

const FATHOM_API_BASE = 'https://api.fathom.ai/external/v1'

// ─── Types ──────────────────────────────────────────────────────

interface FathomMeeting {
  recording_id: number
  title: string
  meeting_title: string
  created_at: string
  scheduled_start_time: string | null
  scheduled_end_time: string | null
  recording_start_time: string | null
  recording_end_time: string | null
  calendar_invitees: { email: string; display_name: string }[]
}

interface FathomTranscriptEntry {
  speaker: {
    display_name: string
    matched_calendar_invitee_email?: string
  }
  text: string
  timestamp: string
}

interface FathomSummary {
  template_name: string
  markdown_formatted: string
}

interface FathomListResponse {
  items: FathomMeeting[]
  next_cursor: string | null
  limit: number
}

export interface FathomSyncResult {
  found: number
  new_synced: number
  already_stored: number
  meetings: { title: string; relevance_tag: string; word_count: number; recording_id: string }[]
}

// ─── API Helpers ────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.FATHOM_API_KEY
  if (!key) throw new Error('FATHOM_API_KEY not configured')
  return key
}

async function fathomFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${FATHOM_API_BASE}${path}`)
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v))
  }

  const res = await fetch(url.toString(), {
    headers: {
      'X-Api-Key': getApiKey(),
      'Accept': 'application/json',
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Fathom API ${res.status}: ${text || res.statusText}`)
  }

  return res.json()
}

// ─── Core Functions ─────────────────────────────────────────────

/**
 * List meetings filtered by attendee domain.
 * Handles cursor pagination to fetch all matching meetings.
 */
export async function listMeetingsByDomain(
  domain: string,
  options?: { after?: string; before?: string; limit?: number }
): Promise<FathomMeeting[]> {
  const meetings: FathomMeeting[] = []
  let cursor: string | null = null
  const maxPages = 10 // Safety limit

  // Default: last 6 months
  const after = options?.after || new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()

  for (let page = 0; page < maxPages; page++) {
    const params: Record<string, string> = {
      'calendar_invitees_domains[]': domain,
      'created_after': after,
    }
    if (options?.before) params['created_before'] = options.before
    if (cursor) params['cursor'] = cursor

    const data = await fathomFetch<FathomListResponse>('/meetings', params)
    meetings.push(...data.items)

    if (!data.next_cursor || (options?.limit && meetings.length >= options.limit)) break
    cursor = data.next_cursor
  }

  return options?.limit ? meetings.slice(0, options.limit) : meetings
}

/**
 * Search meetings by title (fallback when domain matching returns nothing).
 * Fetches recent meetings and filters client-side by title match.
 */
export async function listMeetingsByTitle(
  clientName: string,
  options?: { after?: string }
): Promise<FathomMeeting[]> {
  const allMeetings: FathomMeeting[] = []
  let cursor: string | null = null
  const maxPages = 5

  const after = options?.after || new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()

  for (let page = 0; page < maxPages; page++) {
    const params: Record<string, string> = { 'created_after': after }
    if (cursor) params['cursor'] = cursor

    const data = await fathomFetch<FathomListResponse>('/meetings', params)
    allMeetings.push(...data.items)

    if (!data.next_cursor) break
    cursor = data.next_cursor
  }

  // Client-side title filter (case-insensitive)
  const needle = clientName.toLowerCase()
  return allMeetings.filter(m =>
    m.title?.toLowerCase().includes(needle) ||
    m.meeting_title?.toLowerCase().includes(needle)
  )
}

/**
 * Fetch full transcript for a recording.
 */
export async function fetchTranscript(recordingId: number): Promise<FathomTranscriptEntry[]> {
  const data = await fathomFetch<{ transcript: FathomTranscriptEntry[] }>(
    `/recordings/${recordingId}/transcript`
  )
  return data.transcript || []
}

/**
 * Fetch AI-generated summary for a recording.
 */
export async function fetchSummary(recordingId: number): Promise<string | null> {
  try {
    const data = await fathomFetch<{ summary: FathomSummary }>(
      `/recordings/${recordingId}/summary`
    )
    return data.summary?.markdown_formatted || null
  } catch {
    // Summary may not be available for all meetings
    return null
  }
}

// ─── Formatting ─────────────────────────────────────────────────

/**
 * Convert Fathom transcript entries into readable text.
 */
function formatTranscriptText(entries: FathomTranscriptEntry[]): string {
  if (!entries.length) return ''

  return entries.map(e => {
    const speaker = e.speaker?.display_name || 'Unknown'
    return `[${speaker}] ${e.text}`
  }).join('\n')
}

/**
 * Auto-tag meeting relevance based on title keywords.
 */
function tagRelevance(title: string): 'onboarding' | 'strategy' | 'content_review' | 'general' {
  const t = (title || '').toLowerCase()

  if (/onboarding|kickoff|kick-off|intake|welcome|intro call|discovery/i.test(t)) return 'onboarding'
  if (/strategy|planning|content plan|roadmap|gameplan|game plan/i.test(t)) return 'strategy'
  if (/review|feedback|qc|check-in|checkin|approval/i.test(t)) return 'content_review'
  return 'general'
}

// ─── Orchestrator ───────────────────────────────────────────────

/**
 * Sync Fathom meetings for a client into client_transcripts table.
 * Uses domain matching first, falls back to title search.
 */
export async function syncFathomMeetings(
  clientId: number,
  clientName: string,
  domain: string | null,
  supabase: SupabaseClient
): Promise<FathomSyncResult> {
  // Step 1: Find meetings (domain first, title fallback)
  let meetings: FathomMeeting[] = []

  if (domain) {
    meetings = await listMeetingsByDomain(domain)
  }

  if (meetings.length === 0) {
    meetings = await listMeetingsByTitle(clientName)
  }

  if (meetings.length === 0) {
    return { found: 0, new_synced: 0, already_stored: 0, meetings: [] }
  }

  // Step 2: Check which ones we already have
  const { data: existing } = await supabase
    .from('client_transcripts')
    .select('source_id')
    .eq('client_id', clientId)
    .eq('source', 'fathom')

  const existingIds = new Set((existing || []).map(e => e.source_id))

  const newMeetings = meetings.filter(m => !existingIds.has(String(m.recording_id)))

  // Step 3: Fetch transcripts + summaries for new meetings
  const syncedMeetings: FathomSyncResult['meetings'] = []

  for (const meeting of newMeetings) {
    try {
      const [transcriptEntries, summary] = await Promise.all([
        fetchTranscript(meeting.recording_id),
        fetchSummary(meeting.recording_id),
      ])

      const transcriptText = formatTranscriptText(transcriptEntries)
      if (!transcriptText) continue // Skip meetings with no transcript

      const wordCount = transcriptText.split(/\s+/).length
      const speakerNames = Array.from(new Set(transcriptEntries.map(e => e.speaker?.display_name).filter(Boolean)))
      const relevanceTag = tagRelevance(meeting.title || meeting.meeting_title || '')

      // Calculate duration from recording times
      let durationSeconds: number | null = null
      if (meeting.recording_start_time && meeting.recording_end_time) {
        durationSeconds = Math.round(
          (new Date(meeting.recording_end_time).getTime() - new Date(meeting.recording_start_time).getTime()) / 1000
        )
      }

      const { error } = await supabase.from('client_transcripts').upsert({
        client_id: clientId,
        source: 'fathom',
        source_id: String(meeting.recording_id),
        title: meeting.title || meeting.meeting_title || 'Untitled Meeting',
        transcript_text: transcriptText,
        summary: summary,
        speaker_names: speakerNames,
        word_count: wordCount,
        duration_seconds: durationSeconds,
        recorded_at: meeting.created_at,
        metadata: {
          calendar_invitees: meeting.calendar_invitees,
          scheduled_start: meeting.scheduled_start_time,
          scheduled_end: meeting.scheduled_end_time,
        },
        relevance_tag: relevanceTag,
      }, {
        onConflict: 'client_id,source,source_id',
      })

      if (!error) {
        syncedMeetings.push({
          title: meeting.title || meeting.meeting_title || 'Untitled',
          relevance_tag: relevanceTag,
          word_count: wordCount,
          recording_id: String(meeting.recording_id),
        })
      }
    } catch (err) {
      // Log but continue — don't fail the whole sync for one meeting
      console.error(`Failed to sync Fathom meeting ${meeting.recording_id}:`, err)
    }
  }

  // Also include already-stored meetings in the result for visibility
  const allMeetingResults = [
    ...syncedMeetings,
    ...(existing || []).map(e => ({
      title: '(previously synced)',
      relevance_tag: 'unknown',
      word_count: 0,
      recording_id: e.source_id,
    })),
  ]

  return {
    found: meetings.length,
    new_synced: syncedMeetings.length,
    already_stored: existingIds.size,
    meetings: allMeetingResults,
  }
}

/**
 * Check if Fathom API is configured and accessible.
 */
export function isFathomConfigured(): boolean {
  return !!process.env.FATHOM_API_KEY
}
