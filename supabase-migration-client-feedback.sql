-- Migration: Add 'client_feedback' to qc_notes category constraint
-- Run this in Supabase SQL Editor

ALTER TABLE qc_notes DROP CONSTRAINT IF EXISTS qc_notes_category_check;
ALTER TABLE qc_notes ADD CONSTRAINT qc_notes_category_check
  CHECK (category IN ('brand', 'technical', 'creative', 'copy', 'audio', 'other', 'client_feedback'));
