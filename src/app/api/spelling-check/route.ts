import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

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
 * POST /api/spelling-check
 *
 * Uses Deepgram's word-level timestamps from the transcript to identify
 * proper nouns, names, and brand terms with their EXACT timestamps.
 * Then checks against client DNA for potential spelling risks.
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

    // Get submission with transcript + metadata (contains Deepgram word timestamps)
    const { data: submission, error: fetchErr } = await supabase
      .from('qc_submissions')
      .select('id, title, client_id, transcript, metadata, clients(name)')
      .eq('id', submission_id)
      .single()

    if (fetchErr || !submission) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
    }

    if (!submission.transcript) {
      return NextResponse.json(
        { error: 'No transcript available. Generate the transcript first, then run spelling check.' },
        { status: 400 }
      )
    }

    const clients = submission.clients as unknown as { name: string }[] | { name: string } | null
    const clientName = Array.isArray(clients) ? clients[0]?.name : clients?.name || 'Unknown Client'

    // Get Deepgram word timestamps from metadata
    const meta = submission.metadata as Record<string, unknown> | null
    const dgWords = (meta?.deepgram_words || []) as DeepgramWord[]

    // Build a timestamped transcript — each line shows the time + words
    // This gives Claude exact timestamps to reference
    let timestampedTranscript = ''
    if (dgWords.length > 0) {
      // Group words into ~10-second chunks with timestamps
      let currentChunkStart = 0
      let currentWords: string[] = []

      for (const w of dgWords) {
        if (w.start - currentChunkStart >= 10 && currentWords.length > 0) {
          const mm = Math.floor(currentChunkStart / 60)
          const ss = Math.floor(currentChunkStart % 60)
          timestampedTranscript += `[${mm}:${String(ss).padStart(2, '0')}] ${currentWords.join(' ')}\n`
          currentChunkStart = w.start
          currentWords = []
        }
        currentWords.push(w.punctuated_word || w.word)
      }
      // Last chunk
      if (currentWords.length > 0) {
        const mm = Math.floor(currentChunkStart / 60)
        const ss = Math.floor(currentChunkStart % 60)
        timestampedTranscript += `[${mm}:${String(ss).padStart(2, '0')}] ${currentWords.join(' ')}\n`
      }
    } else {
      // Fallback: use plain transcript without timestamps
      timestampedTranscript = submission.transcript.slice(0, 8000)
    }

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
      dnaExcerpt = dna.dna_markdown.slice(0, 3000)
    }

    // Use Claude to find spelling risks with exact timestamps
    const anthropic = new Anthropic({ apiKey: anthropicKey })

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `You are a QC spelling checker for video production. Your job is to identify words in a timestamped transcript that will likely appear as ON-SCREEN TEXT (lower thirds, name plates, titles, captions) and could be misspelled by editors.

CLIENT INFORMATION (these are the CORRECT spellings):
Client: ${clientName}
${dnaExcerpt}

VIDEO TITLE: ${submission.title || 'Untitled'}

TIMESTAMPED TRANSCRIPT (each line has [MM:SS] timestamp):
${timestampedTranscript.slice(0, 10000)}

TASK:
Find every proper noun, name, company name, title, URL, or technical term that an editor would need to type on screen. For each one, provide the EXACT timestamp from the transcript where it's spoken.

Focus on:
- Person names (speakers, guests, the client) — editors type these into lower thirds
- Company/brand names — appear in title cards and lower thirds
- Product/service names — appear in captions and graphics
- Credentials and titles (CEO, PhD, CPA, etc.) — appear in lower thirds
- URLs and social handles — appear as overlays
- Industry-specific terms that are easy to misspell

DO NOT flag:
- Common English words
- Words that are obviously simple to spell
- Generic phrases

Return a JSON array. Each item MUST have:
- "word": the exact word/phrase from the transcript
- "correct_spelling": the verified correct spelling from the DNA/context
- "timestamp_seconds": the EXACT timestamp in seconds from the transcript (convert MM:SS to seconds)
- "issue": brief description of why this is a risk (e.g., "unusual spelling", "commonly misspelled name")
- "type": "lower_third" | "title_card" | "caption" | "url_overlay"
- "confidence": 0.0-1.0 (how likely an editor would misspell this)

Return ONLY valid JSON array, no other text. If no risks, return [].`,
        },
      ],
    })

    const content = response.content[0]
    if (content.type !== 'text') {
      return NextResponse.json({ success: true, issues: [], message: 'No analysis produced' })
    }

    // Parse response
    let issues: Array<{
      word: string
      correct_spelling: string
      timestamp_seconds: number
      issue: string
      type: string
      confidence: number
    }> = []

    try {
      let jsonStr = content.text.trim()
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (jsonMatch) jsonStr = jsonMatch[1].trim()
      issues = JSON.parse(jsonStr)
    } catch {
      console.error('[spelling-check] Failed to parse:', content.text.slice(0, 200))
      return NextResponse.json({ error: 'Failed to parse spelling analysis' }, { status: 500 })
    }

    // Filter low confidence
    issues = issues.filter(i => i.confidence > 0.3)

    // If we have Deepgram words, snap each issue to the nearest exact word timestamp
    if (dgWords.length > 0) {
      for (const issue of issues) {
        const target = issue.word.toLowerCase()
        // Find the Deepgram word that best matches
        const match = dgWords.find(w =>
          w.word.toLowerCase() === target ||
          (w.punctuated_word || '').toLowerCase() === target ||
          w.word.toLowerCase().includes(target) ||
          target.includes(w.word.toLowerCase())
        )
        if (match) {
          issue.timestamp_seconds = match.start
        }
      }
    }

    // Save results to database
    // Clear previous results first
    await supabase
      .from('spelling_check_results')
      .delete()
      .eq('submission_id', submission_id)

    if (issues.length > 0) {
      const rows = issues.map(issue => ({
        submission_id,
        frame_timestamp_seconds: issue.timestamp_seconds || 0,
        detected_text: issue.word,
        issue_description: `${issue.issue} (${issue.type})`,
        suggested_fix: issue.correct_spelling,
        confidence: Math.max(0, Math.min(1, issue.confidence)),
        status: 'flagged',
      }))

      await supabase.from('spelling_check_results').insert(rows)
    }

    return NextResponse.json({
      success: true,
      issues: issues.map(i => ({
        frame_timestamp_seconds: i.timestamp_seconds || 0,
        detected_text: i.word,
        issue_description: `${i.issue} (${i.type})`,
        suggested_fix: i.correct_spelling,
        confidence: i.confidence,
      })),
      total_risks: issues.length,
      has_timestamps: dgWords.length > 0,
    })
  } catch (err) {
    console.error('[spelling-check] Error:', err)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
