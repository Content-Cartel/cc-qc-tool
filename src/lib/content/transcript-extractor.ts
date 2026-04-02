/**
 * Transcript Extraction via Haiku — Content Intelligence Engine
 *
 * Instead of brutally slicing transcripts to 5K-8K chars (losing 70%+ of content),
 * this uses Claude Haiku to extract the SIGNAL from full transcripts:
 * - Voice patterns, signature phrases, verbal tics
 * - Strategic information (business model, audience, positioning)
 * - Compliance/off-limits topics
 * - Stories, case studies, proof points
 * - Hook patterns and teaching style
 *
 * Cost: ~$0.001 per transcript (Haiku is dirt cheap)
 * Speed: 2-5 seconds per transcript
 * Result: 3-5x more useful information in fewer tokens
 */

import Anthropic from '@anthropic-ai/sdk'

export interface TranscriptExtraction {
  /** Extracted signal, structured for downstream use */
  content: string
  /** Word count of the extraction */
  word_count: number
  /** What was extracted */
  extraction_type: 'voice' | 'strategy' | 'post_generation' | 'stories'
  /** Original transcript word count */
  original_word_count: number
  /** Compression ratio */
  compression_ratio: number
}

/**
 * Extraction prompts tuned by purpose.
 * Each purpose extracts different signal from the same transcript.
 */
