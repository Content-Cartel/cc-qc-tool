/**
 * YouTube Data API v3 integration for DNA generation.
 * Fetches channel data + 50 recent videos with full metadata (descriptions, tags, engagement).
 * Includes playlist extraction, performance tiers, and schedule detection.
 */

const YT_API_BASE = 'https://www.googleapis.com/youtube/v3'

export interface YouTubeChannelData {
  channelId: string
  name: string
  description: string
  subscriberCount: number
  videoCount: number
  viewCount: number
  country: string
  customUrl: string
  keywords: string[]
  publishedAt: string
}

export interface YouTubeVideoData {
  videoId: string
  title: string
  description: string
  tags: string[]
  publishedAt: string
  viewCount: number
  likeCount: number
  commentCount: number
  duration: string
  categoryId: string
}

export interface YouTubePlaylist {
  id: string
  title: string
  description: string
  videoCount: number
}

export interface YouTubeFullData {
  channel: YouTubeChannelData
  videos: YouTubeVideoData[]
  playlists: YouTubePlaylist[]
  aggregated: {
    topTags: string[]
    avgViews: number
    avgLikes: number
    avgComments: number
    avgEngagementRate: number
    commonCTAs: string[]
    totalVideosAnalyzed: number
    avgDaysBetween: number
    topPerformers: YouTubeVideoData[]
    underperformers: YouTubeVideoData[]
    postingSchedule: { dayOfWeek: string; count: number }[]
    descriptionTemplate: string | null
    commonHashtags: string[]
    recurringLinks: string[]
  }
}

/**
 * Extract channel ID from any YouTube URL format.
 * Handles: /@handle, /channel/UCxxx, /c/name, /user/name, + trailing paths
 */
export async function resolveChannelId(url: string, apiKey: string): Promise<string | null> {
  try {
    const parsed = new URL(url.replace(/\/$/, ''))
    const pathname = parsed.pathname.replace(/\/(videos|about|shorts|streams|playlists|community|channels|featured)\/?$/, '')

    // Direct channel ID: /channel/UCxxxx
    const channelMatch = pathname.match(/\/channel\/(UC[\w-]+)/)
    if (channelMatch) return channelMatch[1]

    // Handle format: /@handle
    const handleMatch = pathname.match(/\/@([\w.-]+)/)
    if (handleMatch) {
      const handle = handleMatch[1]
      const res = await fetch(
        `${YT_API_BASE}/channels?part=id&forHandle=${encodeURIComponent(handle)}&key=${apiKey}`,
        { signal: AbortSignal.timeout(10000) }
      )
      const data = await res.json()
      if (data.items?.[0]?.id) return data.items[0].id
    }

    // Legacy formats: /c/name or /user/name
    const legacyMatch = pathname.match(/\/(c|user)\/([\w.-]+)/)
    if (legacyMatch) {
      const name = legacyMatch[2]
      const res = await fetch(
        `${YT_API_BASE}/search?part=id&q=${encodeURIComponent(name)}&type=channel&maxResults=1&key=${apiKey}`,
        { signal: AbortSignal.timeout(10000) }
      )
      const data = await res.json()
      if (data.items?.[0]?.id?.channelId) return data.items[0].id.channelId
    }

    // Last resort: try forHandle with the last path segment
    const lastSegment = pathname.split('/').filter(Boolean).pop()
    if (lastSegment && !lastSegment.startsWith('UC')) {
      const res = await fetch(
        `${YT_API_BASE}/channels?part=id&forHandle=${encodeURIComponent(lastSegment)}&key=${apiKey}`,
        { signal: AbortSignal.timeout(10000) }
      )
      const data = await res.json()
      if (data.items?.[0]?.id) return data.items[0].id
    }

    return null
  } catch {
    return null
  }
}

/**
 * Fetch channel metadata: name, description, stats, keywords.
 */
