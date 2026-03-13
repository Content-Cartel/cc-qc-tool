-- CC QC Tool: Supabase Migration (Video QC MVP)
-- Run this in the Supabase SQL editor for the existing instance
-- (andcsslmnogpuntfuouh.supabase.co)

-- ============================================================
-- QC Submissions: Core entity for all submitted work
-- ============================================================
CREATE TABLE IF NOT EXISTS qc_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  submitted_by_name TEXT NOT NULL,
  client_id INTEGER NOT NULL REFERENCES clients(id),

  content_type TEXT NOT NULL CHECK (content_type IN ('lf_video', 'sf_video')),
  title TEXT NOT NULL,
  description TEXT,

  -- Video reference (Google Drive link)
  external_url TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'in_review', 'approved', 'revision_requested', 'resubmitted'
  )),

  -- PM review
  pm_reviewed_by_name TEXT,
  pm_decision TEXT CHECK (pm_decision IN ('approved', 'revision_requested')),
  pm_reviewed_at TIMESTAMPTZ,

  -- Revision tracking
  revision_of UUID REFERENCES qc_submissions(id),
  revision_count INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- QC Notes: Timestamped notes for video review
-- ============================================================
CREATE TABLE IF NOT EXISTS qc_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES qc_submissions(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  note TEXT NOT NULL,
  timestamp_seconds REAL,
  category TEXT CHECK (category IN ('brand', 'technical', 'creative', 'copy', 'audio', 'other')),
  is_resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_qc_submissions_status ON qc_submissions(status);
CREATE INDEX IF NOT EXISTS idx_qc_submissions_client ON qc_submissions(client_id);
CREATE INDEX IF NOT EXISTS idx_qc_submissions_editor ON qc_submissions(submitted_by_name);
CREATE INDEX IF NOT EXISTS idx_qc_submissions_created ON qc_submissions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qc_notes_submission ON qc_notes(submission_id);

-- ============================================================
-- Enable realtime for QC tables
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE qc_submissions;
ALTER PUBLICATION supabase_realtime ADD TABLE qc_notes;
