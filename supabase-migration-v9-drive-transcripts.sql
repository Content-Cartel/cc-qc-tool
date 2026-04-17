-- ============================================================================
-- Migration v9: Drive/Deepgram transcript bridge for client_transcripts
-- ============================================================================
-- Adds:
-- 1. submission_id column on client_transcripts (points back to qc_submissions
--    when the Drive transcript originated from a QC submission).
-- 2. Index for reverse lookup from a submission.
--
-- Convention (no DDL required): source='drive_deepgram' is the new source tag
-- for transcripts created by the Drive → Deepgram path. The existing
-- `idx_client_transcripts_dedup` UNIQUE(client_id, source, source_id) already
-- prevents duplicates across this path; source_id is the Drive file id (or the
-- qc_submissions.id when a submission is tied to the transcript).
--
-- Backfill of existing qc_submissions transcripts into client_transcripts is
-- handled by scripts/backfill-drive-transcripts.ts (runs once, idempotent).
-- ============================================================================

ALTER TABLE client_transcripts
  ADD COLUMN IF NOT EXISTS submission_id UUID REFERENCES qc_submissions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_client_transcripts_submission
  ON client_transcripts(client_id, submission_id)
  WHERE submission_id IS NOT NULL;

COMMENT ON COLUMN client_transcripts.submission_id IS
  'Optional pointer to qc_submissions row when the transcript originated from a QC submission (Drive/Deepgram path).';
