import type { H3Event } from 'h3'
import type { Link } from '#shared/schemas/link'
import type { LinkAuditAction, LinkAuditChange, LinkAuditEntry, LinkAuditListResponse } from '#shared/types/link-audit'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { createError, getHeader } from 'h3'
import { linkAudit } from '../database/schema'

const AUDIT_CURSOR_PREFIX = 'audit:v1:'

const AUDITED_FIELDS = [
  'url',
  'apple',
  'google',
  'geo',
  'expiration',
  'cloaking',
  'redirectWithQuery',
  'unsafe',
  'locked',
  'comment',
  'title',
  'description',
  'image',
  'tags',
] as const satisfies readonly (keyof Link)[]

type AuditRow = typeof linkAudit.$inferSelect

export interface LinkAuditInput {
  action: LinkAuditAction
  slug: string
  linkId?: string
  reason?: string
  changes?: LinkAuditChange[]
}

interface AuditActor {
  actor: string
  authMethod?: string
  ip?: string
  country?: string
}

function comparable(value: unknown): unknown {
  if (value === undefined || value === null || value === '' || value === false)
    return undefined
  if (Array.isArray(value))
    return value.length ? [...value].sort() : undefined
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    return entries.length ? Object.fromEntries(entries) : undefined
  }
  return value
}

function change(field: string, from: unknown, to: unknown): LinkAuditChange {
  const result: LinkAuditChange = { field }
  if (from !== undefined)
    result.from = from
  if (to !== undefined)
    result.to = to
  return result
}

/** Field-level differences between two versions of a link. Password hashes are never recorded. */
export function diffLinkForAudit(before: Partial<Link> | null | undefined, after: Partial<Link> | null | undefined): LinkAuditChange[] {
  const changes: LinkAuditChange[] = []
  for (const field of AUDITED_FIELDS) {
    const from = comparable(before?.[field])
    const to = comparable(after?.[field])
    if (JSON.stringify(from) !== JSON.stringify(to))
      changes.push(change(field, from, to))
  }

  const hadPassword = Boolean(before?.password)
  const hasPassword = Boolean(after?.password)
  if (hadPassword !== hasPassword || (hadPassword && before?.password !== after?.password))
    changes.push(change('password', hadPassword ? 'set' : undefined, hasPassword ? (hadPassword ? 'changed' : 'set') : undefined))

  return changes
}

function getAuditActor(event: H3Event): AuditActor {
  const cf = event.context.cloudflare?.request?.cf
  return {
    actor: event.context.userEmail || 'unknown',
    authMethod: event.context.authMethod,
    ip: getHeader(event, 'cf-connecting-ip') || undefined,
    country: typeof cf?.country === 'string' ? cf.country : undefined,
  }
}

function createAuditId(now: number): string {
  // Time-ordered so entries created in the same second still sort newest first.
  return `${now.toString(36).padStart(10, '0')}-${crypto.randomUUID().slice(0, 8)}`
}

function buildAuditRow(input: LinkAuditInput, actor: AuditActor, now: number): typeof linkAudit.$inferInsert {
  return {
    id: createAuditId(now),
    slug: input.slug,
    linkId: input.linkId ?? null,
    action: input.action,
    actor: actor.actor,
    authMethod: actor.authMethod ?? null,
    ip: actor.ip ?? null,
    country: actor.country ?? null,
    reason: input.reason ?? null,
    changes: input.changes ?? [],
    createdAt: Math.floor(now / 1000),
  }
}

function shouldAlert(input: LinkAuditInput): boolean {
  return input.action !== 'edit' || (input.changes?.length ?? 0) > 0
}

/**
 * Records one audit entry and queues a change alert.
 * Audit failures are logged rather than thrown, because the change itself has already happened.
 */
export async function recordLinkAudit(event: H3Event, input: LinkAuditInput): Promise<void> {
  await recordLinkAudits(event, [input])
}

