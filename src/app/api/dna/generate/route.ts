import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { scrapeWebsiteMultiPage, fetchYouTubeData, formatScrapedData, type TranscriptForDNA } from '@/lib/dna/scraper'
import { buildDNAPrompt } from '@/lib/dna/prompt'
import { syncFathomMeetings, isFathomConfigured } from '@/lib/dna/fathom'
import type { GenerateDNARequest, DNASources, TranscriptSourceMeta } from '@/lib/dna/types'

export const maxDuration = 180

/**
 * Streaming DNA generation endpoint.
 * Sends SSE events: progress stages → streamed DNA text → final saved result.
 * Enhanced with data quality tracking and richer source metadata.
 */
export async function POST(req: NextRequest) {
  const body: GenerateDNARequest = await req.json()
  const { client_id, client_name, website_url, youtube_url, context, transcript, include_fathom, include_transcripts } = body

  // Validation
  if (!client_id || !client_name) {
    return Response.json({ error: 'client_id and client_name are required' }, { status: 400 })
  }
  if (!website_url && !youtube_url && !context && !transcript) {
    return Response.json({ error: 'At least one data source is required' }, { status: 400 })
  }

  const anthropicKey = process.env.CC_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
  if (!anthropicKey || anthropicKey === 'your-anthropic-api-key-here') {
    return Response.json({ error: 'ANTHROPIC_API_KEY not configured on server' }, { status: 500 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(type: string, data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`))
      }

      try {
        // Stage 1: Scrape data sources
        sendEvent('progress', { stage: 'scraping', message: 'Collecting data sources...' })

        let websiteData = null
        let youtubeData = null

        if (website_url) {
          sendEvent('progress', { stage: 'scraping_website', message: `Scraping ${website_url}...` })
          websiteData = await scrapeWebsiteMultiPage(website_url)
          const pageCount = websiteData?.pages.length || 0
          const totalChars = websiteData?.totalChars || 0
          const attempted = websiteData?.pagesAttempted || []
          sendEvent('progress', {
            stage: 'website_done',
            message: `Scraped ${pageCount} page${pageCount !== 1 ? 's' : ''} (${totalChars.toLocaleString()} chars)`,
            pages: websiteData?.pages.map(p => ({
              type: p.pageType,
              url: p.url,
              chars: p.charCount,
              headings: p.headings.length,
              ctas: p.ctas.length,
            })) || [],
            attempted: attempted.map(a => ({
              pageType: a.pageType,
              status: a.status,
            })),
            totalChars,
          })
        }

        if (youtube_url) {
          sendEvent('progress', { stage: 'scraping_youtube', message: `Fetching YouTube data...` })
          youtubeData = await fetchYouTubeData(youtube_url)
          const videoCount = youtubeData?.raw?.videos.length || 0
          const withDescriptions = youtubeData?.raw?.videos.filter(v => v.description.length > 10).length || 0
          const withTags = youtubeData?.raw?.videos.filter(v => v.tags.length > 0).length || 0
          const playlistCount = youtubeData?.raw?.playlists?.length || 0
          sendEvent('progress', {
            stage: 'youtube_done',
            message: youtubeData
              ? `Fetched ${videoCount} videos via ${youtubeData.type === 'api' ? 'YouTube API' : 'HTML scrape'}`
              : 'Could not fetch YouTube data',
            type: youtubeData?.type || 'none',
            videoCount,
            withDescriptions,
            withTags,
            playlistCount,
            channelName: youtubeData?.raw?.channel.name || null,
            subscribers: youtubeData?.raw?.channel.subscriberCount || null,
          })
        }

        // Stage 1.5: Sync & select transcripts from Fathom + YouTube
        const selectedTranscripts: TranscriptForDNA[] = []
        let fathomSyncResult: { found: number; new_synced: number; already_stored: number } | null = null

        const supabase = createClient(
          (process.env.NEXT_PUBLIC_SUPABASE_URL_1 || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
          process.env.SUPABASE_SERVICE_ROLE_KEY_1 || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_1 || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        )

        // Fathom sync (if configured and not explicitly disabled)
        if (isFathomConfigured() && include_fathom !== false) {
          sendEvent('progress', { stage: 'syncing_fathom', message: 'Syncing Fathom meeting transcripts...' })
          try {
            // Extract domain from website URL for matching
            const domain = website_url ? new URL(website_url).hostname.replace(/^www\./, '') : null
            const result = await syncFathomMeetings(client_id, client_name, domain, supabase)
            fathomSyncResult = { found: result.found, new_synced: result.new_synced, already_stored: result.already_stored }
            sendEvent('progress', {
              stage: 'fathom_done',
              message: result.found > 0
                ? `Found ${result.found} Fathom meeting${result.found > 1 ? 's' : ''} (${result.new_synced} new)`
                : 'No Fathom meetings found for this client',
              found: result.found,
              new_synced: result.new_synced,
            })
          } catch (err) {
            console.error('Fathom sync failed:', err)
            sendEvent('progress', {
              stage: 'fathom_done',
              message: `Fathom sync skipped: ${err instanceof Error ? err.message : 'unknown error'}`,
              found: 0,
            })
          }
        }

        // Select transcripts from database (both Fathom and YouTube)
        if (include_transcripts !== false) {
          sendEvent('progress', { stage: 'selecting_transcripts', message: 'Selecting best transcripts...' })

          const { data: allTranscripts } = await supabase
            .from('client_transcripts')
            .select('source, source_id, title, transcript_text, summary, word_count, relevance_tag, recorded_at, metadata')
            .eq('client_id', client_id)
            .order('recorded_at', { ascending: false })

          if (allTranscripts && allTranscripts.length > 0) {
            // Smart selection with 20,000 word budget
            const WORD_BUDGET = 20000
            let wordsUsed = 0

            // Priority 1: Onboarding transcripts (most valuable for DNA)
            const onboarding = allTranscripts.filter(t => t.relevance_tag === 'onboarding')
            // Priority 2: Strategy transcripts
            const strategy = allTranscripts.filter(t => t.relevance_tag === 'strategy')
            // Priority 3: YouTube transcripts — prefer Whisper over captions, then by view count
            const ytTranscripts = allTranscripts
              .filter(t => t.source === 'youtube')
              .sort((a, b) => {
                const aWhisper = (a.metadata as Record<string, unknown>)?.source_method === 'whisper' ? 1 : 0
                const bWhisper = (b.metadata as Record<string, unknown>)?.source_method === 'whisper' ? 1 : 0
                if (bWhisper !== aWhisper) return bWhisper - aWhisper
                return (Number((b.metadata as Record<string, unknown>)?.view_count) || 0) - (Number((a.metadata as Record<string, unknown>)?.view_count) || 0)
              })
              .slice(0, 5)
            // Priority 4: Other meetings (most recent)
            const general = allTranscripts.filter(t =>
              t.relevance_tag === 'general' || t.relevance_tag === 'content_review'
            )

            const prioritized = [
              ...onboarding,
              ...strategy,
              ...ytTranscripts.filter(yt => !onboarding.includes(yt) && !strategy.includes(yt)),
              ...general,
            ]

            // Deduplicate by source_id
            const seen = new Set<string>()
            for (const t of prioritized) {
              const key = `${t.source}:${t.source_id}`
              if (seen.has(key)) continue
              if (wordsUsed + (t.word_count || 0) > WORD_BUDGET) continue
              seen.add(key)

              selectedTranscripts.push({
                source: t.source as 'fathom' | 'youtube',
                title: t.title || 'Untitled',
                text: t.transcript_text,
                summary: t.summary,
                word_count: t.word_count || 0,
                relevance_tag: t.relevance_tag || 'general',
                recorded_at: t.recorded_at,
                metadata: t.metadata as Record<string, unknown> || {},
              })
              wordsUsed += t.word_count || 0
            }

            const fathomSelected = selectedTranscripts.filter(t => t.source === 'fathom').length
            const ytSelected = selectedTranscripts.filter(t => t.source === 'youtube').length
            sendEvent('progress', {
              stage: 'transcripts_selected',
              message: `Selected ${selectedTranscripts.length} transcript${selectedTranscripts.length !== 1 ? 's' : ''} (${wordsUsed.toLocaleString()} words): ${fathomSelected} meetings, ${ytSelected} videos`,
              fathom_count: fathomSelected,
              youtube_count: ytSelected,
              total_words: wordsUsed,
            })
          }
        }

        const scrapedData = formatScrapedData(websiteData, youtubeData, context, transcript, selectedTranscripts.length > 0 ? selectedTranscripts : undefined)

        if (!scrapedData.trim()) {
          sendEvent('error', { message: 'Could not scrape any data from provided sources' })
          controller.close()
          return
        }

        // Calculate total source words for quality indicator
        const totalSourceWords = scrapedData.split(/\s+/).length
        sendEvent('progress', {
          stage: 'data_ready',
          message: `${totalSourceWords.toLocaleString()} words of source data collected`,
          totalSourceWords,
        })

        // Stage 2: Generate DNA with Claude (streaming)
        sendEvent('progress', { stage: 'generating', message: 'Generating DNA profile with Claude...' })

        const model = process.env.DNA_MODEL || 'claude-sonnet-4-20250514'
        const anthropic = new Anthropic({ apiKey: anthropicKey })
        const prompt = buildDNAPrompt(client_name, scrapedData)

        let fullMarkdown = ''

        const messageStream = anthropic.messages.stream({
          model,
          max_tokens: 12000,
          messages: [{ role: 'user', content: prompt }],
        })

        for await (const event of messageStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            const text = event.delta.text
            fullMarkdown += text
            sendEvent('chunk', { text })
          }
        }

        if (!fullMarkdown) {
          sendEvent('error', { message: 'Failed to generate DNA profile' })
          controller.close()
          return
        }

        // Stage 3: Save to Supabase
        sendEvent('progress', { stage: 'saving', message: 'Saving DNA profile...' })

        const transcriptWordCount = transcript ? transcript.split(/\s+/).length : 0

        // Build transcript source metadata
        const transcriptSourcesMeta: TranscriptSourceMeta[] = selectedTranscripts.map(t => ({
          source: t.source,
          title: t.title,
          word_count: t.word_count,
          relevance: t.relevance_tag,
        }))

        const sources: DNASources = {
          website_data: websiteData ? `Scraped ${websiteData.pages.length} pages from ${website_url}` : null,
          website_pages_scraped: websiteData?.pages.map(p => `${p.pageType}: ${p.url}`) || undefined,
          website_pages_attempted: websiteData?.pagesAttempted || undefined,
          website_total_chars: websiteData?.totalChars || undefined,
          youtube_data: youtubeData ? `${youtubeData.type === 'api' ? 'YouTube Data API' : 'HTML scrape'} from ${youtube_url}` : null,
          youtube_source_type: youtubeData?.type || undefined,
          youtube_api_data: youtubeData?.raw || undefined,
          youtube_videos_analyzed: youtubeData?.raw?.videos.length || undefined,
          youtube_videos_with_descriptions: youtubeData?.raw?.videos.filter(v => v.description.length > 10).length || undefined,
          youtube_videos_with_tags: youtubeData?.raw?.videos.filter(v => v.tags.length > 0).length || undefined,
          youtube_playlists_found: youtubeData?.raw?.playlists?.length || undefined,
          transcript_excerpt: transcript ? transcript.slice(0, 500) + '...' : null,
          transcript_word_count: transcriptWordCount || undefined,
          context_provided: !!context,
          total_source_words: totalSourceWords,
          model_used: model,
          // Fathom + YT transcript metadata
          fathom_meetings_found: fathomSyncResult?.found || undefined,
          fathom_meetings_included: selectedTranscripts.filter(t => t.source === 'fathom').length || undefined,
          fathom_meeting_titles: selectedTranscripts.filter(t => t.source === 'fathom').map(t => t.title) || undefined,
          youtube_transcripts_included: selectedTranscripts.filter(t => t.source === 'youtube').length || undefined,
          youtube_transcript_titles: selectedTranscripts.filter(t => t.source === 'youtube').map(t => t.title) || undefined,
          transcript_sources: transcriptSourcesMeta.length > 0 ? transcriptSourcesMeta : undefined,
        }

        const { data: existing } = await supabase
          .from('client_dna')
          .select('version')
          .eq('client_id', client_id)
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle()

        const nextVersion = (existing?.version || 0) + 1

        const { data: inserted, error: insertError } = await supabase
          .from('client_dna')
          .insert({
            client_id,
            dna_markdown: fullMarkdown,
            sources,
            generated_by: client_name,
            version: nextVersion,
            website_url: website_url || null,
            youtube_url: youtube_url || null,
            context: context || null,
          })
          .select()
          .single()

        if (insertError) {
          sendEvent('error', { message: 'Failed to save DNA profile', details: insertError.message })
          controller.close()
          return
        }

        // Auto-link DNA viewer in PM dashboard — but only if no Google Doc URL is already set
        const { data: existingSettings } = await supabase
          .from('client_settings')
          .select('dna_doc_url')
          .eq('client_id', client_id)
          .maybeSingle()

        const existingUrl = existingSettings?.dna_doc_url || ''
        const hasGoogleDocUrl = existingUrl.includes('docs.google.com')

        if (!hasGoogleDocUrl) {
          const dnaViewerUrl = `https://qc.contentcartel.net/dna/${client_id}`
          await supabase
            .from('client_settings')
            .upsert({ client_id, dna_doc_url: dnaViewerUrl }, { onConflict: 'client_id' })
        }

        const fathomIncluded = selectedTranscripts.filter(t => t.source === 'fathom').length
        const ytTranscriptsIncluded = selectedTranscripts.filter(t => t.source === 'youtube').length

        sendEvent('complete', {
          dna_id: inserted.id,
          version: nextVersion,
          client_id,
          sources: {
            website: websiteData ? `${websiteData.pages.length} pages (${websiteData.totalChars.toLocaleString()} chars)` : 'skipped',
            youtube: youtubeData ? `${youtubeData.type} — ${youtubeData.raw?.videos.length || 0} videos, ${youtubeData.raw?.playlists?.length || 0} playlists` : 'skipped',
            fathom: fathomIncluded > 0 ? `${fathomIncluded} meeting${fathomIncluded > 1 ? 's' : ''}` : 'none',
            youtube_transcripts: ytTranscriptsIncluded > 0 ? `${ytTranscriptsIncluded} video${ytTranscriptsIncluded > 1 ? 's' : ''}` : 'none',
            context: context ? 'provided' : 'none',
            transcript: transcript ? `provided (${transcriptWordCount.toLocaleString()} words)` : 'none',
            total_source_words: totalSourceWords,
            model,
          },
        })

        controller.close()
      } catch (error) {
        sendEvent('error', {
          message: 'Internal server error',
          details: error instanceof Error ? error.message : 'Unknown error',
        })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
