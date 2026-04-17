import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

/**
 * POST /api/transcripts/youtube
 * Ingest a single YouTube video transcript (for Vedant's scraper).
 *
 * POST /api/transcripts/youtube?batch=true
 * Ingest multiple transcripts at once.
 */
export async function POST(req: NextRequest) {
  // Auth check
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

interface TranscriptPayload {
  client_id: number
  video_id: string
  title?: string
  transcript_text: string
  duration_seconds?: number
  recorded_at?: string
  metadata?: Record<string, unknown>
}

async function handleSingle(payload: TranscriptPayload) {
  const supabase = getSupabase()
  const { client_id, video_id, transcript_text, title, duration_seconds, recorded_at, metadata } = payload

  if (!client_id || !video_id || !transcript_text) {
    return Response.json(
      { error: 'client_id, video_id, and transcript_text are required' },
      { status: 400 }
    )
  }

  const wordCount = transcript_text.split(/\s+/).length

  const { data, error } = await supabase.from('client_transcripts').upsert({
    client_id,
    source: 'youtube',
    source_id: video_id,
    title: title || null,
    transcript_text,
    summary: null,
    speaker_names: null,
    word_count: wordCount,
    duration_seconds: duration_seconds || null,
    recorded_at: recorded_at || null,
    metadata: metadata || {},
    relevance_tag: 'general',
  }, {
    onConflict: 'client_id,source,source_id',
  }).select('id').single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ success: true, id: data?.id, word_count: wordCount })
}

async function handleBatch(items: TranscriptPayload[]) {
  if (!items.length) {
    return Response.json({ error: 'Empty batch' }, { status: 400 })
  }

  const supabase = getSupabase()
  const results: { video_id: string; success: boolean; error?: string; word_count?: number }[] = []

  for (const item of items) {
    if (!item.client_id || !item.video_id || !item.transcript_text) {
      results.push({ video_id: item.video_id || 'unknown', success: false, error: 'Missing required fields' })
      continue
    }

    const wordCount = item.transcript_text.split(/\s+/).length

    const { error } = await supabase.from('client_transcripts').upsert({
      client_id: item.client_id,
      source: 'youtube',
      source_id: item.video_id,
      title: item.title || null,
      transcript_text: item.transcript_text,
      summary: null,
      speaker_names: null,
      word_count: wordCount,
      duration_seconds: item.duration_seconds || null,
      recorded_at: item.recorded_at || null,
      metadata: item.metadata || {},
      relevance_tag: 'general',
    }, {
      onConflict: 'client_id,source,source_id',
    })

    results.push({
      video_id: item.video_id,
      success: !error,
      error: error?.message,
      word_count: error ? undefined : wordCount,
    })
  }

  const succeeded = results.filter(r => r.success).length
  return Response.json({ total: items.length, succeeded, failed: items.length - succeeded, results })
}
