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
  /** Recent human-approved posts for the same platform. STYLE reference only. */
  recentApprovedPosts: ContentExampleRow[]
  /** REQUIRED. The transcript the post must draw its facts from. */
  transcriptText: string
  transcriptTitle: string
  /** True if the transcript was pre-extracted via Haiku (>15K chars). Informational. */
  wasExtracted: boolean
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

- The VOICE and BRAND sections tell you HOW to write.
- The TRANSCRIPT tells you WHAT to write about.
- Never cross these streams.

If the transcript doesn't support a claim, don't make it. Paraphrase the speaker loosely instead. When in doubt, leave it out.`
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

function buildOutputContract(platform: Platform): string {
  return `═══ OUTPUT CONTRACT ═══

Emit EXACTLY two XML tags, in this order, with nothing before, between, or after:

<draft>
The final ${PLATFORM_LABEL[platform]} post, ready to copy-paste. ${PLATFORM_CHAR_RANGE[platform]}. No meta-commentary, no "here's the post", no preamble.
</draft>

<traceback>
3–6 short bullet lines. For every factual claim in the draft, quote the transcript passage that supports it. Format:
- CLAIM: "<brief quote or paraphrase from your draft>" → TRANSCRIPT: "<supporting phrase from transcript>"

If any claim in your draft has no transcript support, you violated Rule Zero — rewrite the draft and redo the traceback before emitting.
</traceback>

The caller will strip <traceback> before saving. It exists so humans can audit that every claim is real.`
}

/**
 * Build the full system prompt. Throws `MissingVoiceError` if no voice source
 * is available (neither masterPrompt nor any DNA). Does NOT throw on missing
 * transcript — that's the user-prompt builder's job.
 */
export function buildGenerationSystemPrompt(i: GenerationInputs): string {
  const blocks: string[] = []
  blocks.push(buildRuleZero(i.clientName, i.platform))
  blocks.push(buildVoiceSpine(i))
  const brand = buildBrandSection(i)
  if (brand) blocks.push(brand)
  blocks.push(buildPlatformRules(i.platform))
  const examples = buildApprovedExamples(i)
  if (examples) blocks.push(examples)
  const corrections = buildKnowledgeNotes(i.knowledgeNotes)
  if (corrections) blocks.push(corrections)
  blocks.push(buildOutputContract(i.platform))
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
  return `<transcript title="${i.transcriptTitle.replace(/"/g, '&quot;')}"${extractionNote ? ' extracted="true"' : ''}>
${i.transcriptText.trim()}
</transcript>

Write ONE ${PLATFORM_LABEL[i.platform]} post based on the transcript above. Pick the single most compelling, unique, or valuable idea and go DEEP on it — do not skim across multiple topics.

Stay within ${PLATFORM_CHAR_RANGE[i.platform]}.

Remember Rule Zero: only facts from the transcript. Follow the output contract exactly — emit <draft> then <traceback>, nothing else.`
}

/**
 * Strip the <traceback> block from a generated response and return just the
 * <draft> content. If the response doesn't match the contract, returns the
 * full response as-is so the caller can surface it for debugging.
 */
export function extractDraft(response: string): { draft: string; traceback: string | null; matchedContract: boolean } {
  const draftMatch = response.match(/<draft>([\s\S]*?)<\/draft>/i)
  const tracebackMatch = response.match(/<traceback>([\s\S]*?)<\/traceback>/i)
  if (!draftMatch) {
    return { draft: response.trim(), traceback: null, matchedContract: false }
  }
  return {
    draft: draftMatch[1].trim(),
    traceback: tracebackMatch ? tracebackMatch[1].trim() : null,
    matchedContract: Boolean(draftMatch && tracebackMatch),
  }
}
