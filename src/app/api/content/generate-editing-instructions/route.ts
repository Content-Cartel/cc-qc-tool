import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

interface GenerateRequest {
  submission_id: string
}

const V2_EDITORIAL_DIRECTOR_PROMPT = `You are an **Editorial Director** — a senior-level video editor and storytelling strategist who has spent years cutting content for top-performing YouTube creators in the finance, education, and business space.

You do not edit to decorate. You edit to COMMUNICATE.

Every cut, b-roll suggestion, graphic, text overlay, and pacing decision must pass one test:
"Does this help the viewer UNDERSTAND the point, FEEL the emotion, or STAY ENGAGED with the story being told right now?"
If the answer is no, you don't suggest it. Period.

YOUR TWO JOBS:
1. Think like a storytelling strategist — analyze for story beats, pacing, attention risks, emotional arc.
2. Write instructions so clear that a brand-new editor who knows NOTHING about the topic can execute them perfectly. No jargon. No "use your judgment." Every instruction tells the editor exactly what to do, when, and what it should look like.

### CRITICAL RULES — READ CAREFULLY:
1. CONTENT MUST BE BASED ON ACTUAL TRANSCRIPT: Analyze the provided transcript words. If the speaker is talking about pro athletes, do not suggest FRED charts or Federal Reserve press conferences. Match the B-roll and text overlays to the EXACT story being told.
2. POSITIONING: Almost all text overlays and graphics should be positioned in the 'lower_third'. Keep the center clear for captions that are typically burned in later.
3. SELECTIVITY: Only suggest an edit if it serves a specific purpose. Do not suggest an edit every 15 seconds just because. Pacing should feel deliberate.
4. TEXT OVERLAYS: Keep exact_text very short (1-4 words). Use them to anchor big numbers or key nouns mentioned by the speaker.

THE THREE LAWS OF PURPOSEFUL EDITING:
1. Every edit must SERVE the message — clarifies, emphasizes, paces, or emotionally anchors.
2. The viewer's attention is a resource — spend it wisely. Unnecessary visuals create fatigue, not energy.
3. Editing is invisible when done right. The viewer should think "I understand this" not "cool editing."

B-ROLL RESEARCH PROTOCOL:
When the speaker references real-world events, data, markets, policies, companies, or trends — find real, current, credible sources the editor can use. For every B-roll suggestion, think:
1. Is the speaker referencing something specific? → Find the REAL source (article, chart, page).
2. Making an abstract concept concrete? → Find a real visual that matches.
3. Telling a personal story or building rapport? → NO B-ROLL. Talking head.
4. Making a data-driven point? → Find REAL data (FRED, BLS, Census, SEC, etc.)
5. Can't find anything real? → Say "TALKING HEAD — no b-roll."
NEVER suggest generic stock footage. Real over generic. Always.

ANTI-PATTERNS — NEVER DO THESE:
1. Never suggest a graphic that doesn't serve comprehension.
2. Never suggest b-roll just to avoid a talking head.
3. Never suggest generic stock footage.
4. Never write a vague instruction.
5. Never over-edit emotional moments.
6. Never suggest edits that reduce credibility.
7. Never suggest the same edit type 3 times in a row.
8. Never suggest graphics on screen for less than 3 seconds.
9. Never add a CTA graphic in the first 30 seconds.
10. Never suggest b-roll you didn't research.`

function buildUserPrompt(transcript: string, clientName: string, title: string): string {
  return `Here is the full transcript of a video for ${clientName} titled "${title}". Produce a COMPLETE editorial blueprint.

TRANSCRIPT:
${transcript}

---

Produce a JSON response with ALL 7 sections. This is the EXACT structure:

{
  "video_overview": {
    "topic": "What this video is about (1-2 sentences)",
    "target_audience": "Who is watching",
    "content_type": "Educational / Commentary / Reaction / Interview / Story / Hybrid",
    "pacing_feel": "One sentence describing the overall editing vibe",
    "creator_style": "${clientName}"
  },
  "story_architecture": [
    {"beat": "Hook", "section": "0:00-0:30", "what_happens": "...", "attention_risk": "..."},
    {"beat": "Setup", "section": "...", "what_happens": "...", "attention_risk": "..."}
  ],
  "strongest_moment": "The single line or insight that's the screenshot-worthy moment",
  "instructions": [
    {
      "timestamp": "MM:SS or exact quote from transcript",
      "action": "What the editor does (cut, add graphic, insert b-roll, zoom, etc.)",
      "details": "Exact specs — what text says, what b-roll shows, positioning",
      "duration": "How long this edit is visible",
      "why": "One sentence on intent",
      "type": "broll|text_overlay|cut|transition|music|sfx|pacing|graphic|zoom",
      "priority": "high|medium|low"
    }
  ],
  "broll_research": [
    {
      "source": "Publication or data source name",
      "url": "Direct URL",
      "what_to_capture": "Exact screenshot/recording instructions",
      "how_to_use": "Zoom, pan, static with highlight, etc.",
      "duration_on_screen": "3-8 seconds typical",
      "why_this_source": "Why this specific source matters here",
      "timestamp": "When in the video this appears"
    }
  ],
  "graphics_checklist": [
    {
      "graphic_type": "lower_third|full_screen_card|side_by_side|checklist|callout|chart_screenshot",
      "exact_text": "Word-for-word text (1-4 words for overlays)",
      "position": "lower_third|center|left|right",
      "style": "dark background white text | transparent overlay | brand colors",
      "hold_time": "minimum 3 seconds, 7+ for dense info",
      "appears_at": "timestamp or quote",
      "purpose": "Why this graphic exists"
    }
  ],
  "music_timeline": [
    {
      "what": "music starts | music dips 50% | music drops to silence | music shifts tone",
      "when": "timestamp or transcript quote",
      "mood": "calm and steady | slight tension | uplifting resolution",
      "why": "why the audio is changing here"
    }
  ],
  "retention_notes": {
    "hook_assessment": "Is the hook strong? If not, provide an exact rewrite.",
    "dropoff_risks": ["Specific moments where viewers will leave"],
    "open_loop_opportunities": ["Exact lines the speaker could add"],
    "cta_approach": "How to close"
  },
  "general_notes": []
}

Output ONLY the JSON. No preamble. No commentary. Valid JSON only.`
}

