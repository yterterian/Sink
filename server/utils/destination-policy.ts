import type { H3Event } from 'h3'
import type { Link } from '#shared/schemas/link'

type DestinationFields = Pick<Link, 'url' | 'apple' | 'google' | 'geo'>

export type DestinationViolationReason = 'domain_not_allowed' | 'https_required'

export interface DestinationViolation {
  url: string
  reason: DestinationViolationReason
}

export interface DestinationPolicy {
  allowlist: string[]
  httpsOnly: boolean
}

function normalizeHostname(hostname: string): string | null {
  const value = hostname.trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, '')
  if (!value)
    return null
  try {
    // Converts internationalised names to punycode so they compare like URL hostnames do.
    return new URL(`https://${value}`).hostname
  }
  catch {
    return null
  }
}

export function parseDestinationAllowlist(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(normalizeHostname)
    .filter((entry): entry is string => !!entry)
}

export function getDestinationPolicy(event: H3Event): DestinationPolicy {
  const { destinationAllowlist, destinationHttpsOnly } = useRuntimeConfig(event)
  return {
    allowlist: parseDestinationAllowlist(String(destinationAllowlist ?? '')),
    httpsOnly: destinationHttpsOnly === true || String(destinationHttpsOnly) === 'true',
  }
}

export function isHostAllowed(hostname: string, allowlist: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return allowlist.some(entry => host === entry || host.endsWith(`.${entry}`))
}

/** Every URL a visitor could be sent to by this link. */
export function listLinkDestinations(link: Partial<DestinationFields>): string[] {
  return [link.url, link.apple, link.google, ...Object.values(link.geo ?? {})]
    .filter((url): url is string => typeof url === 'string' && url.length > 0)
}

/** Destinations that are new compared with the previous version of the link. */
export function listChangedDestinations(next: Partial<DestinationFields>, previous?: Partial<DestinationFields> | null): string[] {
  const before = new Set(previous ? listLinkDestinations(previous) : [])
  return listLinkDestinations(next).filter(url => !before.has(url))
}

export function findDestinationViolation(urls: string[], policy: DestinationPolicy): DestinationViolation | null {
  for (const url of urls) {
    let parsed: URL
    try {
      parsed = new URL(url)
    }
    catch {
      return { url, reason: 'domain_not_allowed' }
    }

    if (policy.httpsOnly && parsed.protocol !== 'https:')
      return { url, reason: 'https_required' }

    if (policy.allowlist.length && !isHostAllowed(parsed.hostname, policy.allowlist))
      return { url, reason: 'domain_not_allowed' }
  }
  return null
}

export function describeDestinationViolation(violation: DestinationViolation): string {
  if (violation.reason === 'https_required')
    return `Destination must use https: ${violation.url}`

  let host = violation.url
  try {
    host = new URL(violation.url).hostname
  }
  catch {}
  return `Destination domain is not on the allowlist: ${host}`
}

/** Rejects (and audits) a write whose new or changed destinations break the destination policy. */
export async function assertAllowedDestinations(event: H3Event, next: Link, previous?: Link | null): Promise<void> {
  const violation = findDestinationViolation(listChangedDestinations(next, previous), getDestinationPolicy(event))
  if (!violation)
    return

  await denyLinkChange(event, {
    slug: next.slug,
    linkId: previous?.id,
    status: 422,
    reason: describeDestinationViolation(violation),
    changes: diffLinkForAudit(previous, next),
  })
}