export async function fetchChannelData(channelId: string, apiKey: string): Promise<YouTubeChannelData | null> {
  try {
    const res = await fetch(
      `${YT_API_BASE}/channels?part=snippet,statistics,brandingSettings&id=${channelId}&key=${apiKey}`,
      { signal: AbortSignal.timeout(10000) }
    )
    const data = await res.json()
    const ch = data.items?.[0]
    if (!ch) return null

    const keywords = ch.brandingSettings?.channel?.keywords
      ?.split(/[,\s]+/)
      .map((k: string) => k.replace(/"/g, '').trim())
      .filter(Boolean) || []

    return {
      channelId,
      name: ch.snippet?.title || '',
      description: ch.snippet?.description || '',
      subscriberCount: parseInt(ch.statistics?.subscriberCount || '0', 10),
      videoCount: parseInt(ch.statistics?.videoCount || '0', 10),
      viewCount: parseInt(ch.statistics?.viewCount || '0', 10),
      country: ch.snippet?.country || '',
      customUrl: ch.snippet?.customUrl || '',
      keywords,
      publishedAt: ch.snippet?.publishedAt || '',
    }
  } catch {
    return null
  }
}

/**
 * Fetch recent videos with full metadata: description, tags, stats, duration.
 * Fetches 50 videos in batches.
 */
export async function fetchRecentVideos(channelId: string, apiKey: string, count = 50): Promise<YouTubeVideoData[]> {
  try {
    const allVideoIds: string[] = []
    let pageToken: string | undefined

    // Fetch video IDs in pages (search API returns max 50 per page)
    while (allVideoIds.length < count) {
      const remaining = count - allVideoIds.length
      const maxResults = Math.min(remaining, 50)
      let searchUrl = `${YT_API_BASE}/search?part=id&channelId=${channelId}&order=date&type=video&maxResults=${maxResults}&key=${apiKey}`
      if (pageToken) searchUrl += `&pageToken=${pageToken}`

      const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(15000) })
      const searchData = await searchRes.json()
      const ids = searchData.items
        ?.map((item: { id?: { videoId?: string } }) => item.id?.videoId)
        .filter(Boolean) as string[]

      if (!ids?.length) break
      allVideoIds.push(...ids)
      pageToken = searchData.nextPageToken
      if (!pageToken) break
    }

    if (allVideoIds.length === 0) return []

    // Fetch full video details in batches of 50
    const allVideos: YouTubeVideoData[] = []
    for (let i = 0; i < allVideoIds.length; i += 50) {
      const batch = allVideoIds.slice(i, i + 50)
      const videosRes = await fetch(
        `${YT_API_BASE}/videos?part=snippet,statistics,contentDetails&id=${batch.join(',')}&key=${apiKey}`,
        { signal: AbortSignal.timeout(15000) }
      )
      const videosData = await videosRes.json()

      const videos = (videosData.items || []).map((v: {
        id: string
        snippet?: { title?: string; description?: string; tags?: string[]; publishedAt?: string; categoryId?: string }
        statistics?: { viewCount?: string; likeCount?: string; commentCount?: string }
        contentDetails?: { duration?: string }
      }) => ({
        videoId: v.id,
        title: v.snippet?.title || '',
        description: (v.snippet?.description || '').slice(0, 2000),
        tags: (v.snippet?.tags || []).slice(0, 25),
        publishedAt: v.snippet?.publishedAt || '',
        viewCount: parseInt(v.statistics?.viewCount || '0', 10),
        likeCount: parseInt(v.statistics?.likeCount || '0', 10),
        commentCount: parseInt(v.statistics?.commentCount || '0', 10),
        duration: v.contentDetails?.duration || '',
        categoryId: v.snippet?.categoryId || '',
      }))

      allVideos.push(...videos)
    }

    return allVideos
  } catch {
    return []
  }
}

/**
 * Fetch channel playlists to discover content pillars.
 */
