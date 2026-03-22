import * as cheerio from 'cheerio'
import { fetchYouTubeViaAPI, type YouTubeFullData } from './youtube'
import { extractLogoColors } from './colors'

// ─── Website Types ───────────────────────────────────────────────

export interface ScrapedPage {
  url: string
  pageType: 'home' | 'about' | 'services' | 'blog' | 'testimonials' | 'team' | 'faq' | 'podcast' | 'other'
  title: string
  description: string
  headings: string[]
  bodyText: string
  ctas: string[]
  charCount: number
  status: 'success' | 'failed' | 'not_found'
}

export interface WebsiteVisualIdentity {
  colors: string[]
  logoColors: { hex: string; percentage: number; label?: string }[]
  logoUrl: string | null
  colorSource: 'logo' | 'og_image' | 'favicon' | 'css_fallback'
  fonts: string[]
  socialLinks: { platform: string; url: string }[]
  navItems: string[]
}

export interface ScrapedWebsite {
  pages: ScrapedPage[]
  pagesAttempted: { url: string; pageType: string; status: string }[]
  visual: WebsiteVisualIdentity
  totalChars: number
}

// ─── YouTube Types (for backward compat) ─────────────────────────

export interface ScrapedYouTube {
  channelName: string
  description: string
  recentVideoTitles: string[]
}

export interface YouTubeResult {
  type: 'api' | 'fallback'
  formatted: string
  raw?: YouTubeFullData
  fallback?: ScrapedYouTube
}

// ─── Website Scraping ────────────────────────────────────────────

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
]

const ABOUT_PATHS = ['/about', '/about-us', '/our-story', '/who-we-are', '/team', '/about-us/', '/our-team']
const SERVICES_PATHS = ['/services', '/solutions', '/products', '/offerings', '/pricing', '/what-we-do', '/programs']
const BLOG_PATHS = ['/blog', '/articles', '/resources', '/insights', '/news', '/media', '/content']
const TESTIMONIAL_PATHS = ['/testimonials', '/reviews', '/success-stories', '/case-studies', '/clients', '/results']
const TEAM_PATHS = ['/team', '/our-team', '/leadership', '/people', '/staff']
const FAQ_PATHS = ['/faq', '/faqs', '/frequently-asked-questions', '/help']
const PODCAST_PATHS = ['/podcast', '/podcasts', '/show', '/episodes', '/listen', '/watch']

const CTA_WORDS = /\b(get started|book|schedule|download|try|buy|sign up|contact|free|demo|start|enroll|register|apply|claim|grab|join|subscribe|watch|learn more|request|talk to|speak with|book a call|get in touch|work with|hire|consultation|discovery call|free trial|get access|unlock|reserve|donate|give|support)\b/i

const SOCIAL_DOMAINS: Record<string, string> = {
  'twitter.com': 'Twitter/X',
  'x.com': 'Twitter/X',
  'instagram.com': 'Instagram',
  'linkedin.com': 'LinkedIn',
  'tiktok.com': 'TikTok',
  'facebook.com': 'Facebook',
  'youtube.com': 'YouTube',
  'pinterest.com': 'Pinterest',
  'threads.net': 'Threads',
  'rumble.com': 'Rumble',
  'podcasts.apple.com': 'Apple Podcasts',
  'open.spotify.com': 'Spotify',
}

/**
 * Fetch a single page with retry logic and fallback User-Agents.
 */
async function fetchWithRetry(url: string, timeout = 12000): Promise<string | null> {
  for (const ua of USER_AGENTS) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
        },
        signal: AbortSignal.timeout(timeout),
        redirect: 'follow',
      })
      if (response.ok) {
        return await response.text()
      }
      if (response.status === 403 || response.status === 429) {
        continue // try next UA
      }
      return null
    } catch {
      continue // try next UA
    }
  }
  return null
}

/**
 * Fetch a single page and extract structured data.
 */
