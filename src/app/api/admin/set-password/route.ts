import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabase } from '@/lib/supabase/server'
import { randomBytes } from 'crypto'

export const dynamic = 'force-dynamic'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Generates a memorable-ish random password (16 chars, mixed case + digits).
 */
function generatePassword(): string {
  // 12 bytes -> 16 base64 chars, strip padding and special chars
  return randomBytes(12)
    .toString('base64')
    .replace(/[+/=]/g, '')
    .slice(0, 16)
}

/**
 * POST /api/admin/set-password
 *
 * Admin-only endpoint that sets a temporary password for an existing user
 * and confirms their email. Returns the generated password for the admin
 * to share with the user via Slack/DM.
 *
 * Body: { user_id: string }
 * Response: { success: true, password: string }
 */
export async function POST(req: NextRequest) {
  try {
    // Verify the caller is an admin
    const userSupabase = createServerSupabase()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await userSupabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || !['production_manager', 'admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Production manager or admin role required' }, { status: 403 })
    }

    const body = await req.json()
    const { user_id } = body as { user_id?: string }

    if (!user_id) {
      return NextResponse.json({ error: 'Missing user_id' }, { status: 400 })
    }

    const password = generatePassword()
    const supabaseAdmin = getSupabaseAdmin()

    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
      password,
      email_confirm: true,
    })

    if (error) {
      console.error('Set password error:', error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      password,
      email: data.user?.email,
    })
  } catch (err) {
    console.error('Set password exception:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
