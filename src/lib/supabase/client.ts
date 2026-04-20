import { createBrowserClient } from '@supabase/ssr'

const FALLBACK_URL = 'https://placeholder.supabase.co'
const FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsYWNlaG9sZGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE2MDAwMDAwMDAsImV4cCI6MjAwMDAwMDAwMH0.placeholder'

// Module-level singleton. A fresh instance each call caused consumer useEffects
// (keyed on `supabase`) to re-run every render, which re-subscribed realtime
// channels and refetched data in a tight loop.
let _client: ReturnType<typeof createBrowserClient> | null = null

export function createClient() {
  if (_client) return _client
  // Use fallback values during build/SSR pre-rendering when env vars may not be available.
  // The actual client-side code will always have the real values from NEXT_PUBLIC_ env vars.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL_1 || process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_1 || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_KEY
  _client = createBrowserClient(url, key)
  return _client
}
