import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { replaceSectionInMarkdown } from '@/lib/dna/parser'

export const maxDuration = 60

const SECTION_NAMES: Record<number, string> = {
  1: 'The Play',
  2: 'Voice Fingerprint',
  3: 'Content Strategy',
  4: 'The Funnel',
  5: 'Proof Points',
  6: 'Visual Identity',
  7: 'Off-Limits',
  8: 'Production Playbook',
  9: 'Data Gaps & Next Steps',
}

interface RegenerateSectionRequest {
  dna_id: string
  section_number: number
  additional_context: string
}

export async function POST(req: NextRequest) {
  try {
    const body: RegenerateSectionRequest = await req.json()
    const { dna_id, section_number, additional_context } = body

    if (!dna_id || !section_number) {
      return NextResponse.json({ error: 'dna_id and section_number are required' }, { status: 400 })
    }

    const sectionName = SECTION_NAMES[section_number]
    if (!sectionName) {
      return NextResponse.json({ error: 'Invalid section_number (1-9)' }, { status: 400 })
    }

    const anthropicKey = process.env.CC_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
    if (!anthropicKey || anthropicKey === 'your-anthropic-api-key-here') {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )

    // Fetch existing DNA
    const { data: existingDna, error: fetchError } = await supabase
      .from('client_dna')
      .select('*')
      .eq('id', dna_id)
      .single()

    if (fetchError || !existingDna) {
      return NextResponse.json({ error: 'DNA profile not found' }, { status: 404 })
    }

    const model = process.env.DNA_MODEL || 'claude-sonnet-4-20250514'
    const anthropic = new Anthropic({ apiKey: anthropicKey })

    const prompt = `You are the Content Cartel Client DNA Generator — operator-level strategy playbooks. You previously generated a full DNA playbook. Now REGENERATE ONLY Section ${section_number}: ${sectionName}.

## EXISTING FULL DNA PLAYBOOK:
${existingDna.dna_markdown}

## ADDITIONAL CONTEXT FROM THE TEAM:
${additional_context}

---

## INSTRUCTIONS:
1. Using the existing DNA and the new context, regenerate ONLY Section ${section_number}: ${sectionName}.
2. Output ONLY the section, starting with: ## ${section_number}. ${sectionName.toUpperCase()}
3. Make it MORE SPECIFIC and ACTIONABLE than the original.
4. Write like an operator — prescriptive, punchy, no filler.
5. NEVER guess — use [NEEDS DATA — source: X], [NEEDS CONFIRMATION — ask client], or [INFERRED — verify: reason].
6. Every claim must trace to data. Target 40% fewer words than default.

Output ONLY the regenerated section. No other sections or preamble.`

    const message = await anthropic.messages.create({
      model,
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    })

    const newSectionMarkdown = message.content
      .filter(block => block.type === 'text')
      .map(block => (block as { type: 'text'; text: string }).text)
      .join('\n')

    if (!newSectionMarkdown) {
      return NextResponse.json({ error: 'Failed to regenerate section' }, { status: 500 })
    }

    // Merge back into full markdown
    const updatedMarkdown = replaceSectionInMarkdown(
      existingDna.dna_markdown,
      section_number,
      newSectionMarkdown,
    )

    // Save as new version
    const nextVersion = (existingDna.version || 1) + 1

    const { data: inserted, error: insertError } = await supabase
      .from('client_dna')
      .insert({
        client_id: existingDna.client_id,
        dna_markdown: updatedMarkdown,
        sources: existingDna.sources,
        generated_by: `Section ${section_number} regen`,
        version: nextVersion,
        website_url: existingDna.website_url,
        youtube_url: existingDna.youtube_url,
        context: existingDna.context,
      })
      .select()
      .single()

    if (insertError) {
      return NextResponse.json({ error: 'Failed to save updated DNA', details: insertError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      dna: inserted,
      section_regenerated: section_number,
      version: nextVersion,
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 },
    )
  }
}
