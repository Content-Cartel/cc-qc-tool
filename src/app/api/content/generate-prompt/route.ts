import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { buildMetaPrompt } from '@/lib/content/meta-prompt'
import { ccPostProcess } from '@/lib/content/cc-rules'

export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/**
 * POST /api/content/generate-prompt
 *
 * Auto-generates a client system prompt from ALL available data:
 * - DNA profile (if exists)
 * - Onboarding call transcripts
 * - YouTube video transcripts
 * - Steven's knowledge base (client_knowledge table: SOPs, QC patterns, content insights)
 *
 * Works with whatever data is available. Never 404s for missing data.
 */
export async function POST(req: NextRequest) {
  const { client_id } = await req.json()

  if (!client_id) {
    return NextResponse.json({ error: 'client_id is required' }, { status: 400 })
  }

  const anthropicKey = process.env.CC_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  // Fetch client name
  const { data: client } = await supabase
    .from('clients')
    .select('name')
    .eq('id', client_id)
    .single()

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const clientName = client.name

  // Fetch ALL data sources in parallel
  const [dnaResult, onboardingResult, contentResult, knowledgeResult] = await Promise.all([
    // DNA profile
    supabase
      .from('client_dna')
      .select('dna_markdown')
      .eq('client_id', client_id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Onboarding transcripts
    supabase
      .from('client_transcripts')
      .select('title, transcript_text, relevance_tag')
      .eq('client_id', client_id)
      .in('relevance_tag', ['onboarding', 'strategy'])
      .order('recorded_at', { ascending: false })
      .limit(3),
    // YouTube content transcripts
    supabase
      .from('client_transcripts')
      .select('title, transcript_text, relevance_tag')
      .eq('client_id', client_id)
      .not('relevance_tag', 'in', '("onboarding","strategy")')
      .order('recorded_at', { ascending: false })
      .limit(5),
    // Steven's knowledge base
    supabase
      .from('client_knowledge')
      .select('knowledge_type, content')
      .eq('client_id', client_id),
  ])

  const dna = dnaResult.data
  const onboardingSamples = (onboardingResult.data || [])
    .filter(t => t.transcript_text)
    .map(t => ({ title: `[ONBOARDING] ${t.title}`, text: t.transcript_text.slice(0, 8000) }))

  const contentSamples = (contentResult.data || [])
    .filter(t => t.transcript_text)
    .map(t => ({ title: `[YOUTUBE] ${t.title}`, text: t.transcript_text.slice(0, 5000) }))

  const transcriptSamples = [...onboardingSamples, ...contentSamples]

  const knowledgeEntries = (knowledgeResult.data || [])
    .filter(k => k.content && k.content.length > 10)
    .map(k => ({ type: k.knowledge_type, content: k.content }))

  // Build data source summary
  const sources: string[] = []
  if (dna?.dna_markdown) sources.push('DNA profile')
  if (onboardingSamples.length > 0) sources.push(`${onboardingSamples.length} onboarding call(s)`)
  if (contentSamples.length > 0) sources.push(`${contentSamples.length} YouTube transcript(s)`)
  if (knowledgeEntries.length > 0) sources.push(`${knowledgeEntries.length} knowledge base entries`)
  if (sources.length === 0) sources.push('client name only (no data sources yet)')

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(type: string, data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`))
      }

      try {
        sendEvent('progress', {
          stage: 'building',
          message: `Building prompt for ${clientName} from: ${sources.join(', ')}`,
        })

        const { system, user } = buildMetaPrompt(
          clientName,
          dna?.dna_markdown || null,
          transcriptSamples,
          knowledgeEntries,
        )

        sendEvent('progress', {
          stage: 'generating',
          message: 'Generating with Claude Opus (30-90 seconds)...',
        })

        const anthropic = new Anthropic({ apiKey: anthropicKey })
        let fullResponse = ''

        const messageStream = anthropic.messages.stream({
          model: 'claude-opus-4-20250514',
          max_tokens: 16384,
          system,
          messages: [{ role: 'user', content: user }],
        })

        for await (const event of messageStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            fullResponse += event.delta.text
            sendEvent('text', { content: event.delta.text })
          }
        }

        const cleanedPrompt = ccPostProcess(fullResponse)

        sendEvent('progress', { stage: 'saving', message: 'Saving to client_prompts...' })

        const { data: existing } = await supabase
          .from('client_prompts')
          .select('version')
          .eq('client_id', client_id)
          .eq('prompt_type', 'content_generation')
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle()

        const nextVersion = (existing?.version || 0) + 1

        const { error: saveError } = await supabase
          .from('client_prompts')
          .insert({
            client_id,
            prompt_type: 'content_generation',
            system_prompt: cleanedPrompt,
            version: nextVersion,
            notes: `Auto-generated from: ${sources.join(', ')}`,
          })

        if (saveError) {
          sendEvent('error', { message: `Generation complete but save failed: ${saveError.message}` })
        }

        sendEvent('done', {
          content: cleanedPrompt,
          client_name: clientName,
          version: nextVersion,
          sources,
          prompt_length: cleanedPrompt.length,
        })

        controller.close()
      } catch (err) {
        console.error('Generate prompt error:', err)
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
