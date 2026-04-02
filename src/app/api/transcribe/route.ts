import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { extractGoogleDriveFileId } from '@/lib/utils/google-drive'
import { google } from 'googleapis'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const WHISPER_MAX_SIZE = 25 * 1024 * 1024 // 25MB

export const maxDuration = 120

function getAccessToken(): Promise<string | null> {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyJson) return Promise.resolve(null)

  try {
    const credentials = JSON.parse(keyJson)
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    })
    return auth.getAccessToken() as Promise<string | null>
  } catch {
    console.error('[transcribe] Failed to get access token')
    return Promise.resolve(null)
  }
}

async function downloadFromDrive(fileId: string): Promise<{ blob: Blob; fileName: string; size: number }> {
  const token = await getAccessToken()

  if (token) {
    // Get file metadata
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,size,mimeType&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    if (!metaRes.ok) {
      throw new Error(`Drive metadata failed: ${metaRes.status} ${await metaRes.text().catch(() => '')}`)
    }

    const meta = await metaRes.json()
    const fileName = meta.name || 'video.mp4'
    const size = parseInt(meta.size || '0', 10)

    // Check size before downloading
    if (size > WHISPER_MAX_SIZE) {
      throw new Error(`FILE_TOO_LARGE:${size}`)
    }

    // Download file content
    const dlRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    if (!dlRes.ok) {
      throw new Error(`Drive download failed: ${dlRes.status}`)
    }

    const blob = await dlRes.blob()
    return { blob, fileName, size: blob.size }
  }

  // Fallback: direct download URL
  console.warn('[transcribe] No service account, falling back to direct download')
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`

  const fileResponse = await fetch(downloadUrl, { redirect: 'follow' })
  if (!fileResponse.ok) {
    throw new Error(`Drive download failed: ${fileResponse.status} ${fileResponse.statusText}`)
  }

  const blob = await fileResponse.blob()
  return { blob, fileName: 'video.mp4', size: blob.size }
}

export async function POST(req: NextRequest) {
  try {
    const { submission_id } = await req.json()

    if (!submission_id) {
      return NextResponse.json({ error: 'Missing submission_id' }, { status: 400 })
    }

    const openaiKey = process.env.OPENAI_API_KEY
    if (!openaiKey) {
      return NextResponse.json({ error: 'Transcription not configured: OPENAI_API_KEY missing' }, { status: 500 })
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
      await supabase.from('qc_submissions').update({ transcript_status: 'failed' }).eq('id', submission_id)
      return NextResponse.json({ error: 'Could not extract Drive file ID from URL' }, { status: 400 })
    }

    // Download from Drive with retry
    let downloaded: { blob: Blob; fileName: string; size: number } | undefined
    let lastError: string = ''

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        downloaded = await downloadFromDrive(fileId)
        lastError = ''
        break
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)

        // Don't retry if file is too large
        if (lastError.startsWith('FILE_TOO_LARGE:')) {
          const size = parseInt(lastError.split(':')[1], 10)
          await supabase.from('qc_submissions').update({ transcript_status: 'failed' }).eq('id', submission_id)
          return NextResponse.json(
            { error: `File too large (${Math.round(size / 1024 / 1024)}MB, max 25MB). Use "Paste manually" instead.` },
            { status: 413 }
          )
        }

        console.warn(`[transcribe] Attempt ${attempt + 1} failed: ${lastError}`)
        if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
      }
    }

    if (lastError || !downloaded) {
      await supabase.from('qc_submissions').update({ transcript_status: 'failed' }).eq('id', submission_id)
      return NextResponse.json(
        { error: `Could not download from Drive: ${lastError}` },
        { status: 400 }
      )
    }

    // Check size
    if (downloaded.size > WHISPER_MAX_SIZE) {
      await supabase.from('qc_submissions').update({ transcript_status: 'failed' }).eq('id', submission_id)
      return NextResponse.json(
        { error: `File too large (${Math.round(downloaded.size / 1024 / 1024)}MB, max 25MB). Use "Paste manually" instead.` },
        { status: 413 }
      )
    }

    // Send to Whisper
    const formData = new FormData()
    formData.append('file', downloaded.blob, downloaded.fileName)
    formData.append('model', 'whisper-1')
    formData.append('response_format', 'text')

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}` },
      body: formData,
    })

    if (!whisperRes.ok) {
      const errText = await whisperRes.text()
      console.error('[transcribe] Whisper error:', errText)
      await supabase.from('qc_submissions').update({ transcript_status: 'failed' }).eq('id', submission_id)
      return NextResponse.json({ error: `Transcription failed: ${whisperRes.status}` }, { status: 500 })
    }

    const transcript = (await whisperRes.text()).trim()

    // Save
    await supabase
      .from('qc_submissions')
      .update({ transcript, transcript_status: 'completed' })
      .eq('id', submission_id)

    return NextResponse.json({ success: true, transcript })
  } catch (err) {
    console.error('[transcribe] Unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
