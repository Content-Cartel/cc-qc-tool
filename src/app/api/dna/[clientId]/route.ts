import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { parseDNASections, extractEditorBrief, extractOCIBrief, extractStrategyBrief } from '@/lib/dna/parser'

/**
 * External API endpoint for DNA data.
 * Used by n8n, OCI, and other downstream systems in the Content Intelligence Engine.
 *
 * GET /api/dna/{clientId}
 *   Returns latest DNA for a client.
 *
 * Query params:
 *   ?sections=voice_fingerprint,off_limits   — return only specific sections
 *   ?format=editor_brief                      — condensed for editors
 *   ?format=oci_brief                         — formatted for OCI/n8n editing instructions
 *   ?format=strategy                          — The Play + Content Strategy + The Funnel
 *   ?format=json                              — structured JSON (dna_json column)
 *   ?format=markdown                          — full markdown (default)
 *   ?version=N                                — specific version (default: latest)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const clientId = parseInt(params.clientId, 10)
  if (isNaN(clientId)) {
    return NextResponse.json({ error: 'Invalid client ID' }, { status: 400 })
  }

  const searchParams = req.nextUrl.searchParams
  const format = searchParams.get('format') || 'markdown'
  const sectionsParam = searchParams.get('sections')
  const versionParam = searchParams.get('version')

  const supabase = createClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL_1 || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_1 || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
  )

  // Fetch DNA
  let query = supabase
    .from('client_dna')
    .select('*')
    .eq('client_id', clientId)

  if (versionParam) {
    query = query.eq('version', parseInt(versionParam, 10))
  } else {
    query = query.order('version', { ascending: false }).limit(1)
  }

  const { data: dna, error } = await query.maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Database error', details: error.message }, { status: 500 })
  }

  if (!dna) {
    return NextResponse.json({ error: 'No DNA found for this client' }, { status: 404 })
  }

  // Parse sections
  const parsed = parseDNASections(dna.dna_markdown)

  // Handle format
  if (format === 'editor_brief') {
    return NextResponse.json({
      client_id: clientId,
      version: dna.version,
      format: 'editor_brief',
      content: extractEditorBrief(parsed.sections),
      generated_at: dna.created_at,
    })
  }

  if (format === 'oci_brief') {
    return NextResponse.json({
      client_id: clientId,
      version: dna.version,
      format: 'oci_brief',
      content: extractOCIBrief(parsed.sections),
      generated_at: dna.created_at,
    })
  }

  if (format === 'strategy') {
    return NextResponse.json({
      client_id: clientId,
      version: dna.version,
      format: 'strategy',
      content: extractStrategyBrief(parsed.sections),
      generated_at: dna.created_at,
    })
  }

  if (format === 'json') {
    return NextResponse.json({
      client_id: clientId,
      version: dna.version,
      format: 'json',
      dna_json: dna.dna_json,
      health_score: parsed.overallScore,
      sections_summary: parsed.sections.map(s => ({
        number: s.number,
        title: s.title,
        confidence: s.confidence,
        gap_count: s.gapCount,
      })),
      generated_at: dna.created_at,
    })
  }

  // Handle sections filter
  if (sectionsParam) {
    const requestedSlugs = sectionsParam.split(',').map(s => s.trim().replace(/_/g, '-'))
    const filteredSections = parsed.sections.filter(s =>
      requestedSlugs.includes(s.slug) || requestedSlugs.includes(s.slug.replace(/-/g, '_'))
    )

    return NextResponse.json({
      client_id: clientId,
      version: dna.version,
      format: 'sections',
      sections: filteredSections.map(s => ({
        number: s.number,
        title: s.title,
        slug: s.slug,
        confidence: s.confidence,
        gap_count: s.gapCount,
        markdown: s.markdown,
      })),
      generated_at: dna.created_at,
    })
  }

  // Default: full markdown with metadata
  return NextResponse.json({
    client_id: clientId,
    version: dna.version,
    format: 'markdown',
    dna_markdown: dna.dna_markdown,
    health_score: parsed.overallScore,
    sections_summary: parsed.sections.map(s => ({
      number: s.number,
      title: s.title,
      slug: s.slug,
      confidence: s.confidence,
      gap_count: s.gapCount,
    })),
    sources: dna.sources,
    generated_at: dna.created_at,
    website_url: dna.website_url,
    youtube_url: dna.youtube_url,
  })
}
