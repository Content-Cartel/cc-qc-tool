import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { buildMetaPrompt } from '@/lib/content/meta-prompt'
import { ccPostProcess } from '@/lib/content/cc-rules'
import { selectTranscripts } from '@/lib/content/transcript-selector'
import { extractMultipleTranscripts } from '@/lib/content/transcript-extractor'
import { syncFathomMeetings, isFathomConfigured } from '@/lib/dna/fathom'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

/**
 * POST /api/content/generate-prompt
 *
 * Auto-generates a client system prompt from ALL available data:
 * - DNA profile (if exists)
 * - Onboarding call transcripts (smart-selected, Haiku-extracted)
 * - YouTube video transcripts (smart-selected, Haiku-extracted)
 * - Client knowledge base (SOPs, QC patterns, content insights)
 *
 * Uses Haiku to extract signal from full transcripts instead of brutal truncation.
 * Works with whatever data is available. Never 404s for missing data.
 *
 * ALL heavy work happens INSIDE the stream so the client gets immediate feedback.
 */
export async function POST(req: NextRequest) {
  const supabase = getSupabase()
  const { client_id } = await req.json()

  if (!client_id) {
    return NextResponse.json({ error: 'client_id is required' }, { status: 400 })
  }

  const anthropicKey = process.env.CC_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(type: string, data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`))
      }

      try {
        // Step 0: Fetch client info
        sendEvent('progress', { stage: 'loading', message: 'Loading client data...' })

        const { data: client } = await supabase
          .from('clients')
          .select('name')
          .eq('id', client_id)
          .single()

        if (!client) {
          sendEvent('error', { message: 'Client not found' })
          controller.close()
          return
        }

        const clientName = client.name

        // Step 1: Sync Fathom meetings BEFORE selecting transcripts
        if (isFathomConfigured()) {
          sendEvent('progress', { stage: 'fathom', message: `Syncing Fathom meetings for ${clientName}...` })
          try {
            const fathomResult = await syncFathomMeetings(client_id, clientName, null, supabase)
            if (fathomResult.new_synced > 0) {
              console.log(`[generate-prompt] Synced ${fathomResult.new_synced} new Fathom meeting(s) for ${clientName}`)
              sendEvent('progress', { stage: 'fathom', message: `Synced ${fathomResult.new_synced} new meeting(s)` })
            }
          } catch (err) {
            console.error(`[generate-prompt] Fathom sync failed for ${clientName}:`, err)
            sendEvent('progress', { stage: 'fathom', message: 'Fathom sync skipped (non-critical)' })
          }
        }

        // Step 2: Fetch DNA, transcripts (smart selection), and knowledge base in parallel
        sendEvent('progress', { stage: 'collecting', message: 'Collecting DNA, transcripts, and knowledge base...' })

        const [dnaResult, transcriptSelection, knowledgeResult] = await Promise.all([
          supabase
            .from('client_dna')
            .select('dna_markdown')
            .eq('client_id', client_id)
            .order('version', { ascending: false })
            .limit(1)
            .maybeSingle(),
          selectTranscripts(client_id, supabase, 25000, 'system_prompt'),
          supabase
            .from('client_knowledge')
            .select('knowledge_type, content')
            .eq('client_id', client_id),
        ])

        const dna = dnaResult.data

        // Separate transcripts by type for extraction with different prompts
        const onboardingTranscripts = transcriptSelection.transcripts
          .filter(t => t.relevance_tag === 'onboarding' || t.relevance_tag === 'strategy')
          .map(t => ({ title: `[ONBOARDING] ${t.title}`, text: t.text }))

        const youtubeTranscripts = transcriptSelection.transcripts
          .filter(t => t.source === 'youtube')
          .map(t => ({ title: `[YOUTUBE] ${t.title}`, text: t.text }))

        const generalTranscripts = transcriptSelection.transcripts
          .filter(t => t.relevance_tag !== 'onboarding' && t.relevance_tag !== 'strategy' && t.source !== 'youtube')
          .map(t => ({ title: `[MEETING] ${t.title}`, text: t.text }))

        const knowledgeEntries = (knowledgeResult.data || [])
          .filter(k => k.content && k.content.length > 10)
          .map(k => ({ type: k.knowledge_type, content: k.content }))

        // Build data source summary
        const sources: string[] = []
        if (dna?.dna_markdown) sources.push('DNA profile')
        if (onboardingTranscripts.length > 0) sources.push(`${onboardingTranscripts.length} onboarding/strategy call(s)`)
        if (youtubeTranscripts.length > 0) sources.push(`${youtubeTranscripts.length} YouTube transcript(s)`)
        if (generalTranscripts.length > 0) sources.push(`${generalTranscripts.length} meeting transcript(s)`)
        if (knowledgeEntries.length > 0) sources.push(`${knowledgeEntries.length} knowledge base entries`)
        if (sources.length === 0) sources.push('client name only (no data sources yet)')

        if (transcriptSelection.transcripts.length === 0) {
          sendEvent('progress', {
            stage: 'warning',
            message: `No transcripts found for ${clientName}. The prompt will be generated from DNA and knowledge base only. For best results, sync Fathom meetings or add YouTube transcripts first.`,
          })
        }

        sendEvent('progress', {
          stage: 'extracting',
          message: transcriptSelection.transcripts.length > 0
            ? `Extracting signal from ${transcriptSelection.transcripts.length} transcript(s) via Haiku (${transcriptSelection.fathom_count} meetings, ${transcriptSelection.youtube_count} videos, ${transcriptSelection.total_words.toLocaleString()} words)...`
            : 'No transcripts to extract. Proceeding with available data...',
        })

        // Extract signal from transcripts using Haiku (parallel by type)
        const allTranscriptsForStories = [...onboardingTranscripts, ...youtubeTranscripts, ...generalTranscripts]

        const [extractedOnboarding, extractedYouTube, extractedGeneral, extractedStories] = await Promise.all([
          onboardingTranscripts.length > 0
            ? extractMultipleTranscripts(onboardingTranscripts, 'strategy', anthropicKey, 8000)
            : Promise.resolve([]),
          youtubeTranscripts.length > 0
            ? extractMultipleTranscripts(youtubeTranscripts, 'voice', anthropicKey, 5000)
            : Promise.resolve([]),
          generalTranscripts.length > 0
            ? extractMultipleTranscripts(generalTranscripts, 'strategy', anthropicKey, 5000)
            : Promise.resolve([]),
          allTranscriptsForStories.length > 0
            ? extractMultipleTranscripts(allTranscriptsForStories, 'stories', anthropicKey, 5000)
            : Promise.resolve([]),
        ])

        const extractedCount = [...extractedOnboarding, ...extractedYouTube, ...extractedGeneral, ...extractedStories].filter(t => t.extracted).length
        const totalCount = extractedOnboarding.length + extractedYouTube.length + extractedGeneral.length + extractedStories.length

        sendEvent('progress', {
          stage: 'building',
          message: `Building prompt for ${clientName} from: ${sources.join(', ')} (${extractedCount}/${totalCount} extractions via Haiku)`,
        })

        // Combine story extractions into a single block
        const storyBlock = extractedStories
          .filter(t => t.extracted)
          .map(t => t.text)
          .join('\n\n---\n\n')

        const transcriptSamples = [
          ...extractedOnboarding.map(t => ({ title: t.title, text: t.text })),
          ...extractedYouTube.map(t => ({ title: t.title, text: t.text })),
          ...extractedGeneral.map(t => ({ title: t.title, text: t.text })),
        ]

        // Add stories as a knowledge entry so it flows into the meta-prompt
        const allKnowledge = [
          ...knowledgeEntries,
          ...(storyBlock ? [{ type: 'stories', content: storyBlock }] : []),
        ]

        const { system, user } = buildMetaPrompt(
          clientName,
          dna?.dna_markdown || null,
          transcriptSamples,
          allKnowledge,
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
