import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { notifyTaskCreated } from '@/lib/slack'

export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL_1 || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY_1 || process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * POST /api/tasks/create
 *
 * External webhook endpoint for creating tasks programmatically.
 * Used by N8N, CleanCut, CC Automations bot, etc.
 *
 * Auth: x-webhook-secret header matching TASK_WEBHOOK_SECRET env var.
 *
 * Body:
 * {
 *   client_id?: number,
 *   client_name?: string,       // Fuzzy match if client_id not provided
 *   title: string,              // Required
 *   content_type: 'long_form' | 'short_form',  // Required
 *   source_file_url?: string,
 *   editing_instructions?: string,
 *   priority?: 'low' | 'normal' | 'high' | 'urgent',
 *   deadline_hours?: number,    // Default: 24
 *   notes?: string
 * }
 */
export async function POST(req: NextRequest) {
  try {
    // Validate webhook secret
    const secret = req.headers.get('x-webhook-secret')
    const expectedSecret = process.env.TASK_WEBHOOK_SECRET
    if (!expectedSecret || secret !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getSupabase()
    const body = await req.json()
    const {
      client_id,
      client_name,
      title,
      content_type,
      source_file_url,
      editing_instructions,
      priority = 'normal',
      deadline_hours = 24,
      notes,
    } = body

    // Validate required fields
    if (!title) {
      return NextResponse.json({ error: 'Missing required field: title' }, { status: 400 })
    }
    if (!content_type || !['long_form', 'short_form'].includes(content_type)) {
      return NextResponse.json(
        { error: 'Missing or invalid content_type. Must be "long_form" or "short_form".' },
        { status: 400 }
      )
    }

    // Resolve client
    let resolvedClientId: number | null = null
    let resolvedClientName: string = ''

    if (client_id) {
      const { data: client } = await supabase
        .from('clients')
        .select('id, name')
        .eq('id', client_id)
        .single()
      if (!client) {
        return NextResponse.json({ error: `Client not found with id: ${client_id}` }, { status: 404 })
      }
      resolvedClientId = client.id
      resolvedClientName = client.name
    } else if (client_name) {
      const { data: clients } = await supabase
        .from('clients')
        .select('id, name')
        .ilike('name', `%${client_name}%`)
        .limit(1)
      if (!clients || clients.length === 0) {
        return NextResponse.json({ error: `Client not found: ${client_name}` }, { status: 404 })
      }
      resolvedClientId = clients[0].id
      resolvedClientName = clients[0].name
    } else {
      return NextResponse.json({ error: 'Must provide either client_id or client_name' }, { status: 400 })
    }

    // Find assigned editor (pick one with fewest active tasks if multiple)
    const { data: assignments } = await supabase
      .from('editor_assignments')
      .select('editor_id')
      .eq('client_id', resolvedClientId)

    let assignedEditorId: string | null = null
    let assignedEditorName: string | null = null
    let assignedEditorSlackId: string | null = null

    if (assignments && assignments.length > 0) {
      if (assignments.length === 1) {
        assignedEditorId = assignments[0].editor_id
      } else {
        // Multiple editors — pick one with fewest active tasks
        const editorIds = assignments.map(a => a.editor_id)
        const { data: taskCounts } = await supabase
          .from('tasks')
          .select('editor_id')
          .in('editor_id', editorIds)
          .in('status', ['queued', 'in_progress', 'in_review', 'revision_needed'])

        const countMap = new Map<string, number>()
        for (const id of editorIds) countMap.set(id, 0)
        if (taskCounts) {
          for (const t of taskCounts) {
            countMap.set(t.editor_id, (countMap.get(t.editor_id) || 0) + 1)
          }
        }

        // Pick editor with lowest count
        let minCount = Infinity
        for (const [id, count] of countMap) {
          if (count < minCount) {
            minCount = count
            assignedEditorId = id
          }
        }
      }

      // Get editor profile
      if (assignedEditorId) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('display_name, slack_user_id')
          .eq('id', assignedEditorId)
          .single()

        if (profile) {
          assignedEditorName = profile.display_name
          assignedEditorSlackId = profile.slack_user_id
        }
      }
    }

    // Calculate deadline
    const deadline = new Date(Date.now() + deadline_hours * 60 * 60 * 1000).toISOString()

    // We need a "created_by" — for webhook-created tasks, use a system/admin profile
    // Look for an admin profile to use as creator
    const { data: adminProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'admin')
      .limit(1)
      .maybeSingle()

    const createdBy = adminProfile?.id || assignedEditorId

    if (!createdBy) {
      return NextResponse.json({ error: 'No admin or editor found to set as task creator' }, { status: 500 })
    }

    // Insert task
    const { data: task, error: insertError } = await supabase
      .from('tasks')
      .insert({
        client_id: resolvedClientId,
        editor_id: assignedEditorId,
        created_by: createdBy,
        title: title.trim(),
        content_type,
        status: 'queued',
        priority: ['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : 'normal',
        deadline,
        source_file_url: source_file_url || null,
        editing_instructions: editing_instructions || null,
        notes: notes || null,
      })
      .select('id')
      .single()

    if (insertError) {
      console.error('Task creation error:', insertError)
      return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
    }

    // Log activity
    await supabase.from('task_activity_log').insert({
      task_id: task.id,
      actor_id: createdBy,
      action: 'task_created',
      new_value: `via webhook`,
    })

    // Slack notification (fire-and-forget)
    if (assignedEditorSlackId) {
      notifyTaskCreated(assignedEditorSlackId, title.trim(), resolvedClientName, deadline).catch(() => {})
    }

    return NextResponse.json({
      success: true,
      task_id: task.id,
      client_name: resolvedClientName,
      editor_name: assignedEditorName,
      deadline,
    }, { status: 201 })
  } catch (err) {
    console.error('Task webhook error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
