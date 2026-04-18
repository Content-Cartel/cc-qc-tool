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

type PlatformKey = 'linkedin' | 'twitter' | 'facebook'

const PLATFORM_TAB_ORDER: PlatformKey[] = ['linkedin', 'twitter', 'facebook']
const PLATFORM_TAB_TITLE: Record<PlatformKey, string> = {
  linkedin: 'LinkedIn',
  twitter: 'X (Twitter)',
  facebook: 'Facebook',
}

/**
 * Compute the "Week of Mon-Sun, YYYY" label for the current moment.
 * Used as the parent tab title; identical format lets us reuse a tab if
 * the cron runs more than once in the same week (idempotent re-runs).
 */
function buildWeekLabel(now: Date = new Date()): string {
  const dayOfWeek = now.getDay() // 0=Sun, 1=Mon, ...
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const monday = new Date(now)
  monday.setDate(now.getDate() + daysToMonday)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const formatDate = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  return `Week of ${formatDate(monday)}-${formatDate(sunday)}, ${monday.getFullYear()}`
}

/**
 * Recursive walker: given a tree of tabs, find one matching the predicate.
 * Google Docs tabs can be nested arbitrarily deep but we only use one level
 * of nesting (week → platform). Walker handles any depth for safety.
 */
function findTab(
  tabs: docs_v1.Schema$Tab[] | undefined,
  predicate: (t: docs_v1.Schema$Tab) => boolean,
): docs_v1.Schema$Tab | null {
  if (!tabs) return null
  for (const t of tabs) {
    if (predicate(t)) return t
    const child = findTab(t.childTabs, predicate)
    if (child) return child
  }
  return null
}

/**
 * Find the tabId of an empty new tab's body insertion point. A fresh tab's
 * body starts at index 1 (the implicit leading paragraph), so we return 1.
 * If the tab already has content we still insert at 1 to prepend — but since
 * we only write to freshly-created platform tabs, 1 is always the start.
 */
const NEW_TAB_INSERT_INDEX = 1

/**
 * Create a child tab under a given parent tabId. No get-first lookup — the
 * caller already knows whether a child with this title exists (from the
 * single initial documents.get) and skips the call if it does.
 */
async function createChildTab(
  docsApi: docs_v1.Docs,
  documentId: string,
  parentTabId: string,
  childTitle: string,
): Promise<string | null> {
  const addRes = await docsApi.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        {
          addDocumentTab: {
            tabProperties: {
              title: childTitle,
              parentTabId,
            },
          },
        },
      ],
    },
  })
  const newId = addRes.data.replies?.[0]?.addDocumentTab?.tabProperties?.tabId
  return newId || null
}

/**
 * Append a week's generated posts into a client's "CC Written Content" doc
 * using Google Docs tabs (Week → Platform hierarchy).
 *
 * Structure per doc after this call:
 *   📄 [Client] - CC Written Content
 *      Week of April 13-19, 2026       ← parent tab (one per week)
 *         LinkedIn                    ← child tab per platform
 *         X (Twitter)
 *         Facebook
 *      Week of April 6-12, 2026
 *         ...
 *
 * Idempotent: a second call in the same week reuses the parent week tab and
 * appends to any existing platform tabs.
 *
 * Legacy behaviour: pre-tabs content (the old linear page-break format) stays
 * untouched in the default tab. New weekly batches land as siblings.
 */
export async function appendPostsToDoc(
  clientName: string,
  postsByPlatform: Record<PlatformKey, string[]>,
  folderId: string | null,
): Promise<{ url: string; docId: string } | null> {
  if (!folderId) return null

  const auth = getAuth()
  if (!auth) return null

  const docsApi = google.docs({ version: 'v1', auth })

  try {
    // 1. Locate (or create) the doc.
    let docInfo = await findWrittenContentDoc(folderId)
    if (!docInfo) {
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

    const weekLabel = buildWeekLabel()

    // 2. Find or create the week parent tab.
    const initial = await docsApi.documents.get({
      documentId: docInfo.docId,
      includeTabsContent: true,
    })
    let weekTabId: string | null =
      findTab(initial.data.tabs, t => t.tabProperties?.title === weekLabel)
        ?.tabProperties?.tabId || null

    // Record existing child tabs under the week parent (keyed by title) so a
    // re-run in the same week reuses them instead of creating duplicates.
    const existingChildByTitle = new Map<string, string>()
    if (weekTabId) {
      const weekTab = findTab(initial.data.tabs, t => t.tabProperties?.tabId === weekTabId)
      for (const c of weekTab?.childTabs || []) {
        const title = c.tabProperties?.title
        const id = c.tabProperties?.tabId
        if (title && id) existingChildByTitle.set(title, id)
      }
    } else {
      // Append at the end (omit index). On a legacy doc the existing body
      // becomes the implicit first tab and our new week tab becomes a sibling.
      const createRes = await docsApi.documents.batchUpdate({
        documentId: docInfo.docId,
        requestBody: {
          requests: [
            {
              addDocumentTab: {
                tabProperties: {
                  title: weekLabel,
                },
              },
            },
          ],
        },
      })
      weekTabId =
        createRes.data.replies?.[0]?.addDocumentTab?.tabProperties?.tabId || null
      if (!weekTabId) {
        console.error(`[google-docs] Failed to create week tab for ${clientName}`)
        return { url: docInfo.url, docId: docInfo.docId }
      }
    }

    // 3. For each platform, use existing child tab if present, else create.
    for (const platform of PLATFORM_TAB_ORDER) {
      const posts = postsByPlatform[platform] || []
      if (posts.length === 0) continue

      const childTitle = PLATFORM_TAB_TITLE[platform]
      let childTabId = existingChildByTitle.get(childTitle) || null
      if (!childTabId) {
        childTabId = await createChildTab(
          docsApi,
          docInfo.docId,
          weekTabId,
          childTitle,
        )
      }
      if (!childTabId) {
        console.error(
          `[google-docs] Failed to create ${platform} tab under ${weekLabel} for ${clientName}`,
        )
        continue
      }

      // Build the content: headed, numbered, separated. The model output is
      // already cleaned by ccPostProcess.
      const body = posts
        .map((p, idx) =>
          posts.length > 1
            ? `## ${childTitle} — Post ${idx + 1}\n\n${p}\n`
            : `## ${childTitle}\n\n${p}\n`,
        )
        .join('\n---\n\n')

      await docsApi.documents.batchUpdate({
        documentId: docInfo.docId,
        requestBody: {
          requests: [
            {
              insertText: {
                location: { index: NEW_TAB_INSERT_INDEX, tabId: childTabId },
                text: body + '\n',
              },
            },
          ],
        },
      })
    }

    return { url: docInfo.url, docId: docInfo.docId }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Surface the full error so the Vercel log shows the API response body,
    // not just "Error appending...". Real examples we've seen: "The tab was not found",
    // "Invalid requests[0].insertText: Index 1 has no corresponding paragraph".
    console.error(`[google-docs] Error appending to doc for ${clientName}: ${message}`)
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
