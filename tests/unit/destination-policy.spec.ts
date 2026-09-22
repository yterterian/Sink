import { describe, expect, it } from 'vitest'
import {
  findDestinationViolation,
  isHostAllowed,
  listChangedDestinations,
  listLinkDestinations,
  parseDestinationAllowlist,
} from '../../server/utils/destination-policy'

describe('destination policy', () => {
  it('normalises allowlist entries', () => {
    expect(parseDestinationAllowlist(' Example.com , *.shop.example.org., , bücher.de'))
      .toEqual(['example.com', 'shop.example.org', 'xn--bcher-kva.de'])
  })

  it('allows exact hosts and subdomains only', () => {
    const allowlist = ['example.com']
    expect(isHostAllowed('example.com', allowlist)).toBe(true)
    expect(isHostAllowed('www.example.com', allowlist)).toBe(true)
    expect(isHostAllowed('evilexample.com', allowlist)).toBe(false)
    expect(isHostAllowed('example.com.evil.net', allowlist)).toBe(false)
  })

  it('checks the real hostname, not user info in the URL', () => {
    const violation = findDestinationViolation(['https://example.com@evil.net/login'], { allowlist: ['example.com'], httpsOnly: false })
    expect(violation).toEqual({ url: 'https://example.com@evil.net/login', reason: 'domain_not_allowed' })
  })

  it('enforces https when required', () => {
    expect(findDestinationViolation(['http://example.com'], { allowlist: [], httpsOnly: true }))
      .toEqual({ url: 'http://example.com', reason: 'https_required' })
    expect(findDestinationViolation(['https://example.com'], { allowlist: [], httpsOnly: true })).toBeNull()
  })

  it('does nothing when no policy is configured', () => {
    expect(findDestinationViolation(['http://anything.test'], { allowlist: [], httpsOnly: false })).toBeNull()
  })

  it('covers app store and country destinations', () => {
    const link = {
      url: 'https://example.com',
      apple: 'https://apps.apple.com/app/1',
      geo: { AU: 'https://evil.net/au' },
    }
    expect(listLinkDestinations(link)).toEqual(['https://example.com', 'https://apps.apple.com/app/1', 'https://evil.net/au'])
    expect(findDestinationViolation(listLinkDestinations(link), { allowlist: ['example.com', 'apple.com'], httpsOnly: false }))
      .toEqual({ url: 'https://evil.net/au', reason: 'domain_not_allowed' })
  })

  it('only reports destinations that changed', () => {
    const previous = { url: 'https://legacy.test', google: 'https://play.google.com/x' }
    const next = { url: 'https://legacy.test', google: 'https://new.test' }
    expect(listChangedDestinations(next, previous)).toEqual(['https://new.test'])
    expect(listChangedDestinations(next, null)).toEqual(['https://legacy.test', 'https://new.test'])
  })
})
