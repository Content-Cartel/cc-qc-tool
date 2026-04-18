/**
 * Load recent human-approved posts to use as STYLE-only few-shot examples
 * in generation prompts.
 *
 * Priority order:
 *   1. Posts with content_type IN ('published', 'human_approved', 'human_refined')
 *      — these are the real signal.
 *   2. If none, fall back to the latest ai_generated posts (existing behaviour;
 *      weaker signal but better than nothing).
 *
 * Phase 1 reality: the approved-content pool is empty for most clients, so
 * this will usually return 0 rows and the prompt builder skips the
 * <approved_examples> block. Phase 4's feedback loop + the bootstrap
 * seed-approved-examples flow will populate the pool.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContentExampleRow, Platform } from './build-generation-prompt'

const HUMAN_APPROVED_TYPES = ['published', 'human_approved', 'human_refined'] as const

export async function loadRecentApprovedExamples(
  supabase: SupabaseClient,
  clientId: number,
  platform: Platform,
  limit = 3,
): Promise<ContentExampleRow[]> {
  // First pass: human-approved / published / refined — the real signal.
  const { data: approved, error: approvedErr } = await supabase
    .from('client_content_examples')
    .select('platform, content, title, published_at, content_type')
    .eq('client_id', clientId)
    .eq('platform', platform)
    .in('content_type', HUMAN_APPROVED_TYPES)
    .order('published_at', { ascending: false })
    .limit(limit)

  if (!approvedErr && approved && approved.length > 0) {
    return approved.map(row => ({
      platform: row.platform,
      content: row.content,
      title: row.title ?? null,
      published_at: row.published_at ?? null,
    }))
  }

  // Fallback: latest ai_generated for this platform. Weaker signal — these
  // were never human-confirmed — but better than no style anchor at all.
  const { data: aiGen, error: aiGenErr } = await supabase
    .from('client_content_examples')
    .select('platform, content, title, published_at')
    .eq('client_id', clientId)
    .eq('platform', platform)
    .eq('content_type', 'ai_generated')
    .order('published_at', { ascending: false })
    .limit(limit)

  if (aiGenErr || !aiGen) return []

  return aiGen.map(row => ({
    platform: row.platform,
    content: row.content,
    title: row.title ?? null,
    published_at: row.published_at ?? null,
  }))
}
