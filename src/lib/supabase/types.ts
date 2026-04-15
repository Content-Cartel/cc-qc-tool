export type UserRole = 'editor' | 'pm' | 'admin'  // Legacy — kept for backward compat
export type AppRole = 'editor' | 'production_manager' | 'admin'
export type ContentType = 'lf_video' | 'sf_video'
export type SubmissionStatus = 'pending' | 'in_review' | 'approved' | 'revision_requested' | 'resubmitted' | 'follow_up'
export type NoteCategory = 'brand' | 'technical' | 'creative' | 'copy' | 'audio' | 'other' | 'client_feedback'
export type PipelineStageKey = 'raw_footage' | 'ai_auto_clean' | 'editor_polish' | 'qc_review' | 'package' | 'publish'
export type EditingLevel = 'minimal' | 'normal' | 'high'

export type TranscriptStatus = 'pending' | 'processing' | 'completed' | 'failed'
export type IntakeSource = 'manual' | 'n8n_drive'

export interface QCSubmission {
  id: string
  submitted_by_name: string
  client_id: number
  content_type: ContentType
  title: string
  description: string | null
  external_url: string | null
  status: SubmissionStatus
  pm_reviewed_by_name: string | null
  pm_decision: 'approved' | 'revision_requested' | null
  pm_reviewed_at: string | null
  revision_of: string | null
  revision_count: number
  current_pipeline_stage: PipelineStageKey
  editing_level: EditingLevel | null
  deadline: string | null
  qc_score: number | null
  transcript: string | null
  transcript_status: TranscriptStatus | null
  intake_source: IntakeSource
  created_at: string
  updated_at: string
  // Joined
  clients?: { name: string } | null
  client_name?: string
}

export interface QCNote {
  id: string
  submission_id: string
  author_name: string
  note: string
  timestamp_seconds: number | null
  category: NoteCategory | null
  is_resolved: boolean
  resolved_at: string | null
  created_at: string
}

export interface QCChecklistResult {
  id: string
  submission_id: string
  reviewer_name: string
  audio_quality: boolean
  filler_words: boolean
  flow_pacing: boolean
  branding: boolean
  cta_present: boolean
  both_versions: boolean
  links_description: boolean
  spelling_names: boolean
  client_specific_rules: boolean
  thumbnail_ready: boolean
  total_passed: number
  total_items: number
  overall_pass: boolean
  notes: string | null
  created_at: string
}

export interface Notification {
  id: string
  user_name: string
  submission_id: string | null
  message: string
  type: string
  is_read: boolean
  created_at: string
}

export interface PipelineStage {
  id: string
  submission_id: string
  stage: PipelineStageKey
  entered_at: string
  completed_at: string | null
  completed_by: string | null
  notes: string | null
}

// ============================================================================
// Auth & Profiles (v8)
// ============================================================================

export interface Profile {
  id: string
  display_name: string
  email: string | null
  role: AppRole
  slack_user_id: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface EditorAssignment {
  id: string
  editor_id: string
  client_id: number
  assigned_by: string | null
  assigned_at: string
  // Joined
  profiles?: { display_name: string } | null
  clients?: { name: string } | null
}

// ============================================================================
// Tasks (v8)
// ============================================================================

export type TaskContentType = 'long_form' | 'short_form'
export type TaskStatus = 'queued' | 'in_progress' | 'in_review' | 'revision_needed' | 'approved'
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface Task {
  id: string
  client_id: number
  editor_id: string | null
  created_by: string
  title: string
  content_type: TaskContentType
  status: TaskStatus
  priority: TaskPriority
  deadline: string
  source_file_url: string | null
  editing_instructions: string | null
  notes: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  // Joined
  clients?: { name: string } | null
  client_name?: string
  profiles?: { display_name: string } | null
  editor_name?: string
}

export interface TaskActivityLog {
  id: string
  task_id: string
  actor_id: string | null
  action: string
  old_value: string | null
  new_value: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}
