-- ============================================================================
-- Migration v9b: Backfill Drive/Deepgram transcripts from qc_submissions
-- ============================================================================
-- One-off data migration. Copies completed Drive-origin transcripts that live
-- on qc_submissions into client_transcripts so the Friday cron and Slack
-- trigger can see them.
--
-- Idempotent: ON CONFLICT DO NOTHING against the existing UNIQUE index
-- `idx_client_transcripts_dedup(client_id, source, source_id)`. Safe to re-run.
--
-- Filters:
--   - transcript_status = 'completed' (no garbage from failed Deepgram jobs)
--   - length(transcript) > 200 (no trivial/empty transcripts)
--   - intake_source = 'n8n_drive' (Drive-origin only, not manual/ingested)
-- ============================================================================

INSERT INTO client_transcripts (
  client_id,
  source,
  source_id,
  submission_id,
  title,
  transcript_text,
  word_count,
  recorded_at,
  metadata,
  relevance_tag
)
SELECT
  s.client_id,
  'drive_deepgram'                                                    AS source,
  s.id::text                                                          AS source_id,
  s.id                                                                AS submission_id,
  s.title,
  s.transcript,
  array_length(regexp_split_to_array(s.transcript, E'\\s+'), 1)       AS word_count,
  s.created_at                                                        AS recorded_at,
  jsonb_build_object(
    'backfilled_at', now(),
    'intake_source', s.intake_source,
    'content_type',  s.content_type
  )                                                                   AS metadata,
  'general'                                                           AS relevance_tag
FROM qc_submissions s
WHERE s.transcript IS NOT NULL
  AND length(s.transcript) > 200
  AND s.transcript_status = 'completed'
  AND s.intake_source = 'n8n_drive'
ON CONFLICT (client_id, source, source_id) DO NOTHING;

-- Show how many twin rows now exist so we can verify the backfill landed.
SELECT
  COUNT(*)                                          AS drive_transcripts_total,
  COUNT(DISTINCT client_id)                         AS clients_with_drive_transcripts,
  MIN(created_at)                                   AS earliest_row,
  MAX(created_at)                                   AS latest_row
FROM client_transcripts
WHERE source = 'drive_deepgram';
