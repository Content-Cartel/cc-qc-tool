import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { extractGoogleDriveFileId } from '@/lib/utils/google-drive'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export const maxDuration = 300 // 5 min - Deepgram can take a while for long videos

/**
 * POST /api/transcribe
 *
 * Transcribes a QC submission video using Deepgram.
 * Flow: Google Drive → authenticated download URL → Deepgram (handles any file size)
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
      return NextResponse.json({ error: 'Transcription not configured: DEEPGRAM_API_KEY missing' }, { status: 500 })
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
      return NextResponse.json({ error: 'Could not extract Drive file ID from URL' }, { status: 400 })
    }

    // Mark as processing
    await supabase
      .from('qc_submissions')
      .update({ transcript_status: 'processing' })
      .eq('id', submission_id)

    // Get an authenticated download URL from Google Drive
    const downloadUrl = await getDriveDownloadUrl(fileId)
    if (!downloadUrl) {
      await supabase.from('qc_submissions').update({ transcript_status: 'failed' }).eq('id', submission_id)
      return NextResponse.json(
        { error: 'Could not generate download URL. Check that GOOGLE_SERVICE_ACCOUNT_KEY is set and has access to the file.' },
        { status: 400 }
      )
    }

    // Send to Deepgram — it downloads the file directly (any size)
    let transcript: string
    try {
      transcript = await transcribeWithDeepgram(downloadUrl, deepgramKey)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[transcribe] Deepgram error:', msg)
      await supabase.from('qc_submissions').update({ transcript_status: 'failed' }).eq('id', submission_id)
      return NextResponse.json({ error: `Transcription failed: ${msg}` }, { status: 500 })
    }

    if (!transcript || transcript.trim().length < 10) {
      await supabase.from('qc_submissions').update({ transcript_status: 'failed' }).eq('id', submission_id)
      return NextResponse.json({ error: 'Transcription returned empty. The video may not have spoken audio.' }, { status: 400 })
    }

    // Save transcript
    await supabase
      .from('qc_submissions')
      .update({ transcript: transcript.trim(), transcript_status: 'completed' })
      .eq('id', submission_id)

    return NextResponse.json({ success: true, transcript: transcript.trim(), source: 'deepgram' })
  } catch (err) {
    console.error('[transcribe] Unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Get an authenticated download URL for a Google Drive file.
 * Uses the service account to generate an access token, then builds
 * a URL that Deepgram can fetch directly.
 */
async function getDriveDownloadUrl(fileId: string): Promise<string | null> {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyJson) {
    // Fallback: try public URL (works if file is shared as "anyone with link")
    return `https://drive.google.com/uc?export=download&id=${fileId}`
  }

  try {
    const { google } = await import('googleapis')
    const credentials = JSON.parse(keyJson)
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    })
    const token = await auth.getAccessToken()

    if (!token) return null

    // Return the Drive API URL with the access token as a query param
    // Deepgram will use this to download the file directly
    return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true&access_token=${token}`
  } catch (err) {
    console.error('[transcribe] Failed to get Drive auth:', err)
    return null
  }
}

/**
 * Transcribe audio/video via Deepgram's pre-recorded API.
 * Deepgram downloads the file from the URL — we never hold it in memory.
 */
async function transcribeWithDeepgram(audioUrl: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true&paragraphs=true', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: audioUrl }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Deepgram API ${res.status}: ${errText.slice(0, 200)}`)
  }

  const data = await res.json()

  // Extract transcript from Deepgram response
  const paragraphs = data?.results?.channels?.[0]?.alternatives?.[0]?.paragraphs?.transcript
  if (paragraphs) return paragraphs

  // Fallback to plain transcript
  const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript
  return transcript || ''
}
