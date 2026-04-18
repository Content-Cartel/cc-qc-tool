import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL_1 || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_1 || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
  )
}

function cleanFileName(name: string): string {
  return name
    .replace(/\.[^/.]+$/, '') // remove extension
    .replace(/[_-]+/g, ' ')  // underscores/hyphens to spaces
    .replace(/\s+/g, ' ')    // collapse whitespace
    .trim()
}

export async function POST(req: NextRequest) {
  const supabase = getSupabase()
  try {
    // Validate webhook secret
    const secret = req.headers.get('x-webhook-secret')
    const expectedSecret = process.env.INTAKE_WEBHOOK_SECRET
    if (!expectedSecret || secret !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { client_name, file_name, drive_url, content_type } = body

    if (!client_name || !file_name || !drive_url) {
      return NextResponse.json(
        { error: 'Missing required fields: client_name, file_name, drive_url' },
        { status: 400 }
      )
    }

    // Look up client by name (case-insensitive)
    const { data: clients } = await supabase
      .from('clients')
      .select('id, name')
      .ilike('name', `%${client_name}%`)
      .limit(1)

    if (!clients || clients.length === 0) {
      return NextResponse.json(
        { error: `Client not found: ${client_name}` },
        { status: 404 }
      )
    }

    const client = clients[0]

    // Create submission at raw_footage stage
    const { data: submission, error } = await supabase
      .from('qc_submissions')
      .insert({
        title: cleanFileName(file_name),
        external_url: drive_url,
        client_id: client.id,
        content_type: content_type || 'lf_video',
        status: 'pending',
        current_pipeline_stage: 'raw_footage',
        intake_source: 'n8n_drive',
        submitted_by_name: 'n8n-auto',
        revision_count: 0,
      })
      .select('id')
      .single()

    if (error) {
      console.error('Failed to create submission:', error)
      return NextResponse.json({ error: 'Failed to create submission' }, { status: 500 })
    }

    // Notify CC Client Agent (fire-and-forget)
    const agentUrl = process.env.NEXT_PUBLIC_AGENT_WEBHOOK_URL
    if (agentUrl) {
      fetch(agentUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'new_raw_file',
          client_id: client.id,
          client_name: client.name,
          submission_id: submission.id,
          content_title: cleanFileName(file_name),
          source: 'n8n_drive',
        }),
      }).catch(() => {})
    }

    return NextResponse.json({
      success: true,
      submission_id: submission.id,
      client: client.name,
      title: cleanFileName(file_name),
    })
  } catch (err) {
    console.error('Intake error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
