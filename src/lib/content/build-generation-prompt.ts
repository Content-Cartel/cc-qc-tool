/**
 * Transcript-grounded prompt builder for the written-post generator.
 *
 * The system prompt enforces ONE rule above all others: every factual claim
 * in the generated post must come from the transcript. DNA/master prompt/
 * examples supply voice and style; the transcript supplies facts. The
 * mandatory <traceback> output lets humans audit this claim by claim.
 *
 * Block order in the system prompt is stability-first so prompt caching
 * works across repeat generations for the same client:
 *   1. Rule Zero (static, shared across all clients)
 *   2. Master prompt / voice spine (per-client, stable)
 *   3. Brand DNA (per-client, stable — Phase 3 Google Doc, Phase 1 legacy markdown)
 *   4. Platform rules (static per platform)
 *   5. Approved examples (stable per client-platform; empty in Phase 1)
 *   6. Active corrections (Phase 4; empty in Phase 1)
 *   7. Output contract (static)
 *
 * The transcript lives in the USER message (volatile, not cached).
 */

import { CC_PLATFORM_DEFAULTS } from './cc-rules'

export type Platform = 'linkedin' | 'twitter' | 'facebook'

export interface ContentExampleRow {
  platform: string
  content: string
  title?: string | null
  published_at?: string | null
}

export interface GenerationInputs {
  clientName: string
  platform: Platform
  /** Preferred voice/compliance source — the per-client master prompt from client_prompts. */
  masterPrompt: string | null
  /** Phase 3: the fetched text of the client's DNA Google Doc. */
  dnaDocText: string | null
  /** Phase 1 legacy fallback: the client_dna.dna_markdown blob. Deprecated; removed in Phase 3. */
  dnaMarkdown: string | null
  /** Phase 4: rollup of active client_knowledge_entries (DO/DONT/corrections). */
  knowledgeNotes: string | null
  /** Hard-line per-client compliance rules (verbatim, from clients.compliance_rules).
   *  Rendered as RULE TWO in the system prompt; model must self-check against each line. */
  complianceRules: string | null
  /** Recent human-approved posts for the same platform. STYLE reference only. */
  recentApprovedPosts: ContentExampleRow[]
  /** REQUIRED. The transcript the post must draw its facts from. */
  transcriptText: string
  transcriptTitle: string
  /** True if the transcript was pre-extracted via Haiku (>15K chars). Informational. */
  wasExtracted: boolean
  /** Optional distinct-angle hint for this specific post, from pre-extraction.
   *  When provided, steers the post toward one specific takeaway so parallel posts
   *  from the same transcript don't converge to duplicates. */
  angle?: string | null
  /** 1-based index of this post within its batch + total count, used in the
   *  user prompt to give the model awareness that siblings exist. Optional. */
  postIndex?: number
  postTotal?: number
}

const PLATFORM_LABEL: Record<Platform, string> = {
  linkedin: 'LinkedIn',
  twitter: 'X (Twitter)',
  facebook: 'Facebook',
}

const PLATFORM_CHAR_RANGE: Record<Platform, string> = {
  linkedin: '1,500 to 2,500 characters',
  twitter: 'either a single tweet under 280 characters OR a 3–5 tweet thread',
  facebook: '100 to 250 words',
}

export class MissingTranscriptError extends Error {
  constructor() {
    super('Transcript is required. No transcript, no post — this generator refuses to invent facts from DNA or prompt alone.')
    this.name = 'MissingTranscriptError'
  }
}

export class MissingVoiceError extends Error {
  constructor(clientName: string) {
    super(`No voice instructions available for ${clientName}: missing masterPrompt, dnaDocText, and dnaMarkdown. Generate a master prompt via /api/content/generate-prompt, or link a DNA Doc first.`)
    this.name = 'MissingVoiceError'
  }
}

