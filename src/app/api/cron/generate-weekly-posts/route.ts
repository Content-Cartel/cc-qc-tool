import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { findClientFolder, appendPostsToDoc } from '@/lib/google-docs'
import { ccPostProcess, CC_PLATFORM_DEFAULTS } from '@/lib/content/cc-rules'
import { buildFallbackPrompt, extractDNASection } from '@/lib/content/fallback-prompt'

export const maxDuration = 300 // 5 min for batch processing
export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL_1 || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY_1 || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_1 || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

const BATCH_SIZE = 4 // Process 4 clients in parallel to stay within timeout

type Platform = 'linkedin' | 'twitter' | 'facebook'

interface PostPlan {
  platform: Platform
  transcript_id?: string
  transcript_title?: string
  topic?: string // for prompt-only posts
}

interface ClientResult {
  client_name: string
  status: string
  post_count?: number
  transcript_posts?: number
  dna_posts?: number
  doc_url?: string
}

/**
 * Build a plan of 5 posts for a client based on available transcripts.
 * Platform mix: 2 LinkedIn, 2 X/Twitter, 1 Facebook
 */
function buildPostPlan(
  transcripts: { id: string; title: string }[],
  dnaTopics: string[],
): PostPlan[] {
  const platforms: Platform[] = ['linkedin', 'twitter', 'linkedin', 'twitter', 'facebook']
  const posts: PostPlan[] = []

  if (transcripts.length >= 3) {
    // 2 from t1, 2 from t2, 1 from t3
    const assignments = [0, 1, 0, 1, 2]
    for (let i = 0; i < 5; i++) {
      const t = transcripts[assignments[i]]
      posts.push({ platform: platforms[i], transcript_id: t.id, transcript_title: t.title })
    }
  } else if (transcripts.length === 2) {
    // 3 from t1, 2 from t2
    const assignments = [0, 1, 0, 1, 0]
    for (let i = 0; i < 5; i++) {
      const t = transcripts[assignments[i]]
      posts.push({ platform: platforms[i], transcript_id: t.id, transcript_title: t.title })
    }
  } else if (transcripts.length === 1) {
    // 3 from transcript, 2 prompt-only
    const t = transcripts[0]
    posts.push({ platform: 'linkedin', transcript_id: t.id, transcript_title: t.title })
    posts.push({ platform: 'twitter', transcript_id: t.id, transcript_title: t.title })
    posts.push({ platform: 'linkedin', transcript_id: t.id, transcript_title: t.title })
    posts.push({ platform: 'twitter', topic: dnaTopics[0] || undefined })
    posts.push({ platform: 'facebook', topic: dnaTopics[1] || undefined })
  } else {
    // All 5 prompt-only
    for (let i = 0; i < 5; i++) {
      posts.push({ platform: platforms[i], topic: dnaTopics[i % dnaTopics.length] || undefined })
    }
  }

  return posts
}

/**
 * Extract content pillar topics from DNA for prompt-only generation.
 */
function extractDNATopics(dnaMarkdown: string | null): string[] {
  if (!dnaMarkdown) return []

  const strategy = extractDNASection(dnaMarkdown, 'CONTENT STRATEGY')
  const play = extractDNASection(dnaMarkdown, 'THE PLAY')
  const proofPoints = extractDNASection(dnaMarkdown, 'PROOF POINTS')

  const topics: string[] = []

  // Extract content pillars from strategy section
  if (strategy) {
    const pillarMatch = strategy.match(/content\s*pillars[^:]*:([\s\S]*?)(?=\n\*\*|\n##|$)/i)
    if (pillarMatch) {
      const pillars = pillarMatch[1]
        .split(/\n/)
        .map(l => l.replace(/^[-*\d.)\s]+/, '').trim())
        .filter(l => l.length > 5 && l.length < 100)
      topics.push(...pillars.slice(0, 5))
    }
  }

  // If not enough, use the play section for themes
  if (topics.length < 3 && play) {
    const lines = play.split('\n')
      .map(l => l.replace(/^[-*\d.)\s]+/, '').replace(/\*\*/g, '').trim())
      .filter(l => l.length > 10 && l.length < 100 && !l.startsWith('#'))
    topics.push(...lines.slice(0, 3))
  }

  // If still not enough, use proof points
  if (topics.length < 3 && proofPoints) {
    const lines = proofPoints.split('\n')
      .map(l => l.replace(/^[-*\d.)\s]+/, '').replace(/\*\*/g, '').trim())
      .filter(l => l.length > 10 && l.length < 100 && !l.startsWith('#'))
    topics.push(...lines.slice(0, 3))
  }

  return topics.slice(0, 5)
}

