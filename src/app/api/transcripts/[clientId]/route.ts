import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL_1 || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY_1 || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_1 || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

/**
 * GET /api/transcripts/{clientId}
 * Returns available transcripts summary for the generate UI.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const supabase = getSupabase()
  const { clientId } = await params
  const id = parseInt(clientId)
  if (isNaN(id)) {
    return Response.json({ error: 'Invalid client ID' }, { status: 400 })
  }

  const { data: transcripts, error } = await supabase
    .from('client_transcripts')
    .select('id, source, source_id, title, word_count, duration_seconds, recorded_at, relevance_tag, metadata')
    .eq('client_id', id)
    .order('recorded_at', { ascending: false })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  const fathom = (transcripts || [])
    .filter(t => t.source === 'fathom')
    .map(t => ({
      id: t.id,
      title: t.title,
      recorded_at: t.recorded_at,
      word_count: t.word_count,
      duration_seconds: t.duration_seconds,
      relevance_tag: t.relevance_tag,
    }))

  const youtube = (transcripts || [])
    .filter(t => t.source === 'youtube')
    .map(t => ({
      id: t.id,
      video_id: t.source_id,
      title: t.title,
      recorded_at: t.recorded_at,
      word_count: t.word_count,
      duration_seconds: t.duration_seconds,
      view_count: (t.metadata as Record<string, unknown>)?.view_count || null,
    }))

  const fathomWords = fathom.reduce((sum, t) => sum + (t.word_count || 0), 0)
  const youtubeWords = youtube.reduce((sum, t) => sum + (t.word_count || 0), 0)

  return Response.json({
    fathom,
    youtube,
    totals: {
      fathom: fathom.length,
      youtube: youtube.length,
      total_words: fathomWords + youtubeWords,
    },
    fathom_configured: !!process.env.FATHOM_API_KEY,
  })
}
