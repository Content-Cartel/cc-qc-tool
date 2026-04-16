import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { notifyDeadlineWarning, notifyDeadlineMissed } from '@/lib/slack'

export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY_1 || process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(req: NextRequest) {
  const supabase = getSupabase()
  // Verify cron secret (Vercel sends this automatically for cron jobs)
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const now = new Date()
    const fourHoursFromNow = new Date(now.getTime() + 4 * 60 * 60 * 1000)

    // Find tasks that are:
    // 1. Still queued or in_progress
    // 2. Deadline is within 4 hours OR already past
    const { data: tasks, error } = await supabase
      .from('tasks')
      .select('id, title, deadline, status, editor_id, client_id, clients(name), profiles!tasks_editor_id_fkey(display_name, slack_user_id)')
      .in('status', ['queued', 'in_progress'])
      .lte('deadline', fourHoursFromNow.toISOString())
      .order('deadline', { ascending: true })

    if (error) {
      console.error('Deadline check query error:', error)
      return NextResponse.json({ error: 'Query failed' }, { status: 500 })
    }

    if (!tasks || tasks.length === 0) {
      return NextResponse.json({ checked: 0, warnings: 0, missed: 0 })
    }

    let warnings = 0
    let missed = 0

    for (const task of tasks) {
      const deadline = new Date(task.deadline)
      const isOverdue = deadline < now
      const hoursRemaining = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60)

      const profile = (task as unknown as { profiles?: { display_name: string; slack_user_id: string | null } }).profiles
      const clientName = (task as unknown as { clients?: { name: string } }).clients?.name || 'Unknown'
      const editorSlackId = profile?.slack_user_id || null
      const editorName = profile?.display_name || 'Unassigned'

      // Check if we already sent an alert recently (within last hour)
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
      const alertAction = isOverdue ? 'deadline_missed_alert' : 'deadline_warning_alert'

      const { data: recentAlerts } = await supabase
        .from('task_activity_log')
        .select('id')
        .eq('task_id', task.id)
        .eq('action', alertAction)
        .gte('created_at', oneHourAgo)
        .limit(1)

      if (recentAlerts && recentAlerts.length > 0) {
        continue // Already alerted recently
      }

      if (isOverdue) {
        await notifyDeadlineMissed(editorSlackId, editorName, task.title, clientName)
        missed++
      } else {
        await notifyDeadlineWarning(editorSlackId, task.title, clientName, hoursRemaining)
        warnings++
      }

      // Log the alert to prevent duplicates
      await supabase.from('task_activity_log').insert({
        task_id: task.id,
        action: alertAction,
        new_value: isOverdue ? 'overdue' : `${Math.round(hoursRemaining)}h remaining`,
      })
    }

    return NextResponse.json({
      checked: tasks.length,
      warnings,
      missed,
    })
  } catch (err) {
    console.error('Deadline check error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
