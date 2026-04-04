import { google } from 'googleapis'
import type { docs_v1 } from 'googleapis'

const SHARED_DRIVE_ID = '0ABkWEBUO5WTYUk9PVA' // Content Cartel Production Drive
// Doc naming patterns to search for in client folders
const WRITTEN_CONTENT_PATTERNS = ['CC Written Content', 'Written Posts', 'AI Written Posts']
const DNA_DOC_PATTERNS = ['DNA Playbook', 'DNA Profile', 'Client DNA']

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
    let docInfo = await findWrittenContentDoc(folderId)
    if (!docInfo) {
      // Auto-create the doc if it doesn't exist
      const drive = google.drive({ version: 'v3', auth })
      const file = await drive.files.create({
        requestBody: {
          name: `${clientName} - CC Written Content`,
          mimeType: 'application/vnd.google-apps.document',
          parents: [folderId],
        },
        supportsAllDrives: true,
        fields: 'id',
      })
      if (!file.data.id) {
        console.error(`[google-docs] Failed to create Written Content doc for ${clientName}`)
        return null
      }
      docInfo = {
        docId: file.data.id,
        url: `https://docs.google.com/document/d/${file.data.id}/edit`,
      }
      console.log(`[google-docs] Created Written Content doc for ${clientName}: ${docInfo.url}`)
    }

    // Get current doc length to append at the end
    const doc = await docsApi.documents.get({ documentId: docInfo.docId })
    const endIndex = doc.data.body?.content?.slice(-1)?.[0]?.endIndex || 1

    // Calculate the Monday-Sunday week range
    const now = new Date()
    const dayOfWeek = now.getDay() // 0=Sun, 1=Mon, ...
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    const monday = new Date(now)
    monday.setDate(now.getDate() + daysToMonday)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)

    const formatDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
    const weekLabel = `Week of ${formatDate(monday)}-${formatDate(sunday)}, ${monday.getFullYear()}`

    const header = `${weekLabel}\n${'='.repeat(60)}\n\n`
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

// ─── DNA Template Doc ──────────────────────────────────────────

/**
 * Search for an existing DNA doc in a client's folder.
 */
export async function findDNADoc(
  folderId: string,
): Promise<{ docId: string; url: string } | null> {
  const auth = getAuth()
  if (!auth) return null

  const drive = google.drive({ version: 'v3', auth })

  try {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.document' and trashed = false`,
      fields: 'files(id, name)',
      pageSize: 30,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })

    const docs = res.data.files || []

    for (const pattern of DNA_DOC_PATTERNS) {
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
    console.error(`[google-docs] Error finding DNA doc in folder ${folderId}:`, err)
    return null
  }
}

/**
 * DNA template section definitions.
 * Each section has a header, a description prompt, and sub-items to fill in.
 */
const DNA_TEMPLATE_SECTIONS = [
  {
    header: '1. THE PLAY',
    description: 'The whole strategy in one page. What is this person/brand building, and how does content get them there?',
    items: [
      'One-Sentence Thesis:',
      'The Audiences (who watches/reads and why):',
      'Revenue Streams (how content turns into money):',
      'The Moat (unfair advantage):',
      'Key Differentiator:',
      'ICP (Ideal Client/Customer):',
    ],
  },
  {
    header: '2. VOICE FINGERPRINT ⭐',
    description: 'What makes every piece of content sound like the client. This is the most critical section.',
    items: [
      'Formality (1-10):',
      'Energy (1-10):',
      'Technical Depth (1-10):',
      'Sentence Style:',
      'Teaching Style:',
      'Humor:',
      'Phrases They Use:',
      'Words They\'d NEVER Say:',
      'DO Sound Like (3-5 examples):',
      'DON\'T Sound Like (3-5 examples):',
    ],
  },
  {
    header: '3. CONTENT STRATEGY',
    description: 'What content to make, what works, what to double down on.',
    items: [
      'Content Pillars (3-5 core topics):',
      'What Already Works:',
      'What to Double Down On:',
      'Hook Formulas (from their actual content):',
      'Platform Priority:',
    ],
  },
  {
    header: '4. THE FUNNEL',
    description: 'Step-by-step conversion architecture. Map the actual play.',
    items: [
      'Funnel Overview (Content → ??? → Conversion):',
      'Active CTAs by Platform:',
      'Funnel Links:',
      'Lead Magnets:',
      'Funnel Gaps (what\'s missing):',
    ],
  },
  {
    header: '5. PROOF POINTS',
    description: 'Hard evidence the team can pull into content.',
    items: [
      'Hard Metrics:',
      'Credentials:',
      'Case Studies:',
      'Quotable Moments:',
      'Social Proof:',
    ],
  },
  {
    header: '6. VISUAL IDENTITY',
    description: 'Colors, fonts, energy. Keeps editors and designers on-brand.',
    items: [
      'Colors (hex codes):',
      'Typography:',
      'Visual Energy:',
      'Thumbnail/Graphic Patterns:',
    ],
  },
  {
    header: '7. OFF-LIMITS',
    description: 'What NOT to do. Critical for avoiding brand damage.',
    items: [
      'Topics to Avoid:',
      'Language to Avoid:',
      'Competitor Handling:',
      'Compliance/Legal:',
    ],
  },
  {
    header: '8. PRODUCTION PLAYBOOK',
    description: 'Specific instructions for the CC team and AI editing systems.',
    items: [
      'Editing Style:',
      'Content Cadence:',
      'Priority Content:',
      'AI Editing Instructions:',
    ],
  },
  {
    header: '9. DATA GAPS & NEXT STEPS',
    description: 'What\'s missing and where to get it.',
    items: [
      'What Data Is Missing:',
      'Recommended Actions:',
      'KPIs to Track:',
    ],
  },
]

