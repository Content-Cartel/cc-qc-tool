/**
 * Logo-based brand color extraction.
 * Finds the logo on a website, downloads it, and extracts dominant colors using sharp.
 */

import sharp from 'sharp'
import * as cheerio from 'cheerio'

interface ExtractedColors {
  colors: { hex: string; percentage: number; label?: string }[]
  logoUrl: string | null
  method: 'logo' | 'og_image' | 'favicon' | 'css_fallback'
}

const LOGO_SELECTORS = [
  // Highest priority: explicit logo elements (NOT social media icons)
  'header img[class*="logo"]:not([class*="social"])',
  'header img[id*="logo"]:not([class*="social"])',
  'nav img[class*="logo"]:not([class*="social"])',
  '.navbar-brand img',
  '.site-logo img',
  '.header-logo img',
  '.custom-logo',
  'a[class*="logo"]:not([class*="social"]) img',
  '#logo img',
  '.logo:not([class*="social"]) img',
  // Images with logo in src/alt (but not social)
  'header img[src*="logo"]',
  'nav img[src*="logo"]',
  // First image in header/nav (common for text+logo sites)
  'header a:first-of-type img',
  'nav a:first-of-type img',
  // Generic logo selectors (lower priority)
  'img[class*="logo"]:not([class*="social"]):not([class*="network"])',
  'img[id*="logo"]:not([class*="social"])',
  'img[alt*="logo" i]:not([class*="social"]):not([class*="network"])',
]

/**
 * Check if a URL is likely a social media icon (not the actual brand logo).
 */
function isSocialMediaIcon(url: string, className?: string): boolean {
  const lower = (url + ' ' + (className || '')).toLowerCase()
  const socialKeywords = ['social', 'facebook', 'twitter', 'youtube', 'instagram', 'tiktok', 'linkedin', 'pinterest', 'threads', 'rumble', 'spotify']
  return socialKeywords.some(kw => lower.includes(kw))
}

/**
 * Convert RGB to HSL for better color analysis.
 */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0, s = 0

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }

  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) }
}

/**
 * Check if a color is "boring" (near white, near black, or very desaturated gray).
 */
function isBoringColor(r: number, g: number, b: number): boolean {
  const { s, l } = rgbToHsl(r, g, b)
  // Near white
  if (l > 92) return true
  // Near black
  if (l < 8) return true
  // Very desaturated gray
  if (s < 5 && l > 20 && l < 80) return true
  return false
}

/**
 * Convert RGB to hex.
 */
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

/**
 * Label a color based on its HSL values.
 */
function labelColor(r: number, g: number, b: number): string {
  const { h, s, l } = rgbToHsl(r, g, b)
  if (l > 85) return 'light'
  if (l < 15) return 'dark'
  if (s < 15) return 'neutral'

  // Hue-based labels
  if (h < 15 || h >= 345) return 'red'
  if (h < 45) return 'orange'
  if (h < 70) return 'yellow'
  if (h < 160) return 'green'
  if (h < 200) return 'cyan'
  if (h < 260) return 'blue'
  if (h < 300) return 'purple'
  return 'pink'
}

/**
 * Extract dominant colors from an image buffer using k-means-style pixel sampling.
 * We don't need a full k-means library — just sample pixels and cluster by proximity.
 */
