import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import Anthropic from '@anthropic-ai/sdk'
import { extractGoogleDriveFileId } from '@/lib/utils/google-drive'
import { extractTextFromFrame, checkSpelling, type FrameText } from '@/lib/spelling/analyzer'
import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const execAsync = promisify(exec)

export const maxDuration = 300 // 5 min for video processing

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/**
 * Get the ffmpeg binary path - uses @ffmpeg-installer/ffmpeg package
 * which bundles a platform-appropriate static binary (works on Vercel).
 */
function getFfmpegPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg')
    return ffmpegInstaller.path
  } catch {
    // Fallback to system ffmpeg
    return 'ffmpeg'
  }
}

function getFfprobePath(): string {
  try {
    // ffprobe is bundled alongside ffmpeg in the installer package
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg')
    // Replace ffmpeg binary name with ffprobe in the path
    const ffmpegPath: string = ffmpegInstaller.path
    return ffmpegPath.replace(/ffmpeg$/, 'ffprobe')
  } catch {
    return 'ffprobe'
  }
}

function getDriveAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyJson) return null
  try {
    const credentials = JSON.parse(keyJson)
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    })
  } catch {
    return null
  }
}

async function downloadVideoFromDrive(fileId: string, destPath: string): Promise<void> {
  const auth = getDriveAuth()
  if (!auth) throw new Error('Google service account not configured')

  const drive = google.drive({ version: 'v3', auth })

  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' }
  )

  return new Promise((resolve, reject) => {
    const dest = fs.createWriteStream(destPath)
    ;(res.data as NodeJS.ReadableStream)
      .pipe(dest)
      .on('finish', resolve)
      .on('error', reject)
  })
}

/**
 * Extract frames from a video at regular intervals using ffmpeg.
 * Uses @ffmpeg-installer/ffmpeg for Vercel compatibility.
 */
async function extractFrames(
  videoPath: string,
  outputDir: string,
  intervalSeconds: number = 5,
  maxFrames: number = 60
): Promise<{ path: string; timestamp: number }[]> {
  const ffmpeg = getFfmpegPath()
  const ffprobe = getFfprobePath()

  // Get video duration
  const { stdout: durationOut } = await execAsync(
    `"${ffprobe}" -v quiet -show_entries format=duration -of csv=p=0 "${videoPath}"`
  )
  const duration = parseFloat(durationOut.trim()) || 0

  if (duration <= 0) throw new Error('Could not determine video duration')

  // Calculate actual interval to not exceed maxFrames
  const actualInterval = Math.max(intervalSeconds, duration / maxFrames)

  // Extract frames
  await execAsync(
    `"${ffmpeg}" -i "${videoPath}" -vf "fps=1/${actualInterval},scale=1280:-1" -q:v 3 -f image2 "${outputDir}/frame_%04d.jpg" 2>/dev/null`
  )

  // Collect frame paths with timestamps
  const files = fs.readdirSync(outputDir)
    .filter(f => f.startsWith('frame_') && f.endsWith('.jpg'))
    .sort()

  return files.map((file, idx) => ({
    path: path.join(outputDir, file),
    timestamp: idx * actualInterval,
  }))
}

/**
 * POST /api/spelling-check
 *
 * Runs on-screen text extraction and spelling check on a QC submission video.
 * Body: { submission_id: string }
 */
export async function POST(req: NextRequest) {
  let tmpDir: string | null = null

  try {
    const { submission_id } = await req.json()

    if (!submission_id) {
      return NextResponse.json({ error: 'Missing submission_id' }, { status: 400 })
    }

    const anthropicKey = process.env.CC_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
    if (!anthropicKey) {
      return NextResponse.json({ error: 'Anthropic API key not configured' }, { status: 500 })
    }

    // Get submission + client info
    const { data: submission, error: fetchErr } = await supabase
      .from('qc_submissions')
      .select('id, external_url, title, client_id, clients(name)')
      .eq('id', submission_id)
      .single()

    if (fetchErr || !submission) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
    }

    if (!submission.external_url) {
      return NextResponse.json({ error: 'No video URL on this submission' }, { status: 400 })
    }

    const clients = submission.clients as unknown as { name: string }[] | { name: string } | null
    const clientName = Array.isArray(clients) ? clients[0]?.name : clients?.name || 'Unknown Client'

    // Get client DNA for correct spelling reference
    const { data: dna } = await supabase
      .from('client_dna')
      .select('dna_markdown')
      .eq('client_id', submission.client_id)
      .order('version', { ascending: false })
      .limit(1)
      .single()

    // Extract relevant DNA sections for spelling context (names, company, people)
    let dnaExcerpt = ''
    if (dna?.dna_markdown) {
      dnaExcerpt = dna.dna_markdown.slice(0, 2000)
    }

    // Extract Drive file ID
    const fileId = extractGoogleDriveFileId(submission.external_url)
    if (!fileId) {
      return NextResponse.json({ error: 'Could not extract Drive file ID' }, { status: 400 })
    }

    // Create temp directory for processing
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-spelling-'))
    const videoPath = path.join(tmpDir, 'video.mp4')
    const framesDir = path.join(tmpDir, 'frames')
    fs.mkdirSync(framesDir)

    // Download video
    await downloadVideoFromDrive(fileId, videoPath)

    // Extract frames (every 5 seconds, max 60 frames)
    const frames = await extractFrames(videoPath, framesDir, 5, 60)

    if (frames.length === 0) {
      return NextResponse.json({ error: 'Could not extract frames from video' }, { status: 500 })
    }

    // Process frames through Claude Vision to extract on-screen text
    const anthropic = new Anthropic({ apiKey: anthropicKey })
    const frameTexts: FrameText[] = []

    // Process frames in batches of 5 to avoid rate limits
    for (let i = 0; i < frames.length; i += 5) {
      const batch = frames.slice(i, i + 5)
      const results = await Promise.all(
        batch.map(async (frame) => {
          const imageData = fs.readFileSync(frame.path)
          const base64 = imageData.toString('base64')
          const texts = await extractTextFromFrame(anthropic, base64)
          return { timestamp_seconds: frame.timestamp, texts }
        })
      )
      frameTexts.push(...results.filter(r => r.texts.length > 0))
    }

    if (frameTexts.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No on-screen text detected in video frames',
        issues: [],
        frames_analyzed: frames.length,
        frames_with_text: 0,
      })
    }

    // Check spelling against client DNA
    const issues = await checkSpelling(anthropic, frameTexts, dnaExcerpt, clientName)

    // Save results to database
    if (issues.length > 0) {
      const rows = issues.map(issue => ({
        submission_id,
        frame_timestamp_seconds: issue.frame_timestamp_seconds,
        detected_text: issue.detected_text,
        issue_description: issue.issue_description,
        suggested_fix: issue.suggested_fix,
        confidence: issue.confidence,
        status: 'flagged',
      }))

      await supabase.from('spelling_check_results').insert(rows)
    }

    return NextResponse.json({
      success: true,
      issues,
      frames_analyzed: frames.length,
      frames_with_text: frameTexts.length,
      total_text_elements: frameTexts.reduce((sum, f) => sum + f.texts.length, 0),
    })
  } catch (err) {
    console.error('[spelling-check] Error:', err)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    // Cleanup temp files
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      } catch { /* ignore cleanup errors */ }
    }
  }
}