function buildRuleZero(clientName: string, platform: Platform): string {
  return `You are the voice engine for ${clientName}. Your ONE job: reshape what the speaker actually said on the transcript into a ${PLATFORM_LABEL[platform]} post.

═══ RULE ZERO — READ BEFORE ANYTHING ELSE ═══

Every factual claim in your output — every number, dollar amount, statistic, name, date, quote, anecdote, case study, client story, or example — MUST come from the TRANSCRIPT section in the user message. Nothing else is a valid source of facts.

If the transcript doesn't support a claim, don't make it. Paraphrase the speaker loosely instead. When in doubt, leave it out.

═══ RULE ONE — VOICE MIRRORS THE TRANSCRIPT ═══

The transcript is also the source of TONE. The post should sound the way the speaker actually sounded on that video — their cadence, their register, their vocabulary, their pacing. If they're casual and loose, write casual and loose. If they're formal and authoritative, write formal and authoritative. If they use specific phrasings, metaphors, or catchphrases, echo them in this post. Match their energy and rhythm.

The master prompt defines voice FLOOR: compliance rules, red lines, formatting standards that always apply. The transcript defines voice FEEL for this particular post. When they disagree on tone, the transcript wins — within the master prompt's red lines.

- The VOICE and BRAND sections tell you the general rules for HOW to write.
- The TRANSCRIPT tells you WHAT to write about AND how this particular piece should sound.
- Never cross the facts stream.`
}

function buildVoiceSpine(i: GenerationInputs): string {
  if (i.masterPrompt && i.masterPrompt.trim()) {
    return `<voice_spine>
${i.masterPrompt.trim()}
</voice_spine>

The voice_spine above defines ${i.clientName}'s tone, phrasing, compliance rules, and red lines. Use it for HOW to write — never treat any factual claim in it as a source for your post's content.`
  }
  // Phase 1 legacy: if no master prompt, synthesize minimal voice from DNA blob.
  // Phase 3 removes this branch.
  const fallbackDna = i.dnaDocText ?? i.dnaMarkdown
  if (!fallbackDna || !fallbackDna.trim()) {
    throw new MissingVoiceError(i.clientName)
  }
  return `<voice_spine>
The following is ${i.clientName}'s brand context. Extract voice cues only — tone, phrasing, what the client teaches, what they avoid. Do not pull facts, numbers, or names from this block into the post.

${fallbackDna.trim()}
</voice_spine>`
}

function buildBrandSection(i: GenerationInputs): string | null {
  // Only include a separate brand_dna block if we have a distinct DNA Doc
  // alongside a master prompt. In Phase 1 most clients have only one of the
  // two, so this block is usually empty.
  if (!i.masterPrompt) return null
  const dna = i.dnaDocText ?? null
  if (!dna || !dna.trim()) return null
  return `<brand_dna purpose="voice_feel_only" client="${i.clientName}">
${dna.trim()}
</brand_dna>

Use brand_dna for visual feel, aesthetic cues, and compliance. Do not treat any statement here as factual source material — facts come exclusively from the transcript.`
}

function buildPlatformRules(platform: Platform): string {
  return `<platform_rules platform="${platform}">
${CC_PLATFORM_DEFAULTS[platform]}
</platform_rules>`
}

function buildApprovedExamples(i: GenerationInputs): string | null {
  const examples = i.recentApprovedPosts.filter(e => e.content && e.content.trim().length > 50).slice(0, 3)
  if (examples.length === 0) return null
  const rendered = examples.map((ex, idx) => {
    const title = ex.title ? ` title="${ex.title.replace(/"/g, '&quot;')}"` : ''
    return `<approved_example index="${idx + 1}"${title}>
${ex.content.trim()}
</approved_example>`
  }).join('\n\n')
  return `<approved_examples purpose="STYLE_ONLY" platform="${i.platform}">
${rendered}
</approved_examples>

The examples above show STYLE only — cadence, structure, tone. Do NOT reuse facts, numbers, names, stories, or specifics from them. Your post draws facts only from the transcript.`
}

function buildKnowledgeNotes(notes: string | null): string | null {
  if (!notes || !notes.trim()) return null
  return `<active_corrections>
${notes.trim()}
</active_corrections>

The corrections above come from recent human feedback on ${ 'this client' }'s posts. Apply them.`
}

