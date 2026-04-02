import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { ccPostProcess } from '@/lib/content/cc-rules'

export const maxDuration = 120

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

interface GeneratePostsRequest {
  client_id: number
  transcript_id?: string      // from client_transcripts table
  submission_id?: string      // from qc_submissions table (uses its transcript)
  platforms: ('linkedin' | 'twitter' | 'facebook')[]
}

/**
 * POST /api/content/generate-posts
 *
 * Generates platform-specific written posts from a transcript + client DNA/prompt.
 * If a client has a custom system prompt in client_prompts table, uses that.
 * Otherwise falls back to generic DNA-based prompt.
 * Returns streaming SSE with progress events and generated content.
 */
export async function POST(req: NextRequest) {
  const body: GeneratePostsRequest = await req.json()
  const { client_id, transcript_id, submission_id, platforms } = body

  if (!client_id) {
    return Response.json({ error: 'client_id is required' }, { status: 400 })
  }
  if (!transcript_id && !submission_id) {
    return Response.json({ error: 'Either transcript_id or submission_id is required' }, { status: 400 })
  }
  if (!platforms || platforms.length === 0) {
    return Response.json({ error: 'At least one platform is required' }, { status: 400 })
  }

  const anthropicKey = process.env.CC_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  // Fetch transcript
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
  }

  // Fetch client DNA
  const { data: dna } = await supabase
    .from('client_dna')
    .select('dna_markdown')
    .eq('client_id', client_id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Fetch client-specific system prompt (if exists)
  const { data: clientPrompt } = await supabase
    .from('client_prompts')
    .select('system_prompt')
    .eq('client_id', client_id)
    .eq('prompt_type', 'content_generation')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Fetch client name
  const { data: client } = await supabase
    .from('clients')
    .select('name')
    .eq('id', client_id)
    .single()

  const clientName = client?.name || `Client ${client_id}`
  const hasCustomPrompt = !!clientPrompt?.system_prompt

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(type: string, data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`))
      }

      try {
        sendEvent('progress', {
          stage: 'generating',
          message: hasCustomPrompt
            ? `Generating posts using ${clientName}'s custom brand prompt...`
            : `Generating posts from transcript + DNA...`,
        })

        const platformInstructions = platforms.map(p => {
          switch (p) {
            case 'linkedin':
              return `## LinkedIn Post
- 1,500-2,500 characters (long-form educational post, NOT short fluff)
- Open with a bold, counterintuitive hook (1-2 sentences max) that challenges conventional thinking
- Then immediately teach: explain the core concept in plain language with concrete examples and specific numbers
- Use short paragraphs (1-3 sentences each) separated by line breaks. NO bullet points, NO numbered lists
- Build the argument paragraph by paragraph, each one adding a new layer or angle
- Voice should be authoritative but accessible, like an expert explaining something to a smart peer
- NO hashtags anywhere in the post
- NO emojis anywhere in the post
- NEVER use em dashes. Use commas, periods, colons, or semicolons instead
- End with a CTA that offers something free and valuable (assessment, guide, resource) with a link
- After the CTA link, add a "P.S." section that preemptively addresses a common objection
- Total structure: Hook > Education/Insight (3-5 paragraphs) > CTA with link > P.S.`
            case 'twitter':
              return `## X (Twitter) Post
- Maximum 280 characters for the main tweet
- If the content needs more space, write a thread (3-5 tweets)
- First tweet must be the strongest hook
- Each tweet should stand alone but flow as a narrative
- Punchy, direct language. No filler
- NEVER use em dashes. Use commas, periods, or colons instead
- 1-2 hashtags max
- Tag relevant accounts if obvious from context`
            case 'facebook':
              return `## Facebook Post
- Conversational and relatable tone
- 100-250 words ideal
- Tell a mini-story or share a lesson from the transcript
- Can be more casual than LinkedIn
- NEVER use em dashes. Use commas, periods, or colons instead
- Include a question at the end to encourage comments
- No hashtags (or 1-2 max)
- Write like you're talking to a friend who's interested in the topic`
            default:
              return ''
          }
        }).join('\n\n')

        // Build system prompt: custom client prompt takes priority over generic
        let systemPrompt: string

        if (hasCustomPrompt) {
          // Client has a custom system prompt (e.g., Monetary Metals with compliance rules)
          systemPrompt = `${clientPrompt.system_prompt}

## ADDITIONAL CONTEXT FOR THIS GENERATION

You are generating social media posts from a transcript. Apply ALL your brand rules, compliance checks, and voice guidelines to the output.

CRITICAL FORMATTING RULE: NEVER use em dashes (the "—" character) in any output. Replace with commas, periods, colons, or semicolons. This is a non-negotiable Content Cartel rule.

${platformInstructions}`
        } else {
          // Generic prompt using DNA
          systemPrompt = `You are a content repurposing specialist for ${clientName}. Your job is to take video transcript content and turn it into platform-specific written posts.

${dna?.dna_markdown ? `## Client Voice DNA
Use this DNA profile to match the client's voice, tone, frameworks, and style:

${dna.dna_markdown}` : `## Note
No DNA profile is available for this client. Write in a professional, authentic tone. Focus on extracting the core insights from the transcript.`}

## Rules
1. Extract the BEST ideas, insights, stories, or frameworks from the transcript
2. Each post should focus on ONE clear idea and go DEEP on it
3. Write in the client's voice (if DNA is available), not generic marketing speak. Expert-to-peer tone, not salesy
4. Use specific examples, numbers, and scenarios from the transcript. Concrete > abstract
5. Never invent facts, statistics, or claims not in the transcript
6. Each platform post should cover a DIFFERENT angle/idea from the transcript
7. Output each post under its platform heading, ready to copy-paste. No commentary or meta-notes
8. The CTA should reference the client's actual offer/link/resource. If none exists, use "[INSERT CTA LINK]"
9. NO generic filler lines like "Let me know what you think!" or "Drop a comment below!"
10. NEVER use em dashes (the "—" character). Use commas, periods, colons, or semicolons instead

${platformInstructions}`
        }

        const userPrompt = `Here is the transcript from "${transcriptTitle}":

---
${transcriptText.slice(0, 15000)}
${transcriptText.length > 15000 ? '\n[Transcript truncated for length. Focus on the content provided above]' : ''}
---

Generate written posts for the following platforms: ${platforms.join(', ')}.

Write each post ready to publish. Focus on the most compelling, unique, or valuable ideas from this transcript.`

        const anthropic = new Anthropic({ apiKey: anthropicKey })

        let fullResponse = ''

        const messageStream = anthropic.messages.stream({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        })

        for await (const event of messageStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            const text = event.delta.text
            fullResponse += text
            sendEvent('text', { content: text })
          }
        }

        // CC-wide post-processing: remove em dashes + cleanup
        const cleanedResponse = ccPostProcess(fullResponse)

        sendEvent('done', {
          content: cleanedResponse,
          client_name: clientName,
          transcript_title: transcriptTitle,
          platforms,
          used_custom_prompt: hasCustomPrompt,
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
