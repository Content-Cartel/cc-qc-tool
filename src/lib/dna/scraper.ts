import * as cheerio from 'cheerio'

interface ScrapedWebsite {
  title: string
  description: string
  headings: string[]
  bodyText: string
  aboutText: string
}

interface ScrapedYouTube {
  channelName: string
  description: string
  recentVideoTitles: string[]
}

export async function scrapeWebsite(url: string): Promise<ScrapedWebsite | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) return null

    const html = await response.text()
    const $ = cheerio.load(html)

    // Remove scripts, styles, nav, footer
    $('script, style, nav, footer, header, iframe, noscript').remove()

    const title = $('title').text().trim()
    const description = $('meta[name="description"]').attr('content') ||
                       $('meta[property="og:description"]').attr('content') || ''

    const headings: string[] = []
    $('h1, h2, h3').each((_, el) => {
      const text = $(el).text().trim()
      if (text && text.length < 200) headings.push(text)
    })

    // Get main body text (truncated)
    const bodyText = $('main, article, [role="main"], .content, #content, body')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 5000)

    // Try to find about page content
    let aboutText = ''
    const aboutUrl = new URL(url)
    for (const path of ['/about', '/about-us', '/our-story']) {
      try {
        aboutUrl.pathname = path
        const aboutRes = await fetch(aboutUrl.toString(), {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
          signal: AbortSignal.timeout(10000),
        })
        if (aboutRes.ok) {
          const aboutHtml = await aboutRes.text()
          const $about = cheerio.load(aboutHtml)
          $about('script, style, nav, footer, header').remove()
          aboutText = $about('main, article, [role="main"], body')
            .first()
            .text()
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 3000)
          if (aboutText.length > 100) break
        }
      } catch {
        // Continue trying other paths
      }
    }

    return { title, description, headings: headings.slice(0, 20), bodyText, aboutText }
  } catch {
    return null
  }
}

export async function scrapeYouTube(url: string): Promise<ScrapedYouTube | null> {
  try {
    // Normalize to channel URL
    let channelUrl = url
    if (!channelUrl.includes('/about') && !channelUrl.includes('/videos')) {
      channelUrl = channelUrl.replace(/\/$/, '')
    }

    const response = await fetch(channelUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) return null

    const html = await response.text()

    // Extract channel name from meta tags
    const $ = cheerio.load(html)
    const channelName = $('meta[property="og:title"]').attr('content') ||
                        $('title').text().replace(' - YouTube', '').trim()
    const description = $('meta[property="og:description"]').attr('content') ||
                        $('meta[name="description"]').attr('content') || ''

    // Extract video titles from the page's initial data
    const recentVideoTitles: string[] = []
    const ytInitialDataMatch = html.match(/var ytInitialData = ({.*?});/)
    if (ytInitialDataMatch) {
      try {
        const data = JSON.parse(ytInitialDataMatch[1])
        const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || []
        for (const tab of tabs) {
          const items = tab?.tabRenderer?.content?.richGridRenderer?.contents || []
          for (const item of items) {
            const title = item?.richItemRenderer?.content?.videoRenderer?.title?.runs?.[0]?.text
            if (title) recentVideoTitles.push(title)
          }
        }
      } catch {
        // JSON parse failed, try regex fallback
      }
    }

    // Regex fallback for video titles
    if (recentVideoTitles.length === 0) {
      const titleRegex = /"title":\{"runs":\[\{"text":"([^"]+)"\}/g
      let match: RegExpExecArray | null
      while ((match = titleRegex.exec(html)) !== null) {
        if (match[1] && !recentVideoTitles.includes(match[1]) && match[1].length < 200) {
          recentVideoTitles.push(match[1])
        }
      }
    }

    return {
      channelName,
      description,
      recentVideoTitles: recentVideoTitles.slice(0, 15),
    }
  } catch {
    return null
  }
}

export function formatScrapedData(
  website: ScrapedWebsite | null,
  youtube: ScrapedYouTube | null,
  context?: string,
  transcript?: string,
): string {
  const sections: string[] = []

  if (website) {
    sections.push(`## WEBSITE DATA
**Site Title:** ${website.title}
**Meta Description:** ${website.description}

**Key Headings:**
${website.headings.map(h => `- ${h}`).join('\n')}

**Main Content:**
${website.bodyText}

${website.aboutText ? `**About Page:**\n${website.aboutText}` : ''}`)
  }

  if (youtube) {
    sections.push(`## YOUTUBE DATA
**Channel Name:** ${youtube.channelName}
**Channel Description:** ${youtube.description}

**Recent Video Titles:**
${youtube.recentVideoTitles.map(t => `- ${t}`).join('\n')}`)
  }

  if (context) {
    sections.push(`## ADDITIONAL CONTEXT
${context}`)
  }

  if (transcript) {
    sections.push(`## ONBOARDING/STORY TRANSCRIPT
${transcript.slice(0, 8000)}`)
  }

  return sections.join('\n\n---\n\n')
}