function buildOutputContract(platform: Platform, hasCompliance: boolean): string {
  const complianceBlock = hasCompliance
    ? `

<compliance_check>
One line per rule in RULE TWO, in the same order as RULE TWO lists them. Format for each line:
- <SHORT RULE NAME>: compliant <YES|NO> — <one sentence explaining why, citing the specific check>

If a rule includes a required action (e.g., "insert [LEGAL REVIEW REQUIRED] before any yield claim"), state both the TRIGGER (was the action required in this post?) and the RESULT (was it performed?). Example:
- YIELD FLAG RULE: compliant YES — post does not mention a yield %, so the header was not required.
- YIELD FLAG RULE: compliant YES — yield of 8% appears in paragraph 2; [LEGAL REVIEW REQUIRED — JEFF SIGN-OFF] header is present on the line immediately before that paragraph.
- YIELD FLAG RULE: compliant NO — yield of 8% mentioned but required [LEGAL REVIEW REQUIRED] header is missing. REWRITE.

If ANY line resolves to NO, you violated Rule Two — rewrite the <draft> and redo the <compliance_check> before emitting. Only emit the response when every line is YES.
</compliance_check>`
    : ''

  const tagList = hasCompliance
    ? 'EXACTLY three XML tags, in this order'
    : 'EXACTLY two XML tags, in this order'

  const callerStripNote = hasCompliance
    ? 'The caller will strip <traceback> and <compliance_check> before saving. They exist so humans can audit that every claim is real and every compliance rule passes.'
    : 'The caller will strip <traceback> before saving. It exists so humans can audit that every claim is real.'

  return `═══ OUTPUT CONTRACT ═══

Emit ${tagList}, with nothing before, between, or after:

<draft>
The final ${PLATFORM_LABEL[platform]} post, ready to copy-paste. ${PLATFORM_CHAR_RANGE[platform]}. No meta-commentary, no "here's the post", no preamble.
</draft>

<traceback>
3–6 short bullet lines. For every factual claim in the draft, quote the transcript passage that supports it. Format:
- CLAIM: "<brief quote or paraphrase from your draft>" → TRANSCRIPT: "<supporting phrase from transcript>"

If any claim in your draft has no transcript support, you violated Rule Zero — rewrite the draft and redo the traceback before emitting.
</traceback>${complianceBlock}

${callerStripNote}`
}

function buildComplianceRules(rules: string | null): string | null {
  if (!rules || !rules.trim()) return null
  return `═══ RULE TWO — CLIENT COMPLIANCE (ABSOLUTE OVERRIDE) ═══

These are hard-line client-specific compliance rules. They OVERRIDE all other instructions on FRAMING, WORDING, and LANGUAGE CHOICE, including Rule Zero (facts) and Rule One (tone).

Important: Rule Zero still holds for FACTS — you can't invent what wasn't in the transcript. But if the transcript uses language or framing these rules ban, you REFRAME using compliant language. You cite the same fact; you don't replicate the speaker's banned phrasing or banned frame.

Example: the transcript says "Article 1 Section 10 mandates..." and a rule here says "avoid constitutional originalism framing." You do NOT build the post around "Article 1 Section 10." You can acknowledge the legal basis in passing if needed, but the POST's framing is the economic one the rule specifies.

THE RULES:

${rules.trim()}

Before emitting <draft>, silently re-read your draft against EVERY rule above, word by word. If ANY rule is violated — banned phrase appears, required header missing, banned frame used — rewrite the draft until clean. Only emit when every rule is satisfied. If reframing is impossible without hallucinating, drop the offending section rather than violate a rule.`
}

function buildSelfCheck(hasCompliance: boolean): string {
  const complianceStep = hasCompliance
    ? `

Before emitting <draft>, mentally fill in <compliance_check> first, one line per RULE TWO item. If ANY line would resolve to NO, rewrite the draft. Only proceed to emit once every line resolves to YES.`
    : ''

  return `═══ FINAL SELF-CHECK (SILENT — DO NOT OUTPUT) ═══

Before emitting <draft>, do a word-by-word re-read checking for these SPECIFIC failure modes, in order:

1. CHECK THE CTA. Does it tie to THIS post's specific pain or opportunity? Or is it a canned "schedule a call" that could ride the back of any post? If generic, rewrite.

2. CHECK FOR DUPLICATE HOOK. Your <angle_focus> told you the angle for THIS post — a different angle than the other posts in this batch. If your draft's hook sounds like a generic take on the topic rather than THIS specific angle, rewrite.

3. CHECK TONE. Does it sound like the speaker actually sounded on the transcript? Or does it sound generic-AI?

4. CHECK FACTS. Every number, name, quote, claim traces to the transcript?

5. CHECK BASIC RULES. No em-dashes, no hype phrases ("game-changer", "mind-blowing", "buckle up", etc.), no generic filler, no invented numbers, no "fatal flaw / elegantly simple / perfectly / only one that works" superlatives.${complianceStep}

If ANY check fails, rewrite and re-check the whole list.`
}

/**
 * Build the full system prompt. Throws `MissingVoiceError` if no voice source
 * is available (neither masterPrompt nor any DNA). Does NOT throw on missing
 * transcript — that's the user-prompt builder's job.
 */
