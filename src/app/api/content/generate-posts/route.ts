import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { ccPostProcess } from '@/lib/content/cc-rules'
import { extractTranscriptSignal } from '@/lib/content/transcript-extractor'
import {
  buildGenerationSystemPrompt,
  buildGenerationUserPrompt,
  extractDraft,
  MissingTranscriptError,
  MissingVoiceError,
  type Platform,
} from '@/lib/content/build-generation-prompt'
import { loadRecentApprovedExamples } from '@/lib/content/approved-examples'
import { POSTGEN_MODEL } from '@/lib/content/postgen-model'

export const maxDuration = 180
export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL_1 || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY_1 || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_1 || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

interface GeneratePostsRequest {
  client_id: number
  transcript_id?: string      // from client_transcripts table
  submission_id?: string      // from qc_submissions table (uses its transcript)
  platforms: Platform[]
  /** Include 2–3 recent approved posts as STYLE-only few-shot. Default true. */
  include_few_shot?: boolean
}

/**
 * Platform-specific max tokens. Tighter budgets = more focused output.
 * Includes headroom for the <traceback> block which is emitted alongside
 * the draft and stripped server-side before saving.
 */
const PLATFORM_MAX_TOKENS: Record<Platform, number> = {
  linkedin: 2400,
  twitter: 1000,
  facebook: 1600,
}

/**
 * POST /api/content/generate-posts
 *
 * Transcript-grounded written-post generator. Each platform gets its own
 * Claude call with a Rule Zero system prompt that forbids inventing facts
 * outside the transcript. Returns streaming SSE with progress events and
 * the extracted <draft> content per platform.
 *
 * REQUIRES a transcript (transcript_id or submission_id). Returns 400 if
 * neither is provided — no DNA-only fallback, per the non-hallucination
 * commitment of the rebuild.
 */