/**
 * GET /api/cron/generate-weekly-posts
 *
 * Vercel Cron job that runs every Friday.
 * Generates 5 posts per client (2 LinkedIn, 2 X/Twitter, 1 Facebook)
 * for ALL clients that have DNA or a custom prompt.
 *
 * Clients with transcripts: uses mix of transcripts + prompt-only posts
 * Clients without transcripts: all 5 posts generated from DNA/prompt alone
 *
 * Saves to generated_content table, appends to Google Doc, notifies Slack.
 */
export async function GET(req: NextRequest) {
  const supabase = getSupabase()
  // Verify cron secret (Vercel sends this header for cron jobs)
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
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

      // Get up to 3 content transcripts (exclude onboarding/strategy)
      const { data: transcripts } = await supabase
        .from('client_transcripts')
        .select('id, title, transcript_text, source, relevance_tag')
        .eq('client_id', clientId)
        .not('relevance_tag', 'in', '("onboarding","strategy")')
        .order('recorded_at', { ascending: false })
        .limit(3)

      const validTranscripts = (transcripts || [])
        .filter(t => t.transcript_text && t.transcript_text.length > 100)

      // Get DNA + custom prompt
      const [{ data: dna }, { data: clientPrompt }] = await Promise.all([
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
      ])

      const hasCustomPrompt = !!clientPrompt?.system_prompt
      const hasDNA = !!dna?.dna_markdown

      if (!hasCustomPrompt && !hasDNA) {
        return { client_name: clientName, status: 'skipped: no DNA or prompt' }
      }

      // Extract DNA topics for prompt-only posts
      const dnaTopics = extractDNATopics(dna?.dna_markdown || null)

      // Build the post plan
      const postPlan = buildPostPlan(
        validTranscripts.map(t => ({ id: t.id, title: t.title })),
        dnaTopics,
      )

      const anthropic = new Anthropic({ apiKey: anthropicKey })
      const postResults: { label: string; content: string }[] = []
      let transcriptPosts = 0
      let dnaPosts = 0

      // Generate each post
      for (let i = 0; i < postPlan.length; i++) {
        const plan = postPlan[i]
        const platformRules = CC_PLATFORM_DEFAULTS[plan.platform as keyof typeof CC_PLATFORM_DEFAULTS] || ''

        // Build system prompt (use master prompt if available, fallback to DNA)
        let systemPrompt: string
        const isPromptOnly = !plan.transcript_id

        if (hasCustomPrompt) {
          const taskDescription = isPromptOnly
            ? `Generate a ${plan.platform.toUpperCase()} post based on your brand expertise and knowledge.`
            : `Generate a ${plan.platform.toUpperCase()} post from the transcript below.`

          systemPrompt = `${clientPrompt!.system_prompt}

## TASK: ${taskDescription}

Apply ALL your brand rules, compliance checks, and voice guidelines.

${platformRules}

CRITICAL REMINDERS:
- NEVER use em dashes (—). Use commas, periods, colons, or semicolons.
- NEVER use specific numbers unless DIRECTLY quoted from the transcript or system prompt.
- NEVER use hype phrases: "game-changer," "mind-blowing," "buckle up," "let that sink in," "here's the thing," "read that again," "this is huge."
- NEVER use generic filler: "Let me know what you think!", "Drop a comment!", "Follow for more!"
- Output the post ONLY. No commentary, no "here's the post," no meta-notes. Ready to copy-paste.`
        } else {
          systemPrompt = buildFallbackPrompt(clientName, dna?.dna_markdown || null, plan.platform)
        }

        // Build user prompt
        let userPrompt: string

        if (isPromptOnly) {
          userPrompt = `Write ONE original ${plan.platform} post as ${clientName}.

${plan.topic ? `Topic/theme to focus on: ${plan.topic}` : 'Pick the single most compelling topic from the content pillars, proof points, or unique mechanisms in your system prompt.'}

Use the voice, stories, proof points, and content strategy from the system prompt. Go DEEP on one specific idea.

CRITICAL:
- Do NOT invent specific numbers, client names, or case study details not in the system prompt.
- Use only facts, metrics, and examples that appear in the system prompt.
- Write from first person as ${clientName} sharing expertise.
- This is post ${i + 1} of 5 for this week. Cover a DIFFERENT topic than any previous post would cover.
- Output the post only. Ready to publish. No preamble.`
          dnaPosts++
        } else {
          // Get transcript text
          const transcript = validTranscripts.find(t => t.id === plan.transcript_id)
          const transcriptText = transcript?.transcript_text?.slice(0, 15000) || ''

          userPrompt = `Transcript from "${plan.transcript_title}":

---
${transcriptText}
---

Write ONE ${plan.platform} post from this transcript. Pick the single most compelling, unique, or valuable idea and go DEEP on it.

IMPORTANT: This is post ${i + 1} of 5 for this week. Cover a DIFFERENT angle than posts from the same transcript. Focus on what works best for ${plan.platform}'s audience and format.

Output the post only. Ready to publish. No preamble.`
          transcriptPosts++
        }

        try {
          const PLATFORM_MAX_TOKENS: Record<string, number> = {
            linkedin: 1800,
            twitter: 600,
            facebook: 1200,
          }

          const message = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: PLATFORM_MAX_TOKENS[plan.platform] || 1500,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
          })

          const rawContent = message.content
            .filter(b => b.type === 'text')
            .map(b => b.text)
            .join('')

          const cleanedContent = ccPostProcess(rawContent)
          const source = isPromptOnly
            ? `DNA-based${plan.topic ? `: ${plan.topic.slice(0, 40)}` : ''}`
            : `from "${plan.transcript_title}"`

          const platformLabel = plan.platform === 'linkedin' ? 'LinkedIn'
            : plan.platform === 'twitter' ? 'X/Twitter' : 'Facebook'

          postResults.push({
            label: `## Post ${i + 1}: ${platformLabel} (${source})`,
            content: cleanedContent,
          })
        } catch (err) {
          console.error(`[cron] Error generating post ${i + 1} for ${clientName}:`, err)
          postResults.push({
            label: `## Post ${i + 1}: ${plan.platform} (ERROR)`,
            content: `Generation failed: ${err instanceof Error ? err.message : 'unknown error'}`,
          })
        }
      }

      // Combine all posts into markdown
      const combinedMarkdown = postResults
        .map(p => `${p.label}\n\n${p.content}`)
        .join('\n\n---\n\n')

      // Save to generated_content
      const transcriptTitles = Array.from(
        new Set(postPlan.filter(p => p.transcript_title).map(p => p.transcript_title!))
      )
      const sourceList = [
        ...transcriptTitles,
        ...(dnaPosts > 0 ? [`${dnaPosts} DNA-based`] : []),
      ].join(', ')

      const { data: savedContent } = await supabase.from('generated_content').insert({
        client_id: clientId,
        content_type: 'social_posts',
        source_title: sourceList,
        platforms: ['linkedin', 'twitter', 'facebook'],
        content_markdown: combinedMarkdown,
        generated_by: 'weekly_cron',
        status: 'draft',
      }).select('id').single()

      // Save individual posts as content examples for Slack AI training
      // Clean out old AI-generated examples (keep latest 15 per client)
      const { data: oldExamples } = await supabase
        .from('client_content_examples')
        .select('id')
        .eq('client_id', clientId)
        .eq('content_type', 'ai_generated')
        .order('published_at', { ascending: false })

      if (oldExamples && oldExamples.length >= 15) {
        const idsToDelete = oldExamples.slice(10).map(e => e.id) // keep 10, delete rest to make room for 5 new
        if (idsToDelete.length > 0) {
          await supabase.from('client_content_examples').delete().in('id', idsToDelete)
        }
      }

      // Insert each post as a content example
      const contentExampleRows = postResults
        .filter(p => !p.label.includes('ERROR'))
        .map((p, idx) => ({
          client_id: clientId,
          platform: postPlan[idx]?.platform || 'multi',
          content_type: 'ai_generated',
          title: p.content.slice(0, 80),
          content: p.content,
          published_at: new Date().toISOString(),
        }))

      if (contentExampleRows.length > 0) {
        await supabase.from('client_content_examples').insert(contentExampleRows)
      }

      // Append to Google Doc
      let docUrl: string | undefined
      if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
        const folderId = await findClientFolder(clientName)
        const doc = await appendPostsToDoc(clientName, combinedMarkdown, folderId)
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
        transcript_posts: transcriptPosts,
        dna_posts: dnaPosts,
        doc_url: docUrl,
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
      const totalTranscriptPosts = generated.reduce((sum, r) => sum + (r.transcript_posts || 0), 0)
      const totalDNAPosts = generated.reduce((sum, r) => sum + (r.dna_posts || 0), 0)

      const slackMessage = {
        text: `:memo: *Weekly Written Posts Generated*\n\n` +
          `*Total:* ${totalPosts} posts for ${generated.length} clients (${totalTranscriptPosts} from transcripts, ${totalDNAPosts} from DNA)\n\n` +
          (generated.length > 0 ? generated.map(r =>
            `  :white_check_mark: ${r.client_name} (${r.post_count} posts: ${r.transcript_posts} transcript, ${r.dna_posts} DNA)${r.doc_url ? ` - <${r.doc_url}|Open Doc>` : ''}`
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
