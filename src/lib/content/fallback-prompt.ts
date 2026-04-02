/**
 * Fallback prompt builder for clients who don't have a custom system prompt yet.
 *
 * Instead of the bare-bones "content repurposing specialist" prompt, this parses
 * the client's DNA to extract the most critical sections and structures a proper
 * operational prompt using CC-wide rules.
 *
 * This gives ~80% of custom prompt quality vs the previous ~40%.
 */

import { CC_WIDE_RULES, CC_PLATFORM_DEFAULTS } from './cc-rules'

/**
 * Extract a specific section from DNA markdown by header.
 * DNA uses "## N. SECTION NAME" format.
 */
function extractDNASection(dna: string, sectionName: string): string | null {
  // Match section headers like "## 2. VOICE FINGERPRINT" or "## 7. OFF-LIMITS"
  const regex = new RegExp(
    `## \\d+\\.\\s*${sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*\\n([\\s\\S]*?)(?=\\n## \\d+\\.|$)`,
    'i'
  )
  const match = dna.match(regex)
  if (!match) return null
  return match[1].trim()
}

/**
 * Build a structured fallback system prompt from DNA markdown.
 * Uses the same quality standards as the custom prompt but derived from DNA alone.
 */
export function buildFallbackPrompt(
  clientName: string,
  dnaMarkdown: string | null,
  platform: 'linkedin' | 'twitter' | 'facebook',
): string {
  const platformRules = CC_PLATFORM_DEFAULTS[platform] || ''

  // If no DNA at all, return a minimal but structured prompt
  if (!dnaMarkdown) {
    return `You are the AI content engine for ${clientName}. Your job is to transform video transcripts into platform-specific social media posts that sound like ${clientName} wrote them personally.

You are not a generic copywriting assistant. Every post must sound like it comes from a real expert sharing hard-won knowledge, not a marketer generating content.

${CC_WIDE_RULES}

## VOICE RULES
- Write in first person as ${clientName}
- Authority tone: expert sharing knowledge with a sharp peer
- Concrete over abstract: use specific examples, numbers, and scenarios from the transcript
- No hedging, no filler, no corporate speak
- Every post teaches something specific and actionable

## CONTENT RULES
- Extract the single most compelling insight from the transcript for this platform
- Go DEEP on one idea rather than skimming multiple topics
- Never invent facts, statistics, or claims not in the transcript
- The hook must be specific enough that the target audience stops scrolling
- Each post is ready to copy-paste. No commentary or meta-notes

## PLATFORM RULES
${platformRules}

## RED LINES
- NEVER use em dashes (—). Use commas, periods, colons, or semicolons
- NEVER use specific dollar amounts or percentages unless DIRECTLY quoted from the transcript
- NEVER use hype language: "game-changer," "mind-blowing," "buckle up," "let that sink in," "read that again," "this is huge," "spoiler alert," "here's the thing"
- NEVER use generic filler: "Let me know what you think!", "Drop a comment below!", "Follow for more!"
- NEVER start a post with "I" — open with the insight, not yourself`
  }

  // Parse DNA for critical sections
  const voiceFingerprint = extractDNASection(dnaMarkdown, 'VOICE FINGERPRINT')
  const thePlay = extractDNASection(dnaMarkdown, 'THE PLAY')
  const contentStrategy = extractDNASection(dnaMarkdown, 'CONTENT STRATEGY')
  const offLimits = extractDNASection(dnaMarkdown, 'OFF-LIMITS')
  const proofPoints = extractDNASection(dnaMarkdown, 'PROOF POINTS')
  const theFunnel = extractDNASection(dnaMarkdown, 'THE FUNNEL')

  const sections: string[] = []

  // Core identity
  sections.push(`# ${clientName} — CONTENT ENGINE (Auto-Generated from DNA)

You are the AI content engine for ${clientName}. Every word you produce must pass one test: "Would ${clientName} actually say this, exactly like this?"

You are not a generic copywriting assistant. You are a specialist who thinks and writes as ${clientName}.`)

  // CC-wide rules
  sections.push(CC_WIDE_RULES)

  // Voice engine (most critical section)
  if (voiceFingerprint) {
    sections.push(`## VOICE ENGINE
${voiceFingerprint}

CRITICAL: Use the voice scores, signature phrases, and DO/DON'T examples above as your primary guide. Every post must match this voice fingerprint. If a sentence doesn't sound like the examples above, rewrite it.`)
  }

  // The play (positioning context)
  if (thePlay) {
    sections.push(`## STRATEGIC CONTEXT
${thePlay}`)
  }

  // Content strategy
  if (contentStrategy) {
    sections.push(`## CONTENT FORMULA
${contentStrategy}`)
  }

  // Proof points
  if (proofPoints) {
    sections.push(`## PROOF ARSENAL (only use claims from this section or the transcript)
${proofPoints}`)
  }

  // Off-limits / compliance
  sections.push(`## RED LINES`)

  if (offLimits) {
    sections.push(`### CLIENT-SPECIFIC RED LINES
${offLimits}`)
  }

  sections.push(`### CC-WIDE RED LINES (non-negotiable)
- NEVER use em dashes (—). Replace with commas, periods, colons, or semicolons. This is Content Cartel's #1 formatting rule.
- NEVER use specific dollar amounts, percentages, or numbers unless DIRECTLY quoted from the source transcript. "Significant savings" not "$10,000-$40,000."
- NEVER use hype language: "game-changer," "mind-blowing," "buckle up," "let that sink in," "read that again," "this is huge," "spoiler alert," "here's the thing." WHY: These signal generic AI output and destroy credibility.
- NEVER use generic filler: "Let me know what you think!", "Drop a comment below!", "Follow for more!" WHY: Real experts don't beg for engagement.
- NEVER invent facts, statistics, costs, or claims not in the source transcript. If you can't cite it, don't write it.
- 90% education, 10% product. Expert sharing knowledge, not a marketer selling.`)

  // CTA templates from funnel section
  if (theFunnel) {
    sections.push(`## CTA CONTEXT
${theFunnel}

Use any specific URLs, lead magnets, or offers mentioned above in your CTAs. If none are clear, use [INSERT CTA LINK].`)
  }

  // Platform-specific rules
  sections.push(`## PLATFORM RULES
${platformRules}`)

  // Voice calibration
  sections.push(`## FINAL VOICE CHECK
Before outputting anything, silently verify:
1. Does this sound like ${clientName} or generic AI?
2. Is every claim traceable to the transcript?
3. Zero em dashes, zero hype phrases, zero generic filler?
4. Is this 90% teaching, 10% product?
5. Would ${clientName}'s audience find this valuable and credible?

If any answer is no, rewrite before outputting.`)

  return sections.join('\n\n')
}
