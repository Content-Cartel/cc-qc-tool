interface DeepgramWord {
  word: string
  start: number
  end: number
  confidence: number
  punctuated_word?: string
}

export interface AudioIssue {
  type: 'silence_gap' | 'rapid_speech' | 'long_pause'
  start_seconds: number
  end_seconds: number
  duration_seconds: number
  description: string
  severity: 'low' | 'medium' | 'high'
}

/**
 * Analyze audio patterns from Deepgram word timestamps.
 * Pure computation — no API calls, no LLM needed.
 */
export function analyzeAudioFromWords(words: DeepgramWord[]): AudioIssue[] {
  if (!words || words.length < 2) return []

  const issues: AudioIssue[] = []

  // Detect silence gaps and long pauses
  for (let i = 0; i < words.length - 1; i++) {
    const gap = words[i + 1].start - words[i].end

    if (gap > 5) {
      issues.push({
        type: 'silence_gap',
        start_seconds: Math.round(words[i].end),
        end_seconds: Math.round(words[i + 1].start),
        duration_seconds: Math.round(gap * 10) / 10,
        description: `${Math.round(gap)}s silence gap between "${words[i].word}" and "${words[i + 1].word}"`,
        severity: 'high',
      })
    } else if (gap > 3) {
      issues.push({
        type: 'silence_gap',
        start_seconds: Math.round(words[i].end),
        end_seconds: Math.round(words[i + 1].start),
        duration_seconds: Math.round(gap * 10) / 10,
        description: `${Math.round(gap * 10) / 10}s silence gap`,
        severity: 'medium',
      })
    } else if (gap > 1.5) {
      issues.push({
        type: 'long_pause',
        start_seconds: Math.round(words[i].end),
        end_seconds: Math.round(words[i + 1].start),
        duration_seconds: Math.round(gap * 10) / 10,
        description: `${Math.round(gap * 10) / 10}s pause`,
        severity: 'low',
      })
    }
  }

  // Detect rapid speech (30+ words in 10-second window)
  const WINDOW_SIZE = 10 // seconds
  const RAPID_THRESHOLD = 30 // words

  let windowStart = 0
  for (let windowEnd = 0; windowEnd < words.length; windowEnd++) {
    // Slide window start forward
    while (windowStart < windowEnd && words[windowEnd].start - words[windowStart].start > WINDOW_SIZE) {
      windowStart++
    }

    const wordCount = windowEnd - windowStart + 1
    if (wordCount >= RAPID_THRESHOLD) {
      const startSec = Math.round(words[windowStart].start)
      // Avoid duplicate rapid speech flags for overlapping windows
      const alreadyFlagged = issues.some(
        i => i.type === 'rapid_speech' && Math.abs(i.start_seconds - startSec) < WINDOW_SIZE
      )
      if (!alreadyFlagged) {
        issues.push({
          type: 'rapid_speech',
          start_seconds: startSec,
          end_seconds: Math.round(words[windowEnd].end),
          duration_seconds: WINDOW_SIZE,
          description: `${wordCount} words in ${WINDOW_SIZE}s — very fast pacing`,
          severity: 'medium',
        })
      }
    }
  }

  // Sort by timestamp
  issues.sort((a, b) => a.start_seconds - b.start_seconds)

  return issues
}

/**
 * Get a summary of audio analysis results.
 */
export function getAudioSummary(issues: AudioIssue[]): {
  total: number
  high: number
  medium: number
  low: number
  status: 'clean' | 'minor' | 'issues'
} {
  const high = issues.filter(i => i.severity === 'high').length
  const medium = issues.filter(i => i.severity === 'medium').length
  const low = issues.filter(i => i.severity === 'low').length
  const total = issues.length

  const status = high > 0 ? 'issues' : medium > 0 ? 'minor' : 'clean'

  return { total, high, medium, low, status }
}
