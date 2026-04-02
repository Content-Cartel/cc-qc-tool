-- Migration V5: Generated Content table
-- Stores AI-generated written posts (LinkedIn, X, Facebook) from transcripts + DNA
-- Part of the Content Intelligence Engine Layer 3 (Factory)

CREATE TABLE IF NOT EXISTS generated_content (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  content_type TEXT NOT NULL DEFAULT 'social_posts',
  source_title TEXT NOT NULL,
  platforms TEXT[] DEFAULT '{}',
  content_markdown TEXT NOT NULL,
  google_doc_url TEXT,
  generated_by TEXT NOT NULL DEFAULT 'system',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_generated_content_client ON generated_content(client_id, created_at DESC);

-- RLS (permissive for now, matching existing pattern)
ALTER TABLE generated_content ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to generated_content" ON generated_content
  FOR ALL USING (true) WITH CHECK (true);
