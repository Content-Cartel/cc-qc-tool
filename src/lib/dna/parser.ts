/**
 * DNA Markdown Parser — v3
 * 9-section operator playbook structure.
 * Splits DNA markdown into structured sections with confidence scoring.
 */

export interface DNASection {
  number: number
  title: string
  slug: string
  markdown: string
  confidence: 'high' | 'partial' | 'low'
  gapCount: number
  gaps: string[]
}

export interface ParsedDNA {
  clientName: string
  generatedDate: string
  status: string
  sections: DNASection[]
  overallScore: number      // 0-100
  highConfCount: number
  partialCount: number
  lowConfCount: number
}

// v3 section names — 9 sections, operator playbook
const SECTION_NAMES: Record<number, { title: string; slug: string }> = {
  1: { title: 'The Play', slug: 'the-play' },
  2: { title: 'Voice Fingerprint', slug: 'voice-fingerprint' },
  3: { title: 'Content Strategy', slug: 'content-strategy' },
  4: { title: 'The Funnel', slug: 'the-funnel' },
  5: { title: 'Proof Points', slug: 'proof-points' },
  6: { title: 'Visual Identity', slug: 'visual-identity' },
  7: { title: 'Off-Limits', slug: 'off-limits' },
  8: { title: 'Production Playbook', slug: 'production-playbook' },
  9: { title: 'Data Gaps & Next Steps', slug: 'data-gaps' },
}

// Backward compatibility: map old v1/v2 slugs to icons
const SECTION_ICONS: Record<string, string> = {
  'the-play': '🎯',
  'voice-fingerprint': '🎤',
  'content-strategy': '📐',
  'the-funnel': '🔗',
  'proof-points': '🏆',
  'visual-identity': '🎨',
  'off-limits': '🚫',
  'production-playbook': '🎬',
  'data-gaps': '📊',
  // backward compat: v2 slugs
  'business-overview': '🏢',
  'content-frameworks': '📐',
  'platform-rules': '📱',
  'platform-strategy': '📱',
  'brand-kit': '🎨',
  'cta-map': '🔗',
  'funnel-architecture': '🔗',
  'production-notes': '🎬',
}

export function getSectionIcon(slug: string): string {
  return SECTION_ICONS[slug] || '📄'
}

/**
 * Parse DNA markdown into structured sections with confidence scoring.
 */
export function parseDNASections(markdown: string): ParsedDNA {
  // Extract header info
  let clientName = ''
  let generatedDate = ''
  let status = ''

  // v3 format: "# ClientName — DNA PLAYBOOK"
  const nameMatchV3 = markdown.match(/^# (.+?)\s*[—–-]\s*DNA PLAYBOOK/im)
  // v2 format: "# CLIENT DNA PROFILE: ClientName"
  const nameMatchV2 = markdown.match(/# CLIENT DNA PROFILE:\s*(.+)/i)
  if (nameMatchV3) clientName = nameMatchV3[1].trim()
  else if (nameMatchV2) clientName = nameMatchV2[1].trim()

  const dateMatch = markdown.match(/Generated:\s*(.+)/i)
  if (dateMatch) generatedDate = dateMatch[1].trim()

  const statusMatch = markdown.match(/Status:\s*(.+)/i)
  if (statusMatch) status = statusMatch[1].trim()

  // Split by section headers (## 1. THE PLAY, ## 2. VOICE FINGERPRINT, etc.)
  const sectionRegex = /^## (\d+)\.\s+(.+)$/gm
  const matches: { index: number; number: number; title: string }[] = []
  let match: RegExpExecArray | null

  while ((match = sectionRegex.exec(markdown)) !== null) {
    matches.push({
      index: match.index,
      number: parseInt(match[1], 10),
      title: match[2].trim(),
    })
  }

  const sections: DNASection[] = []

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index
    const end = i + 1 < matches.length ? matches[i + 1].index : markdown.length
    const sectionMarkdown = markdown.slice(start, end).trim()
    const sectionNum = matches[i].number

    // Count all gap types (NEEDS DATA, NEEDS CONFIRMATION, INFERRED)
    const needsDataMatches = sectionMarkdown.match(/\[NEEDS DATA[^\]]*\]/gi) || []
    const needsConfirmMatches = sectionMarkdown.match(/\[NEEDS CONFIRMATION[^\]]*\]/gi) || []
    const inferredMatches = sectionMarkdown.match(/\[INFERRED[^\]]*\]/gi) || []
    const gaps = [
      ...needsDataMatches.map(g => g.replace(/^\[|\]$/g, '')),
      ...needsConfirmMatches.map(g => g.replace(/^\[|\]$/g, '')),
      ...inferredMatches.map(g => g.replace(/^\[|\]$/g, '')),
    ]
    // Weight: NEEDS DATA counts as 1, NEEDS CONFIRMATION as 0.5, INFERRED as 0.25
    const gapCount = needsDataMatches.length + Math.ceil(needsConfirmMatches.length * 0.5) + Math.ceil(inferredMatches.length * 0.25)

    // Determine confidence
    let confidence: DNASection['confidence'] = 'high'
    if (gapCount >= 3) confidence = 'low'
    else if (gapCount >= 1) confidence = 'partial'

    const info = SECTION_NAMES[sectionNum]
    sections.push({
      number: sectionNum,
      title: info?.title || matches[i].title,
      slug: info?.slug || matches[i].title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      markdown: sectionMarkdown,
      confidence,
      gapCount,
      gaps,
    })
  }

  // Calculate overall score
  const highConfCount = sections.filter(s => s.confidence === 'high').length
  const partialCount = sections.filter(s => s.confidence === 'partial').length
  const lowConfCount = sections.filter(s => s.confidence === 'low').length
  const totalSections = sections.length || 1
  const overallScore = Math.round(
    ((highConfCount * 100 + partialCount * 50 + lowConfCount * 10) / totalSections)
  )

  return {
    clientName,
    generatedDate,
    status,
    sections,
    overallScore,
    highConfCount,
    partialCount,
    lowConfCount,
  }
}

