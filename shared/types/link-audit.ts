export const LINK_AUDIT_ACTIONS = ['create', 'edit', 'delete', 'lock', 'unlock', 'import', 'denied'] as const

export type LinkAuditAction = typeof LINK_AUDIT_ACTIONS[number]

export interface LinkAuditChange {
  field: string
  from?: unknown
  to?: unknown
}

export interface LinkAuditEntry {
  id: string
  slug: string
  linkId?: string
  action: LinkAuditAction
  actor: string
  authMethod?: string
  ip?: string
  country?: string
  reason?: string
  changes: LinkAuditChange[]
  createdAt: number
}

export interface LinkAuditListResponse {
  entries: LinkAuditEntry[]
  cursor?: string
}
