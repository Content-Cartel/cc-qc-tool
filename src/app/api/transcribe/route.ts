import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { extractGoogleDriveFileId } from '@/lib/utils/google-drive'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/**
 * POST /api/transcribe
 *
 * Thin proxy — marks submission as processing, fires webhook to
 * Railway worker, returns immediately. Railway does the heavy lifting
 * (downloads from Drive, runs Deepgram, writes result to Supabase).
 *
 * Body: { submission_id: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { submission_id } = await req.json()

    if (!submission_id) {
      return NextResponse.json({ error: 'Missing submission_id' }, { status: 400 })
    }

    const railwayUrl = process.env.RAILWAY_AGENT_URL || process.env.NEXT_PUBLIC_AGENT_WEBHOOK_URL?.replace('/webhook/event', '')
    if (!railwayUrl) {
      return NextResponse.json({ error: 'RAILWAY_AGENT_URL not configured' }, { status: 500 })
    }

    // Get submission
    const { data: submission, error: fetchErr } = await supabase
      .from('qc_submissions')
      .select('id, external_url')
      .eq('id', submission_id)
      .single()

    if (fetchErr || !submission) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
    }

    if (!submission.external_url) {
      return NextResponse.json({ error: 'No video URL on this submission' }, { status: 400 })
    }

    const fileId = extractGoogleDriveFileId(submission.external_url)
    if (!fileId) {
      return NextResponse.json({ error: 'Could not extract Drive file ID' }, { status: 400 })
    }

    // Mark as processing
    await supabase
      .from('qc_submissions')
      .update({ transcript_status: 'processing' })
      .eq('id', submission_id)

    // Fire webhook to Railway
    const webhookSecret = process.env.TRANSCRIBE_WEBHOOK_SECRET || process.env.NEXT_PUBLIC_AGENT_WEBHOOK_SECRET || ''
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
    const callbackUrl = appUrl ? `${appUrl}/api/webhook/transcription-complete` : undefined

    const webhookRes = await fetch(`${railwayUrl}/webhook/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': webhookSecret,
      },
      body: JSON.stringify({
        submission_id,
        file_id: fileId,
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
      }),
    }).catch(err => {
      console.error('[transcribe] Failed to fire webhook to Railway:', err)
      return null
    })

    if (!webhookRes || !webhookRes.ok) {
      const errText = webhookRes ? await webhookRes.text().catch(() => '') : 'Connection failed'
      console.error(`[transcribe] Railway webhook failed: ${webhookRes?.status || 'no response'} ${errText.slice(0, 200)}`)
      // Don't fail the request — Railway may still process it
    }

    return NextResponse.json({ status: 'processing', message: 'Transcription started' })
  } catch (err) {
    console.error('[transcribe] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
