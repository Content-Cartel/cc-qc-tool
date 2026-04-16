import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  notifyTaskCreated,
  notifySubmittedForReview,
  notifyRevisionRequested,
} from '@/lib/slack'

export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY_1 || process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Internal API route for triggering Slack notifications on task events.
 * Called from client-side after successful task updates.
 *
 * Body: { type, task_id }
 * Types: 'task_created' | 'submitted_for_review' | 'revision_requested'
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabase()
    const { type, task_id } = await req.json()

    if (!type || !task_id) {
      return NextResponse.json({ error: 'Missing type or task_id' }, { status: 400 })
    }

    // Fetch task with joins
    const { data: task } = await supabase
      .from('tasks')
      .select('*, clients(name), profiles!tasks_editor_id_fkey(display_name, slack_user_id)')
      .eq('id', task_id)
      .single()

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const profile = (task as unknown as { profiles?: { display_name: string; slack_user_id: string | null } }).profiles
    const clientName = (task as unknown as { clients?: { name: string } }).clients?.name || 'Unknown'
    const editorSlackId = profile?.slack_user_id || null
    const editorName = profile?.display_name || 'Unassigned'

    switch (type) {
      case 'task_created':
        await notifyTaskCreated(editorSlackId, task.title, clientName, task.deadline)
        break

      case 'submitted_for_review':
        await notifySubmittedForReview(editorName, task.title, clientName)
        break

      case 'revision_requested':
        await notifyRevisionRequested(editorSlackId, task.title, clientName)
        break

      default:
        return NextResponse.json({ error: `Unknown notification type: ${type}` }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Task notify error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
