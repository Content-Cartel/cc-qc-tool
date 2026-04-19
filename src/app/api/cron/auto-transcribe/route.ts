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
 * Railway's Deepgram worker queues internally, so this is just a sanity cap.
 * Running every 2 hours × 200/tick = 2400/day capacity — comfortable headroom
 * over the normal inflow rate (~10-30 new videos/day across all clients).
 */
const MAX_PER_TICK = 200

/**
 * How long a row can sit in `transcript_status='processing'` before we reset
 * it to NULL and re-queue. Covers two failure modes:
 *   1. Railway worker crash mid-batch — the row is wedged because the webhook
 *      callback never fired and the cron only picks `status IS NULL`.
 *   2. Legitimately long videos still processing — 45 minutes is comfortably
 *      more than Deepgram's longest sync transcription path, so we're not
 *      re-queuing healthy work.
 */
const STUCK_PROCESSING_MINUTES = 45

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
  // Accept either the cc-qc-tool-scoped CRON_SECRET_1 (for manual curls) or the
  // legacy shared CRON_SECRET (which Vercel's built-in cron scheduler sends
  // automatically). Both are valid; header must match at least one.
  const acceptable = [process.env.CRON_SECRET_1, process.env.CRON_SECRET]
    .filter((s): s is string => !!s)
    .map(s => `Bearer ${s}`)
  if (acceptable.length > 0 && !acceptable.includes(authHeader || '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const railwayUrl = process.env.RAILWAY_AGENT_URL || process.env.NEXT_PUBLIC_AGENT_WEBHOOK_URL?.replace('/webhook/event', '')
  if (!railwayUrl) {
    return NextResponse.json({ error: 'RAILWAY_AGENT_URL not configured' }, { status: 500 })
  }

  const webhookSecret = process.env.TRANSCRIBE_WEBHOOK_SECRET || process.env.NEXT_PUBLIC_AGENT_WEBHOOK_SECRET || ''
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
  const callbackUrl = appUrl ? `${appUrl}/api/webhook/transcription-complete` : undefined

  // Reset stuck 'processing' rows before selecting new ones. Rows wedge when
  // Railway worker crashes mid-batch and the webhook callback never fires.
  // Anything sitting in 'processing' for >45 min is re-queued by flipping back
  // to NULL; the idempotency key on client_transcripts (client_id, source,
  // source_id) prevents double-writes if the original did eventually complete.
  const stuckCutoff = new Date(Date.now() - STUCK_PROCESSING_MINUTES * 60_000).toISOString()
  const { data: resetRows, error: resetErr } = await supabase
    .from('qc_submissions')
    .update({ transcript_status: null, updated_at: new Date().toISOString() })
    .eq('transcript_status', 'processing')
    .lt('updated_at', stuckCutoff)
    .select('id')
  const stuckResetCount = resetRows?.length ?? 0
  if (resetErr) {
    console.warn('[auto-transcribe] stuck-reset query failed:', resetErr.message)
  } else if (stuckResetCount > 0) {
    console.log(`[auto-transcribe] Reset ${stuckResetCount} stuck 'processing' rows older than ${STUCK_PROCESSING_MINUTES}m`)
  }

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
      stuck_reset: stuckResetCount,
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
    // Explicitly bump updated_at so the stuck-reset check above has a fresh
    // timestamp to measure against next tick.
    const { error: markErr } = await supabase
      .from('qc_submissions')
      .update({ transcript_status: 'processing', updated_at: new Date().toISOString() })
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
    const resetNote = stuckResetCount > 0 ? `\n_Reset ${stuckResetCount} stuck 'processing' row(s) older than ${STUCK_PROCESSING_MINUTES}m — re-queued._` : ''
    const slackMessage = {
      text: `:microphone: *Auto-transcribe tick*\n` +
        `Queued ${queued} submissions at Deepgram · ${errors} errors · ${skipped} skipped\n` +
        `Transcripts will bridge into client_transcripts as Railway completes each one.${resetNote}`,
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
    stuck_reset: stuckResetCount,
    results,
  })
}
