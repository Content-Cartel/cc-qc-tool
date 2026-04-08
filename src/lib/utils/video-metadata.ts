import { google } from 'googleapis'

interface VideoMetadata {
  width: number
  height: number
  duration_seconds: number
  aspect_ratio: string
  is_portrait: boolean
  mime_type: string
  file_size_bytes: number
  file_name: string
}

interface ResolutionCheck {
  expected_orientation: 'portrait' | 'landscape'
  actual_orientation: 'portrait' | 'landscape' | 'square'
  is_correct: boolean
  message: string
}

function getAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyJson) return null

  try {
    const credentials = JSON.parse(keyJson)
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    })
  } catch {
    console.error('[video-metadata] Failed to parse service account key')
    return null
  }
}

function computeAspectRatio(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const d = gcd(w, h)
  return `${w / d}:${h / d}`
}

/**
 * Fetch video metadata from Google Drive using the files.get API.
 * Returns resolution, duration, aspect ratio, and file info.
 */
export async function getVideoMetadata(fileId: string): Promise<VideoMetadata | null> {
  const auth = getAuth()
  if (!auth) {
    console.error('[video-metadata] No Google service account configured')
    return null
  }

  const drive = google.drive({ version: 'v3', auth })

  try {
    const res = await drive.files.get({
      fileId,
      fields: 'name,mimeType,size,videoMediaMetadata',
      supportsAllDrives: true,
    })

    const file = res.data
    const vmm = file.videoMediaMetadata

    if (!vmm?.width || !vmm?.height) {
      console.warn(`[video-metadata] No videoMediaMetadata for file ${fileId} — file may still be processing`)
      return null
    }

    const w = vmm.width
    const h = vmm.height
    const durationMs = vmm.durationMillis ? parseInt(String(vmm.durationMillis), 10) : 0

    return {
      width: w,
      height: h,
      duration_seconds: Math.round(durationMs / 1000),
      aspect_ratio: computeAspectRatio(w, h),
      is_portrait: h > w,
      mime_type: file.mimeType || 'unknown',
      file_size_bytes: file.size ? parseInt(String(file.size), 10) : 0,
      file_name: file.name || 'unknown',
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`[video-metadata] Error fetching metadata for ${fileId}:`, errMsg)
    return null
  }
}

/**
 * Check if video resolution matches expected orientation for content type.
 * sf_video (shorts) should be portrait (9:16).
 * lf_video (long-form) should be landscape (16:9).
 */
export function checkResolution(
  contentType: string,
  width: number,
  height: number,
): ResolutionCheck {
  const actual: 'portrait' | 'landscape' | 'square' =
    height > width ? 'portrait' : height === width ? 'square' : 'landscape'

  const expected: 'portrait' | 'landscape' =
    contentType === 'sf_video' ? 'portrait' : 'landscape'

  const isCorrect = actual === expected

  let message: string
  if (isCorrect) {
    message = `${width}x${height} — correct ${actual} orientation`
  } else if (actual === 'square') {
    message = `${width}x${height} — square video, expected ${expected}`
  } else {
    message = `${width}x${height} — wrong orientation! Expected ${expected}, got ${actual}`
  }

  return { expected_orientation: expected, actual_orientation: actual, is_correct: isCorrect, message }
}

/**
 * Format file size for display.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`
}

/**
 * Format duration for display.
 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}
