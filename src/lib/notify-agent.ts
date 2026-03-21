/**
 * Notify the CC Client Agent about QC events.
 * Fire-and-forget — never blocks UI or throws errors.
 */

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_WEBHOOK_URL
  || 'https://cc-client-agent-production.up.railway.app/webhook/event'

const AGENT_SECRET = process.env.NEXT_PUBLIC_AGENT_WEBHOOK_SECRET
  || ''

interface AgentEvent {
  event: 'qc_done' | 'qc_ready' | 'stage_change' | 'raw_upload'
  client_id: number
  [key: string]: unknown
}

export async function notifyAgent(payload: AgentEvent): Promise<void> {
  if (!AGENT_SECRET) {
    console.warn('[notify-agent] No AGENT_WEBHOOK_SECRET set, skipping')
    return
  }

  try {
    const res = await fetch(AGENT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': AGENT_SECRET,
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      console.error(`[notify-agent] ${res.status}: ${await res.text()}`)
    }
  } catch (err) {
    // Never block the UI — just log
    console.error('[notify-agent] Failed:', err)
  }
}