async function extractDominantColors(imageBuffer: Buffer): Promise<{ hex: string; percentage: number; label: string }[]> {
  // Resize to small size for fast processing, force to sRGB
  const { data, info } = await sharp(imageBuffer)
    .resize(100, 100, { fit: 'cover' })
    .removeAlpha() // Remove transparency — we don't want transparent pixels
    .raw()
    .toBuffer({ resolveWithObject: true })

  const pixels: { r: number; g: number; b: number }[] = []
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    // Skip boring colors (white, black, gray backgrounds)
    if (!isBoringColor(r, g, b)) {
      pixels.push({ r, g, b })
    }
  }

  if (pixels.length === 0) {
    // If all pixels were "boring," just return the most common non-white/black colors
    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i], g = data[i + 1], b = data[i + 2]
      const { l } = rgbToHsl(r, g, b)
      if (l > 8 && l < 92) pixels.push({ r, g, b })
    }
  }

  if (pixels.length === 0) return []

  // Simple clustering: bucket pixels by quantized color (reduce to 4-bit per channel)
  const buckets = new Map<string, { r: number; g: number; b: number; count: number }>()

  for (const px of pixels) {
    // Quantize to reduce color space
    const qr = Math.round(px.r / 16) * 16
    const qg = Math.round(px.g / 16) * 16
    const qb = Math.round(px.b / 16) * 16
    const key = `${qr}-${qg}-${qb}`

    const existing = buckets.get(key)
    if (existing) {
      existing.r = Math.round((existing.r * existing.count + px.r) / (existing.count + 1))
      existing.g = Math.round((existing.g * existing.count + px.g) / (existing.count + 1))
      existing.b = Math.round((existing.b * existing.count + px.b) / (existing.count + 1))
      existing.count++
    } else {
      buckets.set(key, { r: px.r, g: px.g, b: px.b, count: 1 })
    }
  }

  // Sort by frequency, take top colors
  const sorted = Array.from(buckets.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  const totalPixels = pixels.length

  // Merge colors that are very close together
  const merged: typeof sorted = []
  for (const color of sorted) {
    let foundMatch = false
    for (const existing of merged) {
      const dr = Math.abs(existing.r - color.r)
      const dg = Math.abs(existing.g - color.g)
      const db = Math.abs(existing.b - color.b)
      if (dr + dg + db < 60) { // Close enough to merge
        existing.count += color.count
        foundMatch = true
        break
      }
    }
    if (!foundMatch) merged.push({ ...color })
  }

  return merged
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map(c => ({
      hex: rgbToHex(c.r, c.g, c.b),
      percentage: Math.round((c.count / totalPixels) * 100),
      label: labelColor(c.r, c.g, c.b),
    }))
}

/**
 * Try to download an image and extract its colors.
 * Returns null if it fails for any reason.
 */
async function tryExtractFromUrl(
  imageUrl: string,
  baseUrl: string,
): Promise<{ hex: string; percentage: number; label: string }[] | null> {
  try {
    const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'image/*,*/*',
        'Referer': baseUrl,
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) return null

    const contentType = response.headers.get('content-type') || ''

    // SVGs — extract colors from source
    if (contentType.includes('svg') || imageUrl.endsWith('.svg')) {
      const svgText = await response.text()
      const svgColors = extractColorsFromSVG(svgText)
      return svgColors.length > 0 ? svgColors : null
    }

    // ICO files — sharp can't handle them, skip
    if (contentType.includes('x-icon') || imageUrl.endsWith('.ico')) {
      return null
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer())
    if (imageBuffer.length < 100) return null // Too small

    const colors = await extractDominantColors(imageBuffer)
    return colors.length > 0 ? colors : null
  } catch {
    return null
  }
}

/**
 * Main function: find logo on website and extract its colors.
 * Tries multiple image sources in priority order until one yields colors.
 */
