import { z } from 'zod'

defineRouteMeta({
  openAPI: {
    description: 'List the change history for one link, or for all links when no slug is given (newest first)',
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'slug',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Only return entries for this slug',
      },
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: 50, maximum: 100 },
        description: 'Maximum number of entries to return',
      },
      {
        name: 'cursor',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Pagination cursor from previous response',
      },
    ],
  },
})

const AuditQuerySchema = z.object({
  slug: z.string().trim().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().max(1024).optional(),
})

export default eventHandler(async (event) => {
  const { slug, limit, cursor } = await getValidatedQuery(event, AuditQuerySchema.parse)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return await listLinkAudit(event, {
    slug: slug ? normalizeSlug(event, slug) : undefined,
    limit,
    cursor,
  })
})
