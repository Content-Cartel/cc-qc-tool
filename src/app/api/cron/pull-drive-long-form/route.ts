import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { findClientFolder, findClientLfSubfolders, listRecentVideosInFolder } from '@/lib/google-docs'
import { enqueueTranscription } from '@/lib/transcribe-enqueue'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL_1 || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY_1 || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_1 || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

/**
 * Long-form folder convention, audited 2026-04-19: every client has a
 * subfolder whose name STARTS with `LF ` (e.g., `LF Monetary Metals`,
 * `LF Travis Hasse`). Some clients have multiple (e.g., Dan Brisse has
 * `LF Dan Brisse` + `LF Podcast Dan Brisse`), so we scan ALL matching
 * folders per client. `findClientLfSubfolders` handles the regex.
 */

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
  /** How many LF folders we found inside this client (0 if none). Multiple
   *  is fine (e.g., `LF <Client>` + `LF Podcast <Client>`) — we scan all. */
  lf_folders_matched: number
  /** Names of LF folders we scanned, for the Slack/audit trail. */
  lf_folder_names?: string[]
  videos_scanned: number
  new_videos_queued: number
  errors: number
  /** When no LF folder matched, list every subfolder name we DID see inside
   *  the client folder. Surfaces drift or missing-setup cases. */
  subfolders_seen?: string[]
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
      lf_folders_matched: 0,
      videos_scanned: 0,
      new_videos_queued: 0,
      errors: 0,
    }

    try {
      // Walk: Shared Drive → client folder → every `LF *` subfolder.
      const clientFolderId = await findClientFolder(client.name)
      if (!clientFolderId) {
        results.push(result)
        continue
      }

      const { lfFolders, siblings } = await findClientLfSubfolders(clientFolderId)
      if (lfFolders.length === 0) {
        // No `LF *` subfolder at all — surface what the client DOES have so
        // we can spot drift (e.g., the editor named it `LongForm Raw`) or
        // flag that an LF folder is missing for this client.
        if (siblings.length > 0) result.subfolders_seen = siblings
        results.push(result)
        continue
      }
      result.lf_folders_matched = lfFolders.length
      result.lf_folder_names = lfFolders.map(f => f.name)

      // Walk each LF folder and collect recent videos. Dedup happens below
      // across the combined pool, so clients with multiple LF folders (e.g.
      // Dan Brisse's `LF Dan Brisse` + `LF Podcast Dan Brisse`) don't
      // double-queue the same file if it somehow lives in both.
      const allVideos: Array<{ id: string; name: string; createdTime: string; mimeType: string; sourceFolderName: string }> = []
      for (const lf of lfFolders) {
        const videos = await listRecentVideosInFolder(lf.id, LOOKBACK_HOURS)
        for (const v of videos) allVideos.push({ ...v, sourceFolderName: lf.name })
      }
      result.videos_scanned = allVideos.length

      if (allVideos.length === 0) {
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

      // Second-layer dedup: if Drive returned the same file from two LF
      // folders, only insert it once.
      const seenInThisTick = new Set<string>()
      const toInsert: Array<Record<string, unknown>> = []
      for (const video of allVideos) {
        if (existingFileIds.has(video.id) || seenInThisTick.has(video.id)) continue
        seenInThisTick.add(video.id)
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

      const { data: inserted, error: insertErr } = await supabase
        .from('qc_submissions')
        .insert(toInsert)
        .select('id, external_url')
      if (insertErr) {
        console.error(`[pull-drive-long-form] insert failed for ${client.name}:`, insertErr.message)
        result.errors += 1
        results.push(result)
        continue
      }

      // Fire transcription immediately for each inserted submission. The 2h
      // auto-transcribe cron still catches any that fail here (its stuck-reset
      // logic re-queues rows wedged in 'processing').
      for (const row of inserted || []) {
        enqueueTranscription({
          supabase,
          submissionId: row.id,
          externalUrl: row.external_url,
        }).catch(err => console.error('[pull-drive-long-form] enqueueTranscription failed:', err))
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
  const clientsWithLf = results.filter(r => r.lf_folders_matched > 0).length
  const clientsMissingLf = results.filter(r => r.lf_folders_matched === 0).length

  // Slack-notify only when something happened — avoid noise on empty ticks.
  if (totalQueued > 0) {
    const slackWebhook = process.env.SLACK_CONTENT_WEBHOOK_URL
    if (slackWebhook) {
      const perClient = results
        .filter(r => r.new_videos_queued > 0)
        .map(r => `  :film_frames: ${r.client_name}: ${r.new_videos_queued} new video${r.new_videos_queued === 1 ? '' : 's'}`)
        .join('\n')
      const message = {
        text: `:satellite_antenna: *Drive LF scan*\n` +
          `${clientsWithLf}/${scannedClients} clients have an LF subfolder · Queued ${totalQueued} new videos\n` +
          perClient + '\n' +
          `Transcription was fired inline for each; the 2h cron is a safety net.`,
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