const EXTRACTION_PROMPTS: Record<string, string> = {
  /**
   * For DNA/system-prompt generation — extract everything strategic + voice.
   * Used by: generate-prompt route, DNA generation
   */
  strategy: `You are a transcript intelligence extractor for a content agency. Your job is to mine this transcript for operational data that will be used to build an AI system prompt for generating social media content.

Extract ALL of the following from the transcript. Include DIRECT QUOTES wherever possible — the exact words matter more than your summary.

## EXTRACT THESE (in this order):

### VOICE & LANGUAGE
- Direct quotes that capture how this person speaks (5-10 examples, word-for-word)
- Signature phrases, verbal tics, catchphrases, transitions ("Look," "Here's the thing," etc.)
- Teaching style: do they use frameworks? stories? Socratic questions? case studies?
- Energy level and humor style (with examples)
- Technical depth: do they use jargon? Do they explain it?
- Sentence patterns: short and punchy? Long and flowing? Mix?

### BUSINESS & STRATEGY
- What they do, who they serve, how they make money
- Their unique angle or methodology (what makes them different)
- Positioning: how they describe themselves vs competitors
- Revenue streams mentioned
- Goals, KPIs, what success looks like to them

### AUDIENCE & ICP
- Who their audience/clients are (demographics + psychographics)
- Pain points they mention their audience having
- Objections they address
- Who they explicitly say they DON'T serve

### COMPLIANCE & OFF-LIMITS
- Topics they say to avoid
- Legal or regulatory concerns mentioned
- Competitor handling preferences
- Industry-specific compliance (SEC, HIPAA, legal disclaimers, etc.)
- Anything they're sensitive about

### CONTENT PATTERNS
- How they open conversations/videos (hook patterns)
- Stories, case studies, or examples they tell (summarize each briefly)
- Numbers, metrics, or proof points they cite
- CTAs, offers, or resources they mention
- What they say works vs doesn't work in their content

### PROOF POINTS
- Specific results, metrics, achievements mentioned
- Credentials, certifications, experience
- Client success stories (even brief mentions)
- Social proof (media appearances, partnerships, endorsements)

## RULES:
- Use DIRECT QUOTES with quotation marks whenever possible
- For each quote, note the context (what they were talking about)
- Never invent or embellish — only extract what's actually in the transcript
- If a section has nothing relevant, write "[Nothing found in this transcript]"
- Be comprehensive — extract EVERYTHING useful, not just highlights
- Prioritize the client's own words over your paraphrasing`,

  /**
   * For voice-focused extraction — heavier on language patterns.
   * Used by: DNA Voice Fingerprint section
   */
  voice: `You are a voice pattern extractor. Your job is to mine this transcript for language patterns, speaking style, and verbal fingerprints.

Extract ONLY voice-related data. Include DIRECT QUOTES for everything.

### DIRECT VOICE SAMPLES
List 10-15 sentences/phrases from the transcript that are most characteristic of how this person speaks. Include the full sentence, not fragments.

### SIGNATURE LANGUAGE
- Phrases they repeat or lean on
- Verbal transitions ("Look," "So here's the deal," etc.)
- How they emphasize points
- Filler patterns (if any)

### COMMUNICATION STYLE
- Formality level (with examples showing why)
- Energy: calm/intense/varies (with examples)
- Humor: type + examples (or "none detected")
- Technical depth: jargon usage + whether they explain it

### TEACHING PATTERNS
- How they introduce new concepts
- How they structure explanations
- Whether they use frameworks, stories, analogies, data
- How they handle complex topics

### OPENING & CLOSING PATTERNS
- How they start (topics, conversations, explanations)
- How they end/transition

## RULES:
- DIRECT QUOTES only. No paraphrasing.
- Context for each quote (1-line description of what they were discussing)
- Extract EVERYTHING voice-related, even small details
- If this is a meeting transcript, focus on the CLIENT's speech, not the interviewer's`,

  /**
   * For post generation — extract compelling content ideas + quotes.
   * Used by: generate-posts route
   */
  post_generation: `You are a content mining specialist. Your job is to extract the most compelling, shareable ideas from this transcript that can be turned into social media posts.

Extract the following:

### KEY INSIGHTS (ranked by shareability)
For each insight:
- The core idea in one sentence
- The best quote from the transcript that captures it
- Why it would resonate with the audience
- Potential hook angle for a social post

Extract 5-10 insights, ranked from most compelling to least.

### STORIES & EXAMPLES
- Any stories, anecdotes, or case studies mentioned (summarize each in 2-3 sentences)
- Include the speaker's exact framing — how they set up and deliver the story

### QUOTABLE MOMENTS
- 5-10 direct quotes that would work as standalone social media hooks
- Context for each (what topic they were discussing)

### NUMBERS & PROOF POINTS
- Any specific numbers, metrics, percentages, or results mentioned
- Note which ones were stated as facts vs estimates

### CONTRARIAN TAKES
- Any opinions that go against conventional thinking
- Bold claims or predictions
- "Most people think X, but actually Y" patterns

## RULES:
- DIRECT QUOTES wherever possible
- Rank insights by social media shareability (hook potential, relatability, surprise factor)
- Never invent or embellish
- Focus on ideas that teach something specific and actionable`,

  /**
   * For story mining — extract personal history, client stories, anecdotes, and experiences.
   * Used by: generate-prompt route (feeds into Story Arsenal layer of system prompt)
   */
  stories: `You are a story archaeologist. Your job is to mine this transcript for every story, anecdote, personal experience, client case study, origin story, and memorable moment that the speaker shares.

Stories are the most valuable content asset. They make content human, relatable, and impossible to replicate. Generic AI can write insights — but it can't invent stories that actually happened.

## EXTRACT THESE:

### ORIGIN STORY / PERSONAL HISTORY
- How they got started in their field
- Key turning points in their career or life
- Failures, setbacks, or pivots that shaped them
- "Before/after" moments (where they were vs where they are now)
- Why they do what they do (motivation, mission, purpose)
- Include their EXACT words when they tell these stories

### CLIENT / CUSTOMER STORIES
For each story, extract:
- **Setup:** Who was the client? What was their situation? (use the speaker's words)
- **Problem:** What were they struggling with?
- **Turning point:** What changed? What did the speaker/their company do?
- **Result:** What happened? (specific outcomes if mentioned)
- **Quote:** The speaker's exact words telling this story
- **Lesson:** What takeaway does the speaker draw from this story?

### ANECDOTES & EXAMPLES
- Short illustrative stories used to make a point
- Real-world examples from their experience (not hypotheticals)
- "I remember when..." or "We had a client who..." moments
- Industry-specific war stories
- Include the context: what point were they making when they told this story?

### LESSONS LEARNED THE HARD WAY
- Mistakes they made and what they learned
- Things they wish they'd known earlier
- Expensive lessons (time, money, reputation)
- "If I could go back..." or "The biggest mistake I see is..." moments

### RECURRING THEMES & BELIEFS
- Core beliefs that come up repeatedly across stories
- Principles they live/work by (with the story that illustrates each one)
- What they're passionate about (detectable by energy/emphasis in their speech)
- Contrarian views shaped by personal experience

### PEOPLE & RELATIONSHIPS
- Mentors, partners, team members they reference by name
- Key relationships that shaped their business/career
- How they talk about their team, clients, or industry peers

## RULES:
- DIRECT QUOTES are essential. The speaker's exact words make stories authentic.
- For each story, include enough context that someone who wasn't there could retell it
- Capture the EMOTIONAL arc, not just the facts (was it funny? painful? surprising?)
- If the speaker tells the same story multiple times with different details, combine them
- Note which stories seem to be their "greatest hits" (told with practiced delivery)
- If this is a meeting/interview, focus on the CLIENT's stories, not the interviewer's
- Never invent details. If the story is incomplete, note what's missing
- Even small anecdotes matter — "I was talking to a client last week who..." is gold`,
}

