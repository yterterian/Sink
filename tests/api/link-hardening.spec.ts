import type { LinkAuditListResponse } from '../../shared/types/link-audit'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { links } from '../../server/database/schema'
import { db, deleteStoredLinks, fetch, fetchWithAuth, getD1Link, postJson, putJson, setLinkStoreD1Mode } from '../utils'

const createdSlugs = new Set<string>()

function newSlug() {
  const slug = `harden-${crypto.randomUUID().slice(0, 13)}`
  createdSlugs.add(slug)
  return slug
}

async function createLink(slug: string, extra: Record<string, unknown> = {}) {
  const response = await postJson('/api/link/create', { url: 'https://example.com/start', slug, ...extra })
  expect(response.status).toBe(201)
}

async function setLocked(slug: string, locked: boolean, confirm?: string) {
  return await postJson('/api/link/lock', { slug, locked, confirm })
}

async function history(slug: string) {
  const response = await fetchWithAuth(`/api/link/audit?slug=${slug}`)
  expect(response.status).toBe(200)
  return await response.json() as LinkAuditListResponse
}

beforeEach(async () => {
  await setLinkStoreD1Mode()
})

afterEach(async () => {
  await deleteStoredLinks([...createdSlugs])
  createdSlugs.clear()
})

describe('link locking', () => {
  it('blocks edits and deletion of a locked link and records the attempt', async () => {
    const slug = newSlug()
    await createLink(slug)
    expect((await setLocked(slug, true)).status).toBe(200)

    const edit = await putJson('/api/link/edit', { slug, url: 'https://attacker.test' })
    expect(edit.status).toBe(423)
    const remove = await postJson('/api/link/delete', { slug })
    expect(remove.status).toBe(423)

    const stored = await getD1Link(slug)
    expect(stored?.url).toBe('https://example.com/start')
    expect(stored?.locked).toBe(true)

    const { entries } = await history(slug)
    expect(entries.map(entry => entry.action)).toEqual(['denied', 'denied', 'lock', 'create'])
    expect(entries[1]?.changes).toContainEqual({ field: 'url', from: 'https://example.com/start', to: 'https://attacker.test' })
    expect(entries[0]?.actor).toMatch(/^root@/)
  })

  it('cannot be unlocked through a normal edit', async () => {
    const slug = newSlug()
    await createLink(slug, { locked: true })

    const edit = await putJson('/api/link/edit', { slug, url: 'https://example.com/start', locked: false })
    expect(edit.status).toBe(423)
    expect((await getD1Link(slug))?.locked).toBe(true)
  })

  it('requires the slug to be typed again to unlock', async () => {
    const slug = newSlug()
    await createLink(slug)
    await setLocked(slug, true)

    expect((await setLocked(slug, false)).status).toBe(400)
    expect((await setLocked(slug, false, 'wrong')).status).toBe(400)
    expect((await getD1Link(slug))?.locked).toBe(true)

    expect((await setLocked(slug, false, slug)).status).toBe(200)
    expect((await getD1Link(slug))?.locked).toBeNull()

    const edit = await putJson('/api/link/edit', { slug, url: 'https://example.com/next' })
    expect(edit.status).toBe(201)

    const { entries } = await history(slug)
    expect(entries.map(entry => entry.action)).toEqual(['edit', 'unlock', 'lock', 'create'])
    expect(entries[0]?.changes).toEqual([{ field: 'url', from: 'https://example.com/start', to: 'https://example.com/next' }])
  })

  it('does not let an expired locked slug be reused', async () => {
    const slug = newSlug()
    await createLink(slug, { expiration: Math.floor(Date.now() / 1000) + 3600, locked: true })
    await db.update(links).set({ effectiveExpiresAt: Math.floor(Date.now() / 1000) - 10 }).where(eq(links.slug, slug))

    const response = await postJson('/api/link/create', { url: 'https://attacker.test', slug })
    expect(response.status).toBe(409)
    expect((await getD1Link(slug))?.url).toBe('https://example.com/start')
    expect((await history(slug)).entries[0]?.action).toBe('denied')
  })

  it('still lets an expired unlocked slug be reused', async () => {
    const slug = newSlug()
    await createLink(slug, { expiration: Math.floor(Date.now() / 1000) + 3600 })
    await db.update(links).set({ effectiveExpiresAt: Math.floor(Date.now() / 1000) - 10 }).where(eq(links.slug, slug))

    const response = await postJson('/api/link/create', { url: 'https://example.com/reused', slug })
    expect(response.status).toBe(201)
  })

  it('returns 404 when locking a missing link', async () => {
    expect((await setLocked(`missing-${crypto.randomUUID()}`, true)).status).toBe(404)
  })
})

describe('/api/link/audit', () => {
  it('requires authentication', async () => {
    expect((await fetch('/api/link/audit')).status).toBe(401)
  })

  it('records deletions and pages newest first', async () => {
    const slug = newSlug()
    await createLink(slug)
    for (const path of ['a', 'b', 'c'])
      expect((await putJson('/api/link/edit', { slug, url: `https://example.com/${path}` })).status).toBe(201)
    expect((await postJson('/api/link/delete', { slug })).status).toBe(204)

    const first = await fetchWithAuth(`/api/link/audit?slug=${slug}&limit=2`)
    const page1 = await first.json() as LinkAuditListResponse
    expect(page1.entries.map(entry => entry.action)).toEqual(['delete', 'edit'])
    expect(page1.cursor).toBeTruthy()

    const second = await fetchWithAuth(`/api/link/audit?slug=${slug}&limit=10&cursor=${encodeURIComponent(page1.cursor!)}`)
    const page2 = await second.json() as LinkAuditListResponse
    expect(page2.entries.map(entry => entry.action)).toEqual(['edit', 'edit', 'create'])
    expect(page2.cursor).toBeUndefined()
  })

  it('rejects a malformed cursor', async () => {
    expect((await fetchWithAuth('/api/link/audit?cursor=nope')).status).toBe(400)
  })
})