export async function POST(req: NextRequest) {
  const supabase = getSupabase()
  const body: GeneratePostsRequest = await req.json()
  const { client_id, transcript_id, submission_id, platforms, include_few_shot = true } = body

  if (!client_id) {
    return Response.json({ error: 'client_id is required' }, { status: 400 })
  }
  if (!platforms || platforms.length === 0) {
    return Response.json({ error: 'At least one platform is required' }, { status: 400 })
  }
  if (!transcript_id && !submission_id) {
    return Response.json(
      { error: 'Transcript is required. Provide transcript_id or submission_id. This generator refuses to invent facts from DNA alone.' },
      { status: 400 },
    )
  }

  const anthropicKey = process.env.CC_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  // Fetch the transcript.
  let transcriptText = ''
  let transcriptTitle = ''

  if (transcript_id) {
    const { data, error } = await supabase
      .from('client_transcripts')
      .select('transcript_text, title')
      .eq('id', transcript_id)
      .single()

    if (error || !data?.transcript_text) {
      return Response.json({ error: 'Transcript not found' }, { status: 404 })
    }
    transcriptText = data.transcript_text
    transcriptTitle = data.title || 'Untitled transcript'
  } else if (submission_id) {
    const { data, error } = await supabase
      .from('qc_submissions')
      .select('transcript, title')
      .eq('id', submission_id)
      .single()

    if (error || !data?.transcript) {
      return Response.json({ error: 'Submission transcript not found' }, { status: 404 })
    }
    transcriptText = data.transcript
    transcriptTitle = data.title || 'Untitled submission'
  }

  if (!transcriptText || transcriptText.trim().length < 50) {
    return Response.json(
      { error: 'Transcript is empty or too short to generate from. Minimum 50 characters.' },
      { status: 400 },
    )
  }

  // Fetch client DNA + master prompt + name in parallel.
  const [dnaResult, clientPromptResult, clientResult] = await Promise.all([
    supabase
      .from('client_dna')
      .select('dna_markdown')
      .eq('client_id', client_id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('client_prompts')
      .select('system_prompt')
      .eq('client_id', client_id)
      .eq('prompt_type', 'content_generation')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('clients')
      .select('name')
      .eq('id', client_id)
      .single(),
  ])

  const dna = dnaResult.data
  const clientPrompt = clientPromptResult.data
  const clientName = clientResult.data?.name || `Client ${client_id}`

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(type: string, data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`))
      }

      try {
        const anthropic = new Anthropic({ apiKey: anthropicKey })

        // Extract signal from transcript via Haiku (if it's long enough to benefit).
        let processedTranscript = transcriptText
        let wasExtracted = false

        if (transcriptText.length > 15000) {
          sendEvent('progress', {
            stage: 'extracting',
            message: `Extracting key insights from transcript via Haiku...`,
          })

          const extraction = await extractTranscriptSignal(
            transcriptText,
            transcriptTitle,
            'post_generation',
            anthropicKey,
          )

          if (extraction) {
            processedTranscript = extraction.content
            wasExtracted = true
            sendEvent('progress', {
              stage: 'extracting',
              message: `Extracted: ${extraction.original_word_count} → ${extraction.word_count} words (${extraction.compression_ratio}x compression)`,
            })
          } else {
            processedTranscript = transcriptText.slice(0, 15000)
          }
        }

        sendEvent('progress', {
          stage: 'generating',
          message: `Generating ${platforms.length} post(s) for ${clientName} from "${transcriptTitle}"...`,
        })

        const platformResults: Record<string, string> = {}
        const platformTracebacks: Record<string, string | null> = {}

        for (const platform of platforms) {
          sendEvent('progress', {
            stage: 'generating',
            message: `Writing ${platform} post...`,
            platform,
          })

          // Load recent approved posts for this platform as STYLE-only few-shot.
          const recentApprovedPosts = include_few_shot
            ? await loadRecentApprovedExamples(supabase, client_id, platform, 3)
            : []

          // Build the prompts via the new Rule-Zero builder.
          let systemPrompt: string
          let userPrompt: string
          try {
            systemPrompt = buildGenerationSystemPrompt({
              clientName,
              platform,
              masterPrompt: clientPrompt?.system_prompt || null,
              dnaDocText: null,                           // Phase 3 will populate
              dnaMarkdown: dna?.dna_markdown || null,     // Phase 1 legacy fallback
              knowledgeNotes: null,                       // Phase 4 will populate
              recentApprovedPosts,
              transcriptText: processedTranscript,
              transcriptTitle,
              wasExtracted,
            })
            userPrompt = buildGenerationUserPrompt({
              clientName,
              platform,
              masterPrompt: clientPrompt?.system_prompt || null,
              dnaDocText: null,
              dnaMarkdown: dna?.dna_markdown || null,
              knowledgeNotes: null,
              recentApprovedPosts,
              transcriptText: processedTranscript,
              transcriptTitle,
              wasExtracted,
            })
          } catch (err) {
            if (err instanceof MissingTranscriptError || err instanceof MissingVoiceError) {
              sendEvent('error', { message: err.message, platform })
              continue
            }
            throw err
          }

          // Stream the response for timeout safety; await the final message so
          // we can parse <draft> / <traceback> cleanly. Prompt caching on the
          // last system block keeps repeat per-client generations cheap.
          const messageStream = anthropic.messages.stream({
            model: POSTGEN_MODEL,
            max_tokens: PLATFORM_MAX_TOKENS[platform],
            system: [
              {
                type: 'text',
                text: systemPrompt,
                cache_control: { type: 'ephemeral' },
              },
            ],
            messages: [{ role: 'user', content: userPrompt }],
          })

          const finalMessage = await messageStream.finalMessage()
          const rawText = finalMessage.content
            .filter(block => block.type === 'text')
            .map(block => (block as { type: 'text'; text: string }).text)
            .join('')

          const { draft, traceback, matchedContract } = extractDraft(rawText)
          if (!matchedContract) {
            console.warn(
              `[generate-posts] ${platform} response did not match <draft>/<traceback> contract for client ${client_id}. Falling back to raw output.`,
            )
          }

          const cleanedDraft = ccPostProcess(draft)
          platformResults[platform] = cleanedDraft
          platformTracebacks[platform] = traceback

          // Emit the final draft as a single text event. Frontend accumulates text events.
          sendEvent('text', { content: cleanedDraft, platform })

          if (platforms.indexOf(platform) < platforms.length - 1) {
            sendEvent('text', { content: '\n\n---\n\n' })
          }
        }

        const fullResponse = platforms.map(p => {
          const header = p === 'linkedin' ? '## LinkedIn Post' : p === 'twitter' ? '## X (Twitter) Post' : '## Facebook Post'
          return `${header}\n\n${platformResults[p] || ''}`
        }).join('\n\n---\n\n')

        sendEvent('done', {
          content: fullResponse,
          client_name: clientName,
          transcript_title: transcriptTitle,
          platforms,
          used_custom_prompt: !!clientPrompt?.system_prompt,
          platform_results: platformResults,
          // Tracebacks are emitted for logs/debugging but stripped from the
          // saved content. Surfaced in done event so the UI can optionally
          // display them (Phase 1: hidden from PM view).
          platform_tracebacks: platformTracebacks,
        })

        controller.close()
      } catch (err) {
        console.error('Generate posts error:', err)
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
