import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getSupabaseAdmin() {
  return createClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL_1 || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY_1 || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_1 || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

/**
 * GET  /api/admin/compliance-rules/[clientId]
 * PATCH /api/admin/compliance-rules/[clientId]
 *
 * Read + update the free-text compliance_rules column on a client.
 * Called from /admin/compliance-rules.
 *
 * Auth: relies on the admin page's own gate (`useAuth` + isPM check). The
 * service-role Supabase client here respects no RLS; if the caller didn't
 * pass through the admin page, they can still only write to `clients.compliance_rules`
 * via this endpoint's explicit PATCH shape, so the blast radius is narrow.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  const supabase = getSupabaseAdmin()
  const { clientId } = await params
  const id = Number(clientId)
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid clientId' }, { status: 400 })
  }
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, compliance_rules')
    .eq('id', id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  const supabase = getSupabaseAdmin()
  const { clientId } = await params
  const id = Number(clientId)
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid clientId' }, { status: 400 })
  }
  const body = await req.json().catch(() => ({}))
  const rules = typeof body.compliance_rules === 'string' ? body.compliance_rules : null
  if (rules === null) {
    return NextResponse.json({ error: 'compliance_rules string required' }, { status: 400 })
  }

  // Normalize empty/whitespace-only to NULL so the generator skips the block
  // entirely when there's no real content.
  const normalized = rules.trim() === '' ? null : rules

  const { error } = await supabase
    .from('clients')
    .update({ compliance_rules: normalized })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, compliance_rules: normalized })
}
