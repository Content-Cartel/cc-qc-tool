import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { extractGoogleDriveFileId } from '@/lib/utils/google-drive'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL_1 || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY_1 || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_1 || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

/**
 * Per-tick cap on how many pending submissions we fire off at Railway.
 * Railway processes transcriptions serially internally; firing too many at
 * once wastes nothing but makes debugging harder. The cron runs daily, so
 * the backlog drains over a few ticks if it's ever huge.
 */
const MAX_PER_TICK = 40

interface TranscribeResult {
  submission_id: string
  title: string | null
  client_id: number | null
  status: 'queued' | 'skipped' | 'error'
  reason?: string
}

/**
 * GET /api/cron/auto-transcribe
 *
 * Runs daily (Vercel cron at 12:00 UTC = 5am PT). Scans qc_submissions for
 * rows that haven't been transcribed yet, and fires each one at the Railway
 * Deepgram worker. The worker's callback hits /api/webhook/transcription-complete
 * which updates qc_submissions AND bridges into client_transcripts (the
 * Phase-1 bridge), so the Friday post cron sees the new content automatically.
 *
 * Auth: Bearer CRON_SECRET (same as the other crons).
 */
export async function GET(req: NextRequest) {
  const supabase = getSupabase()
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const railwayUrl = process.env.RAILWAY_AGENT_URL || process.env.NEXT_PUBLIC_AGENT_WEBHOOK_URL?.replace('/webhook/event', '')
  if (!railwayUrl) {
    return NextResponse.json({ error: 'RAILWAY_AGENT_URL not configured' }, { status: 500 })
  }

  const webhookSecret = process.env.TRANSCRIBE_WEBHOOK_SECRET || process.env.NEXT_PUBLIC_AGENT_WEBHOOK_SECRET || ''
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
  const callbackUrl = appUrl ? `${appUrl}/api/webhook/transcription-complete` : undefined

  // Find pending submissions: transcript_status is NULL AND has a video URL.
  // Ordered oldest-first so the backlog drains fairly.
  const { data: pending, error: queryErr } = await supabase
    .from('qc_submissions')
    .select('id, title, client_id, external_url')
    .is('transcript_status', null)
    .not('external_url', 'is', null)
    .order('created_at', { ascending: true })
    .limit(MAX_PER_TICK)

  if (queryErr) {
    return NextResponse.json({ error: queryErr.message }, { status: 500 })
  }

  if (!pending || pending.length === 0) {
    return NextResponse.json({
      message: 'No pending submissions — backlog clear',
      processed: 0,
      results: [],
    })
  }

  const results: TranscribeResult[] = []

  for (const sub of pending) {
    const fileId = sub.external_url ? extractGoogleDriveFileId(sub.external_url) : null
    if (!fileId) {
      results.push({
        submission_id: sub.id,
        title: sub.title,
        client_id: sub.client_id,
        status: 'skipped',
        reason: 'could not extract Drive file id from external_url',
      })
      continue
    }

    // Mark as processing so the UI reflects the transition and so a re-run
    // of this cron before Railway callback doesn't double-fire for the same row.
    const { error: markErr } = await supabase
      .from('qc_submissions')
      .update({ transcript_status: 'processing' })
      .eq('id', sub.id)

    if (markErr) {
      results.push({
        submission_id: sub.id,
        title: sub.title,
        client_id: sub.client_id,
        status: 'error',
        reason: `failed to mark processing: ${markErr.message}`,
      })
      continue
    }

    try {
      const res = await fetch(`${railwayUrl}/webhook/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': webhookSecret,
        },
        body: JSON.stringify({
          submission_id: sub.id,
          file_id: fileId,
          ...(callbackUrl ? { callback_url: callbackUrl } : {}),
        }),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        results.push({
          submission_id: sub.id,
          title: sub.title,
          client_id: sub.client_id,
          status: 'error',
          reason: `Railway ${res.status}: ${body.slice(0, 180)}`,
        })
        continue
      }

      results.push({
        submission_id: sub.id,
        title: sub.title,
        client_id: sub.client_id,
        status: 'queued',
      })
    } catch (err) {
      results.push({
        submission_id: sub.id,
        title: sub.title,
        client_id: sub.client_id,
        status: 'error',
        reason: err instanceof Error ? err.message : 'unknown error',
      })
    }
  }

  // Best-effort Slack notification so the team sees the backlog draining.
  const slackWebhook = process.env.SLACK_CONTENT_WEBHOOK_URL
  if (slackWebhook) {
    const queued = results.filter(r => r.status === 'queued').length
    const errors = results.filter(r => r.status === 'error').length
    const skipped = results.filter(r => r.status === 'skipped').length
    const slackMessage = {
      text: `:microphone: *Auto-transcribe tick*\n` +
        `Queued ${queued} submissions at Deepgram · ${errors} errors · ${skipped} skipped\n` +
        `Transcripts will bridge into client_transcripts as Railway completes each one.`,
    }
    fetch(slackWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackMessage),
    }).catch(err => console.error('[auto-transcribe] Slack notify failed:', err))
  }

  return NextResponse.json({
    processed: results.length,
    queued: results.filter(r => r.status === 'queued').length,
    errors: results.filter(r => r.status === 'error').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    results,
  })
}
