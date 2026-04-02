-- Migration V6: Client Prompts table
-- Stores per-client system prompts for content generation (and potentially other AI tasks)
-- Allows each client to have a custom system prompt with compliance rules, voice guidelines, etc.

CREATE TABLE IF NOT EXISTS client_prompts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  prompt_type TEXT NOT NULL DEFAULT 'content_generation',
  system_prompt TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_client_prompts_lookup ON client_prompts(client_id, prompt_type, version DESC);

ALTER TABLE client_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to client_prompts" ON client_prompts
  FOR ALL USING (true) WITH CHECK (true);