/**
 * Extract just the sections an editor needs (Voice, Off-Limits, Production).
 */
export function extractEditorBrief(sections: DNASection[]): string {
  const editorSlugs = ['voice-fingerprint', 'off-limits', 'production-playbook', 'production-notes']
  const editorSections = sections.filter(s => editorSlugs.includes(s.slug))
  if (editorSections.length === 0) return ''

  return `# EDITOR BRIEF\n\n${editorSections.map(s => s.markdown).join('\n\n---\n\n')}`
}

/**
 * Extract sections formatted for OCI/n8n AI editing instructions.
 * Includes Voice Fingerprint, Off-Limits, Funnel, and Production Playbook.
 */
export function extractOCIBrief(sections: DNASection[]): string {
  const ociSlugs = ['voice-fingerprint', 'off-limits', 'the-funnel', 'cta-map', 'production-playbook', 'production-notes']
  const ociSections = sections.filter(s => ociSlugs.includes(s.slug))
  if (ociSections.length === 0) return ''

  return `# AI EDITING INSTRUCTIONS\nSource: Client DNA Playbook (Layer 2)\nUsage: Feed into OCI/n8n editing workflow\n\n${ociSections.map(s => s.markdown).join('\n\n---\n\n')}`
}

/**
 * Extract the strategy brief for quick sharing.
 */
export function extractStrategyBrief(sections: DNASection[]): string {
  const strategySlugs = ['the-play', 'the-funnel', 'content-strategy']
  const strategySections = sections.filter(s => strategySlugs.includes(s.slug))
  if (strategySections.length === 0) return ''

  return `# STRATEGY BRIEF\n\n${strategySections.map(s => s.markdown).join('\n\n---\n\n')}`
}

/**
 * Replace a single section in the full markdown.
 */
export function replaceSectionInMarkdown(
  fullMarkdown: string,
  sectionNumber: number,
  newSectionMarkdown: string,
): string {
  const sectionRegex = /^## (\d+)\.\s+(.+)$/gm
  const matches: { index: number; number: number }[] = []
  let match: RegExpExecArray | null

  while ((match = sectionRegex.exec(fullMarkdown)) !== null) {
    matches.push({ index: match.index, number: parseInt(match[1], 10) })
  }

  const targetIdx = matches.findIndex(m => m.number === sectionNumber)
  if (targetIdx === -1) return fullMarkdown

  const start = matches[targetIdx].index
  const end = targetIdx + 1 < matches.length ? matches[targetIdx + 1].index : fullMarkdown.length

  return fullMarkdown.slice(0, start) + newSectionMarkdown.trim() + '\n\n' + fullMarkdown.slice(end)
}
