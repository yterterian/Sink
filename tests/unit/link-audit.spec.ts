import { describe, expect, it } from 'vitest'
import { diffLinkForAudit } from '../../server/utils/link-audit'

const base = {
  id: 'id1',
  slug: 'abc',
  url: 'https://example.com',
  createdAt: 1,
  updatedAt: 1,
  tags: ['b', 'a'],
}

describe('diffLinkForAudit', () => {
  it('records destination changes with old and new values', () => {
    expect(diffLinkForAudit(base, { ...base, url: 'https://example.org' }))
      .toEqual([{ field: 'url', from: 'https://example.com', to: 'https://example.org' }])
  })

  it('ignores differences that do not change behaviour', () => {
    expect(diffLinkForAudit(base, { ...base, cloaking: false, comment: '', tags: ['a', 'b'] })).toEqual([])
  })

  it('never records password hashes', () => {
    const changes = diffLinkForAudit({ ...base, password: 'hash-one' }, { ...base, password: 'hash-two' })
    expect(changes).toEqual([{ field: 'password', from: 'set', to: 'changed' }])
    expect(JSON.stringify(changes)).not.toContain('hash')
  })

  it('describes creation and deletion', () => {
    expect(diffLinkForAudit(null, { ...base, locked: true })).toEqual([
      { field: 'url', to: 'https://example.com' },
      { field: 'locked', to: true },
      { field: 'tags', to: ['a', 'b'] },
    ])
    expect(diffLinkForAudit(base, null)).toEqual([
      { field: 'url', from: 'https://example.com' },
      { field: 'tags', from: ['a', 'b'] },
    ])
  })
})
