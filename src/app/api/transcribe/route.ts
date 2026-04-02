import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { extractGoogleDriveFileId } from '@/lib/utils/google-drive'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export const maxDuration = 60

/**
 * POST /api/transcribe
 *
 * Transcribes a QC submission. Tries multiple methods:
 * 1. YouTube captions (no download needed - fastest, free)
 * 2. Client transcript library (already scraped by cron)
 * 3. Google Drive + Whisper (downloads file - fallback for small files)
 *
 * Body: { submission_id: string, youtube_url?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { submission_id, youtube_url } = await req.json()

    if (!submission_id) {
      return NextResponse.json({ error: 'Missing submission_id' }, { status: 400 })
    }

    // Get submission
    const { data: submission, error: fetchErr } = await supabase
      .from('qc_submissions')
      .select('id, external_url, title, transcript_status, client_id')
      .eq('id', submission_id)
      .single()

    if (fetchErr || !submission) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
    }

    // Mark as processing
    await supabase
      .from('qc_submissions')
      .update({ transcript_status: 'processing' })
      .eq('id', submission_id)

    let transcript: string | null = null
    let source = ''

    // Method 1: Pull from YouTube if URL provided
    if (youtube_url) {
      const videoId = extractYouTubeVideoId(youtube_url)
      if (videoId) {
        transcript = await fetchYouTubeTranscript(videoId)
        if (transcript) source = 'youtube_captions'
      }
    }

    // Method 2: Check if client already has transcripts in the library
    if (!transcript && submission.client_id) {
      const { data: existing } = await supabase
        .from('client_transcripts')
        .select('transcript_text, title')
        .eq('client_id', submission.client_id)
        .order('recorded_at', { ascending: false })
        .limit(5)

      if (existing && existing.length > 0) {
        // Try to match by title similarity
        const subTitle = (submission.title || '').toLowerCase()
        const match = existing.find(t =>
          t.title && subTitle.includes(t.title.toLowerCase().slice(0, 20))
        )
        if (match?.transcript_text) {
          transcript = match.transcript_text
          source = 'client_library'
        }
      }
    }

    // Method 3: Google Drive + Whisper (only for files under 25MB)
    if (!transcript && submission.external_url) {
      const openaiKey = process.env.OPENAI_API_KEY
      const fileId = extractGoogleDriveFileId(submission.external_url)

      if (openaiKey && fileId) {
        try {
          transcript = await transcribeFromDrive(fileId, openaiKey)
          if (transcript) source = 'whisper'
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.warn('[transcribe] Drive+Whisper failed:', msg)
          // Don't fail entirely - just note the error
        }
      }
    }

    if (!transcript) {
      await supabase
        .from('qc_submissions')
        .update({ transcript_status: 'failed' })
        .eq('id', submission_id)
      return NextResponse.json(
        {
          error: 'Could not pull transcript. Options: (1) paste a YouTube URL and retry, (2) paste the transcript manually, (3) check that the video is published on YouTube with captions enabled.',
        },
        { status: 400 }
      )
    }

    // Save transcript
    await supabase
      .from('qc_submissions')
      .update({ transcript, transcript_status: 'completed' })
      .eq('id', submission_id)

    return NextResponse.json({ success: true, transcript, source })
  } catch (err) {
    console.error('[transcribe] Unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}


// --- YouTube transcript (no download needed) ---

function extractYouTubeVideoId(url: string): string | null {
  const match = url.match(/(?:v=|youtu\.be\/|\/shorts\/)([\w-]{11})/)
  return match ? match[1] : null
}

async function fetchYouTubeTranscript(videoId: string): Promise<string | null> {
  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ContentCartel/1.0)' },
    })
    const html = await pageRes.text()

    const captionMatch = html.match(/"captionTracks":\[.*?"baseUrl":"(.*?)"/)
    if (!captionMatch) return null

    const captionUrl = captionMatch[1].replace(/\\u0026/g, '&')
    const captionRes = await fetch(captionUrl)
    const captionXml = await captionRes.text()

    const textSegments = captionXml.match(/<text[^>]*>([^<]*)<\/text>/g)
    if (!textSegments) return null

    const fullText = textSegments
      .map(seg => {
        const textMatch = seg.match(/<text[^>]*>([^<]*)<\/text>/)
        return textMatch ? decodeEntities(textMatch[1]) : ''
      })
      .filter(Boolean)
      .join(' ')

    return fullText.trim() || null
  } catch {
    return null
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\n/g, ' ')
    .trim()
}


// --- Google Drive + Whisper fallback (small files only) ---

const WHISPER_MAX_SIZE = 25 * 1024 * 1024

async function transcribeFromDrive(fileId: string, openaiKey: string): Promise<string | null> {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  let token: string | null = null

  if (keyJson) {
    try {
      const { google } = await import('googleapis')
      const credentials = JSON.parse(keyJson)
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      })
      token = await auth.getAccessToken() as string | null
    } catch {
      console.warn('[transcribe] Could not get service account token')
    }
  }

  // Check file size first
  if (token) {
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=size&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (metaRes.ok) {
      const meta = await metaRes.json()
      const size = parseInt(meta.size || '0', 10)
      if (size > WHISPER_MAX_SIZE) {
        throw new Error(`File too large (${Math.round(size / 1024 / 1024)}MB). Use YouTube captions or paste manually.`)
      }
    }
  }

  // Download
  const dlUrl = token
    ? `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`
    : `https://drive.google.com/uc?export=download&id=${fileId}`

  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  const dlRes = await fetch(dlUrl, { headers, redirect: 'follow' })

  if (!dlRes.ok) throw new Error(`Drive download failed: ${dlRes.status}`)

  const blob = await dlRes.blob()
  if (blob.size > WHISPER_MAX_SIZE) {
    throw new Error(`File too large (${Math.round(blob.size / 1024 / 1024)}MB)`)
  }

  // Send to Whisper
  const formData = new FormData()
  formData.append('file', blob, 'video.mp4')
  formData.append('model', 'whisper-1')
  formData.append('response_format', 'text')

  const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: formData,
  })

  if (!whisperRes.ok) {
    const errText = await whisperRes.text()
    throw new Error(`Whisper API error: ${whisperRes.status} - ${errText.slice(0, 100)}`)
  }

  return (await whisperRes.text()).trim() || null
}
