/**
 * Slack Web API helpers for sending notifications.
 * Requires SLACK_BOT_TOKEN env var (xoxb-...).
 */

const SLACK_API_BASE = 'https://slack.com/api'

interface SlackBlock {
  type: string
  text?: { type: string; text: string; emoji?: boolean }
  elements?: Array<{ type: string; text: string; emoji?: boolean }>
  fields?: Array<{ type: string; text: string }>
  [key: string]: unknown
}

interface SlackMessagePayload {
  channel: string
  text: string
  blocks?: SlackBlock[]
  unfurl_links?: boolean
}

async function slackRequest(method: string, body: Record<string, unknown>) {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) {
    console.warn('[Slack] SLACK_BOT_TOKEN not set — skipping notification')
    return null
  }

  try {
    const res = await fetch(`${SLACK_API_BASE}/${method}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const data = await res.json()
    if (!data.ok) {
      console.error(`[Slack] ${method} failed:`, data.error)
    }
    return data
  } catch (err) {
    console.error(`[Slack] ${method} error:`, err)
    return null
  }
}

/**
 * Send a message to a channel (or DM channel).
 */
export async function sendSlackMessage(channel: string, text: string, blocks?: SlackBlock[]) {
  const payload: SlackMessagePayload = { channel, text, unfurl_links: false }
  if (blocks) payload.blocks = blocks
  return slackRequest('chat.postMessage', payload)
}

/**
 * Send a DM to a user by their Slack user ID.
 */
export async function sendSlackDM(userId: string, text: string, blocks?: SlackBlock[]) {
  // Open a DM channel first
  const openRes = await slackRequest('conversations.open', { users: userId })
  if (!openRes?.ok || !openRes?.channel?.id) {
    console.error('[Slack] Failed to open DM with', userId)
    return null
  }
  return sendSlackMessage(openRes.channel.id, text, blocks)
}

// ============================================================================
// Task Notification Helpers
// ============================================================================

const CC_HOME_CHANNEL = 'C096RFCUU1Y'
const SAAD_SLACK_ID = 'U0ALF0ADURJ'

/**
 * Notify editor that a new task was created.
 */
export async function notifyTaskCreated(
  editorSlackId: string | null,
  taskTitle: string,
  clientName: string,
  deadline: string
) {
  if (!editorSlackId) return
  const deadlineStr = new Date(deadline).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
  await sendSlackDM(
    editorSlackId,
    `📋 *New task assigned:* ${taskTitle}\n*Client:* ${clientName}\n*Deadline:* ${deadlineStr}`
  )
}

/**
 * Alert for deadline warning (<4 hours remaining).
 */
export async function notifyDeadlineWarning(
  editorSlackId: string | null,
  taskTitle: string,
  clientName: string,
  hoursRemaining: number
) {
  const msg = `⚠️ *Deadline alert:* "${taskTitle}" for ${clientName} is due in ${Math.round(hoursRemaining)}h. Still not in review.`

  if (editorSlackId) await sendSlackDM(editorSlackId, msg)
  await sendSlackDM(SAAD_SLACK_ID, msg)
}

/**
 * Alert for missed deadline.
 */
export async function notifyDeadlineMissed(
  editorSlackId: string | null,
  editorName: string,
  taskTitle: string,
  clientName: string
) {
  const msg = `🚨 *Deadline missed:* "${taskTitle}" for ${clientName} (Editor: ${editorName}) — not submitted for review.`

  if (editorSlackId) await sendSlackDM(editorSlackId, msg)
  await sendSlackDM(SAAD_SLACK_ID, msg)
  await sendSlackMessage(CC_HOME_CHANNEL, msg)
}

/**
 * Notify PM when editor submits for review.
 */
export async function notifySubmittedForReview(
  editorName: string,
  taskTitle: string,
  clientName: string
) {
  await sendSlackDM(
    SAAD_SLACK_ID,
    `✅ *Submitted for review:* "${taskTitle}" for ${clientName} by ${editorName}`
  )
}

/**
 * Notify editor when PM requests revision.
 */
export async function notifyRevisionRequested(
  editorSlackId: string | null,
  taskTitle: string,
  clientName: string
) {
  if (!editorSlackId) return
  await sendSlackDM(
    editorSlackId,
    `🔄 *Revision needed:* "${taskTitle}" for ${clientName} — check the task board for details.`
  )
}
