import type { SupabaseClient } from '@supabase/supabase-js'
import { extractGoogleDriveFileId } from '@/lib/utils/google-drive'

export interface EnqueueResult {
  queued: boolean
  reason?: string
}

/**
 * Marks a submission as `transcript_status='processing'` and fires a webhook
 * at the Railway Deepgram worker. Railway calls `/api/webhook/transcription-complete`
 * when done, which writes the transcript back and bridges into `client_transcripts`.
 *
 * Fire-and-forget from callers — if the Railway POST fails, the 2h auto-transcribe
 * cron picks the submission up on its next tick (its stuck-reset logic also unwedges
 * rows that got stuck in 'processing').
 */
export async function enqueueTranscription(opts: {
  supabase: SupabaseClient
  submissionId: string
  externalUrl: string | null | undefined
}): Promise<EnqueueResult> {
  const { supabase, submissionId, externalUrl } = opts

  if (!externalUrl) {
    return { queued: false, reason: 'missing external_url' }
  }

  const fileId = extractGoogleDriveFileId(externalUrl)
  if (!fileId) {
    return { queued: false, reason: 'could not extract Drive file id from external_url' }
  }

  const railwayUrl = process.env.RAILWAY_AGENT_URL || process.env.NEXT_PUBLIC_AGENT_WEBHOOK_URL?.replace('/webhook/event', '')
  if (!railwayUrl) {
    return { queued: false, reason: 'RAILWAY_AGENT_URL not configured' }
  }

  const { error: markErr } = await supabase
    .from('qc_submissions')
    .update({ transcript_status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', submissionId)

  if (markErr) {
    return { queued: false, reason: `failed to mark processing: ${markErr.message}` }
  }

  const webhookSecret = process.env.TRANSCRIBE_WEBHOOK_SECRET || process.env.NEXT_PUBLIC_AGENT_WEBHOOK_SECRET || ''
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
  const callbackUrl = appUrl ? `${appUrl}/api/webhook/transcription-complete` : undefined

  try {
    const res = await fetch(`${railwayUrl}/webhook/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': webhookSecret,
      },
      body: JSON.stringify({
        submission_id: submissionId,
        file_id: fileId,
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { queued: false, reason: `Railway ${res.status}: ${body.slice(0, 180)}` }
    }

    return { queued: true }
  } catch (err) {
    return { queued: false, reason: err instanceof Error ? err.message : 'unknown error' }
  }
}
