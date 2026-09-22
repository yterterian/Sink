import { z } from 'zod'
import { SlugSchema } from '#shared/schemas/link'

defineRouteMeta({
  openAPI: {
    description: 'Delete a short link',
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['slug'],
            properties: {
              slug: { type: 'string', description: 'The slug of the link to delete' },
            },
          },
        },
      },
    },
  },
})

const DeleteSchema = z.object({
  slug: SlugSchema.min(1),
})

export default eventHandler(async (event) => {
  const { previewMode } = useRuntimeConfig(event).public
  if (previewMode) {
    throw createError({
      status: 403,
      statusText: 'Preview mode cannot delete links.',
    })
  }

  const body = await readValidatedBody(event, DeleteSchema.parse)
  const slug = normalizeSlug(event, body.slug)
  const existingLink = await getAnyAuthoritativeLink(event, slug)
  if (existingLink?.locked) {
    await denyLinkChange(event, {
      slug,
      linkId: existingLink.id,
      status: 423,
      reason: 'Link is locked. Unlock it before deleting.',
      changes: [{ field: 'deleted', to: true }],
    })
  }

  await deleteLink(event, slug)
  await recordLinkAudit(event, {
    action: 'delete',
    slug,
    linkId: existingLink?.id,
    changes: existingLink ? diffLinkForAudit(existingLink, null) : [],
  })
})
