import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { scrapeWebsite, scrapeYouTube, formatScrapedData } from '@/lib/dna/scraper'
import { buildDNAPrompt } from '@/lib/dna/prompt'
import type { GenerateDNARequest } from '@/lib/dna/types'

// DNA generation can take 1-2 minutes depending on scraping + Claude response
export const maxDuration = 120

export async function POST(req: NextRequest) {
  try {
    const body: GenerateDNARequest = await req.json()
    const { client_id, client_name, website_url, youtube_url, context, transcript } = body

    if (!client_id || !client_name) {
      return NextResponse.json({ error: 'client_id and client_name are required' }, { status: 400 })
    }

    if (!website_url && !youtube_url && !context && !transcript) {
      return NextResponse.json({ error: 'At least one data source is required (website, youtube, context, or transcript)' }, { status: 400 })
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY
    if (!anthropicKey || anthropicKey === 'your-anthropic-api-key-here') {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured on server' }, { status: 500 })
    }

    // Scrape data sources in parallel
    const [websiteData, youtubeData] = await Promise.all([
      website_url ? scrapeWebsite(website_url) : null,
      youtube_url ? scrapeYouTube(youtube_url) : null,
    ])

    const scrapedData = formatScrapedData(websiteData, youtubeData, context, transcript)

    if (!scrapedData.trim()) {
      return NextResponse.json({ error: 'Could not scrape any data from provided sources' }, { status: 422 })
    }

    // Generate DNA with Claude
    const anthropic = new Anthropic({ apiKey: anthropicKey })
    const prompt = buildDNAPrompt(client_name, scrapedData)

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })

    const dnaMarkdown = message.content
      .filter(block => block.type === 'text')
      .map(block => (block as { type: 'text'; text: string }).text)
      .join('\n')

    if (!dnaMarkdown) {
      return NextResponse.json({ error: 'Failed to generate DNA profile' }, { status: 500 })
    }

    // Store in Supabase
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )

    // Get current max version for this client
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
        dna_markdown: dnaMarkdown,
        sources: {
          website_data: websiteData ? `Scraped from ${website_url}` : null,
          youtube_data: youtubeData ? `Scraped from ${youtube_url}` : null,
          transcript_excerpt: transcript ? transcript.slice(0, 200) + '...' : null,
        },
        generated_by: body.client_name,
        version: nextVersion,
        website_url: website_url || null,
        youtube_url: youtube_url || null,
        context: context || null,
      })
      .select()
      .single()

    if (insertError) {
      console.error('Supabase insert error:', insertError)
      return NextResponse.json({ error: 'Failed to save DNA profile', details: insertError.message }, { status: 500 })
    }

    // Auto-link DNA viewer in PM dashboard's client_settings
    const dnaViewerUrl = `https://qc.contentcartel.net/dna/${client_id}`
    await supabase
      .from('client_settings')
      .update({ dna_doc_url: dnaViewerUrl })
      .eq('client_id', client_id)

    return NextResponse.json({
      success: true,
      dna: inserted,
      sources: {
        website: websiteData ? 'scraped' : 'skipped',
        youtube: youtubeData ? 'scraped' : 'skipped',
        context: context ? 'provided' : 'none',
        transcript: transcript ? 'provided' : 'none',
      },
    })
  } catch (error) {
    console.error('DNA generation error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
