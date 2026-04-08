import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

interface DeepgramWord {
  word: string
  start: number
  end: number
  confidence: number
  punctuated_word?: string
}

/**
 * Validate Deepgram word timestamps for sanity.
 * Returns a health score (0-100) and list of issues.
 */
function validateDeepgramWords(words: DeepgramWord[]): { score: number; issues: string[] } {
  if (!words || words.length === 0) return { score: 0, issues: ['No words provided'] }

  const issues: string[] = []
  let validCount = 0

  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    let wordValid = true

    // Check start < end
    if (w.start >= w.end) {
      if (issues.length < 5) issues.push(`Word "${w.word}" at index ${i}: start (${w.start}) >= end (${w.end})`)
      wordValid = false
    }

    // Check non-negative
    if (w.start < 0 || w.end < 0) {
      if (issues.length < 5) issues.push(`Word "${w.word}" at index ${i}: negative timestamp`)
      wordValid = false
    }

    // Check monotonically increasing (allow slight overlap for fast speech)
    if (i > 0 && w.start < words[i - 1].start - 0.1) {
      if (issues.length < 5) issues.push(`Word "${w.word}" at index ${i}: timestamp goes backward`)
      wordValid = false
    }

    // Check word is non-empty
    if (!w.word || w.word.trim() === '') {
      if (issues.length < 5) issues.push(`Empty word at index ${i}`)
      wordValid = false
    }

    if (wordValid) validCount++
  }

  const score = Math.round((validCount / words.length) * 100)
  return { score, issues }
}

/**
 * POST /api/webhook/transcription-complete
 *
 * Callback endpoint for the Railway transcription worker.
 * Receives transcript + Deepgram word timestamps, validates them,
 * and stores in qc_submissions.
 *
 * Body: {
 *   submission_id: string,
 *   status: "completed" | "failed",
 *   transcript?: string,
 *   deepgram_words?: DeepgramWord[],
 *   error?: string
 * }
 */
export async function POST(req: NextRequest) {
  try {
    // Validate webhook secret
    const secret = req.headers.get('x-webhook-secret')
    const expectedSecret = process.env.TRANSCRIBE_WEBHOOK_SECRET || process.env.INTAKE_WEBHOOK_SECRET
    if (!expectedSecret || secret !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { submission_id, status, transcript, deepgram_words, error: transcriptionError } = body

    if (!submission_id || !status) {
      return NextResponse.json(
        { error: 'Missing required fields: submission_id, status' },
        { status: 400 }
      )
    }

    // Get current submission
    const { data: submission, error: fetchErr } = await supabase
      .from('qc_submissions')
      .select('id, metadata, client_id, title')
      .eq('id', submission_id)
      .single()

    if (fetchErr || !submission) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
    }

    const existingMeta = (submission.metadata as Record<string, unknown>) || {}

    if (status === 'failed') {
      // Mark as failed with error info
      await supabase
        .from('qc_submissions')
        .update({
          transcript_status: 'failed',
          metadata: {
            ...existingMeta,
            transcription_error: transcriptionError || 'Unknown error',
            transcription_failed_at: new Date().toISOString(),
          },
        })
        .eq('id', submission_id)

      return NextResponse.json({ status: 'failed', message: 'Transcription failure recorded' })
    }

    // Status is "completed" — validate and store
    let transcriptStatus = 'completed'
    let healthScore = 100
    let validationIssues: string[] = []

    if (deepgram_words && Array.isArray(deepgram_words) && deepgram_words.length > 0) {
      const validation = validateDeepgramWords(deepgram_words)
      healthScore = validation.score
      validationIssues = validation.issues

      if (healthScore < 80) {
        transcriptStatus = 'needs_review'
        console.warn(`[transcription-complete] Low health score (${healthScore}%) for submission ${submission_id}`)
      }
    }

    // Update submission
    await supabase
      .from('qc_submissions')
      .update({
        transcript: transcript || null,
        transcript_status: transcriptStatus,
        metadata: {
          ...existingMeta,
          deepgram_words: deepgram_words || [],
          transcription_health_score: healthScore,
          transcription_validation_issues: validationIssues,
          transcription_completed_at: new Date().toISOString(),
        },
      })
      .eq('id', submission_id)

    // Auto-trigger spelling check if health is good
    if (transcriptStatus === 'completed' && healthScore >= 90) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${process.env.VERCEL_URL}`
      if (appUrl) {
        fetch(`${appUrl}/api/spelling-check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ submission_id }),
        }).catch(err => {
          console.error('[transcription-complete] Failed to auto-trigger spelling check:', err)
        })
      }
    }

    return NextResponse.json({
      status: transcriptStatus,
      health_score: healthScore,
      word_count: deepgram_words?.length || 0,
      issues: validationIssues,
    })
  } catch (err) {
    console.error('[transcription-complete] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