export async function fetchPlaylists(channelId: string, apiKey: string): Promise<YouTubePlaylist[]> {
  try {
    const res = await fetch(
      `${YT_API_BASE}/playlists?part=snippet,contentDetails&channelId=${channelId}&maxResults=25&key=${apiKey}`,
      { signal: AbortSignal.timeout(10000) }
    )
    const data = await res.json()
    return (data.items || []).map((p: {
      id: string
      snippet?: { title?: string; description?: string }
      contentDetails?: { itemCount?: number }
    }) => ({
      id: p.id,
      title: p.snippet?.title || '',
      description: (p.snippet?.description || '').slice(0, 300),
      videoCount: p.contentDetails?.itemCount || 0,
    }))
  } catch {
    return []
  }
}

/**
 * Parse ISO 8601 duration (PT1H2M3S) to human-readable string.
 */
function formatDuration(iso: string): string {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return iso
  const h = match[1] ? `${match[1]}h ` : ''
  const m = match[2] ? `${match[2]}m ` : '0m '
  const s = match[3] ? `${match[3]}s` : ''
  return `${h}${m}${s}`.trim()
}

/**
 * Format number with K/M suffix.
 */
function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

/**
 * Detect the common description template by finding the recurring boilerplate.
 */
function detectDescriptionTemplate(videos: YouTubeVideoData[]): string | null {
  const descriptions = videos.filter(v => v.description.length > 50).map(v => v.description)
  if (descriptions.length < 5) return null

  // Find common ending (most description templates are appended at the end)
  const lines = descriptions.map(d => d.split('\n'))
  const commonLines: string[] = []

  // Check each line from the end of the first description
  const firstLines = lines[0]
  for (let i = firstLines.length - 1; i >= 0; i--) {
    const line = firstLines[i].trim()
    if (!line) continue
    const matchCount = lines.filter(l => l.some(ll => ll.trim() === line)).length
    if (matchCount >= descriptions.length * 0.6) { // appears in 60%+ of descriptions
      commonLines.unshift(line)
    }
  }

  return commonLines.length > 2 ? commonLines.join('\n') : null
}

/**
 * Extract common hashtags from descriptions.
 */
function extractHashtags(videos: YouTubeVideoData[]): string[] {
  const hashtagCounts = new Map<string, number>()
  for (const v of videos) {
    const hashtags = v.description.match(/#[\w]+/g) || []
    for (const tag of hashtags) {
      const lower = tag.toLowerCase()
      hashtagCounts.set(lower, (hashtagCounts.get(lower) || 0) + 1)
    }
  }
  return Array.from(hashtagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag]) => tag)
}

/**
 * Extract recurring links from descriptions.
 */
function extractRecurringLinks(videos: YouTubeVideoData[]): string[] {
  const linkCounts = new Map<string, number>()
  const urlRegex = /https?:\/\/[^\s<>"]+/g

  for (const v of videos) {
    const links = v.description.match(urlRegex) || []
    for (const link of links) {
      // Normalize by removing tracking params
      const clean = link.split('?')[0].replace(/\/$/, '')
      linkCounts.set(clean, (linkCounts.get(clean) || 0) + 1)
    }
  }

  return Array.from(linkCounts.entries())
    .filter(([, count]) => count >= 3) // appears in 3+ videos
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([link, count]) => `${link} (in ${count} videos)`)
}

/**
 * Aggregate video data for comprehensive insights.
 */
