<script setup lang="ts">
import type { Link } from '@/types'
import { Loader2 } from '@lucide/vue'
import { toast } from 'vue-sonner'

const props = defineProps<{
  link: Link
}>()

const emit = defineEmits<{
  closeAutoFocus: [event: Event]
}>()

const { t } = useI18n()
const linksStore = useDashboardLinksStore()
const linksSearchStore = useDashboardLinksSearchStore()
const open = defineModel<boolean>('open', { default: false })
const submitting = shallowRef(false)
const confirmation = shallowRef('')
const pendingUpdate = shallowRef<Link | null>(null)

// The dialog locks an unlocked link, and unlocks a locked one.
const unlocking = computed(() => Boolean(props.link.locked))
const confirmationId = computed(() => `unlock-confirm-${props.link.id}`)
const canSubmit = computed(() => !unlocking.value || confirmation.value.trim() === props.link.slug)

watch(open, (value) => {
  if (value)
    confirmation.value = ''
})

async function submit() {
  if (submitting.value || !canSubmit.value)
    return

  submitting.value = true
  try {
    const response = await useAPI<{ link: Link }>('/api/link/lock', {
      method: 'POST',
      body: {
        slug: props.link.slug,
        locked: !unlocking.value,
        confirm: unlocking.value ? confirmation.value.trim() : undefined,
      },
    })
    pendingUpdate.value = response.link
    toast(unlocking.value ? t('links.lock.unlock_success') : t('links.lock.lock_success'))
    open.value = false
  }
  catch (error) {
    console.error(error)
    toast.error(t('links.lock.failed'), {
      description: error instanceof Error ? error.message : String(error),
    })
  }
  finally {
    submitting.value = false
  }
}

function updateOpen(value: boolean) {
  if (!value && submitting.value)
    return

  open.value = value
}

function handleEscapeKeyDown(event: KeyboardEvent) {
  if (submitting.value)
    event.preventDefault()
}

function handleCloseAutoFocus(event: Event) {
  emit('closeAutoFocus', event)

  const link = pendingUpdate.value
  if (!link)
    return

  pendingUpdate.value = null
  linksSearchStore.syncLink(link, 'edit')
  linksStore.notifyLinkUpdate(link, 'edit')
}
</script>

<template>
  <AlertDialog :open="open" @update:open="updateOpen">
    <AlertDialogContent
      @close-auto-focus="handleCloseAutoFocus"
      @escape-key-down="handleEscapeKeyDown"
    >
      <AlertDialogHeader>
        <AlertDialogTitle>
          {{ unlocking
            ? $t('links.dialogs.unlock.title', { slug: link.slug })
            : $t('links.dialogs.lock.title', { slug: link.slug }) }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ unlocking
            ? $t('links.dialogs.unlock.description')
            : $t('links.dialogs.lock.description') }}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <Field v-if="unlocking">
        <FieldLabel :for="confirmationId">
          {{ $t('links.dialogs.unlock.confirm_label', { slug: link.slug }) }}
        </FieldLabel>
        <Input
          :id="confirmationId"
          v-model="confirmation"
          name="unlock-confirm"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          :disabled="submitting"
          @keydown.enter.prevent="submit"
        />
      </Field>

      <AlertDialogFooter>
        <AlertDialogCancel :disabled="submitting">
          {{ $t('common.cancel') }}
        </AlertDialogCancel>
        <Button
          :variant="unlocking ? 'destructive' : 'default'"
          :disabled="submitting || !canSubmit"
          :aria-busy="submitting"
          @click.prevent="submit"
        >
          <Loader2 v-if="submitting" class="motion-safe:animate-spin" aria-hidden="true" />
          {{ unlocking ? $t('links.dialogs.unlock.action') : $t('links.dialogs.lock.action') }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
