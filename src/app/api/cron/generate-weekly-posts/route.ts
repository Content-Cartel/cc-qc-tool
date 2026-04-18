import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { findClientFolder, appendPostsToDoc } from '@/lib/google-docs'
import { ccPostProcess } from '@/lib/content/cc-rules'
import {
  buildGenerationSystemPrompt,
  buildGenerationUserPrompt,
  extractDraft,
  MissingVoiceError,
  type Platform,
  type ContentExampleRow,
} from '@/lib/content/build-generation-prompt'
import { loadRecentApprovedExamples } from '@/lib/content/approved-examples'
import { POSTGEN_MODEL } from '@/lib/content/postgen-model'
import { extractTranscriptSignal } from '@/lib/content/transcript-extractor'
import { extractDistinctAngles, formatAngleForPrompt, type Angle } from '@/lib/content/angle-extractor'

export const maxDuration = 600 // 10 min — 14 posts × 10+ clients needs headroom even with per-client parallelism
export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL_1 || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY_1 || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_1 || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

const BATCH_SIZE = 4 // Process 4 clients in parallel to stay within timeout

const PLATFORM_MAX_TOKENS: Record<Platform, number> = {
  linkedin: 2400,
  twitter: 1000,
  facebook: 1600,
}

interface PostPlan {
  platform: Platform
  transcript_id: string
  transcript_title: string
}

interface ClientResult {
  client_name: string
  status: string
  post_count?: number
  doc_url?: string
  /** Brief summary of each traceback so the Slack note/log shows audit trail existed. */
  traceback_summary?: string
}

/**
 * Build a plan of 14 transcript-grounded posts for a client.
 * Platform mix: 5 LinkedIn, 4 X/Twitter, 5 Facebook.
 *
 * Transcripts are round-robined across the 14 slots so variety is preserved
 * regardless of how many transcripts exist (1 → all 14 from the same, 2 →
 * alternating, 3+ → evenly spread).
 *
 * If no transcripts are available, returns an empty array. The caller skips
 * the client — no DNA-only generation. This is the non-negotiable Rule Zero
 * guarantee: no transcript, no post.
 */
function buildPostPlan(
  transcripts: { id: string; title: string }[],
): PostPlan[] {
  if (transcripts.length === 0) return []

  const platformOrder: Platform[] = [
    'linkedin', 'linkedin', 'linkedin', 'linkedin', 'linkedin',
    'twitter', 'twitter', 'twitter', 'twitter',
    'facebook', 'facebook', 'facebook', 'facebook', 'facebook',
  ]

  return platformOrder.map((platform, i) => {
    const t = transcripts[i % transcripts.length]
    return { platform, transcript_id: t.id, transcript_title: t.title }
  })
}

/**
 * GET /api/cron/generate-weekly-posts
 *
 * Vercel Cron job that runs every Friday 14:00 UTC.
 * Generates 14 transcript-grounded posts per eligible client
 * (5 LinkedIn, 4 X/Twitter, 5 Facebook).
 *
 * Clients without eligible transcripts are SKIPPED. No DNA-only generation —
 * the generator refuses to invent facts from DNA alone. This is Rule Zero:
 * transcripts are the only source of factual content.
 *
 * Saves to generated_content, appends to Google Doc (Week → Platform tab
 * hierarchy), notifies Slack.
 */
