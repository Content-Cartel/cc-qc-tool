import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { enqueueTranscription } from '@/lib/transcribe-enqueue'

export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL_1 || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY_1 || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_1 || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

/**
 * POST /api/transcribe
 *
 * Manual-trigger endpoint for the "Generate Transcript" button on the review
 * page. Thin wrapper around `enqueueTranscription` so the manual and automatic
 * (intake + drive-scan + 2h cron) paths share one implementation.
 *
 * Body: { submission_id: string }
 */
export async function POST(req: NextRequest) {
  const supabase = getSupabase()
  try {
    const { submission_id } = await req.json()

    if (!submission_id) {
      return NextResponse.json({ error: 'Missing submission_id' }, { status: 400 })
    }

    const { data: submission, error: fetchErr } = await supabase
      .from('qc_submissions')
      .select('id, external_url')
      .eq('id', submission_id)
      .single()

    if (fetchErr || !submission) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
    }

    const result = await enqueueTranscription({
      supabase,
      submissionId: submission.id,
      externalUrl: submission.external_url,
    })

    if (!result.queued) {
      return NextResponse.json({ error: result.reason || 'Failed to queue' }, { status: 400 })
    }

    return NextResponse.json({ status: 'processing', message: 'Transcription started' })
  } catch (err) {
    console.error('[transcribe] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
