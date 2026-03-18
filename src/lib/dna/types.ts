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
  brand_identity: {
    voice: string
    tone: string
    personality: string
  }
  content_pillars: string[]
  target_audience: {
    demographics: string
    psychographics: string
    pain_points: string[]
  }
  key_messaging: {
    tagline: string
    value_props: string[]
    differentiators: string[]
  }
  visual_identity: {
    colors: string
    style: string
    energy: string
  }
  content_guidelines: {
    dos: string[]
    donts: string[]
  }
  platform_notes: {
    long_form: string
    short_form: string
  }
}

export interface DNASources {
  website_data: string | null
  youtube_data: string | null
  transcript_excerpt: string | null
}

export interface GenerateDNARequest {
  client_id: number
  client_name: string
  website_url?: string
  youtube_url?: string
  context?: string
  transcript?: string
}
