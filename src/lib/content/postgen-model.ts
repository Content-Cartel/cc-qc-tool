/**
 * Single source of truth for the model used by the written-post generator.
 * Consumed by /api/content/generate-posts and /api/cron/generate-weekly-posts.
 *
 * Override via the POSTGEN_MODEL env var on Vercel if you need to pin a
 * different Sonnet 4.x id without a code change. Valid IDs are listed in
 * platform.claude.com's Models catalog; confirm availability in the CC
 * Anthropic workspace before swapping.
 */
export const POSTGEN_MODEL = process.env.POSTGEN_MODEL || 'claude-sonnet-4-5-20250929'