export async function extractLogoColors(
  html: string,
  baseUrl: string,
): Promise<ExtractedColors> {
  const result: ExtractedColors = { colors: [], logoUrl: null, method: 'css_fallback' }
  const $ = cheerio.load(html)

  // Build a priority list of image URLs to try
  const candidates: { url: string; method: ExtractedColors['method'] }[] = []

  // 1. Explicit logo selectors (highest priority)
  for (const selector of LOGO_SELECTORS) {
    const el = $(selector).first()
    if (el.length) {
      const src = el.attr('src') || el.attr('data-src') || el.attr('srcset')?.split(' ')[0]
      const cls = el.attr('class') || ''
      if (src && !isSocialMediaIcon(src, cls)) {
        try {
          candidates.push({ url: new URL(src, baseUrl).toString(), method: 'logo' })
        } catch { /* skip */ }
      }
    }
  }

  // 2. Background images on logo-like elements
  const bgSelectors = ['.navbar-home-link', '.navbar_home_link', '.logo', '#logo', '.site-branding', 'header a:first-of-type']
  for (const sel of bgSelectors) {
    const el = $(sel).first()
    if (el.length) {
      const style = el.attr('style') || ''
      const bgMatch = style.match(/background-image:\s*url\(['"]?([^'")\s]+)['"]?\)/)
      if (bgMatch) {
        try {
          candidates.push({ url: new URL(bgMatch[1], baseUrl).toString(), method: 'logo' })
        } catch { /* skip */ }
      }
    }
  }

  // 3. Apple touch icon (usually 180x180, great for colors)
  const touchIcon = $('link[rel="apple-touch-icon"]').attr('href') ||
                    $('link[rel="apple-touch-icon-precomposed"]').attr('href')
  if (touchIcon) {
    try { candidates.push({ url: new URL(touchIcon, baseUrl).toString(), method: 'favicon' }) } catch { /* skip */ }
  }

  // 4. Large favicons (PNG)
  const faviconSizes = ['192x192', '180x180', '152x152', '144x144', '128x128', '96x96']
  for (const size of faviconSizes) {
    const icon = $(`link[rel*="icon"][sizes="${size}"]`).attr('href')
    if (icon) {
      try { candidates.push({ url: new URL(icon, baseUrl).toString(), method: 'favicon' }) } catch { /* skip */ }
    }
  }

  // 5. Any PNG/SVG favicon (skip ICO)
  $('link[rel*="icon"]').each((_, el) => {
    const href = $(el).attr('href') || ''
    if (href && !href.endsWith('.ico')) {
      try { candidates.push({ url: new URL(href, baseUrl).toString(), method: 'favicon' }) } catch { /* skip */ }
    }
  })

  // 6. og:image (last resort — often a content image, but usually on-brand)
  const ogImage = $('meta[property="og:image"]').attr('content')
  if (ogImage) {
    try { candidates.push({ url: new URL(ogImage, baseUrl).toString(), method: 'og_image' }) } catch { /* skip */ }
  }

  // Try each candidate until we get colors
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (seen.has(candidate.url)) continue
    seen.add(candidate.url)

    const colors = await tryExtractFromUrl(candidate.url, baseUrl)
    if (colors && colors.length > 0) {
      result.colors = colors
      result.logoUrl = candidate.url
      result.method = candidate.method
      return result
    }
  }

  return result
}

/**
 * Extract colors from SVG source code.
 */
function extractColorsFromSVG(svgText: string): { hex: string; percentage: number; label: string }[] {
  const colors = new Set<string>()

  // Find fill and stroke colors
  const hexMatches = svgText.match(/(?:fill|stroke|stop-color|color)=["']#([0-9a-fA-F]{3,6})["']/g) || []
  for (const match of hexMatches) {
    const hex = match.match(/#([0-9a-fA-F]{3,6})/)
    if (hex) {
      let fullHex = hex[0].toLowerCase()
      // Expand 3-char hex to 6-char
      if (fullHex.length === 4) {
        fullHex = '#' + fullHex[1] + fullHex[1] + fullHex[2] + fullHex[2] + fullHex[3] + fullHex[3]
      }
      if (fullHex !== '#000000' && fullHex !== '#ffffff') {
        colors.add(fullHex)
      }
    }
  }

  // Also check style attributes and inline CSS
  const styleHexes = svgText.match(/(?:fill|stroke|stop-color|color):\s*#([0-9a-fA-F]{3,6})/g) || []
  for (const match of styleHexes) {
    const hex = match.match(/#([0-9a-fA-F]{3,6})/)
    if (hex) {
      let fullHex = hex[0].toLowerCase()
      if (fullHex.length === 4) {
        fullHex = '#' + fullHex[1] + fullHex[1] + fullHex[2] + fullHex[2] + fullHex[3] + fullHex[3]
      }
      if (fullHex !== '#000000' && fullHex !== '#ffffff') {
        colors.add(fullHex)
      }
    }
  }

  return Array.from(colors).slice(0, 6).map(hex => {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return {
      hex,
      percentage: Math.round(100 / Math.max(colors.size, 1)),
      label: labelColor(r, g, b),
    }
  })
}
