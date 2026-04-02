// Client portal configuration — add new clients here
export interface ClientPortalConfig {
  slug: string
  clientName: string        // Must match the name in the Supabase `clients` table
  displayName: string       // Shown in the UI
  password: string
}

export const CLIENT_PORTALS: Record<string, ClientPortalConfig> = {
  'monetary-metals': {
    slug: 'monetary-metals',
    clientName: 'Monetary Metals',
    displayName: 'Monetary Metals',
    password: 'mm2024',
  },
}

export function getPortalBySlug(slug: string): ClientPortalConfig | null {
  return CLIENT_PORTALS[slug] || null
}

// Client-friendly status labels (hides internal terminology)
export const CLIENT_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending Review', color: 'blue' },
  in_review: { label: 'In Review', color: 'amber' },
  approved: { label: 'Approved', color: 'green' },
  revision_requested: { label: 'Revision Needed', color: 'red' },
  resubmitted: { label: 'Pending Review', color: 'blue' },
  follow_up: { label: 'In Review', color: 'amber' },
}
