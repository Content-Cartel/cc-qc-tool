import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

/**
 * POST /api/content/save-posts
 *
 * Saves generated posts to the generated_content table.
 * Also stores in a format ready for Google Docs export when credentials are configured.
 */
export async function POST(req: NextRequest) {
  const supabase = getSupabase()
  const { client_id, transcript_title, platforms, content, generated_by } = await req.json()

  if (!client_id || !content) {
    return NextResponse.json({ error: 'client_id and content are required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('generated_content')
    .insert({
      client_id,
      content_type: 'social_posts',
      source_title: transcript_title || 'Untitled transcript',
      platforms: platforms || [],
      content_markdown: content,
      generated_by: generated_by || 'system',
      status: 'draft',
    })
    .select('id')
    .single()

  if (error) {
    // Table might not exist yet — provide helpful error
    if (error.code === '42P01') {
      return NextResponse.json({
        error: 'generated_content table not found. Run the migration to create it.',
        migration: MIGRATION_SQL,
      }, { status: 500 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, id: data.id })
}

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS generated_content (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  content_type TEXT NOT NULL DEFAULT 'social_posts',
  source_title TEXT NOT NULL,
  platforms TEXT[] DEFAULT '{}',
  content_markdown TEXT NOT NULL,
  google_doc_url TEXT,
  generated_by TEXT NOT NULL DEFAULT 'system',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_generated_content_client ON generated_content(client_id, created_at DESC);
`
