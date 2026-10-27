import type { PageAction, PageWorkspace } from '@shared/workspace/model'
import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { cleanErr } from '../../shared/lib/format'

export function useWorkspaceAutosave(
  work: Ref<PageWorkspace>,
  title: Ref<string>,
  composer: Ref<string>,
  error: Ref<string>,
  isBusy: () => boolean,
  updated: () => void,
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let chain: Promise<unknown> = Promise.resolve()
  const saving = ref(false)
  const notesValue = () => ({
    type: 'notes' as const,
    title: title.value,
    goal: work.value.goal,
    preserve: work.value.preserve,
    composer: composer.value,
  })
  const savedNotes = ref(JSON.stringify(notesValue()))

  function mutate(action: PageAction): Promise<void> {
    const next = chain.then(async () => {
      saving.value = true
      try {
        work.value = await window.api.pagesEdit(
          work.value.id,
          work.value.revision,
          JSON.parse(JSON.stringify(action)) as PageAction,
        )
        updated()
      } finally {
        saving.value = false
      }
    })
    // Callers receive the original rejection; later independent edits can proceed.
    chain = next.catch(() => undefined)
    return next
  }

  async function flushNotes() {
    clearTimeout(timer)
    const value = notesValue()
    const key = JSON.stringify(value)
    if (key !== savedNotes.value) {
      await mutate(value)
      savedNotes.value = key
    } else {
      await chain
    }
  }

  watch([title, composer], () => {
    clearTimeout(timer)
    if (isBusy()) {
      return
    }
    timer = setTimeout(() => {
      void flushNotes().catch((failure: unknown) => {
        error.value = `尚未保存：${cleanErr(failure)}`
      })
    }, 500)
  })
  onBeforeUnmount(() => clearTimeout(timer))

  return { saving, notesValue, savedNotes, mutate, flushNotes }
}
