import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { extractGoogleDriveFileId } from '@/lib/utils/google-drive'
import { getVideoMetadata, checkResolution } from '@/lib/utils/video-metadata'

export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL_1 || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY_1 || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_1 || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

/**
 * POST /api/video-metadata
 *
 * Fetches video resolution, duration, and file info from Google Drive
 * and caches it in qc_submissions.metadata.video_info.
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

    // Get submission
    const { data: submission, error: fetchErr } = await supabase
      .from('qc_submissions')
      .select('id, external_url, content_type, metadata')
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

    // Fetch metadata from Google Drive
    const videoMeta = await getVideoMetadata(fileId)
    if (!videoMeta) {
      return NextResponse.json(
        { error: 'Could not retrieve video metadata — file may still be processing in Drive' },
        { status: 422 }
      )
    }

    // Check resolution against content type
    const resolutionCheck = checkResolution(
      submission.content_type,
      videoMeta.width,
      videoMeta.height,
    )

    const videoInfo = {
      ...videoMeta,
      resolution_check: resolutionCheck,
      fetched_at: new Date().toISOString(),
    }

    // Cache in metadata
    const existingMeta = (submission.metadata as Record<string, unknown>) || {}
    await supabase
      .from('qc_submissions')
      .update({
        metadata: { ...existingMeta, video_info: videoInfo },
      })
      .eq('id', submission_id)

    return NextResponse.json({ video_info: videoInfo })
  } catch (err) {
    console.error('[video-metadata] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
