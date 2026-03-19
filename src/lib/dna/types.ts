import type { YouTubeChannelData, YouTubeVideoData, YouTubeFullData, YouTubePlaylist } from './youtube'

export type { YouTubeChannelData, YouTubeVideoData, YouTubeFullData, YouTubePlaylist }

export interface ClientDNA {
  id: string
  client_id: number
  dna_markdown: string
  dna_json: DNAProfile | null
  sources: DNASources | null
  generated_by: string
  version: number
  website_url: string | null
  youtube_url: string | null
  context: string | null
  created_at: string
  updated_at: string
}

export interface DNAProfile {
  the_play: {
    thesis: string
    audiences: string
    revenue_streams: string[]
    moat: string
    differentiator: string
    icp: {
      who: string
      where: string
      trigger: string
    }
  }
  voice_fingerprint: {
    formality: number
    energy: number
    technical_depth: number
    sentence_style: string
    teaching_style: string
    humor: string
    opening_pattern: string
    closing_pattern: string
    energy_arc: string
    signature_phrases: string[]
    vocabulary: string
    words_to_avoid: string
    transitions: string[]
    do_sound_like: string[]
    dont_sound_like: string[]
  }
  content_strategy: {
    pillars: { name: string; description: string; subtopics: string[]; engagement_rank?: string }[]
    what_works: string
    double_down: string
    hook_formulas: string[]
    signature_structures: string[]
    platform_priority: string[]
  }
  the_funnel: {
    overview: string
    steps: { step: string; description: string; cta?: string }[]
    active_ctas_by_platform: Record<string, string[]>
    funnel_links: string[]
    lead_magnets: string[]
    cta_language_patterns: string
    funnel_gaps: string
  }
  proof_points: {
    metrics: { topic: string; content: string }[]
    credentials: { topic: string; content: string }[]
    case_studies: { topic: string; content: string }[]
    quotes: { topic: string; content: string }[]
    social_proof: string[]
  }
  visual_identity: {
    colors: string[]
    fonts: string[]
    visual_energy: string
    thumbnail_patterns: string
    template_direction: string
  }
  off_limits: {
    topics: string[]
    language: string[]
    competitor_handling: string
    compliance: string
    cultural_sensitivities: string
  }
  production_playbook: {
    editing_style: string
    cadence: string
    priority_content: string
    ai_editing_instructions: {
      tone_guardrails: string
      terminology_requirements: string
      structure_preferences: string
    }
    atomization: string
    qc_checklist: string[]
  }
  data_gaps: {
    gap: string
    missing: string
    source: string
    priority: string
    impact: string
  }[]
}

export interface DNASources {
  website_data: string | null
  website_pages_scraped?: string[]
  website_pages_attempted?: { url: string; pageType: string; status: string }[]
  website_total_chars?: number
  youtube_data: string | null
  youtube_source_type?: 'api' | 'fallback'
  youtube_api_data?: YouTubeFullData | null
  youtube_videos_analyzed?: number
  youtube_videos_with_descriptions?: number
  youtube_videos_with_tags?: number
  youtube_playlists_found?: number
  transcript_excerpt: string | null
  transcript_word_count?: number
  context_provided: boolean
  total_source_words?: number
  model_used?: string
}

export interface GenerateDNARequest {
  client_id: number
  client_name: string
  website_url?: string
  youtube_url?: string
  context?: string
  transcript?: string
}
