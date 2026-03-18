-- Migration V3: Client DNA table
-- Run this on your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS client_dna (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  dna_markdown TEXT NOT NULL,
  dna_json JSONB,
  sources JSONB,
  generated_by TEXT NOT NULL DEFAULT 'system',
  version INTEGER NOT NULL DEFAULT 1,
  website_url TEXT,
  youtube_url TEXT,
  context TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookups by client
CREATE INDEX IF NOT EXISTS idx_client_dna_client_id ON client_dna(client_id);

-- Only keep latest version easily accessible
CREATE INDEX IF NOT EXISTS idx_client_dna_latest ON client_dna(client_id, version DESC);

-- Enable RLS
ALTER TABLE client_dna ENABLE ROW LEVEL SECURITY;

-- Allow all operations (matches existing QC tool pattern - localStorage auth, no Supabase auth)
CREATE POLICY "Allow all access to client_dna" ON client_dna
  FOR ALL USING (true) WITH CHECK (true);
