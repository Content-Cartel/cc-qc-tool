-- Migration v7: Spelling check results for on-screen text detection
-- Run this in Supabase SQL editor

-- Table to store automated spelling check results from video frame analysis
create table if not exists spelling_check_results (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid references qc_submissions(id) on delete cascade,
  frame_timestamp_seconds float,
  frame_thumbnail_url text, -- optional: stored frame thumbnail for reference
  detected_text text not null,
  issue_description text not null,
  suggested_fix text not null,
  confidence float default 0.5 check (confidence >= 0 and confidence <= 1),
  status text default 'flagged' check (status in ('flagged', 'dismissed', 'confirmed')),
  dismissed_by text, -- who dismissed the flag (if status = 'dismissed')
  created_at timestamptz default now()
);

-- Index for fast lookup by submission
create index if not exists idx_spelling_checks_submission
  on spelling_check_results(submission_id);

-- Index for finding unresolved flags
create index if not exists idx_spelling_checks_status
  on spelling_check_results(status) where status = 'flagged';

-- Add source_method to client_transcripts metadata for tracking Whisper vs caption quality
-- (metadata is already a jsonb column, no schema change needed, just documenting the convention)
comment on column client_transcripts.metadata is
  'JSON metadata. For YouTube transcripts, includes source_method: "whisper" | "caption" to track transcription quality.';

-- Add metadata column to qc_submissions for storing Deepgram word timestamps
alter table qc_submissions add column if not exists metadata jsonb;

-- RLS policies (match existing pattern)
alter table spelling_check_results enable row level security;

create policy "spelling_check_results_select" on spelling_check_results
  for select using (true);

create policy "spelling_check_results_insert" on spelling_check_results
  for insert with check (true);

create policy "spelling_check_results_update" on spelling_check_results
  for update using (true);
