-- Migration v4: client_transcripts table for Fathom + YouTube transcript storage
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS client_transcripts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  source TEXT NOT NULL,                    -- 'fathom' or 'youtube'
  source_id TEXT NOT NULL,                 -- Fathom recording_id or YouTube video_id (dedup key)
  title TEXT,                              -- Meeting title or video title
  transcript_text TEXT NOT NULL,           -- Full transcript
  summary TEXT,                            -- Fathom summary markdown (null for YT)
  speaker_names TEXT[],                    -- Array of speaker names (Fathom)
  word_count INTEGER,                      -- Pre-computed
  duration_seconds INTEGER,                -- Meeting/video duration
  recorded_at TIMESTAMPTZ,                 -- When meeting/video happened
  metadata JSONB DEFAULT '{}',             -- Flexible: Fathom invitees, YT view count, etc.
  relevance_tag TEXT DEFAULT 'general',    -- 'onboarding', 'strategy', 'content_review', 'general'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prevent duplicate inserts from same source
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_transcripts_dedup
  ON client_transcripts(client_id, source, source_id);

-- Fast lookup during DNA generation
CREATE INDEX IF NOT EXISTS idx_client_transcripts_client
  ON client_transcripts(client_id, source);

-- RLS: permissive (matches existing tool auth pattern)
ALTER TABLE client_transcripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to client_transcripts"
  ON client_transcripts FOR ALL USING (true);
