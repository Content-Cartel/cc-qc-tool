export const QC_CHECKLIST_ITEMS = [
  { key: 'audio_quality', label: 'Audio Quality', description: 'Clean audio, no distortion, proper levels' },
  { key: 'filler_words', label: 'Filler Words', description: 'No ums, uhs, repeated words, or awkward pauses' },
  { key: 'flow_pacing', label: 'Flow + Pacing', description: 'Video flows naturally, no dead air, engaging pace' },
  { key: 'branding', label: 'Branding', description: 'Correct intro/outro, lower thirds, fonts, colors match brand' },
  { key: 'cta_present', label: 'CTA Present', description: 'Verbal CTA exists, pinned comment ready, description links correct' },
  { key: 'both_versions', label: 'Both Versions', description: 'Full version + no-BGM/SFX version both delivered (if required)' },
  { key: 'links_description', label: 'Links + Description', description: 'All links work, description text correct' },
  { key: 'spelling_names', label: 'Spelling + Names', description: 'All names, company names, titles spelled correctly' },
  { key: 'client_specific_rules', label: 'Client-Specific Rules', description: 'Any client-specific requirements met' },
  { key: 'thumbnail_ready', label: 'Thumbnail Ready', description: 'Thumbnail designed and uploaded' },
] as const

export type QCChecklistKey = typeof QC_CHECKLIST_ITEMS[number]['key']

export const PIPELINE_STAGES = [
  { key: 'raw_footage', label: 'Raw Footage', icon: 'Film', sla: 'Day 0' },
  { key: 'ai_auto_clean', label: 'AI Clean', icon: 'Sparkles', sla: '4 hours' },
  { key: 'ai_auto_cut', label: 'AI Cut', icon: 'Scissors', sla: 'Auto' },
  { key: 'transcript_instructions', label: 'Transcript', icon: 'FileText', sla: 'Auto' },
  { key: 'editor_polish', label: 'Editor Polish', icon: 'Pen', sla: '24 hours' },
  { key: 'qc_review', label: 'QC Review', icon: 'CheckSquare', sla: '2-3 hours' },
  { key: 'package', label: 'Package', icon: 'Package', sla: '1 hour' },
  { key: 'publish', label: 'Publish', icon: 'Globe', sla: 'Per schedule' },
] as const

export type PipelineStageKey = typeof PIPELINE_STAGES[number]['key']

export const STATUS_CONFIG = {
  pending: { label: 'Pending Review', color: 'blue' },
  in_review: { label: 'In Review', color: 'amber' },
  approved: { label: 'Approved', color: 'green' },
  revision_requested: { label: 'Revision Requested', color: 'red' },
  resubmitted: { label: 'Resubmitted', color: 'blue' },
} as const

export const CONTENT_TYPE_CONFIG = {
  lf_video: { label: 'LF Video', color: 'gold' },
  sf_video: { label: 'SF Video', color: 'purple' },
} as const

export const NOTE_CATEGORIES = [
  { key: 'creative', label: 'Creative' },
  { key: 'technical', label: 'Technical' },
  { key: 'brand', label: 'Brand' },
  { key: 'copy', label: 'Copy/Text' },
  { key: 'audio', label: 'Audio' },
  { key: 'other', label: 'Other' },
] as const
