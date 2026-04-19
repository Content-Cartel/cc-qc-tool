import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 600
export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL_1 || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY_1 || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_1 || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

/**
 * Minimum new transcripts since the last prompt version before we regen.
 * Below this, the voice corpus hasn't grown meaningfully and a regen would
 * produce a near-identical prompt for cost that isn't paid back. Above this,
 * the selector has genuinely new material to prioritize (onboarding → strategy
 * → YouTube → general within the 25K-word budget inside selectTranscripts).
 */
const MIN_NEW_TRANSCRIPTS_FOR_REGEN = 3

/**
 * Concurrency for the regen loop. generate-prompt is heavy (Fathom sync +
 * Haiku extraction + Opus/Sonnet prompt build); keep this low so we don't
 * trip Anthropic rate limits across clients and so a single slow client
 * doesn't starve the batch.
 */
const BATCH_SIZE = 2

interface ClientRegenResult {
  client_id: number
  client_name: string
  new_transcripts: number
  status: 'regenerated' | 'skipped' | 'error'
  reason?: string
  duration_ms?: number
}

/**
 * GET /api/cron/regenerate-master-prompts
 *
 * Voice-enrichment flywheel. Runs every Friday at 13:00 UTC (1 hour before
 * generate-weekly-posts at 14:00 UTC). For each active client whose transcript
 * corpus has grown by >=3 new transcripts since their last master-prompt
 * version, POST to /api/content/generate-prompt to rebuild the prompt against
 * the current corpus. The existing selectTranscripts() already prioritizes
 * onboarding/strategy/YouTube/general within a 25K-word budget, so the more
 * content accumulates per client, the more the selector can pick the strongest
 * voice material automatically.
 *
 * Auth: Bearer CRON_SECRET_1 (or legacy CRON_SECRET).
 */
export async function GET(req: NextRequest) {
  const supabase = getSupabase()
  const authHeader = req.headers.get('authorization')
  const acceptable = [process.env.CRON_SECRET_1, process.env.CRON_SECRET]
    .filter((s): s is string => !!s)
    .map(s => `Bearer ${s}`)
  if (acceptable.length > 0 && !acceptable.includes(authHeader || '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
  if (!appUrl) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL or VERCEL_URL required for internal POST' }, { status: 500 })
  }

  const cronSecret = process.env.CRON_SECRET_1 || process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET_1 or CRON_SECRET required for internal POST' }, { status: 500 })
  }

  const { data: clients } = await supabase
    .from('clients')
    .select('id, name')
    .in('phase', ['production', 'active', 'onboarding', 'special'])
    .order('name')

  if (!clients || clients.length === 0) {
    return NextResponse.json({ message: 'No eligible clients', results: [] })
  }

  // For each client, compute the "new transcripts since last prompt version"
  // count in parallel — these are read-only Supabase queries and are cheap.
  const candidateChecks = await Promise.all(
    clients.map(async (c) => {
      // Most recent prompt version's created_at, if any exists.
      const { data: latestPrompt } = await supabase
        .from('client_prompts')
        .select('created_at')
        .eq('client_id', c.id)
        .eq('prompt_type', 'content_generation')
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle()

      const cutoff = latestPrompt?.created_at ?? '1970-01-01T00:00:00Z'

      const { count } = await supabase
        .from('client_transcripts')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', c.id)
        .gt('recorded_at', cutoff)

      return { id: c.id, name: c.name, newCount: count ?? 0, hasAnyPrompt: !!latestPrompt }
    }),
  )

  // Regen policy:
  //   - Client has no prompt yet AND has >=1 transcript → regen (seed).
  //   - Client has a prompt AND has >=MIN_NEW since last version → regen (refresh).
  const candidates = candidateChecks.filter(c => {
    if (!c.hasAnyPrompt) return c.newCount >= 1
    return c.newCount >= MIN_NEW_TRANSCRIPTS_FOR_REGEN
  })

  if (candidates.length === 0) {
    return NextResponse.json({
      message: 'No clients need regeneration this week',
      checked: candidateChecks.length,
      results: [],
    })
  }

  const results: ClientRegenResult[] = []

  const regenOne = async (c: { id: number; name: string; newCount: number }): Promise<ClientRegenResult> => {
    const started = Date.now()
    try {
      const res = await fetch(`${appUrl}/api/content/generate-prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cronSecret}`,
        },
        body: JSON.stringify({ client_id: c.id }),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return {
          client_id: c.id,
          client_name: c.name,
          new_transcripts: c.newCount,
          status: 'error',
          reason: `HTTP ${res.status}: ${body.slice(0, 180)}`,
          duration_ms: Date.now() - started,
        }
      }

      // generate-prompt streams SSE. Drain the body fully so the stream
      // completes and the prompt gets persisted to client_prompts.
      if (res.body) {
        const reader = res.body.getReader()
        while (true) {
          const { done } = await reader.read()
          if (done) break
        }
      }

      return {
        client_id: c.id,
        client_name: c.name,
        new_transcripts: c.newCount,
        status: 'regenerated',
        duration_ms: Date.now() - started,
      }
    } catch (err) {
      return {
        client_id: c.id,
        client_name: c.name,
        new_transcripts: c.newCount,
        status: 'error',
        reason: err instanceof Error ? err.message : 'unknown',
        duration_ms: Date.now() - started,
      }
    }
  }

  // Process in small parallel batches so we don't hammer Anthropic across all
  // clients at once. Each client is one generate-prompt run (~30-90s).
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(batch.map(regenOne))
    results.push(...batchResults)
  }

  // Note clients we skipped (had a prompt but <MIN new transcripts) for
  // Slack visibility — they're the "stable voice, no new material" case.
  const skipped = candidateChecks
    .filter(c => !candidates.find(cand => cand.id === c.id))
    .map<ClientRegenResult>(c => ({
      client_id: c.id,
      client_name: c.name,
      new_transcripts: c.newCount,
      status: 'skipped',
      reason: c.hasAnyPrompt ? `<${MIN_NEW_TRANSCRIPTS_FOR_REGEN} new transcripts since last version` : 'no transcripts yet',
    }))

  const regenerated = results.filter(r => r.status === 'regenerated').length
  const errors = results.filter(r => r.status === 'error').length

  const slackWebhook = process.env.SLACK_CONTENT_WEBHOOK_URL
  if (slackWebhook) {
    const successLines = results
      .filter(r => r.status === 'regenerated')
      .map(r => `  :arrows_counterclockwise: ${r.client_name} — ${r.new_transcripts} new transcripts ingested`)
      .join('\n')
    const errorLines = results
      .filter(r => r.status === 'error')
      .map(r => `  :x: ${r.client_name}: ${r.reason}`)
      .join('\n')
    const message = {
      text: `:dna: *Voice flywheel — master prompt regeneration*\n` +
        `Regenerated ${regenerated} / checked ${candidateChecks.length} clients · ${errors} errors · ${skipped.length} skipped (no new material)\n` +
        (successLines ? successLines + '\n' : '') +
        (errorLines ? errorLines + '\n' : '') +
        `Friday post-gen (14:00 UTC) will pick up the refreshed prompts.`,
    }
    fetch(slackWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    }).catch(err => console.error('[regenerate-master-prompts] Slack notify failed:', err))
  }

  return NextResponse.json({
    checked: candidateChecks.length,
    regenerated,
    skipped: skipped.length,
    errors,
    min_new_transcripts_threshold: MIN_NEW_TRANSCRIPTS_FOR_REGEN,
    results: [...results, ...skipped],
  })
}
