import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 300 // 5 min
export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL_1 || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY_1 || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_1 || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

const YT_API_KEY = process.env.YOUTUBE_API_KEY

/**
 * GET /api/cron/scrape-transcripts
 *
 * Weekly cron that pulls YouTube transcripts for all clients.
 * Reads youtube_url from client_dna, resolves channel, fetches recent videos,
 * pulls transcripts via YouTube's timedtext API, saves to client_transcripts.
 */
export async function GET(req: NextRequest) {
  const supabase = getSupabase()
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!YT_API_KEY) {
    return NextResponse.json({ error: 'YOUTUBE_API_KEY not configured' }, { status: 500 })
  }

  const results: { client_name: string; status: string; saved?: number }[] = []

  try {
    // Get all clients with DNA that has a youtube_url
    const { data: dnaRecords } = await supabase
      .from('client_dna')
      .select('client_id, youtube_url')
      .not('youtube_url', 'is', null)
      .order('client_id', { ascending: true })
      .order('version', { ascending: false })

    if (!dnaRecords || dnaRecords.length === 0) {
      return NextResponse.json({ message: 'No clients with YouTube URLs in DNA', results: [] })
    }

    // Dedupe to latest version per client
    const clientYouTube = new Map<number, string>()
    for (const r of dnaRecords) {
      if (!clientYouTube.has(r.client_id) && r.youtube_url) {
        clientYouTube.set(r.client_id, r.youtube_url)
      }
    }

    // Get client names
    const clientIds = Array.from(clientYouTube.keys())
    const { data: clients } = await supabase
      .from('clients')
      .select('id, name')
      .in('id', clientIds)

    const clientNameMap: Record<number, string> = {}
    for (const c of (clients || [])) {
      clientNameMap[c.id] = c.name
    }

    const entries = Array.from(clientYouTube.entries())
    for (const [clientId, youtubeUrl] of entries) {
      const clientName = clientNameMap[clientId] || `Client ${clientId}`

      try {
        // Extract handle from URL
        const handle = extractHandle(youtubeUrl)
        if (!handle) {
          results.push({ client_name: clientName, status: 'skipped: could not parse YouTube handle' })
          continue
        }

        // Resolve channel ID
        const channelId = await resolveChannelId(handle)
        if (!channelId) {
          results.push({ client_name: clientName, status: 'skipped: could not resolve channel' })
          continue
        }

        // Get recent videos
        const videos = await getRecentVideos(channelId, 5)

        let saved = 0
        for (const video of videos) {
          // Check if already exists
          const { data: existing } = await supabase
            .from('client_transcripts')
            .select('id')
            .eq('client_id', clientId)
            .eq('source', 'youtube')
            .eq('source_id', video.videoId)
            .limit(1)

          if (existing && existing.length > 0) continue

          // Fetch transcript
          const transcript = await fetchTranscript(video.videoId)
          if (!transcript || transcript.length < 200) continue // Skip if too short or no transcript

          const wordCount = transcript.split(/\s+/).length
          if (wordCount < 50) continue // Skip very short

          // Save
          const { error } = await supabase.from('client_transcripts').insert({
            client_id: clientId,
            source: 'youtube',
            source_id: video.videoId,
            title: video.title,
            transcript_text: transcript,
            word_count: wordCount,
            duration_seconds: video.duration || null,
            recorded_at: video.publishedAt,
            relevance_tag: 'general',
          })

          if (!error) saved++
        }

        results.push({
          client_name: clientName,
          status: saved > 0 ? 'scraped' : 'no new transcripts',
          saved,
        })
      } catch (err) {
        results.push({
          client_name: clientName,
          status: `error: ${err instanceof Error ? err.message : 'unknown'}`,
        })
      }
    }

    return NextResponse.json({
      success: true,
      total_clients: clientYouTube.size,
      clients_with_new: results.filter(r => (r.saved || 0) > 0).length,
      total_new_transcripts: results.reduce((sum, r) => sum + (r.saved || 0), 0),
      results,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Scrape failed' },
      { status: 500 }
    )
  }
}

// --- YouTube helpers ---

function extractHandle(url: string): string | null {
  // Handle formats: @handle, /channel/UCxxx, /c/name, full URL
  const handleMatch = url.match(/@([\w-]+)/)
  if (handleMatch) return handleMatch[1]

  const channelMatch = url.match(/youtube\.com\/(c\/|channel\/|user\/|@)([\w-]+)/)
  if (channelMatch) return channelMatch[2]

  return null
}

async function resolveChannelId(handle: string): Promise<string | null> {
  try {
    // Try as handle first
    let url = `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${handle}&key=${YT_API_KEY}`
    let res = await fetch(url)
    let data = await res.json()
    if (data.items?.length > 0) return data.items[0].id

    // Try as username
    url = `https://www.googleapis.com/youtube/v3/channels?part=id&forUsername=${handle}&key=${YT_API_KEY}`
    res = await fetch(url)
    data = await res.json()
    if (data.items?.length > 0) return data.items[0].id

    // Try as channel ID directly
    if (handle.startsWith('UC')) {
      url = `https://www.googleapis.com/youtube/v3/channels?part=id&id=${handle}&key=${YT_API_KEY}`
      res = await fetch(url)
      data = await res.json()
      if (data.items?.length > 0) return data.items[0].id
    }

    return null
  } catch {
    return null
  }
}

async function getRecentVideos(channelId: string, maxResults: number) {
  // Get uploads playlist
  const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${YT_API_KEY}`
  const channelRes = await fetch(channelUrl)
  const channelData = await channelRes.json()
  const uploadsId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
  if (!uploadsId) return []

  // Get playlist items
  const playlistUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsId}&maxResults=${maxResults}&key=${YT_API_KEY}`
  const playlistRes = await fetch(playlistUrl)
  const playlistData = await playlistRes.json()

  return (playlistData.items || []).map((item: { snippet: { resourceId: { videoId: string }; title: string; publishedAt: string } }) => ({
    videoId: item.snippet.resourceId.videoId,
    title: item.snippet.title,
    publishedAt: item.snippet.publishedAt,
    duration: null, // Would need separate API call for duration
  }))
}

async function fetchTranscript(videoId: string): Promise<string | null> {
  try {
    // Try to get transcript via YouTube's timedtext API
    // First, get the video page to find available captions
    const pageUrl = `https://www.youtube.com/watch?v=${videoId}`
    const pageRes = await fetch(pageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ContentCartel/1.0)' },
    })
    const html = await pageRes.text()

    // Extract captions URL from the page
    const captionMatch = html.match(/"captionTracks":\[.*?"baseUrl":"(.*?)"/)

    if (!captionMatch) return null

    const captionUrl = captionMatch[1].replace(/\\u0026/g, '&')
    const captionRes = await fetch(captionUrl)
    const captionXml = await captionRes.text()

    // Parse the XML transcript
    const textSegments = captionXml.match(/<text[^>]*>([^<]*)<\/text>/g)
    if (!textSegments) return null

    const fullText = textSegments
      .map(seg => {
        const textMatch = seg.match(/<text[^>]*>([^<]*)<\/text>/)
        return textMatch ? decodeHtmlEntities(textMatch[1]) : ''
      })
      .filter(Boolean)
      .join(' ')

    return fullText.trim()
  } catch {
    return null
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\n/g, ' ')
    .trim()
}
