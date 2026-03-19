/**
 * Extract Google Drive file ID from various URL formats:
 * - https://drive.google.com/file/d/{fileId}/view
 * - https://drive.google.com/open?id={fileId}
 * - https://docs.google.com/document/d/{fileId}/edit
 * - https://drive.google.com/file/d/{fileId}/preview
 */
export function extractGoogleDriveFileId(url: string): string | null {
  if (!url) return null

  // Pattern: /file/d/{id}/
  const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
  if (fileMatch) return fileMatch[1]

  // Pattern: /d/{id}/
  const docMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/)
  if (docMatch) return docMatch[1]

  // Pattern: ?id={id}
  const queryMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (queryMatch) return queryMatch[1]

  return null
}

/**
 * Build an embeddable Google Drive video preview URL
 */
export function getGoogleDriveEmbedUrl(url: string): string | null {
  const fileId = extractGoogleDriveFileId(url)
  if (!fileId) return null
  return `https://drive.google.com/file/d/${fileId}/preview`
}

/**
 * Build a direct download URL for Google Drive files
 */
export function getGoogleDriveDownloadUrl(url: string): string | null {
  const fileId = extractGoogleDriveFileId(url)
  if (!fileId) return null
  return `https://drive.google.com/uc?export=download&id=${fileId}`
}

/**
 * Build a direct streaming URL for Google Drive video files.
 * Works when the file is shared as "Anyone with the link can view".
 */
export function getGoogleDriveDirectUrl(url: string): string | null {
  const fileId = extractGoogleDriveFileId(url)
  if (!fileId) return null
  return `https://drive.google.com/uc?export=view&id=${fileId}`
}

/**
 * Check if a URL is a Google Drive link
 */
export function isGoogleDriveUrl(url: string): boolean {
  return url.includes('drive.google.com') || url.includes('docs.google.com')
}
