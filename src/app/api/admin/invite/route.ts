import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabase } from '@/lib/supabase/server'
import { randomBytes } from 'crypto'

export const dynamic = 'force-dynamic'

function getSupabaseAdmin() {
  return createClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL_1 || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY_1 || process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function generatePassword(): string {
  return randomBytes(12).toString('base64').replace(/[+/=]/g, '').slice(0, 16)
}

/**
 * POST /api/admin/invite
 *
 * Creates a new user directly via auth.admin.createUser (no email sent).
 * Returns the generated password so the admin can share it via Slack.
 * The handle_new_user trigger auto-creates the profile row.
 */
export async function POST(req: NextRequest) {
  try {
    // Verify the caller is a PM or admin
    const userSupabase = createServerSupabase()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { data: callerProfile } = await userSupabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (!callerProfile || !['production_manager', 'admin'].includes(callerProfile.role)) {
      return NextResponse.json({ error: 'Production manager or admin role required' }, { status: 403 })
    }

    const supabaseAdmin = getSupabaseAdmin()
    const body = await req.json()
    const { email, display_name, role, slack_user_id } = body

    if (!email || !display_name || !role) {
      return NextResponse.json(
        { error: 'Missing required fields: email, display_name, role' },
        { status: 400 }
      )
    }

    const validRoles = ['editor', 'production_manager', 'admin']
    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { error: `Invalid role. Must be one of: ${validRoles.join(', ')}` },
        { status: 400 }
      )
    }

    // Guard: reject self-invite
    if (email.toLowerCase() === user.email?.toLowerCase()) {
      return NextResponse.json(
        { error: 'You cannot add your own email. Your account already exists.' },
        { status: 400 }
      )
    }

    // Guard: reject if user already exists
    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name')
      .eq('email', email.toLowerCase())
      .maybeSingle()
    if (existing) {
      return NextResponse.json(
        { error: `User ${existing.display_name} already exists. Use the key icon to reset their password instead.` },
        { status: 400 }
      )
    }

    // Create user directly — no email sent, no rate limits
    const password = generatePassword()
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: email.toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: {
        display_name,
        role,
        slack_user_id: slack_user_id || null,
      },
    })

    if (error) {
      console.error('Create user error:', error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // Update slack_user_id on the profile if provided (trigger may not capture it)
    if (data.user && slack_user_id) {
      await supabaseAdmin
        .from('profiles')
        .update({ slack_user_id })
        .eq('id', data.user.id)
    }

    return NextResponse.json({
      success: true,
      user_id: data.user?.id,
      email,
      display_name,
      role,
      password,
    })
  } catch (err) {
    console.error('Admin create user error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
