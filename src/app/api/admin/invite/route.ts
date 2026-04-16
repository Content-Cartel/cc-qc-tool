import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Uses service_role key to call admin API (inviteUserByEmail)
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY_1 || process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  try {
    // Verify the caller is a PM or admin
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

    // Invite user via Supabase Auth admin API
    // This sends them an email with a link to set their password
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: {
        display_name,
        role,
        slack_user_id: slack_user_id || null,
      },
    })

    if (error) {
      console.error('Invite error:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    // The on_auth_user_created trigger will auto-create the profile row
    // But we can also update the slack_user_id if provided (trigger may not capture it)
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
    })
  } catch (err) {
    console.error('Admin invite error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