/**
 * Extract structured signal from a full transcript using Claude Haiku.
 *
 * @param transcript - Full transcript text
 * @param title - Transcript title (for context)
 * @param purpose - What the extraction will be used for
 * @param apiKey - Anthropic API key
 * @returns Extracted signal, or null on failure
 */
export async function extractTranscriptSignal(
  transcript: string,
  title: string,
  purpose: 'strategy' | 'voice' | 'post_generation' | 'stories',
  apiKey: string,
): Promise<TranscriptExtraction | null> {
  if (!transcript || transcript.trim().length < 100) {
    return null
  }

  const originalWordCount = transcript.split(/\s+/).length
  const extractionPrompt = EXTRACTION_PROMPTS[purpose]

  try {
    const anthropic = new Anthropic({ apiKey })

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: extractionPrompt,
      messages: [{
        role: 'user',
        content: `Transcript: "${title}"\n\n---\n${transcript}\n---\n\nExtract all relevant signal from this transcript following the structure above. Be comprehensive — this extraction replaces the original transcript in our pipeline, so anything you miss is lost.`,
      }],
    })

    const content = response.content[0]?.type === 'text' ? response.content[0].text : ''
    if (!content || content.length < 50) return null

    const extractionWordCount = content.split(/\s+/).length

    return {
      content,
      word_count: extractionWordCount,
      extraction_type: purpose,
      original_word_count: originalWordCount,
      compression_ratio: Math.round((originalWordCount / Math.max(extractionWordCount, 1)) * 10) / 10,
    }
  } catch (err) {
    console.error(`[transcript-extractor] Haiku extraction failed for "${title}":`, err)
    return null
  }
}

/**
 * Extract signal from multiple transcripts in parallel.
 * Falls back to truncation if Haiku extraction fails for any transcript.
 *
 * @param transcripts - Array of { title, text } pairs
 * @param purpose - Extraction purpose
 * @param apiKey - Anthropic API key
 * @param fallbackCharLimit - If extraction fails, truncate to this many chars
 * @returns Array of { title, text } with extracted or truncated text
 */
export async function extractMultipleTranscripts(
  transcripts: { title: string; text: string }[],
  purpose: 'strategy' | 'voice' | 'post_generation' | 'stories',
  apiKey: string,
  fallbackCharLimit: number = 8000,
): Promise<{ title: string; text: string; extracted: boolean }[]> {
  const results = await Promise.all(
    transcripts.map(async (t) => {
      const extraction = await extractTranscriptSignal(t.text, t.title, purpose, apiKey)

      if (extraction) {
        return {
          title: `${t.title} [Extracted: ${extraction.original_word_count} → ${extraction.word_count} words, ${extraction.compression_ratio}x compression]`,
          text: extraction.content,
          extracted: true,
        }
      }

      // Fallback: truncate like before
      return {
        title: t.title,
        text: t.text.slice(0, fallbackCharLimit),
        extracted: false,
      }
    })
  )

  return results
}
