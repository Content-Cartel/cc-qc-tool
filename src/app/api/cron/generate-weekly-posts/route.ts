import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { findClientFolder, appendPostsToDoc } from '@/lib/google-docs'
import { ccPostProcess } from '@/lib/content/cc-rules'

export const maxDuration = 300 // 5 min for batch processing

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/**
 * GET /api/cron/generate-weekly-posts
 *
 * Vercel Cron job that runs every Friday.
 * Generates LinkedIn, X, and Facebook posts for all clients
 * that have both DNA and transcripts.
 * Saves to generated_content table and notifies Slack.
 */
export async function GET(req: NextRequest) {
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

  const platforms: ('linkedin' | 'twitter' | 'facebook')[] = ['linkedin', 'twitter', 'facebook']
  const results: { client_name: string; status: string; post_count?: number; doc_url?: string }[] = []

  try {
    // 1. Find all clients with DNA
    const { data: dnaRecords } = await supabase
      .from('client_dna')
      .select('client_id')
      .order('version', { ascending: false })

    if (!dnaRecords || dnaRecords.length === 0) {
      return NextResponse.json({ message: 'No clients with DNA found', results: [] })
    }

    // Dedupe to unique client IDs (latest version only)
    const clientIdsWithDNA = Array.from(new Set(dnaRecords.map(d => d.client_id)))

    // 2. For each client, check if they have transcripts
    for (const clientId of clientIdsWithDNA) {
      // Get client name
      const { data: client } = await supabase
        .from('clients')
        .select('name')
        .eq('id', clientId)
        .single()

      const clientName = client?.name || `Client ${clientId}`

      // Get latest CONTENT transcript (exclude onboarding/strategy calls — those are internal)
      // Priority: YouTube > content_review > general. Never use onboarding/strategy calls for posts.
      const { data: transcripts } = await supabase
        .from('client_transcripts')
        .select('id, title, transcript_text, source, relevance_tag')
        .eq('client_id', clientId)
        .not('relevance_tag', 'in', '("onboarding","strategy")')
        .order('recorded_at', { ascending: false })
        .limit(1)

      if (!transcripts || transcripts.length === 0 || !transcripts[0].transcript_text) {
        results.push({ client_name: clientName, status: 'skipped: no content transcripts (only onboarding/strategy calls)' })
        continue
      }

      const transcript = transcripts[0]

      // Get DNA
      const { data: dna } = await supabase
        .from('client_dna')
        .select('dna_markdown')
        .eq('client_id', clientId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle()

      // Get custom prompt (if exists)
      const { data: clientPrompt } = await supabase
        .from('client_prompts')
        .select('system_prompt')
        .eq('client_id', clientId)
        .eq('prompt_type', 'content_generation')
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle()

      const hasCustomPrompt = !!clientPrompt?.system_prompt

      // Build prompts
      const platformInstructions = platforms.map(p => {
        switch (p) {
          case 'linkedin':
            return `## LinkedIn Post
- 1,500-2,500 characters, long-form educational post
- Bold counterintuitive hook, then teach with concrete examples and numbers
- Short paragraphs, NO bullet points, NO numbered lists
- NO hashtags, NO emojis, NEVER use em dashes
- End with CTA + P.S. addressing an objection`
          case 'twitter':
            return `## X (Twitter) Post
- 280 chars main tweet, or 3-5 tweet thread for deeper content
- Strongest hook first. Punchy, no filler. NEVER use em dashes. 1-2 hashtags max`
          case 'facebook':
            return `## Facebook Post
- 100-250 words, conversational. Mini-story or lesson. NEVER use em dashes
- Question at end to encourage comments. No hashtags`
          default:
            return ''
        }
      }).join('\n\n')

      let systemPrompt: string
      if (hasCustomPrompt) {
        systemPrompt = `${clientPrompt.system_prompt}\n\n## ADDITIONAL CONTEXT\nYou are generating social media posts from a transcript. Apply ALL brand rules and compliance checks.\nCRITICAL: NEVER use em dashes.\n\n${platformInstructions}`
      } else {
        systemPrompt = `You are a content repurposing specialist for ${clientName}. Take transcript content and create platform-specific posts.\n\n${dna?.dna_markdown ? `## Client Voice DNA\n${dna.dna_markdown}` : ''}\n\n## Rules\n1. ONE clear idea per post, go DEEP\n2. Expert-to-peer voice, not salesy\n3. Specific examples and numbers from the transcript\n4. Never invent facts\n5. DIFFERENT angle per platform\n6. NEVER use em dashes\n7. CTA should reference client's actual offer or use [INSERT CTA LINK]\n\n${platformInstructions}`
      }

      const userPrompt = `Transcript from "${transcript.title}":\n\n---\n${transcript.transcript_text.slice(0, 15000)}\n${transcript.transcript_text.length > 15000 ? '\n[Truncated]' : ''}\n---\n\nGenerate posts for: ${platforms.join(', ')}. Each ready to publish.`

      try {
        const anthropic = new Anthropic({ apiKey: anthropicKey })

        const message = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        })

        const rawContent = message.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('')

        const cleanedContent = ccPostProcess(rawContent)

        // Save to generated_content
        const { data: savedContent } = await supabase.from('generated_content').insert({
          client_id: clientId,
          content_type: 'social_posts',
          source_title: transcript.title,
          platforms,
          content_markdown: cleanedContent,
          generated_by: 'weekly_cron',
          status: 'draft',
        }).select('id').single()

        // Append to existing Google Doc in client's Drive folder (or create if first time)
        let docUrl: string | undefined
        if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
          const folderId = await findClientFolder(clientName)
          const doc = await appendPostsToDoc(clientName, cleanedContent, folderId)
          if (doc) {
            docUrl = doc.url
            if (savedContent?.id) {
              await supabase.from('generated_content')
                .update({ google_doc_url: doc.url })
                .eq('id', savedContent.id)
            }
          }
        }

        results.push({
          client_name: clientName,
          status: 'generated',
          post_count: platforms.length,
          doc_url: docUrl,
        })
      } catch (err) {
        console.error(`[cron] Error generating for ${clientName}:`, err)
        results.push({
          client_name: clientName,
          status: `error: ${err instanceof Error ? err.message : 'unknown'}`,
        })
      }
    }

    // 3. Send Slack notification
    const slackWebhook = process.env.SLACK_CONTENT_WEBHOOK_URL
    if (slackWebhook) {
      const generated = results.filter(r => r.status === 'generated')
      const skipped = results.filter(r => r.status.startsWith('skipped'))
      const errors = results.filter(r => r.status.startsWith('error'))

      const slackMessage = {
        text: `:memo: *Weekly Written Posts Generated*\n\n` +
          `*Generated:* ${generated.length} clients\n` +
          (generated.length > 0 ? generated.map(r =>
            `  :white_check_mark: ${r.client_name} (${r.post_count} posts)${r.doc_url ? ` - <${r.doc_url}|Open Doc>` : ''}`
          ).join('\n') + '\n' : '') +
          (skipped.length > 0 ? `\n*Skipped:* ${skipped.length} (no transcripts)\n` : '') +
          (errors.length > 0 ? `\n*Errors:* ${errors.length}\n${errors.map(r => `  :x: ${r.client_name}: ${r.status}`).join('\n')}\n` : '') +
          `\nGhazi, review the docs and send to scheduler when ready.`,
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
      total_clients: clientIdsWithDNA.length,
      generated: results.filter(r => r.status === 'generated').length,
      skipped: results.filter(r => r.status.startsWith('skipped')).length,
      errors: results.filter(r => r.status.startsWith('error')).length,
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
