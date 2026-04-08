import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { notifyAgent } from '@/lib/notify-agent'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const VALID_STAGES = [
  'raw_footage', 'ai_auto_clean', 'editor_polish',
  'qc_review', 'package', 'publish',
]

/**
 * POST /api/webhook/pipeline-advance
 *
 * Called by n8n or OCI when AI processing completes,
 * to auto-advance a submission through pipeline stages.
 *
 * Body: {
 *   submission_id: string,
 *   from_stage: string,
 *   to_stage: string,
 *   source: "n8n" | "oci" | "manual",
 *   metadata?: Record<string, unknown>
 * }
 */
export async function POST(req: NextRequest) {
  try {
    // Validate webhook secret
    const secret = req.headers.get('x-webhook-secret')
    const expectedSecret = process.env.PIPELINE_WEBHOOK_SECRET || process.env.INTAKE_WEBHOOK_SECRET
    if (!expectedSecret || secret !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { submission_id, from_stage, to_stage, source, metadata } = body

    if (!submission_id || !to_stage) {
      return NextResponse.json(
        { error: 'Missing required fields: submission_id, to_stage' },
        { status: 400 }
      )
    }

    if (!VALID_STAGES.includes(to_stage)) {
      return NextResponse.json(
        { error: `Invalid to_stage: ${to_stage}. Valid stages: ${VALID_STAGES.join(', ')}` },
        { status: 400 }
      )
    }

    // Get submission
    const { data: submission, error: fetchErr } = await supabase
      .from('qc_submissions')
      .select('id, current_pipeline_stage, client_id, title, submitted_by_name')
      .eq('id', submission_id)
      .single()

    if (fetchErr || !submission) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
    }

    // Validate from_stage if provided
    if (from_stage && submission.current_pipeline_stage !== from_stage) {
      return NextResponse.json({
        error: `Stage mismatch: submission is at "${submission.current_pipeline_stage}", expected "${from_stage}"`,
        current_stage: submission.current_pipeline_stage,
      }, { status: 409 })
    }

    // Update pipeline stage
    await supabase
      .from('qc_submissions')
      .update({ current_pipeline_stage: to_stage })
      .eq('id', submission_id)

    // Track in pipeline_stages table
    try {
      await supabase.from('pipeline_stages').insert({
        submission_id,
        stage: to_stage,
        entered_at: new Date().toISOString(),
        notes: `Auto-advanced by ${source || 'webhook'}${metadata?.processing_time_ms ? ` (${metadata.processing_time_ms}ms)` : ''}`,
      })
    } catch {
      // Table may not exist yet
    }

    // Notify agent about stage change
    notifyAgent({
      event: 'stage_change',
      client_id: submission.client_id,
      submission_id,
      from: submission.current_pipeline_stage,
      to: to_stage,
      content_title: submission.title,
      source: source || 'webhook',
    })

    // Create in-app notification when reaching editor_polish (editors can pick up)
    if (to_stage === 'editor_polish') {
      await supabase.from('notifications').insert({
        user_name: submission.submitted_by_name || 'editors',
        submission_id,
        message: `"${submission.title}" is ready for editing — AI processing complete.`,
        type: 'stage_change',
      })
    }

    return NextResponse.json({
      success: true,
      submission_id,
      from_stage: submission.current_pipeline_stage,
      to_stage,
    })
  } catch (err) {
    console.error('[pipeline-advance] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