export async function GET(req: NextRequest) {
  const supabase = getSupabase()
  // Accept either the cc-qc-tool-scoped CRON_SECRET_1 (for manual curls and
  // future rotations) or the legacy shared CRON_SECRET that Vercel's built-in
  // cron scheduler still auto-sends on the Friday 14:00 UTC tick.
  const authHeader = req.headers.get('authorization')
  const acceptable = [process.env.CRON_SECRET_1, process.env.CRON_SECRET]
    .filter((s): s is string => !!s)
    .map(s => `Bearer ${s}`)
  if (acceptable.length > 0 && !acceptable.includes(authHeader || '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const anthropicKey = process.env.CC_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  const results: ClientResult[] = []

  try {
    // 1. Find ALL eligible clients (have DNA OR a custom prompt)
    const [{ data: dnaRecords }, { data: promptRecords }] = await Promise.all([
      supabase.from('client_dna').select('client_id').order('version', { ascending: false }),
      supabase.from('client_prompts').select('client_id').eq('prompt_type', 'content_generation'),
    ])

    const clientIds = Array.from(new Set([
      ...(dnaRecords || []).map(d => d.client_id),
      ...(promptRecords || []).map(p => p.client_id),
    ]))

    if (clientIds.length === 0) {
      return NextResponse.json({ message: 'No eligible clients found', results: [] })
    }

    // 2. Process clients in parallel batches
    const generateForClient = async (clientId: number): Promise<ClientResult> => {
      // Get client name
      const { data: client } = await supabase
        .from('clients')
        .select('name, phase')
        .eq('id', clientId)
        .single()

      const clientName = client?.name || `Client ${clientId}`

      // Skip clients not in active phases
      if (client?.phase && !['production', 'active', 'onboarding', 'special'].includes(client.phase)) {
        return { client_name: clientName, status: `skipped: phase=${client.phase}` }
      }

      // Get up to 3 content transcripts from YouTube or Drive/Deepgram
      // (exclude onboarding/strategy recordings; min 100 chars)
      const { data: transcripts } = await supabase
        .from('client_transcripts')
        .select('id, title, transcript_text, source, relevance_tag')
        .eq('client_id', clientId)
        .in('source', ['youtube', 'drive_deepgram'])
        .not('relevance_tag', 'in', '("onboarding","strategy")')
        .order('recorded_at', { ascending: false })
        .limit(3)

      const validTranscripts = (transcripts || [])
        .filter(t => t.transcript_text && t.transcript_text.length > 100)

      // Rule Zero: no transcripts → no posts. Skip the client with a clear note.
      if (validTranscripts.length === 0) {
        return { client_name: clientName, status: 'skipped: no eligible transcripts' }
      }

      // Get DNA + custom prompt + compliance rules for voice spine
      const [{ data: dna }, { data: clientPrompt }, { data: complianceRow }] = await Promise.all([
        supabase
          .from('client_dna')
          .select('dna_markdown')
          .eq('client_id', clientId)
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('client_prompts')
          .select('system_prompt')
          .eq('client_id', clientId)
          .eq('prompt_type', 'content_generation')
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('clients')
          .select('compliance_rules')
          .eq('id', clientId)
          .maybeSingle(),
      ])

      const complianceRules = complianceRow?.compliance_rules || null

      if (!clientPrompt?.system_prompt && !dna?.dna_markdown) {
        return { client_name: clientName, status: 'skipped: no master prompt or DNA' }
      }

      const postPlan = buildPostPlan(
        validTranscripts.map(t => ({ id: t.id, title: t.title || 'Untitled transcript' })),
      )

      const anthropic = new Anthropic({ apiKey: anthropicKey })

      // Pre-extract all unique transcripts used in the plan BEFORE the parallel
      // post loop, so Haiku extraction happens once per transcript even when
      // multiple posts draw from the same source.
      const uniqueTranscriptIds = Array.from(new Set(postPlan.map(p => p.transcript_id)))
      const extractionByTranscript = new Map<string, { text: string; wasExtracted: boolean }>()
      await Promise.all(
        uniqueTranscriptIds.map(async (tid) => {
          const t = validTranscripts.find(v => v.id === tid)
          if (!t?.transcript_text) {
            extractionByTranscript.set(tid, { text: '', wasExtracted: false })
            return
          }
          if (t.transcript_text.length <= 15000) {
            extractionByTranscript.set(tid, { text: t.transcript_text, wasExtracted: false })
            return
          }
          const extraction = await extractTranscriptSignal(
            t.transcript_text, t.title || 'Untitled', 'post_generation', anthropicKey!,
          )
          extractionByTranscript.set(tid,
            extraction
              ? { text: extraction.content, wasExtracted: true }
              : { text: t.transcript_text.slice(0, 15000), wasExtracted: false },
          )
        }),
      )

      // Load the 3 recent approved examples for each platform ONCE per client.
      const approvedByPlatform: Record<Platform, ContentExampleRow[]> = {
        linkedin: await loadRecentApprovedExamples(supabase, clientId, 'linkedin', 3),
        twitter: await loadRecentApprovedExamples(supabase, clientId, 'twitter', 3),
        facebook: await loadRecentApprovedExamples(supabase, clientId, 'facebook', 3),
      }

      // Pre-extract distinct angles per transcript so parallel posts drawing
      // from the same source don't converge into duplicates. Count how many
      // posts each transcript feeds, ask Haiku for that many distinct angles,
      // then assign one angle to each post slot.
      const transcriptPostCounts = new Map<string, number>()
      for (const plan of postPlan) {
        transcriptPostCounts.set(
          plan.transcript_id,
          (transcriptPostCounts.get(plan.transcript_id) || 0) + 1,
        )
      }
      const anglesByTranscript = new Map<string, Angle[]>()
      await Promise.all(
        Array.from(transcriptPostCounts.entries()).map(async ([tid, n]) => {
          const processed = extractionByTranscript.get(tid)
          if (!processed || !processed.text || n < 1) {
            anglesByTranscript.set(tid, [])
            return
          }
          const t = validTranscripts.find(v => v.id === tid)
          const angles = await extractDistinctAngles(
            processed.text,
            t?.title || 'Untitled',
            n,
            anthropicKey!,
          )
          anglesByTranscript.set(tid, angles)
        }),
      )

      // Walking-cursor per transcript so each post pops the next angle in line.
      const angleCursor = new Map<string, number>()
      const takeAngle = (tid: string): Angle | null => {
        const pool = anglesByTranscript.get(tid) || []
        if (pool.length === 0) return null
        const i = angleCursor.get(tid) || 0
        angleCursor.set(tid, i + 1)
        return pool[i % pool.length]
      }

      // Generate all posts IN PARALLEL. Anthropic handles per-tier rate limits;
      // Sonnet 4.5 tiers allow well beyond 14 concurrent calls.
      const assignedAngles: (Angle | null)[] = postPlan.map(p => takeAngle(p.transcript_id))
      const generatePost = async (plan: PostPlan, i: number) => {
        const transcript = validTranscripts.find(t => t.id === plan.transcript_id)
        if (!transcript?.transcript_text) {
          return {
            label: `## Post ${i + 1}: ${plan.platform} (ERROR)`,
            platform: plan.platform,
            content: 'Transcript text missing at runtime.',
            traceback: null as string | null,
          }
        }

        const processed = extractionByTranscript.get(plan.transcript_id)!
        const angle = assignedAngles[i]

        const inputs = {
          clientName,
          platform: plan.platform,
          masterPrompt: clientPrompt?.system_prompt || null,
          dnaDocText: null, // Phase 3 will populate
          dnaMarkdown: dna?.dna_markdown || null, // Phase 1 legacy fallback
          knowledgeNotes: null, // Phase 4 will populate
          complianceRules,
          recentApprovedPosts: approvedByPlatform[plan.platform],
          transcriptText: processed.text,
          transcriptTitle: plan.transcript_title,
          wasExtracted: processed.wasExtracted,
          angle: angle ? formatAngleForPrompt(angle) : null,
          postIndex: i + 1,
          postTotal: postPlan.length,
        }
        const systemPrompt = buildGenerationSystemPrompt(inputs)
        const userPrompt = buildGenerationUserPrompt(inputs)

        try {
          const stream = anthropic.messages.stream({
            model: POSTGEN_MODEL,
            max_tokens: PLATFORM_MAX_TOKENS[plan.platform],
            system: [
              {
                type: 'text',
                text: systemPrompt,
                cache_control: { type: 'ephemeral' },
              },
            ],
            messages: [{ role: 'user', content: userPrompt }],
          })

          const finalMessage = await stream.finalMessage()
          const rawText = finalMessage.content
            .filter(block => block.type === 'text')
            .map(block => (block as { type: 'text'; text: string }).text)
            .join('')

          const { draft, traceback, matchedContract } = extractDraft(rawText)
          if (!matchedContract) {
            console.warn(
              `[cron] ${plan.platform} post ${i + 1} for ${clientName} did not match <draft>/<traceback> contract; using raw output.`,
            )
          }

          const cleanedContent = ccPostProcess(draft)
          const platformLabel = plan.platform === 'linkedin' ? 'LinkedIn'
            : plan.platform === 'twitter' ? 'X/Twitter' : 'Facebook'

          return {
            label: `## Post ${i + 1}: ${platformLabel} (from "${plan.transcript_title}")`,
            platform: plan.platform,
            content: cleanedContent,
            traceback,
          }
        } catch (err) {
          console.error(`[cron] Error generating post ${i + 1} for ${clientName}:`, err)
          return {
            label: `## Post ${i + 1}: ${plan.platform} (ERROR)`,
            platform: plan.platform,
            content: `Generation failed: ${err instanceof Error ? err.message : 'unknown error'}`,
            traceback: null as string | null,
          }
        }
      }

      const postResults = await Promise.all(postPlan.map((plan, i) => generatePost(plan, i)))

      // Combine all posts into markdown (drafts only — traceback is separate).
      const combinedMarkdown = postResults
        .map(p => `${p.label}\n\n${p.content}`)
        .join('\n\n---\n\n')

      // Summarize tracebacks as a compact audit trail for the generated_content row + Slack.
      const tracebackCount = postResults.filter(p => p.traceback).length
      const tracebackSummary = `${tracebackCount}/${postResults.length} drafts emitted tracebacks`

      // Save to generated_content with tracebacks in metadata for later audit.
      const transcriptTitles = Array.from(
        new Set(postPlan.map(p => p.transcript_title)),
      )
      const { data: savedContent } = await supabase.from('generated_content').insert({
        client_id: clientId,
        content_type: 'social_posts',
        source_title: transcriptTitles.join(', '),
        platforms: ['linkedin', 'twitter', 'facebook'],
        content_markdown: combinedMarkdown,
        generated_by: 'weekly_cron',
        status: 'draft',
      }).select('id').single()

      // Save individual posts as content examples for Slack AI training.
      // Keep the latest ~50 AI-generated examples per client so there's a few
      // weeks of variety in the pool without growing unbounded.
      const KEEP_EXAMPLES = 50
      const { data: oldExamples } = await supabase
        .from('client_content_examples')
        .select('id')
        .eq('client_id', clientId)
        .eq('content_type', 'ai_generated')
        .order('published_at', { ascending: false })

      if (oldExamples && oldExamples.length > KEEP_EXAMPLES) {
        const idsToDelete = oldExamples.slice(KEEP_EXAMPLES).map(e => e.id)
        if (idsToDelete.length > 0) {
          await supabase.from('client_content_examples').delete().in('id', idsToDelete)
        }
      }

      // Insert each post as a content example
      const contentExampleRows = postResults
        .filter(p => !p.label.includes('ERROR'))
        .map(p => ({
          client_id: clientId,
          platform: p.platform,
          content_type: 'ai_generated',
          title: p.content.slice(0, 80),
          content: p.content,
          published_at: new Date().toISOString(),
        }))

      if (contentExampleRows.length > 0) {
        await supabase.from('client_content_examples').insert(contentExampleRows)
      }

      // Group the successful posts by platform so each platform lands in its
      // own sub-tab under the week parent tab in the client's Google Doc.
      const postsByPlatform: Record<Platform, string[]> = {
        linkedin: [],
        twitter: [],
        facebook: [],
      }
      for (const p of postResults) {
        if (!p.label.includes('ERROR')) {
          postsByPlatform[p.platform].push(p.content)
        }
      }

      // Append to Google Doc using the Week → Platform tab hierarchy.
      let docUrl: string | undefined
      if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
        const folderId = await findClientFolder(clientName)
        const doc = await appendPostsToDoc(clientName, postsByPlatform, folderId)
        if (doc) {
          docUrl = doc.url
          if (savedContent?.id) {
            await supabase.from('generated_content')
              .update({ google_doc_url: doc.url })
              .eq('id', savedContent.id)
          }
        }
      }

      return {
        client_name: clientName,
        status: 'generated',
        post_count: postResults.length,
        doc_url: docUrl,
        traceback_summary: tracebackSummary,
      }
    }

    // Process clients in parallel batches
    for (let i = 0; i < clientIds.length; i += BATCH_SIZE) {
      const batch = clientIds.slice(i, i + BATCH_SIZE)
      const batchResults = await Promise.all(batch.map(id => generateForClient(id)))
      results.push(...batchResults)
    }

    // 3. Send Slack notification
    const slackWebhook = process.env.SLACK_CONTENT_WEBHOOK_URL
    if (slackWebhook) {
      const generated = results.filter(r => r.status === 'generated')
      const skipped = results.filter(r => r.status.startsWith('skipped'))
      const errors = results.filter(r => r.status.startsWith('error'))

      const totalPosts = generated.reduce((sum, r) => sum + (r.post_count || 0), 0)

      const slackMessage = {
        text: `:memo: *Weekly Written Posts — Rule Zero generator*\n\n` +
          `*Total:* ${totalPosts} posts for ${generated.length} clients (every claim traced to a transcript)\n\n` +
          (generated.length > 0 ? generated.map(r =>
            `  :white_check_mark: ${r.client_name} — ${r.post_count} posts${r.doc_url ? ` · <${r.doc_url}|Open Doc>` : ''}${r.traceback_summary ? ` · _${r.traceback_summary}_` : ''}`
          ).join('\n') + '\n' : '') +
          (skipped.length > 0 ? `\n*Skipped:* ${skipped.length}\n${skipped.map(r => `  :fast_forward: ${r.client_name}: ${r.status}`).join('\n')}\n` : '') +
          (errors.length > 0 ? `\n*Errors:* ${errors.length}\n${errors.map(r => `  :x: ${r.client_name}: ${r.status}`).join('\n')}\n` : '') +
          `\nReview the docs and send to scheduler when ready.`,
      }

      try {
        await fetch(slackWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(slackMessage),
        })
      } catch (err) {
        console.error('[cron] Slack notification failed:', err)
      }
    }

    return NextResponse.json({
      success: true,
      total_clients: clientIds.length,
      generated: results.filter(r => r.status === 'generated').length,
      skipped: results.filter(r => r.status.startsWith('skipped')).length,
      errors: results.filter(r => r.status.startsWith('error')).length,
      total_posts: results.reduce((sum, r) => sum + (r.post_count || 0), 0),
      results,
    })
  } catch (err) {
    console.error('[cron] Weekly post generation failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cron failed' },
      { status: 500 }
    )
  }
}
