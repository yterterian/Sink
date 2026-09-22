import type { Link } from '#shared/schemas/link'
import { z } from 'zod'
import { SlugSchema } from '#shared/schemas/link'

defineRouteMeta({
  openAPI: {
    description: 'Lock or unlock a short link. Locked links cannot be edited, deleted, or have their slug reused.',
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['slug', 'locked'],
            properties: {
              slug: { type: 'string', description: 'The slug of the link' },
              locked: { type: 'boolean', description: 'true to lock, false to unlock' },
              confirm: { type: 'string', description: 'Required when unlocking: the slug, typed again' },
            },
          },
        },
      },
    },
  },
})

const LockSchema = z.object({
  slug: SlugSchema.min(1),
  locked: z.boolean(),
  confirm: z.string().trim().max(2048).optional(),
})

function parseEmailList(value: unknown): string[] {
  return String(value ?? '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean)
}

export default eventHandler(async (event) => {
  const { previewMode } = useRuntimeConfig(event).public
  if (previewMode) {
    throw createError({
      status: 403,
      statusText: 'Preview mode cannot lock or unlock links.',
    })
  }

  const body = await readValidatedBody(event, LockSchema.parse)
  const slug = normalizeSlug(event, body.slug)

  const existingLink: Link | null = await getAnyAuthoritativeLink(event, slug)
  if (!existingLink) {
    throw createError({
      status: 404,
      statusText: 'Link not found',
    })
  }

  if (Boolean(existingLink.locked) === body.locked)
    return buildLinkResponse(event, existingLink)

  if (!body.locked) {
    if (normalizeSlug(event, body.confirm ?? '') !== slug) {
      throw createError({
        status: 400,
        statusText: 'Type the slug to confirm unlocking.',
      })
    }

    const allowedEmails = parseEmailList(useRuntimeConfig(event).unlockAllowedEmails)
    const email = event.context.userEmail?.toLowerCase()
    if (allowedEmails.length && (event.context.authMethod !== 'access-user' || !email || !allowedEmails.includes(email))) {
      await denyLinkChange(event, {
        slug,
        linkId: existingLink.id,
        status: 403,
        reason: 'This sign-in is not allowed to unlock links.',
        changes: [{ field: 'locked', from: true }],
      })
    }
  }

  const newLink: Link = {
    ...existingLink,
    updatedAt: Math.max(Math.floor(Date.now() / 1000), existingLink.updatedAt + 1),
  }
  if (body.locked)
    newLink.locked = true
  else
    delete newLink.locked

  if (!await updateLink(event, newLink, { id: existingLink.id, updatedAt: existingLink.updatedAt })) {
    throw createError({
      status: 409,
      statusText: 'Link was modified or replaced',
    })
  }

  await recordLinkAudit(event, {
    action: body.locked ? 'lock' : 'unlock',
    slug,
    linkId: existingLink.id,
    changes: diffLinkForAudit(existingLink, newLink),
  })

  return buildLinkResponse(event, newLink)
})
