import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL_1 || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY_1 || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_1 || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

/**
 * POST /api/transcripts/drive
 * Ingest a single Drive/Deepgram transcript (for the cc-written-agent cron).
 *
 * POST /api/transcripts/drive?batch=true
 * Ingest multiple transcripts at once.
 *
 * Dedup key: (client_id, source='drive_deepgram', source_id).
 * source_id = submission_id ?? drive_file_id. At least one is required.
 */
export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  const expectedKey = process.env.TRANSCRIPT_API_KEY
  if (expectedKey && apiKey !== expectedKey) {
    return Response.json({ error: 'Invalid API key' }, { status: 401 })
  }

  const isBatch = req.nextUrl.searchParams.get('batch') === 'true'
  const body = await req.json()

  if (isBatch) {
    return handleBatch(Array.isArray(body) ? body : body.transcripts || [])
  }
  return handleSingle(body)
}

interface DrivePayload {
  client_id: number
  submission_id?: string
  drive_file_id?: string
  title?: string
  transcript_text: string
  duration_seconds?: number
  recorded_at?: string
  metadata?: Record<string, unknown>
  relevance_tag?: 'general' | 'onboarding' | 'strategy' | 'content_review'
}

function resolveSourceId(p: DrivePayload): string | null {
  return p.submission_id || p.drive_file_id || null
}

async function handleSingle(payload: DrivePayload) {
  const supabase = getSupabase()
  const { client_id, transcript_text, title, duration_seconds, recorded_at, metadata, relevance_tag, submission_id } = payload
  const source_id = resolveSourceId(payload)

  if (!client_id || !transcript_text || !source_id) {
    return Response.json(
      { error: 'client_id, transcript_text, and one of (submission_id, drive_file_id) are required' },
      { status: 400 }
    )
  }

  const wordCount = transcript_text.split(/\s+/).length

  const { data, error } = await supabase.from('client_transcripts').upsert({
    client_id,
    source: 'drive_deepgram',
    source_id,
    submission_id: submission_id || null,
    title: title || null,
    transcript_text,
    word_count: wordCount,
    duration_seconds: duration_seconds || null,
    recorded_at: recorded_at || null,
    metadata: metadata || {},
    relevance_tag: relevance_tag || 'general',
  }, {
    onConflict: 'client_id,source,source_id',
  }).select('id').single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ success: true, id: data?.id, word_count: wordCount })
}

async function handleBatch(items: DrivePayload[]) {
  if (!items.length) {
    return Response.json({ error: 'Empty batch' }, { status: 400 })
  }

  const supabase = getSupabase()
  const results: { source_id: string; success: boolean; error?: string; word_count?: number }[] = []

  for (const item of items) {
    const source_id = resolveSourceId(item)
    if (!item.client_id || !item.transcript_text || !source_id) {
      results.push({ source_id: source_id || 'unknown', success: false, error: 'Missing required fields' })
      continue
    }

    const wordCount = item.transcript_text.split(/\s+/).length

    const { error } = await supabase.from('client_transcripts').upsert({
      client_id: item.client_id,
      source: 'drive_deepgram',
      source_id,
      submission_id: item.submission_id || null,
      title: item.title || null,
      transcript_text: item.transcript_text,
      word_count: wordCount,
      duration_seconds: item.duration_seconds || null,
      recorded_at: item.recorded_at || null,
      metadata: item.metadata || {},
      relevance_tag: item.relevance_tag || 'general',
    }, {
      onConflict: 'client_id,source,source_id',
    })

    results.push({
      source_id,
      success: !error,
      error: error?.message,
      word_count: error ? undefined : wordCount,
    })
  }

  const succeeded = results.filter(r => r.success).length
  return Response.json({ total: items.length, succeeded, failed: items.length - succeeded, results })
}
