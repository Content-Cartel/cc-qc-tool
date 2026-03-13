-- CC QC Tool: Migration V2 — QC Checklist, Pipeline Stages, Escalations
-- Run in Supabase SQL editor (andcsslmnogpuntfuouh.supabase.co)

-- ============================================================
-- QC Checklist Results: Binary pass/fail for each submission
-- ============================================================
CREATE TABLE IF NOT EXISTS qc_checklist_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES qc_submissions(id) ON DELETE CASCADE,
  reviewer_name TEXT NOT NULL,

  -- 10 binary pass/fail items
  audio_quality BOOLEAN DEFAULT FALSE,
  filler_words BOOLEAN DEFAULT FALSE,
  flow_pacing BOOLEAN DEFAULT FALSE,
  branding BOOLEAN DEFAULT FALSE,
  cta_present BOOLEAN DEFAULT FALSE,
  both_versions BOOLEAN DEFAULT FALSE,
  links_description BOOLEAN DEFAULT FALSE,
  spelling_names BOOLEAN DEFAULT FALSE,
  client_specific_rules BOOLEAN DEFAULT FALSE,
  thumbnail_ready BOOLEAN DEFAULT FALSE,

  -- Computed
  total_passed INTEGER DEFAULT 0,
  total_items INTEGER DEFAULT 10,
  overall_pass BOOLEAN DEFAULT FALSE,

  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qc_checklist_submission
  ON qc_checklist_results(submission_id);

-- ============================================================
-- Pipeline Stages: Track each submission through 8 stages
-- ============================================================
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES qc_submissions(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN (
    'raw_footage', 'ai_auto_clean', 'ai_auto_cut',
    'transcript_instructions', 'editor_polish',
    'qc_review', 'package', 'publish'
  )),
  entered_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  completed_by TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_pipeline_submission ON pipeline_stages(submission_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_stage ON pipeline_stages(stage);

-- ============================================================
-- Add columns to qc_submissions
-- ============================================================
ALTER TABLE qc_submissions
  ADD COLUMN IF NOT EXISTS current_pipeline_stage TEXT DEFAULT 'raw_footage',
  ADD COLUMN IF NOT EXISTS deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qc_score INTEGER;

-- ============================================================
-- Enable realtime
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE qc_checklist_results;
ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_stages;
