import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { extractGoogleDriveFileId } from '@/lib/utils/google-drive'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export const maxDuration = 300

/**
 * POST /api/transcribe
 *
 * Transcribes a QC submission video using Deepgram.
 * Streams the file from Google Drive directly to Deepgram — never buffers
 * the full file in memory, so it works with any file size.
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
      .select('id, external_url, title, transcript_status')
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

    // Get Drive access token
    const token = await getDriveAccessToken()
    if (!token) {
      await supabase.from('qc_submissions').update({ transcript_status: 'failed' }).eq('id', submission_id)
      return NextResponse.json({ error: 'Google Drive service account not configured (GOOGLE_SERVICE_ACCOUNT_KEY)' }, { status: 500 })
    }

    // Get file metadata (mime type needed for Deepgram)
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,size,mimeType&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!metaRes.ok) {
      await supabase.from('qc_submissions').update({ transcript_status: 'failed' }).eq('id', submission_id)
      const errText = await metaRes.text()
      return NextResponse.json({ error: `Drive file not accessible: ${metaRes.status} ${errText.slice(0, 100)}` }, { status: 400 })
    }
    const fileMeta = await metaRes.json()
    const mimeType = fileMeta.mimeType || 'video/mp4'

    // Stream file from Drive -> Deepgram
    // We fetch from Drive and pipe the response body directly to Deepgram
    // This avoids buffering the entire file in memory
    const driveStream = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    if (!driveStream.ok || !driveStream.body) {
      await supabase.from('qc_submissions').update({ transcript_status: 'failed' }).eq('id', submission_id)
      return NextResponse.json({ error: `Drive download failed: ${driveStream.status}` }, { status: 400 })
    }

    // Send the stream directly to Deepgram's pre-recorded API
    // Deepgram accepts raw audio/video via POST body with Content-Type header
    const dgRes = await fetch(
      'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true&paragraphs=true&utterances=true&utt_split=0.8',
      {
        method: 'POST',
        headers: {
          'Authorization': `Token ${deepgramKey}`,
          'Content-Type': mimeType,
        },
        body: driveStream.body,
        // @ts-expect-error - duplex is needed for streaming request bodies in Node.js
        duplex: 'half',
      }
    )

    if (!dgRes.ok) {
      const errText = await dgRes.text()
      console.error('[transcribe] Deepgram error:', errText)
      await supabase.from('qc_submissions').update({ transcript_status: 'failed' }).eq('id', submission_id)
      return NextResponse.json({ error: `Deepgram API ${dgRes.status}: ${errText.slice(0, 200)}` }, { status: 500 })
    }

    const dgData = await dgRes.json()

    // Extract paragraph transcript (nicely formatted)
    const paragraphs = dgData?.results?.channels?.[0]?.alternatives?.[0]?.paragraphs?.transcript
    const plainTranscript = dgData?.results?.channels?.[0]?.alternatives?.[0]?.transcript
    const transcript = (paragraphs || plainTranscript || '').trim()

    // Extract word-level timestamps for spelling check later
    const words = dgData?.results?.channels?.[0]?.alternatives?.[0]?.words || []
    const utterances = dgData?.results?.utterances || []

    if (!transcript || transcript.length < 10) {
      await supabase.from('qc_submissions').update({ transcript_status: 'failed' }).eq('id', submission_id)
      return NextResponse.json({ error: 'Transcription returned empty. The video may not have spoken audio.' }, { status: 400 })
    }

    // Save transcript + word timestamps (for spelling check with timestamps)
    await supabase
      .from('qc_submissions')
      .update({
        transcript,
        transcript_status: 'completed',
        // Store word-level data in metadata for spelling check
        metadata: {
          deepgram_words: words.slice(0, 5000), // Cap at 5000 words to avoid row size limits
          deepgram_utterances: utterances.slice(0, 500),
          transcribed_at: new Date().toISOString(),
          duration_seconds: dgData?.metadata?.duration || null,
        },
      })
      .eq('id', submission_id)

    return NextResponse.json({
      success: true,
      transcript,
      source: 'deepgram',
      duration: dgData?.metadata?.duration || null,
      word_count: words.length,
    })
  } catch (err) {
    console.error('[transcribe] Unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function getDriveAccessToken(): Promise<string | null> {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyJson) return null

  try {
    const { google } = await import('googleapis')
    const credentials = JSON.parse(keyJson)
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    })
    return await auth.getAccessToken() as string | null
  } catch (err) {
    console.error('[transcribe] Service account auth failed:', err)
    return null
  }
}
