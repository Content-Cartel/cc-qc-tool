/**
 * Distinct-angle extraction for transcript-grounded post generation.
 *
 * When we generate N posts in parallel from the same transcript with the same
 * system prompt, Claude converges on the same "best" angle every time —
 * resulting in duplicate posts. To avoid that, we pre-extract N distinct
 * angles from the transcript via a single Haiku call, then assign one angle
 * per post as a focused hint in the user prompt.
 *
 * Cost: ~$0.001 per transcript (Haiku is cheap). Net effect: 14 posts from
 * the same transcript each start from a different takeaway.
 */

import Anthropic from '@anthropic-ai/sdk'

export interface Angle {
  /** One-sentence takeaway — the specific insight this post should land. */
  takeaway: string
  /** The supporting quote from the transcript that anchors the angle. */
  anchor: string | null
  /** Suggested hook or opening framing. */
  hook: string | null
}

function buildAnglePrompt(count: number, complianceRules: string | null): string {
  const complianceBlock = complianceRules && complianceRules.trim()
    ? `

═══ CLIENT COMPLIANCE RULES (ABSOLUTE) ═══

The angles you propose will seed ${count} social media posts that must obey these client-specific rules. DO NOT propose angles that would require the downstream post to violate a rule. If the transcript leans heavily on a banned frame (e.g., "constitutional originalism" or "war on savers" when banned), REFRAME the angle around a compliant alternative the rule specifies — don't just copy the speaker's banned frame.

THE RULES:

${complianceRules.trim()}

End of client rules. Every angle you propose below must be compatible with them.

═══════════════════════════════════════`
    : ''

  return `You are an angle miner for Content Cartel's transcript-grounded post generator.

Given a transcript, extract ${count} DISTINCT post angles. Each angle is one specific takeaway or insight that could form the basis of one social media post.

The ${count} angles MUST be meaningfully different from each other — different topics, different framings, different hooks. Together they should cover the full range of the transcript, not overlap. Duplicates will cause downstream posts to converge, which is the exact problem this extraction is solving.${complianceBlock}

For each angle, emit exactly this shape (nothing else):

<angle>
TAKEAWAY: [one sentence — the specific insight, phrased concretely${complianceRules ? ', compliant with the rules above' : ''}]
ANCHOR: "[exact quote from the transcript that supports this angle, verbatim]"
HOOK: [one short phrase suggesting an opening framing${complianceRules ? ' — must be compliant with the rules above' : ''} — not the full hook]
</angle>

RULES:
- Emit exactly ${count} <angle> blocks. No more, no less.
- Each TAKEAWAY sentence must be concrete. No "the speaker discusses how..." — that's description, not an angle. An angle is an INSIGHT the post could deliver.
- Each ANCHOR must be a verbatim phrase or sentence from the transcript. If no clear anchor exists, use the closest paraphrase with "[PARA]" prepended.
- Each HOOK suggestion should be a specific opening idea, not a category. "A counter-intuitive take on carrying costs" is a hook. "Financial content" is not.
- Angles can share topical DNA but must differ on framing, implication, or audience. (Same topic, different angle is fine. Same angle twice is the failure mode.)
- If the transcript genuinely does not support ${count} distinct angles, prioritize distinctness over quantity — duplicates are worse than fewer angles.${complianceRules ? '\n- If multiple angles would all lean on a banned frame, REPLACE some with angles using compliant frames (even if less dominant in the transcript).' : ''}

Emit only the <angle> blocks. No preamble. No commentary. Nothing else.`
}

function parseAngles(raw: string): Angle[] {
  const matches = raw.matchAll(/<angle>([\s\S]*?)<\/angle>/gi)
  const angles: Angle[] = []
  for (const m of matches) {
    const body = m[1]
    const takeaway = body.match(/TAKEAWAY:\s*(.+)/i)?.[1]?.trim() || ''
    const anchor = body.match(/ANCHOR:\s*(.+)/i)?.[1]?.trim() || null
    const hook = body.match(/HOOK:\s*(.+)/i)?.[1]?.trim() || null
    if (takeaway) {
      angles.push({ takeaway, anchor: anchor || null, hook: hook || null })
    }
  }
  return angles
}

/**
 * Format an angle as a short string for inclusion in the generation user prompt.
 * Kept compact — the transcript itself does most of the work; this is just a
 * steering signal.
 */
export function formatAngleForPrompt(angle: Angle): string {
  const parts = [angle.takeaway]
  if (angle.anchor) parts.push(`Anchor quote: ${angle.anchor}`)
  if (angle.hook) parts.push(`Hook direction: ${angle.hook}`)
  return parts.join('\n')
}

/**
 * Extract `count` distinct angles from a transcript via one Haiku call.
 * Returns an empty array on failure — the caller should fall back to
 * running without angle hints rather than blocking generation.
 */
export async function extractDistinctAngles(
  transcriptText: string,
  transcriptTitle: string,
  count: number,
  apiKey: string,
  complianceRules: string | null = null,
): Promise<Angle[]> {
  if (!transcriptText || transcriptText.trim().length < 100 || count < 1) {
    return []
  }

  try {
    const anthropic = new Anthropic({ apiKey })
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      // Rough budget: 14 angles × ~120 tokens each + overhead = 2k-ish; set 3k for safety.
      max_tokens: 3000,
      system: buildAnglePrompt(count, complianceRules),
      messages: [
        {
          role: 'user',
          content: `Transcript: "${transcriptTitle}"\n\n---\n${transcriptText}\n---\n\nExtract exactly ${count} distinct <angle> blocks following the format and rules above.`,
        },
      ],
    })

    const content = response.content[0]?.type === 'text' ? response.content[0].text : ''
    const angles = parseAngles(content)
    return angles
  } catch (err) {
    console.error(`[angle-extractor] Haiku extraction failed for "${transcriptTitle}":`, err)
    return []
  }
}