export async function recordLinkAudits(event: H3Event, inputs: LinkAuditInput[], summaryAlert?: LinkAuditInput & { count: number }): Promise<void> {
  if (!inputs.length)
    return

  const actor = getAuditActor(event)
  const now = Date.now()
  const rows = inputs.map((input, index) => buildAuditRow(input, actor, now + index))

  try {
    const db = drizzle(event.context.cloudflare.env.DB)
    const [first, ...rest] = rows.map(row => db.insert(linkAudit).values(row))
    await db.batch([first!, ...rest])
  }
  catch (error) {
    console.error({
      event: 'link_audit.write.failed',
      slugs: inputs.map(input => input.slug),
      error: error instanceof Error ? error.message : String(error),
    })
  }

  if (summaryAlert) {
    queueChangeAlert(event, {
      ...actor,
      action: summaryAlert.action,
      slug: summaryAlert.slug,
      reason: summaryAlert.reason,
      changes: summaryAlert.changes ?? [],
      count: summaryAlert.count,
    })
    return
  }

  for (const input of inputs) {
    if (shouldAlert(input))
      queueChangeAlert(event, { ...actor, action: input.action, slug: input.slug, reason: input.reason, changes: input.changes ?? [] })
  }
}

/** Records a blocked change, sends an urgent alert, and rejects the request. */
export async function denyLinkChange(
  event: H3Event,
  input: { slug: string, linkId?: string, reason: string, changes?: LinkAuditChange[], status: number },
): Promise<never> {
  await recordLinkAudit(event, {
    action: 'denied',
    slug: input.slug,
    linkId: input.linkId,
    reason: input.reason,
    changes: input.changes,
  })
  throw createError({ status: input.status, statusText: input.reason })
}

function rowToEntry(row: AuditRow): LinkAuditEntry {
  const entry: LinkAuditEntry = {
    id: row.id,
    slug: row.slug,
    action: row.action,
    actor: row.actor,
    changes: row.changes ?? [],
    createdAt: row.createdAt,
  }
  if (row.linkId)
    entry.linkId = row.linkId
  if (row.authMethod)
    entry.authMethod = row.authMethod
  if (row.ip)
    entry.ip = row.ip
  if (row.country)
    entry.country = row.country
  if (row.reason)
    entry.reason = row.reason
  return entry
}

function encodeAuditCursor(row: AuditRow): string {
  return `${AUDIT_CURSOR_PREFIX}${btoa(JSON.stringify({ createdAt: row.createdAt, id: row.id }))}`
}

function decodeAuditCursor(cursor: string | undefined): { createdAt: number, id: string } | undefined {
  if (!cursor)
    return undefined
  try {
    if (!cursor.startsWith(AUDIT_CURSOR_PREFIX))
      throw new Error('prefix')
    const decoded = JSON.parse(atob(cursor.slice(AUDIT_CURSOR_PREFIX.length))) as { createdAt: unknown, id: unknown }
    if (typeof decoded.createdAt !== 'number' || typeof decoded.id !== 'string')
      throw new Error('shape')
    return { createdAt: decoded.createdAt, id: decoded.id }
  }
  catch {
    throw createError({ status: 400, statusText: 'Invalid pagination cursor' })
  }
}

export async function listLinkAudit(event: H3Event, options: { slug?: string, limit: number, cursor?: string }): Promise<LinkAuditListResponse> {
  const db = drizzle(event.context.cloudflare.env.DB)
  const cursor = decodeAuditCursor(options.cursor)
  const rows = await db
    .select()
    .from(linkAudit)
    .where(and(
      options.slug ? eq(linkAudit.slug, options.slug) : undefined,
      cursor
        ? or(
            lt(linkAudit.createdAt, cursor.createdAt),
            and(eq(linkAudit.createdAt, cursor.createdAt), lt(linkAudit.id, cursor.id)),
          )
        : undefined,
    ))
    .orderBy(desc(linkAudit.createdAt), desc(linkAudit.id))
    .limit(options.limit + 1)

  const hasMore = rows.length > options.limit
  const page = hasMore ? rows.slice(0, options.limit) : rows
  const last = page.at(-1)
  return {
    entries: page.map(rowToEntry),
    cursor: hasMore && last ? encodeAuditCursor(last) : undefined,
  }
}