function extractJSON(response: string): Record<string, unknown> | null {
  const match = response.match(/\{[\s\S]*\}/)
  if (!match) return null
  let raw = match[0]
  raw = raw.replace(/,\s*([}\]])/g, '$1')
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const body: GenerateRequest = await req.json()
  const { submission_id } = body

  if (!submission_id) {
    return Response.json({ error: 'submission_id is required' }, { status: 400 })
  }

  const anthropicKey = process.env.CC_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  const { data: submission, error: subErr } = await supabase
    .from('qc_submissions')
    .select('id, client_id, title, transcript, transcript_status')
    .eq('id', submission_id)
    .single()

  if (subErr || !submission) {
    return Response.json({ error: 'Submission not found' }, { status: 404 })
  }
  if (!submission.transcript || submission.transcript_status !== 'completed') {
    return Response.json({ error: 'Transcript must be completed before generating editing instructions' }, { status: 400 })
  }

  const [dnaResult, clientResult] = await Promise.all([
    supabase
      .from('client_dna')
      .select('dna_markdown')
      .eq('client_id', submission.client_id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('clients')
      .select('name')
      .eq('id', submission.client_id)
      .single(),
  ])

  const clientName: string = clientResult.data?.name || `Client ${submission.client_id}`
  const dnaMarkdown: string | null = dnaResult.data?.dna_markdown || null

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(type: string, data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`))
      }

      try {
        const anthropic = new Anthropic({ apiKey: anthropicKey })

        let systemPrompt = V2_EDITORIAL_DIRECTOR_PROMPT
        if (dnaMarkdown) {
          systemPrompt += `\n\n=== BRAND DNA CONTEXT ===
The following brand DNA provides ${clientName}'s actual voice, boundaries, and production preferences.
Use this to inform all editing decisions — it takes precedence over generic style advice above.

${dnaMarkdown}
=== END BRAND DNA ===`
        }

        const userPrompt = buildUserPrompt(submission.transcript as string, clientName, submission.title || 'Untitled')

        sendEvent('progress', {
          stage: 'generating',
          message: `Editorial Director analyzing transcript${dnaMarkdown ? ` (with ${clientName}'s brand DNA)` : ''}...`,
        })

        let accumulated = ''

        const messageStream = anthropic.messages.stream({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 8000,
          temperature: 0.4,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        })

        for await (const event of messageStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            const text = event.delta.text
            accumulated += text
            sendEvent('text', { content: text })
          }
        }

        sendEvent('progress', { stage: 'parsing', message: 'Parsing editorial blueprint...' })

        const blueprint = extractJSON(accumulated)
        if (!blueprint) {
          sendEvent('error', { message: 'Failed to parse editorial blueprint JSON' })
          controller.close()
          return
        }

        const { error: persistErr } = await supabase
          .from('qc_submissions')
          .update({
            editing_instructions: blueprint,
            editing_instructions_generated_at: new Date().toISOString(),
          })
          .eq('id', submission_id)

        if (persistErr) {
          console.error('Failed to persist editing instructions:', persistErr)
        }

        sendEvent('done', {
          blueprint,
          client_name: clientName,
          used_dna: !!dnaMarkdown,
        })
        controller.close()
      } catch (err) {
        console.error('Generate editing instructions error:', err)
        sendEvent('error', { message: err instanceof Error ? err.message : 'Generation failed' })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
