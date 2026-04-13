-- Migration V8: Editing Instructions (V2 Editorial Director) on qc_submissions
-- Stores the 7-section editorial blueprint generated from a submission's transcript.

ALTER TABLE qc_submissions
  ADD COLUMN IF NOT EXISTS editing_instructions JSONB,
  ADD COLUMN IF NOT EXISTS editing_instructions_generated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_qc_submissions_editing_instructions
  ON qc_submissions(editing_instructions_generated_at DESC)
  WHERE editing_instructions IS NOT NULL;