/**
 * Create a blank DNA template Google Doc in the client's Drive folder.
 * Returns the doc URL, or an existing DNA doc URL if one already exists.
 */
export async function createDNATemplateDoc(
  clientName: string,
  folderId: string,
): Promise<{ url: string; docId: string; alreadyExisted: boolean } | null> {
  const auth = getAuth()
  if (!auth) return null

  // Check if a DNA doc already exists
  const existing = await findDNADoc(folderId)
  if (existing) {
    return { ...existing, alreadyExisted: true }
  }

  const drive = google.drive({ version: 'v3', auth })
  const docsApi = google.docs({ version: 'v1', auth })

  try {
    // Step 1: Create the doc in the shared drive folder
    const docTitle = `${clientName} — DNA Playbook`

    const file = await drive.files.create({
      requestBody: {
        name: docTitle,
        mimeType: 'application/vnd.google-apps.document',
        parents: [folderId],
      },
      supportsAllDrives: true,
      fields: 'id',
    })

    const docId = file.data.id
    if (!docId) {
      console.error('[google-docs] Failed to create DNA doc — no ID returned')
      return null
    }

    // Step 2: Build the document content with formatting
    const requests: docs_v1.Schema$Request[] = []
    let currentIndex = 1 // Google Docs body starts at index 1

    // Helper: insert text and advance index
    const insertText = (text: string): number => {
      requests.push({
        insertText: {
          location: { index: currentIndex },
          text,
        },
      })
      const startIndex = currentIndex
      currentIndex += text.length
      return startIndex
    }

    // Helper: apply heading style
    const applyHeading = (startIndex: number, endIndex: number, style: string) => {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex, endIndex },
          paragraphStyle: { namedStyleType: style },
          fields: 'namedStyleType',
        },
      })
    }

    // Helper: apply bold
    const applyBold = (startIndex: number, endIndex: number) => {
      requests.push({
        updateTextStyle: {
          range: { startIndex, endIndex },
          textStyle: { bold: true },
          fields: 'bold',
        },
      })
    }

    // Helper: apply italic
    const applyItalic = (startIndex: number, endIndex: number) => {
      requests.push({
        updateTextStyle: {
          range: { startIndex, endIndex },
          textStyle: { italic: true },
          fields: 'italic',
        },
      })
    }

    // Helper: apply color (grey for descriptions)
    const applyColor = (startIndex: number, endIndex: number, r: number, g: number, b: number) => {
      requests.push({
        updateTextStyle: {
          range: { startIndex, endIndex },
          textStyle: {
            foregroundColor: {
              color: { rgbColor: { red: r, green: g, blue: b } },
            },
          },
          fields: 'foregroundColor',
        },
      })
    }

    // ── Title ──
    const titleText = `${clientName} — DNA PLAYBOOK\n`
    const titleStart = insertText(titleText)
    applyHeading(titleStart, currentIndex, 'TITLE')

    // ── Subtitle ──
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    const subtitleText = `Content Cartel | Created: ${today}\nStatus: Template — Fill in each section below\n\n`
    const subtitleStart = insertText(subtitleText)
    applyItalic(subtitleStart, subtitleStart + subtitleText.trimEnd().length)
    applyColor(subtitleStart, subtitleStart + subtitleText.trimEnd().length, 0.5, 0.5, 0.5)

    // ── Horizontal rule (just dashes) ──
    insertText('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n')

    // ── Sections ──
    for (const section of DNA_TEMPLATE_SECTIONS) {
      // Section header (H2)
      const headerText = `${section.header}\n`
      const headerStart = insertText(headerText)
      applyHeading(headerStart, currentIndex, 'HEADING_2')

      // Section description (italic, grey)
      const descText = `${section.description}\n\n`
      const descStart = insertText(descText)
      applyItalic(descStart, descStart + descText.trimEnd().length)
      applyColor(descStart, descStart + descText.trimEnd().length, 0.5, 0.5, 0.5)

      // Sub-items (bold label + space for filling in)
      for (const item of section.items) {
        const itemText = `${item} \n\n`
        const itemStart = insertText(itemText)
        // Bold just the label part (up to the colon)
        const colonIndex = item.indexOf(':')
        if (colonIndex > 0) {
          applyBold(itemStart, itemStart + colonIndex + 1)
        }
      }

      // Section separator
      insertText('\n')
    }

    // Step 3: Apply all formatting in one batch
    await docsApi.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests },
    })

    const url = `https://docs.google.com/document/d/${docId}/edit`
    console.log(`[google-docs] Created DNA template for ${clientName}: ${url}`)

    return { url, docId, alreadyExisted: false }
  } catch (err) {
    console.error(`[google-docs] Error creating DNA template for ${clientName}:`, err)
    return null
  }
}