function aggregateVideoData(videos: YouTubeVideoData[]) {
  if (videos.length === 0) return {
    topTags: [], avgViews: 0, avgLikes: 0, avgComments: 0, avgEngagementRate: 0,
    commonCTAs: [], totalVideosAnalyzed: 0, avgDaysBetween: 0,
    topPerformers: [] as YouTubeVideoData[], underperformers: [] as YouTubeVideoData[],
    postingSchedule: [] as { dayOfWeek: string; count: number }[],
    descriptionTemplate: null as string | null,
    commonHashtags: [] as string[],
    recurringLinks: [] as string[],
  }

  // Top tags by frequency
  const tagCounts = new Map<string, number>()
  for (const v of videos) {
    for (const tag of v.tags) {
      const lower = tag.toLowerCase()
      tagCounts.set(lower, (tagCounts.get(lower) || 0) + 1)
    }
  }
  const topTags = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([tag]) => tag)

  // Averages
  const avgViews = Math.round(videos.reduce((s, v) => s + v.viewCount, 0) / videos.length)
  const avgLikes = Math.round(videos.reduce((s, v) => s + v.likeCount, 0) / videos.length)
  const avgComments = Math.round(videos.reduce((s, v) => s + v.commentCount, 0) / videos.length)
  const avgEngagementRate = avgViews > 0 ? (avgLikes / avgViews) * 100 : 0

  // Performance tiers
  const sortedByViews = [...videos].sort((a, b) => b.viewCount - a.viewCount)
  const top20pct = Math.max(1, Math.ceil(videos.length * 0.2))
  const topPerformers = sortedByViews.slice(0, top20pct)
  const underperformers = sortedByViews.slice(-top20pct)

  // Extract common CTAs from descriptions
  const ctaPatterns = /(?:link in (?:bio|description)|subscribe|sign up|book a call|free (?:guide|download|course|webinar)|check out|click (?:here|below)|join|get started|grab your|use code|limited time|don'?t miss|watch (?:next|more)|follow (?:me|us)|leave a comment|share this|hit the bell|turn on notifications)/gi
  const ctaCounts = new Map<string, number>()
  for (const v of videos) {
    const matches = v.description.match(ctaPatterns) || []
    for (const m of matches) {
      const lower = m.toLowerCase()
      ctaCounts.set(lower, (ctaCounts.get(lower) || 0) + 1)
    }
  }
  const commonCTAs = Array.from(ctaCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([cta]) => cta)

  // Detect upload cadence
  const dates = videos
    .map(v => v.publishedAt ? new Date(v.publishedAt) : null)
    .filter((d): d is Date => d !== null && !isNaN(d.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())

  let avgDaysBetween = 0
  if (dates.length >= 2) {
    const gaps: number[] = []
    for (let i = 0; i < dates.length - 1; i++) {
      gaps.push((dates[i].getTime() - dates[i + 1].getTime()) / (1000 * 60 * 60 * 24))
    }
    avgDaysBetween = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length)
  }

  // Posting schedule (day of week analysis)
  const dayOfWeekNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const dayCounts = new Map<string, number>()
  for (const d of dates) {
    const day = dayOfWeekNames[d.getUTCDay()]
    dayCounts.set(day, (dayCounts.get(day) || 0) + 1)
  }
  const postingSchedule = Array.from(dayCounts.entries())
    .map(([dayOfWeek, count]) => ({ dayOfWeek, count }))
    .sort((a, b) => b.count - a.count)

  // Description template detection
  const descriptionTemplate = detectDescriptionTemplate(videos)

  // Hashtags
  const commonHashtags = extractHashtags(videos)

  // Recurring links
  const recurringLinks = extractRecurringLinks(videos)

  return {
    topTags, avgViews, avgLikes, avgComments, avgEngagementRate,
    commonCTAs, totalVideosAnalyzed: videos.length, avgDaysBetween,
    topPerformers, underperformers, postingSchedule,
    descriptionTemplate, commonHashtags, recurringLinks,
  }
}

/**
 * Format all YouTube data into a structured markdown section for the DNA prompt.
 * Structure: Insights FIRST (what works, what doesn't), then top performers with detail,
 * then remaining videos as titles-only. The AI needs patterns, not raw data dumps.
 */