export function buildGenerationSystemPrompt(i: GenerationInputs): string {
  const blocks: string[] = []
  blocks.push(buildRuleZero(i.clientName, i.platform))
  // RULE TWO (client compliance) sits right after Rule Zero so its
  // rules get the highest priority placement after the grounding rule.
  const compliance = buildComplianceRules(i.complianceRules)
  if (compliance) blocks.push(compliance)
  blocks.push(buildVoiceSpine(i))
  const brand = buildBrandSection(i)
  if (brand) blocks.push(brand)
  blocks.push(buildPlatformRules(i.platform))
  const examples = buildApprovedExamples(i)
  if (examples) blocks.push(examples)
  const corrections = buildKnowledgeNotes(i.knowledgeNotes)
  if (corrections) blocks.push(corrections)
  const hasCompliance = Boolean(i.complianceRules && i.complianceRules.trim())
  blocks.push(buildOutputContract(i.platform, hasCompliance))
  blocks.push(buildSelfCheck(hasCompliance))
  return blocks.join('\n\n')
}

/**
 * Build the user prompt carrying the transcript. Throws `MissingTranscriptError`
 * if the transcript is empty or missing — transcript is the ONLY source of
 * facts, and we refuse to generate without one.
 */
export function buildGenerationUserPrompt(i: GenerationInputs): string {
  if (!i.transcriptText || !i.transcriptText.trim()) {
    throw new MissingTranscriptError()
  }
  const extractionNote = i.wasExtracted
    ? ' (key signal extracted via AI — the full transcript was too long to fit; the excerpt below preserves the speaker\'s claims)'
    : ''

  const angleBlock = i.angle && i.angle.trim()
    ? `\n\n<angle_focus>\nThis is ONE of several posts being generated from this transcript in parallel for this week. To avoid duplicates across the batch, focus THIS post specifically on the following angle:\n\n${i.angle.trim()}\n\nStay with this angle — don't drift to other angles the transcript could support; other posts are handling those.\n</angle_focus>`
    : ''

  const batchNote = i.postIndex && i.postTotal
    ? `\n\nYou are writing post ${i.postIndex} of ${i.postTotal} for this batch. Other posts are covering different angles from the same source.`
    : ''

  return `<transcript title="${i.transcriptTitle.replace(/"/g, '&quot;')}"${extractionNote ? ' extracted="true"' : ''}>
${i.transcriptText.trim()}
</transcript>${angleBlock}

Write ONE ${PLATFORM_LABEL[i.platform]} post based on the transcript above${i.angle ? ', focused on the angle specified above' : '. Pick the single most compelling, unique, or valuable idea and go DEEP on it — do not skim across multiple topics'}.${batchNote}

Stay within ${PLATFORM_CHAR_RANGE[i.platform]}.

Remember Rule Zero: only facts from the transcript. Follow the output contract exactly — emit <draft> then <traceback>, nothing else.`
}

/**
 * Strip the <traceback> and <compliance_check> blocks from a generated response
 * and return the clean <draft> content + audit metadata. If the response doesn't
 * match the contract, returns the full response so the caller can surface it.
 *
 * `violationCount` is the number of compliance_check lines containing " NO"
 * (case-insensitive). A non-zero count means the model self-reported a rule
 * failure — caller should flag the post for human review rather than block it.
 */
export function extractDraft(response: string): {
  draft: string
  traceback: string | null
  complianceCheck: string | null
  violationCount: number
  matchedContract: boolean
} {
  const draftMatch = response.match(/<draft>([\s\S]*?)<\/draft>/i)
  const tracebackMatch = response.match(/<traceback>([\s\S]*?)<\/traceback>/i)
  const complianceMatch = response.match(/<compliance_check>([\s\S]*?)<\/compliance_check>/i)

  if (!draftMatch) {
    return {
      draft: response.trim(),
      traceback: null,
      complianceCheck: null,
      violationCount: 0,
      matchedContract: false,
    }
  }

  const complianceCheck = complianceMatch ? complianceMatch[1].trim() : null
  let violationCount = 0
  if (complianceCheck) {
    for (const line of complianceCheck.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      // Match "compliant NO" (case-insensitive) as the self-reported failure marker.
      if (/compliant\s+NO\b/i.test(trimmed)) {
        violationCount += 1
      }
    }
  }

  return {
    draft: draftMatch[1].trim(),
    traceback: tracebackMatch ? tracebackMatch[1].trim() : null,
    complianceCheck,
    violationCount,
    matchedContract: Boolean(draftMatch && tracebackMatch),
  }
}
