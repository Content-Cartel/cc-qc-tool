import Anthropic from '@anthropic-ai/sdk'

export interface SpellingIssue {
  frame_timestamp_seconds: number
  detected_text: string
  issue_description: string
  suggested_fix: string
  confidence: number // 0-1
}

export interface FrameText {
  timestamp_seconds: number
  texts: string[] // All on-screen text elements detected in this frame
}

/**
 * Extract on-screen text from a video frame using Claude Vision.
 * Returns all visible text elements (lower thirds, titles, captions, name plates, URLs).
 */
export async function extractTextFromFrame(
  client: Anthropic,
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' = 'image/jpeg'
): Promise<string[]> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: imageBase64 },
          },
          {
            type: 'text',
            text: `Extract ALL on-screen text visible in this video frame. Include:
- Lower thirds (name plates, titles, job titles)
- On-screen titles or headings
- Captions or subtitles burned into the video
- URLs, social media handles
- Any other text overlays

Return ONLY the text elements, one per line. If there is no visible text overlay, return "NO_TEXT".
Do NOT describe the image. Only extract text exactly as it appears on screen.`,
          },
        ],
      },
    ],
  })

  const content = response.content[0]
  if (content.type !== 'text') return []

  const text = content.text.trim()
  if (text === 'NO_TEXT' || !text) return []

  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && line !== 'NO_TEXT')
}

/**
 * Check extracted on-screen text for spelling issues using client DNA context.
 * Compares against known correct spellings of names, company names, titles, etc.
 */
export async function checkSpelling(
  client: Anthropic,
  frameTexts: FrameText[],
  dnaExcerpt: string,
  clientName: string,
): Promise<SpellingIssue[]> {
  // Deduplicate text across frames, keeping earliest timestamp
  const textMap = new Map<string, number>()
  for (const frame of frameTexts) {
    for (const text of frame.texts) {
      const normalized = text.trim()
      if (!textMap.has(normalized)) {
        textMap.set(normalized, frame.timestamp_seconds)
      }
    }
  }

  if (textMap.size === 0) return []

  const textList = Array.from(textMap.entries())
    .map(([text, ts]) => `[${formatTimestamp(ts)}] "${text}"`)
    .join('\n')

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `You are a spelling checker for video production. Check the following on-screen text elements from a video for spelling errors.

CLIENT INFORMATION (correct spellings):
Client name: ${clientName}
${dnaExcerpt}

ON-SCREEN TEXT FOUND IN VIDEO:
${textList}

Check each text element for:
1. Misspelled names (person names, company names, product names)
2. Common English spelling mistakes
3. Incorrect capitalization of proper nouns
4. Wrong characters (e.g., "Ciaud" instead of "Claude")

IMPORTANT: Only flag genuine spelling issues. Do NOT flag:
- Stylistic choices (all caps, intentional abbreviations)
- Brand-specific formatting (camelCase, etc.)
- Social media handles or URLs

Return your findings as a JSON array. Each item should have:
- "timestamp": the timestamp string from the input
- "detected_text": the text as shown
- "issue": what's wrong
- "suggestion": the correct spelling
- "confidence": 0.0-1.0 (1.0 = definitely wrong, 0.5 = possibly wrong)

If no issues found, return an empty array: []

Return ONLY valid JSON, no other text.`,
      },
    ],
  })

  const content = response.content[0]
  if (content.type !== 'text') return []

  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = content.text.trim()
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) jsonStr = jsonMatch[1].trim()

    const results = JSON.parse(jsonStr) as Array<{
      timestamp: string
      detected_text: string
      issue: string
      suggestion: string
      confidence: number
    }>

    return results.map(r => ({
      frame_timestamp_seconds: parseTimestamp(r.timestamp),
      detected_text: r.detected_text,
      issue_description: r.issue,
      suggested_fix: r.suggestion,
      confidence: Math.max(0, Math.min(1, r.confidence)),
    }))
  } catch {
    console.error('[spelling] Failed to parse Claude response:', content.text.slice(0, 200))
    return []
  }
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function parseTimestamp(ts: string): number {
  const match = ts.match(/(\d+):(\d+)/)
  if (!match) return 0
  return parseInt(match[1]) * 60 + parseInt(match[2])
}
