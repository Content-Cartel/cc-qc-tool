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
  follow_up: { label: 'Follow Up', color: 'purple' },
} as const

export const EDITING_LEVEL_CONFIG = {
  minimal: { label: 'Minimal', color: 'green', description: 'Podcast-style, light cuts' },
  normal: { label: 'Normal', color: 'blue', description: 'Standard editing' },
  high: { label: 'High', color: 'red', description: 'Dynamic talking-head, strong storytelling' },
} as const

export type EditingLevelKey = keyof typeof EDITING_LEVEL_CONFIG

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
  { key: 'spelling', label: 'Spelling' },
  { key: 'other', label: 'Other' },
  { key: 'client_feedback', label: 'Client Feedback' },
] as const

// ============================================================================
// Task Tracker (v8)
// ============================================================================

export const TASK_STATUS_CONFIG = {
  queued: { label: 'Queued', color: 'blue', icon: 'Clock' },
  in_progress: { label: 'In Progress', color: 'amber', icon: 'Play' },
  in_review: { label: 'In Review', color: 'purple', icon: 'Eye' },
  revision_needed: { label: 'Revision Needed', color: 'red', icon: 'RotateCcw' },
  approved: { label: 'Approved', color: 'green', icon: 'CheckCircle' },
} as const

export type TaskStatusKey = keyof typeof TASK_STATUS_CONFIG

export const TASK_PRIORITY_CONFIG = {
  low: { label: 'Low', color: 'neutral', icon: 'ArrowDown' },
  normal: { label: 'Normal', color: 'blue', icon: 'Minus' },
  high: { label: 'High', color: 'amber', icon: 'ArrowUp' },
  urgent: { label: 'Urgent', color: 'red', icon: 'AlertTriangle' },
} as const

export type TaskPriorityKey = keyof typeof TASK_PRIORITY_CONFIG

export const TASK_CONTENT_TYPE_CONFIG = {
  long_form: { label: 'Long Form', color: 'gold' },
  short_form: { label: 'Short Form', color: 'purple' },
} as const

// Kanban columns for editor view (cannot drag to approved)
export const EDITOR_KANBAN_COLUMNS = ['queued', 'in_progress', 'in_review'] as const
// Kanban columns for PM view (full access)
export const PM_KANBAN_COLUMNS = ['queued', 'in_progress', 'in_review', 'revision_needed', 'approved'] as const

// Deadline thresholds (in hours)
export const DEADLINE_THRESHOLDS = {
  GREEN: 12,   // > 12 hours remaining
  YELLOW: 4,   // 4-12 hours remaining
  RED: 0,      // < 4 hours remaining (or overdue)
} as const
