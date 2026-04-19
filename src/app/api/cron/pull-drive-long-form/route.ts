import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { findClientFolder, findClientSubfolder, listRecentVideosInFolder } from '@/lib/google-docs'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL_1 || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY_1 || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_1 || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

/**
 * Subfolder name inside each client's Shared Drive folder where editors drop
 * raw long-form videos. Case-insensitive match — handles `LF raw`, `LF Raw`,
 * `LF RAW`, etc. Convention established by the creative team.
 */
const LF_SUBFOLDER_NAME = 'LF raw'

/**
 * How far back to look for new videos per tick. The cron runs every 2 hours;
 * a 72-hour lookback absorbs 36 missed ticks — more than enough buffer for
 * Railway outages, env var rotations, or Vercel incidents without losing
 * content. Dedup via `external_url` containing the file ID means we don't
 * re-insert videos we've already queued.
 */
const LOOKBACK_HOURS = 72

interface ClientResult {
  client_id: number
  client_name: string
  lf_folder_found: boolean
  videos_scanned: number
  new_videos_queued: number
  errors: number
}

/**
 * GET /api/cron/pull-drive-long-form
 *
 * Polls each active client's `LF raw` subfolder in the Shared Drive for new
 * video files and inserts qc_submissions rows for any we haven't seen. The
 * auto-transcribe cron picks those up on its next tick and fires them at
 * the Railway Deepgram worker; the webhook then bridges into client_transcripts
 * for the Friday post-gen to consume.
 *
 * Zero webhook changes — this is intake only. Dedup via external_url matching
 * on the Drive file ID. Missing LF subfolder is a non-error (skip with log).
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

  // Pull the roster of clients we poll for. Match the same phase filter the
  // weekly-posts cron uses so we don't pull videos for clients we won't
  // generate posts for anyway.
  const { data: clients, error: clientsErr } = await supabase
    .from('clients')
    .select('id, name')
    .in('phase', ['production', 'active', 'onboarding', 'special'])
    .order('name')

  if (clientsErr) {
    return NextResponse.json({ error: clientsErr.message }, { status: 500 })
  }
  if (!clients || clients.length === 0) {
    return NextResponse.json({ message: 'No eligible clients', results: [] })
  }

  const results: ClientResult[] = []
  let totalQueued = 0

  for (const client of clients) {
    const result: ClientResult = {
      client_id: client.id,
      client_name: client.name,
      lf_folder_found: false,
      videos_scanned: 0,
      new_videos_queued: 0,
      errors: 0,
    }

    try {
      // Walk: Shared Drive → client folder → LF raw subfolder.
      const clientFolderId = await findClientFolder(client.name)
      if (!clientFolderId) {
        results.push(result)
        continue
      }

      const lfFolderId = await findClientSubfolder(clientFolderId, LF_SUBFOLDER_NAME)
      if (!lfFolderId) {
        results.push(result)
        continue
      }
      result.lf_folder_found = true

      const videos = await listRecentVideosInFolder(lfFolderId, LOOKBACK_HOURS)
      result.videos_scanned = videos.length

      if (videos.length === 0) {
        results.push(result)
        continue
      }

      // Dedup: pull every existing qc_submissions external_url for this client
      // once and check each video's file ID against it. Cheaper than N queries.
      const { data: existing } = await supabase
        .from('qc_submissions')
        .select('external_url')
        .eq('client_id', client.id)
        .not('external_url', 'is', null)

      const existingFileIds = new Set<string>()
      for (const row of existing || []) {
        const url = row.external_url || ''
        // Drive file ID pattern inside /file/d/{ID}/ or /d/{ID}
        const match = url.match(/\/(?:file\/)?d\/([A-Za-z0-9_-]{10,})/)
        if (match) existingFileIds.add(match[1])
      }

      const toInsert: Array<Record<string, unknown>> = []
      for (const video of videos) {
        if (existingFileIds.has(video.id)) continue
        // Strip extension for a cleaner title (e.g., "Wsbwar.mp4" → "Wsbwar").
        const title = video.name.replace(/\.[^.]+$/, '').trim() || video.name
        toInsert.push({
          title,
          external_url: `https://drive.google.com/file/d/${video.id}/view`,
          client_id: client.id,
          content_type: 'lf_video',
          status: 'pending',
          current_pipeline_stage: 'raw_footage',
          intake_source: 'drive_lf_cron',
          submitted_by_name: 'drive-lf-cron',
          revision_count: 0,
        })
      }

      if (toInsert.length === 0) {
        results.push(result)
        continue
      }

      const { error: insertErr } = await supabase.from('qc_submissions').insert(toInsert)
      if (insertErr) {
        console.error(`[pull-drive-long-form] insert failed for ${client.name}:`, insertErr.message)
        result.errors += 1
        results.push(result)
        continue
      }

      result.new_videos_queued = toInsert.length
      totalQueued += toInsert.length
      results.push(result)
    } catch (err) {
      console.error(`[pull-drive-long-form] error for ${client.name}:`, err)
      result.errors += 1
      results.push(result)
    }
  }

  const scannedClients = results.length
  const clientsWithLf = results.filter(r => r.lf_folder_found).length
  const clientsMissingLf = results.filter(r => !r.lf_folder_found).length

  // Slack-notify only when something happened — avoid noise on empty ticks.
  if (totalQueued > 0) {
    const slackWebhook = process.env.SLACK_CONTENT_WEBHOOK_URL
    if (slackWebhook) {
      const perClient = results
        .filter(r => r.new_videos_queued > 0)
        .map(r => `  :film_frames: ${r.client_name}: ${r.new_videos_queued} new video${r.new_videos_queued === 1 ? '' : 's'}`)
        .join('\n')
      const message = {
        text: `:satellite_antenna: *Drive LF-raw scan*\n` +
          `Scanned ${clientsWithLf}/${scannedClients} clients with an LF raw folder · Queued ${totalQueued} new videos\n` +
          perClient + '\n' +
          `Auto-transcribe will pick these up within 2 hours.`,
      }
      fetch(slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      }).catch(err => console.error('[pull-drive-long-form] Slack notify failed:', err))
    }
  }

  return NextResponse.json({
    scanned_clients: scannedClients,
    clients_with_lf_folder: clientsWithLf,
    clients_missing_lf_folder: clientsMissingLf,
    new_videos_queued: totalQueued,
    lookback_hours: LOOKBACK_HOURS,
    results,
  })
}
