import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import { extractGoogleDriveFileId } from '@/lib/utils/google-drive'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const WHISPER_MAX_SIZE = 25 * 1024 * 1024 // 25MB

export const maxDuration = 120 // 2 min timeout for large files

function getDriveAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyJson) return null
  try {
    const credentials = JSON.parse(keyJson)
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    })
  } catch {
    console.error('[transcribe] Failed to parse service account key')
    return null
  }
}

async function downloadFromDrive(fileId: string): Promise<{ blob: Blob; fileName: string; size: number }> {
  const auth = getDriveAuth()

  if (auth) {
    // Preferred: Use Google Drive API with service account
    const drive = google.drive({ version: 'v3', auth })

    // Get file metadata first
    const meta = await drive.files.get({
      fileId,
      fields: 'name,size,mimeType',
      supportsAllDrives: true,
    })

    const fileName = meta.data.name || 'video.mp4'
    const size = parseInt(meta.data.size || '0', 10)

    // Download file content
    const res = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    )

    const buffer = Buffer.from(res.data as ArrayBuffer)
    const blob = new Blob([buffer], { type: meta.data.mimeType || 'video/mp4' })

    return { blob, fileName, size }
  }

  // Fallback: direct download URL (less reliable, kept for backwards compat)
  console.warn('[transcribe] No service account configured, falling back to direct download URL')
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`

  const fileResponse = await fetch(downloadUrl, { redirect: 'follow' })
  if (!fileResponse.ok) {
    throw new Error(`Drive download failed: ${fileResponse.status} ${fileResponse.statusText}`)
  }

  const blob = await fileResponse.blob()
  const size = blob.size

  return { blob, fileName: 'video.mp4', size }
}

async function transcribeWithWhisper(blob: Blob, fileName: string, openaiKey: string): Promise<string> {
  const formData = new FormData()
  formData.append('file', blob, fileName)
  formData.append('model', 'whisper-1')
  formData.append('response_format', 'text')

  const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${openaiKey}` },
    body: formData,
  })

  if (!whisperResponse.ok) {
    const errText = await whisperResponse.text()
    console.error('[transcribe] Whisper error:', errText)
    throw new Error(`Whisper API error: ${whisperResponse.status}`)
  }

  return (await whisperResponse.text()).trim()
}

export async function POST(req: NextRequest) {
  try {
    const { submission_id } = await req.json()

    if (!submission_id) {
      return NextResponse.json({ error: 'Missing submission_id' }, { status: 400 })
    }

    const openaiKey = process.env.OPENAI_API_KEY
    if (!openaiKey) {
      return NextResponse.json({ error: 'Transcription service not configured (OPENAI_API_KEY missing)' }, { status: 500 })
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

    // Mark as processing
    await supabase
      .from('qc_submissions')
      .update({ transcript_status: 'processing' })
      .eq('id', submission_id)

    // Extract file ID
    const fileId = extractGoogleDriveFileId(submission.external_url)
    if (!fileId) {
      await supabase
        .from('qc_submissions')
        .update({ transcript_status: 'failed' })
        .eq('id', submission_id)
      return NextResponse.json({ error: 'Could not extract Drive file ID from URL' }, { status: 400 })
    }

    // Download from Drive with retry
    let downloaded: { blob: Blob; fileName: string; size: number }
    let lastError: Error | null = null

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        downloaded = await downloadFromDrive(fileId)
        lastError = null
        break
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        console.warn(`[transcribe] Download attempt ${attempt + 1} failed: ${lastError.message}`)
        if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
      }
    }

    if (lastError || !downloaded!) {
      await supabase
        .from('qc_submissions')
        .update({ transcript_status: 'failed' })
        .eq('id', submission_id)
      return NextResponse.json(
        { error: `Could not download file from Google Drive after 3 attempts: ${lastError?.message}` },
        { status: 400 }
      )
    }

    // Check file size
    if (downloaded.size > WHISPER_MAX_SIZE) {
      await supabase
        .from('qc_submissions')
        .update({ transcript_status: 'failed' })
        .eq('id', submission_id)
      return NextResponse.json(
        { error: `File too large for transcription (${Math.round(downloaded.size / 1024 / 1024)}MB, max 25MB). Extract audio or use a shorter clip.` },
        { status: 413 }
      )
    }

    // Transcribe with Whisper
    let transcript: string
    try {
      transcript = await transcribeWithWhisper(downloaded.blob, downloaded.fileName, openaiKey)
    } catch (err) {
      await supabase
        .from('qc_submissions')
        .update({ transcript_status: 'failed' })
        .eq('id', submission_id)
      const msg = err instanceof Error ? err.message : 'Unknown Whisper error'
      return NextResponse.json({ error: `Transcription failed: ${msg}` }, { status: 500 })
    }

    // Save transcript
    await supabase
      .from('qc_submissions')
      .update({
        transcript: transcript,
        transcript_status: 'completed',
      })
      .eq('id', submission_id)

    return NextResponse.json({
      success: true,
      transcript,
    })
  } catch (err) {
    console.error('[transcribe] Unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
