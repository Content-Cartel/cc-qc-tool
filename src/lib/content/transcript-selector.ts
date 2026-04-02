/**
 * Shared transcript selection logic — Content Intelligence Engine
 *
 * Smart selection with priority ordering and word budget management.
 * Extracted from the DNA generation route so it can be reused by:
 * - generate-prompt (system prompt generation)
 * - generate-posts (post generation)
 * - DNA generation
 */

import { SupabaseClient } from '@supabase/supabase-js'

export interface SelectedTranscript {
  source: 'fathom' | 'youtube'
  title: string
  text: string
  summary: string | null
  word_count: number
  relevance_tag: string
  recorded_at: string | null
  metadata: Record<string, unknown>
}

export interface TranscriptSelectionResult {
  transcripts: SelectedTranscript[]
  total_words: number
  fathom_count: number
  youtube_count: number
}

/**
 * Select the best transcripts for a client within a word budget.
 *
 * Priority order:
 * 1. Onboarding calls (most valuable — strategy, voice, compliance)
 * 2. Strategy meetings
 * 3. YouTube transcripts (prefer Whisper over captions, then by view count)
 * 4. General meetings (most recent)
 *
 * @param clientId - Client ID in Supabase
 * @param supabase - Supabase client
 * @param wordBudget - Maximum total words to select (default: 20,000)
 * @param purpose - What the transcripts will be used for (affects filtering)
 */
export async function selectTranscripts(
  clientId: number,
  supabase: SupabaseClient,
  wordBudget: number = 20000,
  purpose: 'dna' | 'system_prompt' | 'post_generation' = 'system_prompt',
): Promise<TranscriptSelectionResult> {
  const { data: allTranscripts } = await supabase
    .from('client_transcripts')
    .select('source, source_id, title, transcript_text, summary, word_count, relevance_tag, recorded_at, metadata')
    .eq('client_id', clientId)
    .order('recorded_at', { ascending: false })

  if (!allTranscripts || allTranscripts.length === 0) {
    return { transcripts: [], total_words: 0, fathom_count: 0, youtube_count: 0 }
  }

  // Priority 1: Onboarding transcripts (most valuable)
  const onboarding = allTranscripts.filter(t => t.relevance_tag === 'onboarding')

  // Priority 2: Strategy meetings
  const strategy = allTranscripts.filter(t => t.relevance_tag === 'strategy')

  // Priority 3: YouTube transcripts — prefer Whisper, then by view count
  const ytTranscripts = allTranscripts
    .filter(t => t.source === 'youtube')
    .sort((a, b) => {
      const aWhisper = (a.metadata as Record<string, unknown>)?.source_method === 'whisper' ? 1 : 0
      const bWhisper = (b.metadata as Record<string, unknown>)?.source_method === 'whisper' ? 1 : 0
      if (bWhisper !== aWhisper) return bWhisper - aWhisper
      return (Number((b.metadata as Record<string, unknown>)?.view_count) || 0) - (Number((a.metadata as Record<string, unknown>)?.view_count) || 0)
    })

  // For post generation, prioritize YouTube transcripts higher (voice + content patterns)
  // For system prompt, prioritize onboarding (strategy + compliance)
  let ytLimit = 5
  if (purpose === 'post_generation') ytLimit = 8
  if (purpose === 'dna') ytLimit = 5

  const ytFiltered = ytTranscripts
    .filter(yt => !onboarding.includes(yt) && !strategy.includes(yt))
    .slice(0, ytLimit)

  // Priority 4: Other meetings (most recent)
  const general = allTranscripts.filter(t =>
    t.relevance_tag === 'general' || t.relevance_tag === 'content_review'
  )

  // Build prioritized list
  const prioritized = [
    ...onboarding,
    ...strategy,
    ...ytFiltered,
    ...general,
  ]

  // Select within word budget, deduplicating by source_id
  const selected: SelectedTranscript[] = []
  let wordsUsed = 0
  const seen = new Set<string>()

  for (const t of prioritized) {
    const key = `${t.source}:${t.source_id}`
    if (seen.has(key)) continue
    if (!t.transcript_text || t.transcript_text.trim().length < 50) continue

    const wordCount = t.word_count || t.transcript_text.split(/\s+/).length
    if (wordsUsed + wordCount > wordBudget) continue

    seen.add(key)
    selected.push({
      source: t.source as 'fathom' | 'youtube',
      title: t.title || 'Untitled',
      text: t.transcript_text,
      summary: t.summary || null,
      word_count: wordCount,
      relevance_tag: t.relevance_tag || 'general',
      recorded_at: t.recorded_at || null,
      metadata: (t.metadata as Record<string, unknown>) || {},
    })
    wordsUsed += wordCount
  }

  return {
    transcripts: selected,
    total_words: wordsUsed,
    fathom_count: selected.filter(t => t.source === 'fathom').length,
    youtube_count: selected.filter(t => t.source === 'youtube').length,
  }
}
