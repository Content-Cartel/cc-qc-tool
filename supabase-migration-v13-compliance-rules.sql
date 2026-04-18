-- ============================================================================
-- Migration v13: per-client compliance rules for the written-post generator
-- ============================================================================
-- Adds a free-text column on `clients` where PMs can paste hard-line
-- compliance rules for each client. The rules render as a dedicated
-- RULE TWO — CLIENT COMPLIANCE block near the top of the generation
-- system prompt, and the model is required to silently verify each
-- draft against the rules before emitting.
--
-- Examples of rules the PM might paste:
--   - Any yield rate (X% annually, X% per annum) MUST include
--     [LEGAL REVIEW REQUIRED — JEFF SIGN-OFF] as an inline header.
--   - NEVER use politicized framing ("war on X", "so-called",
--     "fight back", conspiracy-adjacent language).
--   - NEVER mention "monetary collapse" — even in denial.
--   - Every CTA must tie to the specific opportunity raised in THIS post.
--
-- Format: plain text, one rule per line (or bullet-indented). Rendered
-- verbatim into the prompt, so the PM writes the exact words they want
-- the model to see.
--
-- Rules are optional; clients without rules behave as before.
-- ============================================================================

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS compliance_rules TEXT;

COMMENT ON COLUMN clients.compliance_rules IS
  'Hard-line compliance rules rendered verbatim as RULE TWO in the generation prompt. PM-editable via /admin/compliance-rules/[clientId]. One rule per bullet. Optional.';
