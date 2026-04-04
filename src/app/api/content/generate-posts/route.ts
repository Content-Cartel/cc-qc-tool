import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { ccPostProcess, CC_PLATFORM_DEFAULTS } from '@/lib/content/cc-rules'
import { buildFallbackPrompt } from '@/lib/content/fallback-prompt'
import { extractTranscriptSignal } from '@/lib/content/transcript-extractor'

export const maxDuration = 180

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

interface GeneratePostsRequest {
  client_id: number
  transcript_id?: string      // from client_transcripts table
  submission_id?: string      // from qc_submissions table (uses its transcript)
  topic?: string              // for prompt-only generation (no transcript needed)
  platforms: ('linkedin' | 'twitter' | 'facebook')[]
}

/**
 * Platform-specific max tokens. Tighter budgets = more focused output.
 */
const PLATFORM_MAX_TOKENS: Record<string, number> = {
  linkedin: 1800,
  twitter: 600,
  facebook: 1200,
}

/**
 * POST /api/content/generate-posts
 *
 * Generates platform-specific written posts from a transcript + client DNA/prompt,
 * or from the client's DNA/prompt alone (prompt-only mode) when no transcript is provided.
 *
 * Each platform gets its own Claude call for focused, higher-quality output.
 * If a client has a custom system prompt, uses that. Otherwise uses DNA-based fallback.
 * Returns streaming SSE with progress events and generated content.
 */
export async function POST(req: NextRequest) {
  const body: GeneratePostsRequest = await req.json()
  const { client_id, transcript_id, submission_id, topic, platforms } = body

  if (!client_id) {
    return Response.json({ error: 'client_id is required' }, { status: 400 })
  }
  if (!platforms || platforms.length === 0) {
    return Response.json({ error: 'At least one platform is required' }, { status: 400 })
  }

  const anthropicKey = process.env.CC_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  // Fetch transcript (if provided)
  let transcriptText = ''
  let transcriptTitle = ''
  const isPromptOnly = !transcript_id && !submission_id

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
    transcriptTitle = data.title
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
    transcriptTitle = data.title
  } else {
    // Prompt-only mode: no transcript needed
    transcriptTitle = topic || 'DNA-based generation'
  }

  // Fetch client DNA + custom prompt + client name in parallel
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
  const hasCustomPrompt = !!clientPrompt?.system_prompt

  // Prompt-only mode requires at least DNA or a custom prompt
  if (isPromptOnly && !dna?.dna_markdown && !hasCustomPrompt) {
    return Response.json({ error: 'No transcript, DNA, or prompt available for this client' }, { status: 400 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(type: string, data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`))
      }

      try {
        const anthropic = new Anthropic({ apiKey: anthropicKey })

        // Extract signal from transcript via Haiku (if transcript is long enough to benefit)
        let processedTranscript = transcriptText
        let wasExtracted = false

        if (!isPromptOnly && transcriptText.length > 15000) {
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
          message: isPromptOnly
            ? `Generating ${platforms.length} post(s) for ${clientName} from brand DNA${topic ? ` (topic: ${topic})` : ''}...`
            : hasCustomPrompt
              ? `Generating ${platforms.length} post(s) using ${clientName}'s custom brand prompt...`
              : `Generating ${platforms.length} post(s) from transcript + DNA...`,
        })

        // Generate each platform separately for focused, higher-quality output
        const platformResults: Record<string, string> = {}

        for (const platform of platforms) {
          sendEvent('progress', {
            stage: 'generating',
            message: `Writing ${platform} post${isPromptOnly ? ' (from DNA)' : ''}...`,
          })

          // Build system prompt per-platform
          let systemPrompt: string
          const platformRules = CC_PLATFORM_DEFAULTS[platform as keyof typeof CC_PLATFORM_DEFAULTS] || ''

          if (hasCustomPrompt) {
            const taskDescription = isPromptOnly
              ? `Generate a ${platform.toUpperCase()} post based on your brand expertise and knowledge.`
              : `Generate a ${platform.toUpperCase()} post from the transcript below.`

            systemPrompt = `${clientPrompt.system_prompt}

## TASK: ${taskDescription}

Apply ALL your brand rules, compliance checks, and voice guidelines.

${platformRules}

CRITICAL REMINDERS:
- NEVER use em dashes (—). Use commas, periods, colons, or semicolons.
- NEVER use specific numbers unless DIRECTLY quoted from the transcript or system prompt.
- NEVER use hype phrases: "game-changer," "mind-blowing," "buckle up," "let that sink in," "here's the thing," "read that again," "this is huge."
- NEVER use generic filler: "Let me know what you think!", "Drop a comment!", "Follow for more!"
- Output the post ONLY. No commentary, no "here's the post," no meta-notes. Ready to copy-paste.`
          } else {
            systemPrompt = buildFallbackPrompt(clientName, dna?.dna_markdown || null, platform as 'linkedin' | 'twitter' | 'facebook')
          }

          // Build user prompt based on mode
          let userPrompt: string

          if (isPromptOnly) {
            userPrompt = `Write ONE original ${platform} post as ${clientName}.

${topic ? `Topic/theme to focus on: ${topic}` : 'Pick the single most compelling topic from the content pillars, proof points, or unique mechanisms in your system prompt.'}

Use the voice, stories, proof points, and content strategy from the system prompt. Go DEEP on one specific idea.

CRITICAL:
- Do NOT invent specific numbers, client names, or case study details not in the system prompt.
- Use only facts, metrics, and examples that appear in the system prompt.
- Write from first person as ${clientName} sharing expertise.
- Output the post only. Ready to publish. No preamble.`
          } else {
            userPrompt = `Transcript from "${transcriptTitle}"${wasExtracted ? ' (key insights extracted via AI)' : ''}:

---
${processedTranscript}
---

Write ONE ${platform} post from this transcript. Pick the single most compelling, unique, or valuable idea and go DEEP on it.${
  platforms.length > 1 ? `\n\nIMPORTANT: This post should cover a DIFFERENT angle than the other platform posts. Focus on what works best for ${platform}'s audience and format.` : ''
}

Output the post only. Ready to publish. No preamble.`
          }

          let platformResponse = ''

          const messageStream = anthropic.messages.stream({
            model: 'claude-sonnet-4-20250514',
            max_tokens: PLATFORM_MAX_TOKENS[platform] || 1500,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
          })

          for await (const event of messageStream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              const text = event.delta.text
              platformResponse += text
              sendEvent('text', { content: text, platform })
            }
          }

          // CC-wide post-processing: safety net for em dashes + hype phrases
          platformResults[platform] = ccPostProcess(platformResponse)

          // Add separator between platforms in the stream
          if (platforms.indexOf(platform) < platforms.length - 1) {
            const separator = '\n\n---\n\n'
            sendEvent('text', { content: separator })
          }
        }

        // Combine all platform results for the final done event
        const fullResponse = platforms.map(p => {
          const header = p === 'linkedin' ? '## LinkedIn Post' : p === 'twitter' ? '## X (Twitter) Post' : '## Facebook Post'
          return `${header}\n\n${platformResults[p]}`
        }).join('\n\n---\n\n')

        sendEvent('done', {
          content: fullResponse,
          client_name: clientName,
          transcript_title: transcriptTitle,
          platforms,
          used_custom_prompt: hasCustomPrompt,
          prompt_only: isPromptOnly,
          platform_results: platformResults,
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
