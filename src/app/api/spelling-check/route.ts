import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/**
 * POST /api/spelling-check
 *
 * Analyzes a submission's transcript against the client's DNA to flag
 * potential on-screen spelling issues (names, company names, titles, etc.)
 *
 * Works by cross-referencing the transcript with known correct spellings
 * from the client DNA, then flagging words/phrases that could be misspelled
 * when displayed as lower thirds, titles, or captions.
 *
 * Body: { submission_id: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { submission_id } = await req.json()

    if (!submission_id) {
      return NextResponse.json({ error: 'Missing submission_id' }, { status: 400 })
    }

    const anthropicKey = process.env.CC_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
    if (!anthropicKey) {
      return NextResponse.json({ error: 'Anthropic API key not configured' }, { status: 500 })
    }

    // Get submission + transcript + client info
    const { data: submission, error: fetchErr } = await supabase
      .from('qc_submissions')
      .select('id, external_url, title, client_id, transcript, clients(name)')
      .eq('id', submission_id)
      .single()

    if (fetchErr || !submission) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
    }

    // Need either a transcript or client transcripts to analyze
    let transcriptText = submission.transcript

    // If no submission transcript, try to find client transcripts for this video
    if (!transcriptText) {
      const { data: clientTranscripts } = await supabase
        .from('client_transcripts')
        .select('transcript_text')
        .eq('client_id', submission.client_id)
        .order('recorded_at', { ascending: false })
        .limit(1)

      if (clientTranscripts?.[0]?.transcript_text) {
        transcriptText = clientTranscripts[0].transcript_text
      }
    }

    if (!transcriptText) {
      return NextResponse.json(
        { error: 'No transcript available for this submission. Transcribe the video first, then run the spelling check.' },
        { status: 400 }
      )
    }

    const clients = submission.clients as unknown as { name: string }[] | { name: string } | null
    const clientName = Array.isArray(clients) ? clients[0]?.name : clients?.name || 'Unknown Client'

    // Get client DNA for correct spelling reference
    const { data: dna } = await supabase
      .from('client_dna')
      .select('dna_markdown')
      .eq('client_id', submission.client_id)
      .order('version', { ascending: false })
      .limit(1)
      .single()

    let dnaExcerpt = ''
    if (dna?.dna_markdown) {
      // Pull first 3000 chars of DNA (covers names, company, key people, brand terms)
      dnaExcerpt = dna.dna_markdown.slice(0, 3000)
    }

    // Use Claude to analyze transcript for potential on-screen spelling issues
    const anthropic = new Anthropic({ apiKey: anthropicKey })

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `You are a QC spelling checker for video production at Content Cartel. Your job is to identify words and phrases in a video transcript that are likely to appear as ON-SCREEN TEXT (lower thirds, name plates, titles, captions, URLs) and might be misspelled by editors.

CLIENT INFORMATION (correct spellings):
Client name: ${clientName}
${dnaExcerpt}

VIDEO TITLE: ${submission.title || 'Untitled'}

TRANSCRIPT:
${transcriptText.slice(0, 8000)}

TASK:
1. Identify all proper nouns, names, company names, titles, URLs, technical terms, and brand-specific words in the transcript
2. For each one, flag it as a potential on-screen spelling risk — these are words editors will type into lower thirds, title cards, or captions
3. Provide the CORRECT spelling based on the client DNA and context
4. Estimate roughly where in the video this text might appear (early/middle/late, as approximate seconds)

Focus on:
- Person names mentioned (speakers, guests, the client themselves)
- Company/brand names
- Product or service names
- Technical terms specific to the client's industry
- URLs or social handles mentioned
- Titles or credentials (CEO, PhD, etc.)

DO NOT flag:
- Common English words
- Generic phrases unlikely to appear on screen
- Words that are obviously correct

Return a JSON array. Each item:
- "detected_text": the word/phrase as heard in transcript
- "correct_spelling": the verified correct spelling from DNA/context
- "issue": why this might be misspelled (e.g., "commonly misspelled name", "unusual company spelling")
- "timestamp_estimate": approximate seconds into the video (0 for beginning, estimate based on position in transcript)
- "confidence": 0.0-1.0 (1.0 = very likely to be misspelled by editors, 0.5 = moderate risk)
- "on_screen_type": what kind of on-screen element this would appear in ("lower_third", "title_card", "caption", "url_overlay")

If no risks found, return empty array: []
Return ONLY valid JSON, no other text.`,
        },
      ],
    })

    const content = response.content[0]
    if (content.type !== 'text') {
      return NextResponse.json({ success: true, issues: [], message: 'No analysis produced' })
    }

    // Parse response
    let issues: Array<{
      detected_text: string
      correct_spelling: string
      issue: string
      timestamp_estimate: number
      confidence: number
      on_screen_type: string
    }> = []

    try {
      let jsonStr = content.text.trim()
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (jsonMatch) jsonStr = jsonMatch[1].trim()
      issues = JSON.parse(jsonStr)
    } catch {
      console.error('[spelling-check] Failed to parse response:', content.text.slice(0, 200))
      return NextResponse.json({ error: 'Failed to parse spelling analysis' }, { status: 500 })
    }

    // Filter to only meaningful issues (confidence > 0.3)
    issues = issues.filter(i => i.confidence > 0.3)

    // Save results to database
    if (issues.length > 0) {
      const rows = issues.map(issue => ({
        submission_id,
        frame_timestamp_seconds: issue.timestamp_estimate || 0,
        detected_text: issue.detected_text,
        issue_description: `${issue.issue} (${issue.on_screen_type})`,
        suggested_fix: issue.correct_spelling,
        confidence: Math.max(0, Math.min(1, issue.confidence)),
        status: 'flagged',
      }))

      // Clear previous results for this submission before inserting new ones
      await supabase
        .from('spelling_check_results')
        .delete()
        .eq('submission_id', submission_id)

      await supabase.from('spelling_check_results').insert(rows)
    }

    return NextResponse.json({
      success: true,
      issues: issues.map(i => ({
        frame_timestamp_seconds: i.timestamp_estimate || 0,
        detected_text: i.detected_text,
        issue_description: `${i.issue} (${i.on_screen_type})`,
        suggested_fix: i.correct_spelling,
        confidence: i.confidence,
      })),
      total_risks: issues.length,
    })
  } catch (err) {
    console.error('[spelling-check] Error:', err)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
