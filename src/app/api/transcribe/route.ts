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
 * Downloads from Google Drive via service account, sends buffer to Deepgram.
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

    // Step 1: Get Drive access token
    const token = await getDriveAccessToken()
    if (!token) {
      await markFailed(submission_id)
      return NextResponse.json({ error: 'GOOGLE_SERVICE_ACCOUNT_KEY not configured or invalid' }, { status: 500 })
    }

    // Step 2: Get file metadata
    let mimeType = 'video/mp4'
    try {
      const metaRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,size,mimeType&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (metaRes.ok) {
        const meta = await metaRes.json()
        mimeType = meta.mimeType || 'video/mp4'
        const sizeMB = Math.round(parseInt(meta.size || '0') / (1024 * 1024))
        console.log(`[transcribe] File: ${meta.name}, ${sizeMB}MB, ${mimeType}`)

        // Warn if file is very large (>1GB) — might OOM
        if (sizeMB > 1000) {
          console.warn(`[transcribe] Large file (${sizeMB}MB) — may run out of memory`)
        }
      } else {
        const errText = await metaRes.text()
        console.error(`[transcribe] Drive metadata error: ${metaRes.status} ${errText}`)
        await markFailed(submission_id)
        return NextResponse.json({ error: `Cannot access Drive file: ${metaRes.status}. Make sure the service account has access.` }, { status: 400 })
      }
    } catch (err) {
      console.error('[transcribe] Metadata fetch failed:', err)
    }

    // Step 3: Download file from Drive into buffer
    console.log('[transcribe] Downloading from Drive...')
    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    if (!driveRes.ok) {
      const errText = await driveRes.text()
      console.error(`[transcribe] Drive download failed: ${driveRes.status} ${errText}`)
      await markFailed(submission_id)
      return NextResponse.json({ error: `Drive download failed: ${driveRes.status}` }, { status: 400 })
    }

    const fileBuffer = await driveRes.arrayBuffer()
    console.log(`[transcribe] Downloaded ${Math.round(fileBuffer.byteLength / (1024 * 1024))}MB, sending to Deepgram...`)

    // Step 4: Send to Deepgram
    const dgRes = await fetch(
      'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true&paragraphs=true&utterances=true&utt_split=0.8',
      {
        method: 'POST',
        headers: {
          'Authorization': `Token ${deepgramKey}`,
          'Content-Type': mimeType,
        },
        body: fileBuffer,
      }
    )

    if (!dgRes.ok) {
      const errText = await dgRes.text()
      console.error(`[transcribe] Deepgram error: ${dgRes.status} ${errText}`)
      await markFailed(submission_id)
      return NextResponse.json({ error: `Deepgram API ${dgRes.status}: ${errText.slice(0, 300)}` }, { status: 500 })
    }

    const dgData = await dgRes.json()
    console.log('[transcribe] Deepgram response received')

    // Extract transcript
    const paragraphs = dgData?.results?.channels?.[0]?.alternatives?.[0]?.paragraphs?.transcript
    const plainTranscript = dgData?.results?.channels?.[0]?.alternatives?.[0]?.transcript
    const transcript = (paragraphs || plainTranscript || '').trim()

    const words = dgData?.results?.channels?.[0]?.alternatives?.[0]?.words || []
    const utterances = dgData?.results?.utterances || []

    if (!transcript || transcript.length < 10) {
      await markFailed(submission_id)
      return NextResponse.json({ error: 'Transcription returned empty. The video may not have audible speech.' }, { status: 400 })
    }

    // Save transcript + word timestamps
    await supabase
      .from('qc_submissions')
      .update({
        transcript,
        transcript_status: 'completed',
        metadata: {
          deepgram_words: words.slice(0, 5000),
          deepgram_utterances: utterances.slice(0, 500),
          transcribed_at: new Date().toISOString(),
          duration_seconds: dgData?.metadata?.duration || null,
        },
      })
      .eq('id', submission_id)

    console.log(`[transcribe] Done: ${words.length} words, ${Math.round(dgData?.metadata?.duration || 0)}s duration`)

    return NextResponse.json({
      success: true,
      transcript,
      source: 'deepgram',
      duration: dgData?.metadata?.duration || null,
      word_count: words.length,
    })
  } catch (err) {
    console.error('[transcribe] Unhandled error:', err)
    return NextResponse.json({ error: `Internal server error: ${err instanceof Error ? err.message : 'unknown'}` }, { status: 500 })
  }
}

async function markFailed(submissionId: string) {
  await supabase.from('qc_submissions').update({ transcript_status: 'failed' }).eq('id', submissionId)
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