async function scrapeSinglePage(
  url: string,
  pageType: ScrapedPage['pageType'],
  maxBodyChars: number,
): Promise<ScrapedPage | null> {
  try {
    const html = await fetchWithRetry(url)
    if (!html) return null

    const $ = cheerio.load(html)

    $('script, style, nav, footer, header, iframe, noscript, svg, aside, [role="banner"], [role="navigation"], [role="complementary"]').remove()

    const title = $('title').text().trim()
    const description = $('meta[name="description"]').attr('content') ||
                        $('meta[property="og:description"]').attr('content') || ''

    const headings: string[] = []
    $('h1, h2, h3').each((_, el) => {
      const text = $(el).text().trim()
      if (text && text.length < 200 && text.length > 2) headings.push(text)
    })

    // Try multiple content selectors
    let bodyText = ''
    const contentSelectors = ['main', 'article', '[role="main"]', '.content', '#content', '.entry-content', '.post-content', '.page-content', '.site-content', 'body']
    for (const selector of contentSelectors) {
      const el = $(selector).first()
      if (el.length) {
        bodyText = el.text().replace(/\s+/g, ' ').trim()
        if (bodyText.length > 200) break
      }
    }
    bodyText = bodyText.slice(0, maxBodyChars)

    // Extract CTAs
    const ctas: string[] = []
    $('a, button').each((_, el) => {
      const text = $(el).text().trim()
      if (text && text.length > 2 && text.length < 100 && CTA_WORDS.test(text)) {
        if (!ctas.includes(text)) ctas.push(text)
      }
    })

    // Extract testimonials if on relevant page
    const testimonials: string[] = []
    if (['testimonials', 'about', 'home'].includes(pageType)) {
      $('[class*="testimonial"], [class*="review"], [class*="quote"], blockquote, [class*="success-stor"]').each((_, el) => {
        const text = $(el).text().trim()
        if (text && text.length > 30 && text.length < 500) {
          testimonials.push(text)
        }
      })
    }

    const fullText = testimonials.length > 0
      ? `${bodyText}\n\n--- Testimonials/Social Proof ---\n${testimonials.slice(0, 5).join('\n---\n')}`
      : bodyText

    return {
      url,
      pageType,
      title,
      description,
      headings: headings.slice(0, 25),
      bodyText: fullText.slice(0, maxBodyChars),
      ctas: ctas.slice(0, 15),
      charCount: fullText.length,
      status: 'success',
    }
  } catch {
    return null
  }
}

/**
 * Extract visual identity signals from the homepage HTML.
 */
