import type { H3Event } from 'h3'
import type { LinkAuditAction, LinkAuditChange } from '#shared/types/link-audit'
import { getRequestHost, getRequestProtocol } from 'h3'

const CHANGE_ALERT_TIMEOUT_MS = 10_000
const MAX_VALUE_LENGTH = 200

type AlertFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface ChangeAlert {
  action: LinkAuditAction
  slug: string
  actor: string
  authMethod?: string
  ip?: string
  country?: string
  reason?: string
  changes: LinkAuditChange[]
  /** Number of links affected, for bulk actions such as import. */
  count?: number
}

export interface ChangeAlertConfig {
  url: string
  format: 'json' | 'ntfy'
  secret?: string
  token?: string
}

interface DeliveryContext {
  origin: string
  fetcher?: AlertFetch
  now?: Date
}

const NTFY_PRIORITY: Record<LinkAuditAction, number> = {
  denied: 5,
  unlock: 5,
  delete: 4,
  edit: 4,
  import: 3,
  create: 2,
  lock: 2,
}

const NTFY_TAGS: Record<LinkAuditAction, string> = {
  denied: 'rotating_light',
  unlock: 'unlock',
  delete: 'wastebasket',
  edit: 'pencil2',
  import: 'inbox_tray',
  create: 'link',
  lock: 'lock',
}

const ACTION_TITLES: Record<LinkAuditAction, string> = {
  denied: 'change blocked',
  unlock: 'unlocked',
  delete: 'deleted',
  edit: 'edited',
  import: 'imported',
  create: 'created',
  lock: 'locked',
}

export function getChangeAlertConfig(event: H3Event): ChangeAlertConfig | null {
  const { changeAlertUrl, changeAlertFormat, changeAlertSecret, changeAlertToken } = useRuntimeConfig(event)
  const url = String(changeAlertUrl ?? '').trim()
  if (!url)
    return null
  return {
    url,
    format: String(changeAlertFormat).trim().toLowerCase() === 'ntfy' ? 'ntfy' : 'json',
    secret: String(changeAlertSecret ?? '').trim() || undefined,
    token: String(changeAlertToken ?? '').trim() || undefined,
  }
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '')
    return '(none)'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text
}

export function buildChangeAlertTitle(alert: ChangeAlert): string {
  if (alert.action === 'import')
    return `Sink: ${alert.count ?? 0} link(s) imported`
  return `Sink: /${alert.slug} ${ACTION_TITLES[alert.action]}`
}

export function buildChangeAlertText(alert: ChangeAlert): string {
  const lines = [
    `By: ${alert.actor}${alert.authMethod ? ` (${alert.authMethod})` : ''}`,
  ]
  if (alert.ip || alert.country)
    lines.push(`From: ${[alert.ip, alert.country].filter(Boolean).join(', ')}`)
  if (alert.reason)
    lines.push(`Reason: ${alert.reason}`)
  for (const change of alert.changes)
    lines.push(`${change.field}: ${formatValue(change.from)} -> ${formatValue(change.to)}`)
  return lines.join('\n')
}

function assertAlertUrl(value: string): URL {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('invalid_url')
  return url
}

export async function deliverChangeAlert(config: ChangeAlertConfig, alert: ChangeAlert, context: DeliveryContext): Promise<void> {
  const url = assertAlertUrl(config.url)
  const headers = new Headers()
  let body: string

  if (config.format === 'ntfy') {
    body = buildChangeAlertText(alert)
    headers.set('Content-Type', 'text/plain; charset=utf-8')
    headers.set('Title', buildChangeAlertTitle(alert))
    headers.set('Priority', String(NTFY_PRIORITY[alert.action]))
    headers.set('Tags', NTFY_TAGS[alert.action])
    if (alert.action !== 'import' && alert.action !== 'delete')
      headers.set('Click', `${context.origin}/dashboard/link?slug=${encodeURIComponent(alert.slug)}`)
  }
  else {
    const id = `evt_${crypto.randomUUID()}`
    const deliveryTimestamp = Math.floor((context.now ?? new Date()).getTime() / 1000)
    body = JSON.stringify({
      id,
      event: `link.${alert.action}`,
      createdAt: (context.now ?? new Date()).toISOString(),
      data: {
        ...alert,
        shortLink: `${context.origin}/${alert.slug}`,
        summary: buildChangeAlertText(alert),
      },
    })
    headers.set('Content-Type', 'application/json')
    headers.set('webhook-id', id)
    headers.set('webhook-timestamp', String(deliveryTimestamp))
    if (config.secret)
      headers.set('webhook-signature', await signWebhook(id, deliveryTimestamp, body, config.secret))
  }

  if (config.token)
    headers.set('Authorization', `Bearer ${config.token}`)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CHANGE_ALERT_TIMEOUT_MS)
  try {
    const response = await (context.fetcher || fetch)(url, {
      method: 'POST',
      redirect: 'manual',
      signal: controller.signal,
      headers,
      body,
    })
    await response.body?.cancel()
    if (!response.ok)
      throw new Error(`unexpected_status_${response.status}`)
  }
  finally {
    clearTimeout(timeout)
  }
}

export function queueChangeAlert(event: H3Event, alert: ChangeAlert): void {
  const config = getChangeAlertConfig(event)
  if (!config)
    return

  const origin = `${getRequestProtocol(event)}://${getRequestHost(event)}`
  const delivery = deliverChangeAlert(config, alert, { origin }).catch((error: unknown) => {
    console.error({
      event: 'change_alert.delivery.failed',
      action: alert.action,
      slug: alert.slug,
      error: error instanceof Error ? error.message : String(error),
    })
  })
  event.context.cloudflare.context.waitUntil(delivery)
}
