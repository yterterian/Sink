<script setup lang="ts">
import type { LinkAuditChange, LinkAuditEntry, LinkAuditListResponse } from '@/types'
import { AlertCircle, Loader2 } from '@lucide/vue'

const props = defineProps<{
  slug: string
}>()

const emit = defineEmits<{
  closeAutoFocus: [event: Event]
}>()

const PAGE_SIZE = 20

const { locale } = useI18n()
const open = defineModel<boolean>('open', { default: false })
const entries = shallowRef<LinkAuditEntry[]>([])
const cursor = shallowRef<string>()
const loading = shallowRef(false)
const failed = shallowRef(false)
let requestGeneration = 0

async function load(reset = false) {
  if (loading.value)
    return

  const generation = ++requestGeneration
  loading.value = true
  failed.value = false
  try {
    const response = await useAPI<LinkAuditListResponse>('/api/link/audit', {
      query: {
        slug: props.slug,
        limit: PAGE_SIZE,
        cursor: reset ? undefined : cursor.value,
      },
    })
    if (generation !== requestGeneration)
      return
    entries.value = reset ? response.entries : [...entries.value, ...response.entries]
    cursor.value = response.cursor
  }
  catch (error) {
    console.error(error)
    if (generation === requestGeneration)
      failed.value = true
  }
  finally {
    if (generation === requestGeneration)
      loading.value = false
  }
}

watch(open, (value) => {
  if (value) {
    entries.value = []
    cursor.value = undefined
    loading.value = false
    load(true)
  }
  else {
    requestGeneration++
  }
})

function formatValue(change: LinkAuditChange, value: unknown): string {
  if (value === undefined || value === null || value === '')
    return '—'
  if (change.field === 'expiration' && typeof value === 'number')
    return longDate(value, locale.value)
  if (Array.isArray(value))
    return value.join(', ')
  if (typeof value === 'object')
    return JSON.stringify(value)
  return String(value)
}

function actionVariant(entry: LinkAuditEntry) {
  if (entry.action === 'denied' || entry.action === 'unlock')
    return 'destructive' as const
  if (entry.action === 'lock')
    return 'default' as const
  return 'secondary' as const
}

function origin(entry: LinkAuditEntry): string {
  return [entry.ip, entry.country].filter(Boolean).join(', ')
}
</script>

<template>
  <ResponsiveModal
    v-model:open="open"
    :title="$t('links.history.title', { slug })"
    content-class="sm:max-w-xl"
    @close-auto-focus="emit('closeAutoFocus', $event)"
  >
    <div class="flex max-h-[70svh] flex-col gap-3 overflow-y-auto">
      <Alert v-if="failed && !entries.length" variant="destructive">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>{{ $t('links.history.load_failed') }}</AlertTitle>
        <AlertDescription>
          <Button variant="link" class="h-auto px-0" @click="load(true)">
            {{ $t('common.try_again') }}
          </Button>
        </AlertDescription>
      </Alert>

      <p
        v-else-if="!loading && !entries.length"
        class="text-sm text-muted-foreground"
      >
        {{ $t('links.history.empty') }}
      </p>

      <ItemGroup v-if="entries.length" as="ol" class="gap-2">
        <Item
          v-for="entry in entries"
          :key="entry.id"
          as="li"
          variant="outline"
          size="sm"
        >
          <ItemContent class="min-w-0 gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <Badge :variant="actionVariant(entry)">
                {{ $t(`links.history.actions.${entry.action}`) }}
              </Badge>
              <time
                class="text-sm tabular-nums"
                :datetime="new Date(entry.createdAt * 1000).toISOString()"
              >
                {{ longDate(entry.createdAt, locale) }}
              </time>
            </div>

            <ItemDescription class="break-all">
              {{ $t('links.history.by', { actor: entry.actor }) }}
              <template v-if="origin(entry)">
                ({{ origin(entry) }})
              </template>
            </ItemDescription>

            <p v-if="entry.reason" class="text-sm">
              {{ entry.reason }}
            </p>

            <dl
              v-if="entry.changes.length"
              class="
                grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1
                text-sm
              "
            >
              <template v-for="change in entry.changes" :key="change.field">
                <dt class="text-muted-foreground">
                  {{ change.field }}
                </dt>
                <dd class="min-w-0 break-all">
                  <span class="text-muted-foreground line-through decoration-1">{{ formatValue(change, change.from) }}</span>
                  <span aria-hidden="true"> ⟶ </span>
                  <span>{{ formatValue(change, change.to) }}</span>
                </dd>
              </template>
            </dl>
            <p v-else class="text-sm text-muted-foreground">
              {{ $t('links.history.no_field_changes') }}
            </p>
          </ItemContent>
        </Item>
      </ItemGroup>

      <div v-if="loading" class="flex justify-center py-4">
        <Loader2
          class="
            size-5
            motion-safe:animate-spin
          " aria-hidden="true"
        />
        <span class="sr-only">{{ $t('links.history.load_more') }}</span>
      </div>

      <Button
        v-else-if="cursor"
        variant="outline"
        class="self-center"
        @click="load()"
      >
        {{ $t('links.history.load_more') }}
      </Button>
    </div>
  </ResponsiveModal>
</template>
