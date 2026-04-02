import { google } from 'googleapis'

const SHARED_DRIVE_ID = '0ABkWEBUO5WTYUk9PVA' // Content Cartel Production Drive
// Doc naming patterns to search for in client folders
const WRITTEN_CONTENT_PATTERNS = ['CC Written Content', 'Written Posts', 'AI Written Posts']

function getAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyJson) return null

  try {
    const credentials = JSON.parse(keyJson)
    return new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/documents',
      ],
    })
  } catch {
    console.error('[google-docs] Failed to parse service account key')
    return null
  }
}

/**
 * Find a client's folder in the shared Drive by name.
 */
export async function findClientFolder(clientName: string): Promise<string | null> {
  const auth = getAuth()
  if (!auth) return null

  const drive = google.drive({ version: 'v3', auth })

  try {
    const res = await drive.files.list({
      q: `'${SHARED_DRIVE_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
      pageSize: 50,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      driveId: SHARED_DRIVE_ID,
      corpora: 'drive',
    })

    const folders = res.data.files || []
    const nameNorm = clientName.toLowerCase().trim()

    // Exact match first, then case-insensitive contains
    const exact = folders.find(f => f.name?.toLowerCase().trim() === nameNorm)
    if (exact?.id) return exact.id

    const partial = folders.find(f => f.name?.toLowerCase().includes(nameNorm) || nameNorm.includes(f.name?.toLowerCase() || ''))
    return partial?.id || null
  } catch (err) {
    console.error(`[google-docs] Error finding folder for ${clientName}:`, err)
    return null
  }
}

/**
 * Find the existing "CC Written Content" doc in a client's folder.
 * Searches for common naming patterns.
 */
async function findWrittenContentDoc(
  folderId: string,
): Promise<{ docId: string; url: string } | null> {
  const auth = getAuth()
  if (!auth) return null

  const drive = google.drive({ version: 'v3', auth })

  try {
    // List all Google Docs in this folder
    const res = await drive.files.list({
      q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.document' and trashed = false`,
      fields: 'files(id, name)',
      pageSize: 20,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })

    const docs = res.data.files || []

    // Find the written content doc by pattern matching
    for (const pattern of WRITTEN_CONTENT_PATTERNS) {
      const match = docs.find(d => d.name?.toLowerCase().includes(pattern.toLowerCase()))
      if (match?.id) {
        return {
          docId: match.id,
          url: `https://docs.google.com/document/d/${match.id}/edit`,
        }
      }
    }

    return null
  } catch (err) {
    console.error(`[google-docs] Error finding doc in folder ${folderId}:`, err)
    return null
  }
}

/**
 * Appends generated posts to a client's "AI Written Posts" doc.
 * Creates the doc if it doesn't exist.
 * Returns the doc URL.
 */
export async function appendPostsToDoc(
  clientName: string,
  content: string,
  folderId: string | null
): Promise<{ url: string; docId: string } | null> {
  if (!folderId) return null

  const auth = getAuth()
  if (!auth) return null

  const docsApi = google.docs({ version: 'v1', auth })

  try {
    const docInfo = await findWrittenContentDoc(folderId)
    if (!docInfo) {
      console.warn(`[google-docs] No "CC Written Content" doc found for ${clientName}. Skipping.`)
      return null
    }

    // Get current doc length to append at the end
    const doc = await docsApi.documents.get({ documentId: docInfo.docId })
    const endIndex = doc.data.body?.content?.slice(-1)?.[0]?.endIndex || 1

    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })

    const header = `Generated: ${today}\n${'='.repeat(60)}\n\n`
    const fullText = header + content + '\n\n'
    const insertIndex = Math.max(endIndex - 1, 1)

    await docsApi.documents.batchUpdate({
      documentId: docInfo.docId,
      requestBody: {
        requests: [
          // Page break first so each generation starts on a fresh page
          {
            insertText: {
              location: { index: insertIndex },
              text: '\n',
            },
          },
          {
            insertPageBreak: {
              location: { index: insertIndex },
            },
          },
          // Then insert the content after the page break
          {
            insertText: {
              location: { index: insertIndex + 2 }, // after page break + newline
              text: fullText,
            },
          },
        ],
      },
    })

    return { url: docInfo.url, docId: docInfo.docId }
  } catch (err) {
    console.error(`[google-docs] Error appending to doc for ${clientName}:`, err)
    return null
  }
}