export function formatYouTubeAPIData(
  channel: YouTubeChannelData,
  videos: YouTubeVideoData[],
  playlists: YouTubePlaylist[],
): string {
  const agg = aggregateVideoData(videos)
  const sections: string[] = []

  // ============================================================
  // SECTION 1: WHAT WORKS vs WHAT DOESN'T (Most important — goes first)
  // ============================================================
  if (videos.length >= 5) {
    const cadenceStr = agg.avgDaysBetween > 0
      ? agg.avgDaysBetween <= 2 ? 'Daily'
        : agg.avgDaysBetween <= 4 ? `Every ~${agg.avgDaysBetween} days`
        : agg.avgDaysBetween <= 8 ? 'Weekly'
        : agg.avgDaysBetween <= 16 ? 'Bi-weekly'
        : `Every ~${agg.avgDaysBetween} days`
      : 'Unknown'

    // Analyze what top performers have in common
    const topAvgDuration = agg.topPerformers.length > 0
      ? Math.round(agg.topPerformers.reduce((s, v) => s + parseDurationSeconds(v.duration), 0) / agg.topPerformers.length / 60)
      : 0
    const bottomAvgDuration = agg.underperformers.length > 0
      ? Math.round(agg.underperformers.reduce((s, v) => s + parseDurationSeconds(v.duration), 0) / agg.underperformers.length / 60)
      : 0

    // Top performer tags vs underperformer tags
    const topTagSet = new Map<string, number>()
    for (const v of agg.topPerformers) {
      for (const tag of v.tags) topTagSet.set(tag.toLowerCase(), (topTagSet.get(tag.toLowerCase()) || 0) + 1)
    }
    const topUniqueThemes = Array.from(topTagSet.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag]) => tag)

    sections.push(`### CONTENT INTELLIGENCE — What Works vs What Doesn't
**Based on analysis of ${agg.totalVideosAnalyzed} videos.**

**Channel Benchmarks:**
- Avg views: ${formatCount(agg.avgViews)} | Avg likes: ${formatCount(agg.avgLikes)} | Avg comments: ${formatCount(agg.avgComments)}
- Engagement rate: ${agg.avgEngagementRate.toFixed(1)}%
- Upload cadence: ${cadenceStr} (avg ${agg.avgDaysBetween} days between uploads)

**WHAT WORKS (Top 20% by views):**
${agg.topPerformers.map(v => `- "${v.title}" — ${formatCount(v.viewCount)} views (${(v.viewCount / Math.max(agg.avgViews, 1)).toFixed(1)}x channel avg)`).join('\n')}
${topAvgDuration > 0 ? `- Top performers average ~${topAvgDuration} minutes` : ''}
${topUniqueThemes.length > 0 ? `- Common themes in top content: ${topUniqueThemes.join(', ')}` : ''}

**WHAT DOESN'T WORK (Bottom 20% by views):**
${videos.length >= 10 ? agg.underperformers.map(v => `- "${v.title}" — ${formatCount(v.viewCount)} views (${(v.viewCount / Math.max(agg.avgViews, 1)).toFixed(1)}x channel avg)`).join('\n') : '[Not enough videos to determine underperformers]'}
${bottomAvgDuration > 0 && videos.length >= 10 ? `- Underperformers average ~${bottomAvgDuration} minutes` : ''}

**CONTENT PATTERNS:**
${agg.topTags.length > 0 ? `- Most used tags across all videos: ${agg.topTags.slice(0, 15).join(', ')}` : ''}
${agg.commonCTAs.length > 0 ? `- Common CTAs: ${agg.commonCTAs.join(', ')}` : ''}
${agg.commonHashtags.length > 0 ? `- Common hashtags: ${agg.commonHashtags.join(', ')}` : ''}
${agg.postingSchedule.length > 0 ? `- Most active upload days: ${agg.postingSchedule.slice(0, 3).map(d => `${d.dayOfWeek} (${d.count})`).join(', ')}` : ''}`)
  }

  // ============================================================
  // SECTION 2: Channel Overview + Content Pillars (Context)
  // ============================================================
  sections.push(`### Channel Overview
- **Name:** ${channel.name}
- **Subscribers:** ${formatCount(channel.subscriberCount)}
- **Total Videos:** ${formatCount(channel.videoCount)}
- **Total Views:** ${formatCount(channel.viewCount)}
- **Country:** ${channel.country || 'Not specified'}
- **Channel Created:** ${channel.publishedAt ? new Date(channel.publishedAt).getFullYear() : 'Unknown'}
${channel.description ? `\n**Channel Description:**\n${channel.description.slice(0, 1500)}` : ''}
${channel.keywords.length > 0 ? `\n**Channel Keywords:** ${channel.keywords.join(', ')}` : ''}`)

  if (playlists.length > 0) {
    sections.push(`### Playlists (Content Pillars)
${playlists.map(p => `- **${p.title}** (${p.videoCount} videos)${p.description ? ` — ${p.description}` : ''}`).join('\n')}`)
  }

  // ============================================================
  // SECTION 3: Top 10 Videos — Full Detail (for voice mining + hook patterns)
  // ============================================================
  if (agg.topPerformers.length > 0) {
    const topVideos = agg.topPerformers.slice(0, 10)
    sections.push(`### Top 10 Videos — Full Detail (mine these for voice, hooks, and content patterns)
${topVideos.map((v, i) => {
      const date = v.publishedAt ? new Date(v.publishedAt).toLocaleDateString() : ''
      return `**${i + 1}. ${v.title}**
   Views: ${formatCount(v.viewCount)} | Likes: ${formatCount(v.likeCount)} | Comments: ${formatCount(v.commentCount)} | Duration: ${formatDuration(v.duration)} | Published: ${date}
   ${v.tags.length > 0 ? `Tags: ${v.tags.slice(0, 10).join(', ')}` : ''}
   ${v.description ? `Description: ${v.description.slice(0, 500)}` : ''}`
    }).join('\n\n')}`)
  }

  // ============================================================
  // SECTION 4: Remaining Videos — Titles Only (for topic coverage)
  // ============================================================
  const topPerformerIds = new Set(agg.topPerformers.slice(0, 10).map(v => v.videoId))
  const remainingVideos = videos.filter(v => !topPerformerIds.has(v.videoId))
  if (remainingVideos.length > 0) {
    sections.push(`### Additional Videos — Titles (${remainingVideos.length} videos, for topic coverage analysis)
${remainingVideos.map((v, i) => {
      const views = formatCount(v.viewCount)
      return `${i + 1}. ${v.title} (${views} views, ${formatDuration(v.duration)})`
    }).join('\n')}`)
  }

  // ============================================================
  // SECTION 5: Funnel Signals (recurring links, description templates)
  // ============================================================
  if (agg.recurringLinks.length > 0 || agg.descriptionTemplate) {
    let funnelSection = `### Funnel Signals`
    if (agg.recurringLinks.length > 0) {
      funnelSection += `\n**Recurring Links in Descriptions (where they send traffic):**\n${agg.recurringLinks.map(l => `- ${l}`).join('\n')}`
    }
    if (agg.descriptionTemplate) {
      funnelSection += `\n\n**Description Template (appears in 60%+ of videos):**\n\`\`\`\n${agg.descriptionTemplate.slice(0, 800)}\n\`\`\``
    }
    sections.push(funnelSection)
  }

  return sections.join('\n\n')
}

/**
 * Parse ISO 8601 duration (PT#H#M#S) to total seconds.
 */
function parseDurationSeconds(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0
  return (parseInt(match[1] || '0') * 3600) + (parseInt(match[2] || '0') * 60) + parseInt(match[3] || '0')
}

/**
 * Main entry: fetch all YouTube data for a channel URL.
 * Returns formatted text for the DNA prompt + raw data for storage.
 */
export async function fetchYouTubeViaAPI(
  url: string,
  apiKey: string,
): Promise<{ formatted: string; raw: YouTubeFullData } | null> {
  const channelId = await resolveChannelId(url, apiKey)
  if (!channelId) return null

  const [channel, videos, playlists] = await Promise.all([
    fetchChannelData(channelId, apiKey),
    fetchRecentVideos(channelId, apiKey, 50),
    fetchPlaylists(channelId, apiKey),
  ])

  if (!channel) return null

  const formatted = formatYouTubeAPIData(channel, videos, playlists)
  const aggregated = aggregateVideoData(videos)

  return {
    formatted,
    raw: { channel, videos, playlists, aggregated },
  }
}