async function extractVisualIdentity(url: string): Promise<WebsiteVisualIdentity> {
  const result: WebsiteVisualIdentity = { colors: [], logoColors: [], logoUrl: null, colorSource: 'css_fallback', fonts: [], socialLinks: [], navItems: [] }

  try {
    const html = await fetchWithRetry(url)
    if (!html) return result

    const $ = cheerio.load(html)

    // LOGO COLOR EXTRACTION (primary method — most accurate for brand colors)
    try {
      const logoResult = await extractLogoColors(html, url)
      if (logoResult.colors.length > 0) {
        result.logoColors = logoResult.colors
        result.logoUrl = logoResult.logoUrl
        result.colorSource = logoResult.method
        // Use logo colors as the primary colors
        result.colors = logoResult.colors.map(c => c.hex)
      }
    } catch {
      // Logo extraction failed, fall back to CSS
    }

    // CSS COLOR EXTRACTION (fallback — fills in if logo colors are sparse)
    let styleContent = $('style').map((_, el) => $(el).html()).get().join('\n')

    // Also fetch external CSS files for brand colors/fonts
    const cssLinks: string[] = []
    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href')
      if (href) {
        try {
          const cssUrl = new URL(href, url).toString()
          cssLinks.push(cssUrl)
        } catch { /* skip invalid URLs */ }
      }
    })

    // Fetch up to 3 external CSS files (in parallel)
    const cssPromises = cssLinks.slice(0, 3).map(async (cssUrl) => {
      try {
        const res = await fetch(cssUrl, {
          headers: { 'User-Agent': USER_AGENTS[0] },
          signal: AbortSignal.timeout(8000),
        })
        if (res.ok) return await res.text()
      } catch { /* skip failed CSS fetches */ }
      return ''
    })
    const externalCSS = await Promise.all(cssPromises)
    styleContent += '\n' + externalCSS.join('\n')
    const hexColors = new Set<string>()

    // CSS custom properties (brand colors)
    const customPropMatches = styleContent.match(/--[\w-]*(?:primary|brand|accent|main|secondary|bg|background|text|color|theme|highlight)[\w-]*:\s*(#[0-9a-fA-F]{3,8})/g)
    if (customPropMatches) {
      for (const m of customPropMatches) {
        const hex = m.match(/#[0-9a-fA-F]{3,8}/)
        if (hex) hexColors.add(hex[0].toLowerCase())
      }
    }

    // General hex colors (from most-used)
    const allHexMatches = styleContent.match(/#[0-9a-fA-F]{6}\b/g) || []
    const colorCounts = new Map<string, number>()
    for (const hex of allHexMatches) {
      const lower = hex.toLowerCase()
      if (['#000000', '#ffffff', '#fff', '#000', '#333333', '#666666', '#999999', '#cccccc', '#f5f5f5', '#e5e5e5', '#d4d4d4', '#fafafa'].includes(lower)) continue
      colorCounts.set(lower, (colorCounts.get(lower) || 0) + 1)
    }
    const topColors = Array.from(colorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([color]) => color)
    for (const c of topColors) hexColors.add(c)

    // Also extract colors from inline style attributes on elements
    $('[style]').each((_, el) => {
      const style = $(el).attr('style') || ''
      const inlineHexes = style.match(/#[0-9a-fA-F]{6}\b/g) || []
      for (const hex of inlineHexes) {
        const lower = hex.toLowerCase()
        if (!['#000000', '#ffffff', '#333333', '#666666', '#999999', '#cccccc', '#f5f5f5', '#e5e5e5', '#fafafa'].includes(lower)) {
          hexColors.add(lower)
        }
      }
      // Also check for rgb/rgba colors
      const rgbMatches = style.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g) || []
      for (const rgb of rgbMatches) {
        const parts = rgb.match(/(\d+)/g)
        if (parts && parts.length >= 3) {
          const hex = '#' + parts.slice(0, 3).map(n => parseInt(n).toString(16).padStart(2, '0')).join('')
          if (!['#000000', '#ffffff', '#333333', '#666666'].includes(hex)) {
            hexColors.add(hex)
          }
        }
      }
    })

    // Extract from meta theme-color
    const themeColor = $('meta[name="theme-color"]').attr('content')
    if (themeColor && themeColor.startsWith('#')) hexColors.add(themeColor.toLowerCase())

    result.colors = Array.from(hexColors).slice(0, 10)

    // Extract fonts
    const fontMatches = styleContent.match(/font-family:\s*([^;}{]+)/g) || []
    const fontSet = new Set<string>()
    for (const match of fontMatches) {
      const fonts = match.replace('font-family:', '').trim().split(',')
      const primaryFont = fonts[0]?.trim().replace(/['"]/g, '')
      if (primaryFont && !['inherit', 'initial', 'sans-serif', 'serif', 'monospace', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Arial', 'Helvetica'].includes(primaryFont)) {
        fontSet.add(primaryFont)
      }
    }
    // Also check link tags for Google Fonts
    $('link[href*="fonts.googleapis.com"]').each((_, el) => {
      const href = $(el).attr('href') || ''
      const familyMatch = href.match(/family=([^&:]+)/)
      if (familyMatch) {
        const families = familyMatch[1].split('|').map(f => f.replace(/\+/g, ' '))
        for (const f of families) fontSet.add(f)
      }
    })
    result.fonts = Array.from(fontSet).slice(0, 6)

    // Extract social links
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || ''
      for (const [domain, platform] of Object.entries(SOCIAL_DOMAINS)) {
        if (href.includes(domain) && !result.socialLinks.find(s => s.platform === platform)) {
          result.socialLinks.push({ platform, url: href })
        }
      }
    })

    // Extract nav items
    $('nav a, header a').each((_, el) => {
      const text = $(el).text().trim()
      if (text && text.length < 50 && text.length > 1) {
        if (!result.navItems.includes(text)) result.navItems.push(text)
      }
    })
    result.navItems = result.navItems.slice(0, 20)

  } catch {
    // Visual identity extraction is best-effort
  }

  return result
}

/**
 * Try to discover additional page URLs from sitemap.xml.
 */
async function discoverFromSitemap(baseUrl: string): Promise<string[]> {
  const discovered: string[] = []
  try {
    const base = new URL(baseUrl)
    const sitemapUrl = `${base.origin}/sitemap.xml`
    const html = await fetchWithRetry(sitemapUrl, 8000)
    if (!html) return discovered

    // Parse sitemap XML for URLs
    const urlMatches = html.match(/<loc>([^<]+)<\/loc>/g) || []
    for (const match of urlMatches) {
      const url = match.replace(/<\/?loc>/g, '')
      if (url.startsWith(base.origin)) {
        discovered.push(url)
      }
    }
  } catch {
    // Sitemap discovery is best-effort
  }
  return discovered.slice(0, 50) // Cap at 50 URLs
}

/**
 * Discover additional pages from nav/footer links on the homepage.
 */
async function discoverFromLinks(baseUrl: string, html: string): Promise<string[]> {
  const discovered: string[] = []
  try {
    const base = new URL(baseUrl)
    const $ = cheerio.load(html)
    const seen = new Set<string>()

    $('nav a[href], footer a[href]').each((_, el) => {
      const href = $(el).attr('href') || ''
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return

      let fullUrl: string
      try {
        fullUrl = new URL(href, base.origin).toString()
      } catch {
        return
      }

      // Only same-origin, skip external links
      if (!fullUrl.startsWith(base.origin)) return
      // Skip file downloads
      if (/\.(pdf|doc|zip|png|jpg|jpeg|gif|svg|mp4|mp3)$/i.test(fullUrl)) return
      // Skip already seen
      if (seen.has(fullUrl)) return
      seen.add(fullUrl)
      discovered.push(fullUrl)
    })
  } catch {
    // Link discovery is best-effort
  }
  return discovered.slice(0, 30)
}

/**
 * Try multiple paths for a page type, return the first that succeeds.
 */
async function tryPaths(
  baseUrl: string,
  paths: string[],
  pageType: ScrapedPage['pageType'],
  maxChars: number,
): Promise<ScrapedPage | null> {
  const base = new URL(baseUrl)
  for (const path of paths) {
    base.pathname = path
    const result = await scrapeSinglePage(base.toString(), pageType, maxChars)
    if (result && result.bodyText.length > 100) return result
  }
  return null
}

/**
 * Multi-page website scraper with retry logic, sitemap discovery, and expanded paths.
 * Returns detailed scrape status for each page attempted.
 */
export async function scrapeWebsiteMultiPage(url: string): Promise<ScrapedWebsite | null> {
  try {
    const pagesAttempted: { url: string; pageType: string; status: string }[] = []

    // Phase 1: Scrape known page types in parallel (increased char limits)
    const [homePage, aboutPage, servicesPage, blogPage, testimonialPage, teamPage, faqPage, podcastPage, visual] = await Promise.all([
      scrapeSinglePage(url, 'home', 8000),
      tryPaths(url, ABOUT_PATHS, 'about', 5000),
      tryPaths(url, SERVICES_PATHS, 'services', 5000),
      tryPaths(url, BLOG_PATHS, 'blog', 3000),
      tryPaths(url, TESTIMONIAL_PATHS, 'testimonials', 4000),
      tryPaths(url, TEAM_PATHS, 'team', 3000),
      tryPaths(url, FAQ_PATHS, 'faq', 3000),
      tryPaths(url, PODCAST_PATHS, 'podcast', 3000),
      extractVisualIdentity(url),
    ])

    // Track what was attempted
    pagesAttempted.push({ url, pageType: 'home', status: homePage ? 'success' : 'failed' })
    pagesAttempted.push({ url: `${url}/about*`, pageType: 'about', status: aboutPage ? 'success' : 'not_found' })
    pagesAttempted.push({ url: `${url}/services*`, pageType: 'services', status: servicesPage ? 'success' : 'not_found' })
    pagesAttempted.push({ url: `${url}/blog*`, pageType: 'blog', status: blogPage ? 'success' : 'not_found' })
    pagesAttempted.push({ url: `${url}/testimonials*`, pageType: 'testimonials', status: testimonialPage ? 'success' : 'not_found' })
    pagesAttempted.push({ url: `${url}/team*`, pageType: 'team', status: teamPage ? 'success' : 'not_found' })
    pagesAttempted.push({ url: `${url}/faq*`, pageType: 'faq', status: faqPage ? 'success' : 'not_found' })
    pagesAttempted.push({ url: `${url}/podcast*`, pageType: 'podcast', status: podcastPage ? 'success' : 'not_found' })

    const pages: ScrapedPage[] = []
    if (homePage) pages.push(homePage)
    if (aboutPage) pages.push(aboutPage)
    if (servicesPage) pages.push(servicesPage)
    if (blogPage) pages.push(blogPage)
    if (testimonialPage) pages.push(testimonialPage)
    if (teamPage) pages.push(teamPage)
    if (faqPage) pages.push(faqPage)
    if (podcastPage) pages.push(podcastPage)

    // Phase 2: If we got very few pages, try sitemap discovery
    if (pages.length < 3) {
      const sitemapUrls = await discoverFromSitemap(url)
      if (sitemapUrls.length > 0) {
        // Scrape up to 3 additional relevant pages from sitemap
        const relevantKeywords = ['about', 'service', 'team', 'testimon', 'case-stud', 'faq', 'pricing', 'podcast', 'blog']
        const relevantUrls = sitemapUrls.filter(u =>
          relevantKeywords.some(kw => u.toLowerCase().includes(kw)) &&
          !pages.some(p => p.url === u)
        ).slice(0, 3)

        for (const sitemapUrl of relevantUrls) {
          const page = await scrapeSinglePage(sitemapUrl, 'other', 3000)
          if (page && page.bodyText.length > 100) {
            pages.push(page)
            pagesAttempted.push({ url: sitemapUrl, pageType: 'sitemap-discovered', status: 'success' })
          }
        }
      }
    }

    // Phase 3: Discover from nav/footer links if still few pages
    if (pages.length < 4 && homePage) {
      const homeHtml = await fetchWithRetry(url)
      if (homeHtml) {
        const navUrls = await discoverFromLinks(url, homeHtml)
        const unscrapedUrls = navUrls.filter(u => !pages.some(p => p.url === u)).slice(0, 3)
        for (const navUrl of unscrapedUrls) {
          const page = await scrapeSinglePage(navUrl, 'other', 3000)
          if (page && page.bodyText.length > 100) {
            pages.push(page)
            pagesAttempted.push({ url: navUrl, pageType: 'nav-discovered', status: 'success' })
          }
        }
      }
    }

    if (pages.length === 0) return null

    const totalChars = pages.reduce((sum, p) => sum + p.charCount, 0)

    return { pages, pagesAttempted, visual, totalChars }
  } catch {
    return null
  }
}

// ─── YouTube Fetching (API + Fallback) ───────────────────────────

/**
 * HTML-based YouTube scraper (fallback when no API key).
 */
export async function scrapeYouTubeFallback(url: string): Promise<ScrapedYouTube | null> {
  try {
    const channelUrl = url.replace(/\/$/, '')

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
    const $ = cheerio.load(html)
    const channelName = $('meta[property="og:title"]').attr('content') ||
                        $('title').text().replace(' - YouTube', '').trim()
    const description = $('meta[property="og:description"]').attr('content') ||
                        $('meta[name="description"]').attr('content') || ''

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
        // JSON parse failed
      }
    }

    if (recentVideoTitles.length === 0) {
      const titleRegex = /"title":\{"runs":\[\{"text":"([^"]+)"\}/g
      let match: RegExpExecArray | null
      while ((match = titleRegex.exec(html)) !== null) {
        if (match[1] && !recentVideoTitles.includes(match[1]) && match[1].length < 200) {
          recentVideoTitles.push(match[1])
        }
      }
    }

    return { channelName, description, recentVideoTitles: recentVideoTitles.slice(0, 20) }
  } catch {
    return null
  }
}

/**
 * Fetch YouTube data — tries API first, falls back to HTML scraping.
 */
export async function fetchYouTubeData(url: string): Promise<YouTubeResult | null> {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (apiKey && apiKey !== 'your-youtube-api-key-here') {
    const apiResult = await fetchYouTubeViaAPI(url, apiKey)
    if (apiResult) {
      return { type: 'api', formatted: apiResult.formatted, raw: apiResult.raw }
    }
  }

  // Fallback to HTML scraping
  const fallback = await scrapeYouTubeFallback(url)
  if (!fallback) return null

  const formatted = `### Channel Overview
- **Name:** ${fallback.channelName}
- **Description:** ${fallback.description}

### Recent Video Titles
${fallback.recentVideoTitles.map(t => `- ${t}`).join('\n')}

*Note: Limited data — YouTube API key not configured. Only video titles available.*`

  return { type: 'fallback', formatted, fallback }
}

// ─── Data Formatting ─────────────────────────────────────────────

/**
 * Format all scraped data into structured sections for the DNA prompt.
 * Enhanced with data quality indicators.
 */
export interface TranscriptForDNA {
  source: 'fathom' | 'youtube'
  title: string
  text: string
  summary?: string | null
  word_count: number
  relevance_tag: string
  recorded_at?: string | null
  metadata?: Record<string, unknown>
}

export function formatScrapedData(
  website: ScrapedWebsite | null,
  youtube: YouTubeResult | null,
  context?: string,
  transcript?: string,
  transcripts?: TranscriptForDNA[],
): string {
  const sections: string[] = []

  if (website) {
    const pageSections: string[] = []

    for (const page of website.pages) {
      const pageLabel = page.pageType === 'home' ? `Homepage — ${page.title}`
        : page.pageType === 'about' ? 'About Page'
        : page.pageType === 'services' ? 'Services / Offerings'
        : page.pageType === 'blog' ? 'Blog / Resources'
        : page.pageType === 'testimonials' ? 'Testimonials / Social Proof'
        : page.pageType === 'team' ? 'Team / Leadership'
        : page.pageType === 'faq' ? 'FAQ'
        : page.pageType === 'podcast' ? 'Podcast / Media'
        : `Additional Page — ${page.title}`

      pageSections.push(`### ${pageLabel}
**URL:** ${page.url}
${page.description ? `**Meta Description:** ${page.description}` : ''}

**Key Headings:**
${page.headings.slice(0, 15).map(h => `- ${h}`).join('\n')}

${page.ctas.length > 0 ? `**CTAs Found:** ${page.ctas.join(' | ')}` : ''}

**Page Content (${page.charCount.toLocaleString()} chars):**
${page.bodyText}`)
    }

    // Visual identity
    const vis = website.visual
    const visualParts: string[] = []
    if (vis.logoColors.length > 0) {
      visualParts.push(`**Brand Colors (from ${vis.colorSource === 'logo' ? 'logo' : vis.colorSource === 'og_image' ? 'brand image' : 'favicon'}):**`)
      for (const c of vis.logoColors) {
        visualParts.push(`  - ${c.hex} (${c.label || 'unknown'}, ${c.percentage}% of logo)`)
      }
      if (vis.logoUrl) visualParts.push(`**Logo Source:** ${vis.logoUrl}`)
    } else if (vis.colors.length > 0) {
      visualParts.push(`**Colors Detected (from CSS — less reliable):** ${vis.colors.join(', ')}`)
    }
    if (vis.fonts.length > 0) visualParts.push(`**Fonts Detected:** ${vis.fonts.join(', ')}`)
    if (vis.socialLinks.length > 0) visualParts.push(`**Social Profiles:** ${vis.socialLinks.map(s => `${s.platform} (${s.url})`).join(', ')}`)
    if (vis.navItems.length > 0) visualParts.push(`**Navigation Structure:** ${vis.navItems.join(' | ')}`)

    sections.push(`## WEBSITE DATA
**Pages Scraped:** ${website.pages.length} pages (${website.pages.map(p => p.pageType).join(', ')})
**Total Content:** ${website.totalChars.toLocaleString()} characters
**Scrape Summary:** ${website.pagesAttempted.filter(p => p.status === 'success').length} succeeded, ${website.pagesAttempted.filter(p => p.status === 'not_found').length} not found, ${website.pagesAttempted.filter(p => p.status === 'failed').length} failed

${pageSections.join('\n\n---\n\n')}

${visualParts.length > 0 ? `### Visual Identity Signals\n${visualParts.join('\n')}` : ''}`)
  }

  if (youtube) {
    sections.push(`## YOUTUBE DATA
**Source:** ${youtube.type === 'api' ? 'YouTube Data API v3 (full metadata)' : 'HTML fallback (limited data)'}
${youtube.raw ? `**Videos Analyzed:** ${youtube.raw.videos.length}` : ''}
${youtube.raw ? `**Videos with Descriptions:** ${youtube.raw.videos.filter(v => v.description.length > 10).length}` : ''}
${youtube.raw ? `**Videos with Tags:** ${youtube.raw.videos.filter(v => v.tags.length > 0).length}` : ''}

${youtube.formatted}`)
  }

  if (context) {
    sections.push(`## ADDITIONAL CONTEXT (provided by team)
${context}`)
  }

  // Auto-pulled transcripts (Fathom meetings + YouTube videos)
  if (transcripts && transcripts.length > 0) {
    const fathomTranscripts = transcripts.filter(t => t.source === 'fathom')
    const ytTranscripts = transcripts.filter(t => t.source === 'youtube')
    const totalTranscriptWords = transcripts.reduce((sum, t) => sum + t.word_count, 0)

    const transcriptParts: string[] = []
    transcriptParts.push(`## MEETING & VIDEO TRANSCRIPTS
**Sources:** ${fathomTranscripts.length ? `${fathomTranscripts.length} Fathom meeting${fathomTranscripts.length > 1 ? 's' : ''}` : ''}${fathomTranscripts.length && ytTranscripts.length ? ', ' : ''}${ytTranscripts.length ? `${ytTranscripts.length} YouTube video${ytTranscripts.length > 1 ? 's' : ''}` : ''} (${totalTranscriptWords.toLocaleString()} total words)
**Note:** These are REAL transcripts from actual meetings and videos — weight them heavily for Voice Fingerprint and strategy insights.`)

    for (const t of transcripts) {
      const label = t.source === 'fathom'
        ? `[FATHOM — ${t.relevance_tag.replace('_', ' ')}] ${t.title || 'Untitled Meeting'}`
        : `[YOUTUBE${t.metadata?.view_count ? ` — ${Number(t.metadata.view_count).toLocaleString()} views` : ''}] ${t.title || 'Untitled Video'}`

      const date = t.recorded_at ? new Date(t.recorded_at).toLocaleDateString() : ''

      let entry = `### ${label}${date ? ` (${date})` : ''}\n`
      if (t.summary) {
        entry += `**AI Summary:** ${t.summary.slice(0, 1000)}\n\n`
      }
      // Cap individual transcripts at 5000 chars to stay within budget
      entry += `**Transcript (${t.word_count.toLocaleString()} words):**\n${t.text.slice(0, 5000)}`
      if (t.text.length > 5000) entry += '\n[...truncated for length]'

      transcriptParts.push(entry)
    }

    sections.push(transcriptParts.join('\n\n'))
  }

  // Manual transcript (backward compat — used when no auto-transcripts available)
  if (transcript) {
    const wordCount = transcript.split(/\s+/).length
    sections.push(`## MANUAL TRANSCRIPT (provided by team)
**Word Count:** ${wordCount.toLocaleString()} words
${transcript.slice(0, 15000)}`)
  }

  // Add data quality summary
  const fathomCount = transcripts?.filter(t => t.source === 'fathom').length || 0
  const ytTranscriptCount = transcripts?.filter(t => t.source === 'youtube').length || 0
  const totalTranscriptWords = transcripts?.reduce((sum, t) => sum + t.word_count, 0) || 0

  const totalWords = sections.join(' ').split(/\s+/).length
  sections.unshift(`## DATA QUALITY SUMMARY
**Total Source Data:** ~${totalWords.toLocaleString()} words
**Sources Available:** ${[
    website ? `Website (${website.pages.length} pages)` : null,
    youtube ? `YouTube (${youtube.type === 'api' ? 'full API data' : 'limited fallback'})` : null,
    fathomCount > 0 ? `Fathom Meetings (${fathomCount} calls, ${totalTranscriptWords.toLocaleString()} words)` : null,
    ytTranscriptCount > 0 ? `YouTube Transcripts (${ytTranscriptCount} videos)` : null,
    context ? 'Team Context' : null,
    transcript ? 'Manual Transcript' : null,
  ].filter(Boolean).join(', ')}
**Sources Missing:** ${[
    !website ? 'Website' : null,
    !youtube ? 'YouTube' : null,
    fathomCount === 0 && !transcript ? 'Meeting Transcripts (Fathom or manual)' : null,
    ytTranscriptCount === 0 ? 'Video Transcripts' : null,
    !context ? 'Team Context' : null,
  ].filter(Boolean).join(', ') || 'None'}`)

  return sections.join('\n\n---\n\n')
}
