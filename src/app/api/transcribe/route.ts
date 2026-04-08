import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import { extractGoogleDriveFileId } from '@/lib/utils/google-drive'

export const maxDuration = 300 // 5 minutes — enough for most videos

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function getAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyJson) return null
  try {
    const credentials = JSON.parse(keyJson)
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    })
  } catch {
    return null
  }
}

/**
 * POST /api/transcribe
 *
 * Downloads video from Google Drive via service account,
 * sends audio to Deepgram for transcription, and stores
 * the result with word-level timestamps directly in Supabase.
 *
 * No Railway middleman — single request, single response.
 *
 * Body: { submission_id: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { submission_id } = await req.json()

    if (!submission_id) {
      return NextResponse.json({ error: 'Missing submission_id' }, { status: 400 })
    }

    const deepgramKey = process.env.DEEPGRAM_API_KEY
    if (!deepgramKey) {
      return NextResponse.json({ error: 'DEEPGRAM_API_KEY not configured' }, { status: 500 })
    }

    // Get submission
    const { data: submission, error: fetchErr } = await supabase
      .from('qc_submissions')
      .select('id, external_url, metadata')
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
    const existingMeta = (submission.metadata as Record<string, unknown>) || {}
    await supabase
      .from('qc_submissions')
      .update({
        transcript_status: 'processing',
        metadata: { ...existingMeta, transcription_started_at: new Date().toISOString() },
      })
      .eq('id', submission_id)

    // Get authenticated download URL from Google Drive
    const auth = getAuth()
    if (!auth) {
      await markFailed(submission_id, existingMeta, 'Google service account not configured')
      return NextResponse.json({ error: 'Google service account not configured' }, { status: 500 })
    }

    const authClient = await auth.getClient()
    const token = await authClient.getAccessToken()
    if (!token.token) {
      await markFailed(submission_id, existingMeta, 'Failed to get Google access token')
      return NextResponse.json({ error: 'Failed to get Google access token' }, { status: 500 })
    }

    // Stream file from Drive directly to Deepgram (no buffering in memory)
    console.log(`[transcribe] Streaming file ${fileId} from Drive to Deepgram...`)

    const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token.token}` },
    })

    if (!driveRes.ok) {
      const errText = await driveRes.text().catch(() => 'unknown')
      await markFailed(submission_id, existingMeta, `Drive download failed: ${driveRes.status} ${errText.slice(0, 200)}`)
      return NextResponse.json({ error: `Failed to download from Drive: ${driveRes.status}` }, { status: 500 })
    }

    // Pipe the Drive response body directly to Deepgram — no arraybuffer needed
    const dgRes = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&paragraphs=true&utterances=false&punctuate=true', {
      method: 'POST',
      headers: {
        Authorization: `Token ${deepgramKey}`,
        'Content-Type': driveRes.headers.get('content-type') || 'application/octet-stream',
      },
      body: driveRes.body,
      // @ts-expect-error - duplex required for streaming request body
      duplex: 'half',
    })

    if (!dgRes.ok) {
      const errText = await dgRes.text().catch(() => 'unknown')
      await markFailed(submission_id, existingMeta, `Deepgram error: ${dgRes.status} ${errText.slice(0, 200)}`)
      return NextResponse.json({ error: `Deepgram transcription failed: ${dgRes.status}` }, { status: 500 })
    }

    const dgData = await dgRes.json()
    console.log(`[transcribe] Deepgram response received`)

    // Extract transcript and word timestamps
    const channel = dgData.results?.channels?.[0]
    const alternative = channel?.alternatives?.[0]

    if (!alternative) {
      await markFailed(submission_id, existingMeta, 'Deepgram returned no transcript data')
      return NextResponse.json({ error: 'No transcript data from Deepgram' }, { status: 500 })
    }

    const transcript = alternative.paragraphs?.transcript || alternative.transcript || ''
    const words = (alternative.words || []).map((w: { word: string; start: number; end: number; confidence: number; punctuated_word?: string }) => ({
      word: w.word,
      start: w.start,
      end: w.end,
      confidence: w.confidence,
      punctuated_word: w.punctuated_word || w.word,
    }))

    // Save to Supabase
    await supabase
      .from('qc_submissions')
      .update({
        transcript,
        transcript_status: 'completed',
        metadata: {
          ...existingMeta,
          deepgram_words: words,
          transcription_completed_at: new Date().toISOString(),
          transcription_word_count: words.length,
          transcription_duration_seconds: dgData.metadata?.duration || 0,
          source_method: 'deepgram-direct',
        },
      })
      .eq('id', submission_id)

    console.log(`[transcribe] Done — ${words.length} words, saved to submission ${submission_id}`)

    return NextResponse.json({
      status: 'completed',
      word_count: words.length,
      duration: dgData.metadata?.duration || 0,
    })
  } catch (err) {
    console.error('[transcribe] Error:', err)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function markFailed(submissionId: string, existingMeta: Record<string, unknown>, error: string) {
  console.error(`[transcribe] Failed: ${error}`)
  await supabase
    .from('qc_submissions')
    .update({
      transcript_status: 'failed',
      metadata: {
        ...existingMeta,
        transcription_error: error,
        transcription_failed_at: new Date().toISOString(),
      },
    })
    .eq('id', submissionId)
}
