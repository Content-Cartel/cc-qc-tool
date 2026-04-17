import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { findClientFolder, createDNATemplateDoc } from '@/lib/google-docs'

export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

/**
 * POST /api/dna/create-template
 *
 * Creates a blank DNA Playbook template doc in the client's Google Drive folder.
 * If a DNA doc already exists, returns that URL instead.
 * Saves the doc URL to client_settings.dna_doc_url.
 */
export async function POST(req: NextRequest) {
  const supabase = getSupabase()
  const { client_id } = await req.json()

  if (!client_id) {
    return NextResponse.json({ error: 'client_id is required' }, { status: 400 })
  }

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    return NextResponse.json({ error: 'Google Service Account not configured' }, { status: 500 })
  }

  // Fetch client name
  const { data: client } = await supabase
    .from('clients')
    .select('name')
    .eq('id', client_id)
    .single()

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const clientName = client.name

  // Find client folder in shared Drive
  const folderId = await findClientFolder(clientName)
  if (!folderId) {
    return NextResponse.json(
      { error: `No folder found for "${clientName}" in the Content Cartel shared Drive. Create the client folder first.` },
      { status: 404 }
    )
  }

  // Create (or find existing) DNA template doc
  const result = await createDNATemplateDoc(clientName, folderId)
  if (!result) {
    return NextResponse.json({ error: 'Failed to create DNA template doc' }, { status: 500 })
  }

  // Save doc URL to client_settings
  const { error: settingsError } = await supabase
    .from('client_settings')
    .upsert(
      { client_id, dna_doc_url: result.url },
      { onConflict: 'client_id' }
    )

  if (settingsError) {
    console.error(`[create-template] Failed to save dna_doc_url for ${clientName}:`, settingsError)
    // Don't fail the request — the doc was created successfully
  }

  return NextResponse.json({
    url: result.url,
    doc_id: result.docId,
    client_name: clientName,
    already_existed: result.alreadyExisted,
    message: result.alreadyExisted
      ? `Found existing DNA doc for ${clientName}`
      : `Created new DNA Playbook template for ${clientName}`,
  })
}
