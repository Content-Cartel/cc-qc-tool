import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/**
 * POST /api/content/seed-prompt
 *
 * Seeds a client system prompt into the client_prompts table.
 * Used to populate custom brand/compliance prompts for specific clients.
 *
 * Body: { client_id, system_prompt, prompt_type?, notes? }
 */
export async function POST(req: NextRequest) {
  const { client_id, system_prompt, prompt_type, notes } = await req.json()

  if (!client_id || !system_prompt) {
    return NextResponse.json({ error: 'client_id and system_prompt are required' }, { status: 400 })
  }

  // Check current version
  const { data: existing } = await supabase
    .from('client_prompts')
    .select('version')
    .eq('client_id', client_id)
    .eq('prompt_type', prompt_type || 'content_generation')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextVersion = (existing?.version || 0) + 1

  const { data, error } = await supabase
    .from('client_prompts')
    .insert({
      client_id,
      prompt_type: prompt_type || 'content_generation',
      system_prompt,
      version: nextVersion,
      notes: notes || `Seeded v${nextVersion}`,
    })
    .select('id, client_id, version')
    .single()

  if (error) {
    if (error.code === '42P01') {
      return NextResponse.json({
        error: 'client_prompts table not found. Run supabase-migration-v6-client-prompts.sql first.',
      }, { status: 500 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    id: data.id,
    client_id: data.client_id,
    version: data.version,
    prompt_length: system_prompt.length,
  })
}
