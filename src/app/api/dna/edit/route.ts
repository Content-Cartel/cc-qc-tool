import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { replaceSectionInMarkdown } from '@/lib/dna/parser'

/**
 * Manual DNA editing endpoint.
 * Allows PMs to directly edit section content without AI regeneration.
 * Creates a new version on each edit for full history tracking.
 *
 * POST /api/dna/edit
 * Body: { dna_id, section_number, new_markdown, edited_by }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { dna_id, section_number, new_markdown, edited_by } = body

    if (!dna_id || !section_number || !new_markdown) {
      return NextResponse.json(
        { error: 'dna_id, section_number, and new_markdown are required' },
        { status: 400 },
      )
    }

    if (section_number < 1 || section_number > 10) {
      return NextResponse.json({ error: 'section_number must be 1-10' }, { status: 400 })
    }

    const supabase = createClient(
      (process.env.NEXT_PUBLIC_SUPABASE_URL_1 || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
      (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_1 || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
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

    // Merge edited section into full markdown
    const updatedMarkdown = replaceSectionInMarkdown(
      existingDna.dna_markdown,
      section_number,
      new_markdown,
    )

    // Save as new version
    const nextVersion = (existingDna.version || 1) + 1

    const { data: inserted, error: insertError } = await supabase
      .from('client_dna')
      .insert({
        client_id: existingDna.client_id,
        dna_markdown: updatedMarkdown,
        sources: existingDna.sources,
        generated_by: edited_by || 'manual edit',
        version: nextVersion,
        website_url: existingDna.website_url,
        youtube_url: existingDna.youtube_url,
        context: existingDna.context,
      })
      .select()
      .single()

    if (insertError) {
      return NextResponse.json(
        { error: 'Failed to save edit', details: insertError.message },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      dna: inserted,
      section_edited: section_number,
      version: nextVersion,
      edited_by: edited_by || 'manual edit',
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 },
    )
  }
}
