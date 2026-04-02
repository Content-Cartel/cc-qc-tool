/**
 * Content Cartel-wide rules that apply to ALL clients.
 * Single source of truth for formatting, compliance, and platform defaults.
 */

export const CC_BANNED_WORDS = [
  'game-changer', 'mind-blowing', 'amazing deal', 'limited time',
  'you won\'t believe', 'shocking', 'insane value', 'act now',
  'once in a lifetime', 'don\'t miss out',
]

/**
 * Hype phrases that get filtered out of ALL output.
 * These are common AI-generated filler that sounds robotic.
 */
const HYPE_PATTERNS = [
  /zero emotion\.?\s*zero hype\.?/gi,
  /no emotion\.?\s*no hype\.?/gi,
  /there'?s zero emotion\.?/gi,
  /zero hype\.?/gi,
  /game[- ]chang(er|ing)/gi,
  /mind[- ]blow(ing|n)/gi,
  /here'?s the thing:?\s*/gi,
  /let that sink in\.?\s*/gi,
  /read that again\.?\s*/gi,
  /i'?ll say it again\.?\s*/gi,
  /this is huge\.?\s*/gi,
  /buckle up\.?\s*/gi,
  /spoiler alert:?\s*/gi,
]

/**
 * CC-wide post-processing applied to ALL generated content.
 * 1. Removes em dashes
 * 2. Strips hype phrases
 * 3. Removes specific dollar amounts, percentages, and numbers that could be inaccurate
 */
export function ccPostProcess(text: string): string {
  let cleaned = text

  // Remove internal checklist output that AI sometimes includes
  cleaned = cleaned.replace(/\*\*INTERNAL CHECKLIST[^]*?---\s*/gi, '')
  cleaned = cleaned.replace(/INTERNAL CHECKLIST[^]*?---\s*/gi, '')

  // Remove em dashes
  cleaned = cleaned.replace(/\s*—\s*/g, '. ')
  cleaned = cleaned.replace(/\.\.\s/g, '. ')
  cleaned = cleaned.replace(/,\.\s/g, ', ')

  // Strip hype phrases
  for (const pattern of HYPE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '')
  }

  // Clean up double spaces and empty lines from removals
  cleaned = cleaned.replace(/  +/g, ' ')
  cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n')

  return cleaned.trim()
}

export const CC_WIDE_RULES = `
CONTENT CARTEL UNIVERSAL RULES (apply to EVERY client, EVERY output):
1. NEVER use em dashes (the character). Replace with commas, periods, colons, or semicolons. Non-negotiable.
2. 90% education, 10% product. If it reads like a sales pitch, rewrite it as a teaching moment.
3. Authority tone always. Expert sharing hard-won knowledge, not a marketer selling. Write as a practitioner, not a commentator.
4. NEVER invent facts, statistics, costs, or claims not present in the source transcript.
5. NEVER use specific dollar amounts, percentages, or numbers unless they are DIRECTLY quoted from the transcript. If the client says "$150,000" in the video, you can use it. If you're estimating or generalizing, do NOT use specific numbers. Use language like "significant tax savings" instead of "$10,000 to $40,000." This protects every client from inaccurate claims.
6. NO emojis on LinkedIn. Minimal elsewhere.
7. NO hashtags on LinkedIn. 1-2 max on X and Facebook.
8. Each platform post covers a DIFFERENT angle from the same transcript. Never reformat the same idea.
9. Posts must be ready to copy-paste. No meta-commentary, no "here's the post" preamble.
10. Hook must be specific enough that the target audience stops scrolling.
11. NEVER use generic filler: "Let me know what you think!", "Drop a comment below!", "Follow for more!"
12. NEVER use hype language: "zero emotion," "zero hype," "buckle up," "let that sink in," "read that again," "this is huge," "game-changer," "mind-blowing," "spoiler alert." These phrases make content sound like generic AI output. Write like a real expert, not a LinkedIn influencer.
`.trim()

export const CC_PLATFORM_DEFAULTS = {
  linkedin: `LinkedIn Post Rules:
- 1,500-2,500 characters (long-form educational, NOT short fluff)
- Bold counterintuitive hook (1-2 sentences max)
- Short paragraphs (1-3 sentences each) separated by line breaks
- NO bullet points, NO numbered lists in the post body
- NO hashtags, NO emojis
- NEVER use em dashes
- NEVER use specific numbers unless directly from the transcript
- NEVER use hype phrases (zero hype, buckle up, let that sink in, etc.)
- End with CTA offering something free and valuable
- After CTA, add a P.S. section addressing a common objection
- Structure: Hook > Education (3-5 paragraphs) > CTA with link > P.S.`,

  twitter: `X (Twitter) Post Rules:
- 280 characters max for single tweet, or 3-5 tweet thread
- First tweet is the strongest hook
- Each tweet stands alone but flows as narrative
- Punchy, direct. No filler. NEVER use em dashes
- NEVER use specific numbers unless directly from the transcript
- 1-2 hashtags max`,

  facebook: `Facebook Post Rules:
- 100-250 words, conversational and relatable
- Tell a mini-story or share a lesson
- More casual than LinkedIn but still authoritative
- NEVER use em dashes
- NEVER use specific numbers unless directly from the transcript
- Question at end to encourage comments
- No hashtags (or 1-2 max)`,
}
