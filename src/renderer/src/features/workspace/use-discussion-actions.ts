import { computed, ref, type Ref } from 'vue'
import type { PageMessage, PageVersion } from '@shared/workspace/model'
import { taskIsActive } from '@shared/tasks/model'
import { taskState } from '../../shared/state/tasks'
import { cleanErr } from '../../shared/lib/format'
import type { WorkspaceActionContext } from './action-context'

interface DiscussionOptions {
  isBusy: () => boolean
  external: Ref<boolean>
  pendingRequest: Ref<PageMessage | undefined>
  discussionVersion: Ref<PageVersion>
  composer: Ref<string>
  selectedRegionIds: Ref<string[]>
  references: Ref<string[]>
  savedNotes: Ref<string>
  notesValue: () => unknown
  scrollEnd: () => Promise<void>
  focusComposer: () => void
}

/** Discussion requests and mode changes preserve one composer and frozen version context. */
export function useDiscussionActions(context: WorkspaceActionContext, options: DiscussionOptions) {
  const { work, operation, error: errorMessage, flushNotes, updated, frontendContext } = context
  const {
    isBusy,
    external,
    pendingRequest,
    discussionVersion,
    composer,
    selectedRegionIds,
    references,
    savedNotes,
    notesValue,
    scrollEnd,
    focusComposer,
  } = options
  const pendingText = ref('')
  const chatProgress = computed(
    () =>
      taskState.tasks.find(
        (task) =>
          task.kind === 'page-chat' && task.targetId === work.value.id && taskIsActive(task),
      )?.message ?? '',
  )

  async function setAgentMode(mode: 'internal' | 'external') {
    if (isBusy()) {
      return
    }
    operation.value = 'save'
    errorMessage.value = ''
    try {
      await flushNotes()
      work.value = await window.api.pagesAgent(
        work.value.id,
        work.value.revision,
        mode,
        frontendContext()?.actionId,
      )
      savedNotes.value = JSON.stringify(notesValue())
      updated()
    } catch (error) {
      errorMessage.value = cleanErr(error)
    } finally {
      operation.value = ''
      await scrollEnd()
    }
  }

  async function cancelExternal() {
    if (isBusy()) {
      return
    }
    operation.value = 'save'
    errorMessage.value = ''
    try {
      await flushNotes()
      work.value = await window.api.pagesExternalCancel(
        work.value.id,
        work.value.revision,
        frontendContext()?.actionId,
      )
      updated()
    } catch (error) {
      errorMessage.value = cleanErr(error)
    } finally {
      operation.value = ''
    }
  }

  async function cancelChat() {
    try {
      await window.api.pagesCancel(work.value.id)
    } catch (error) {
      errorMessage.value = cleanErr(error)
    }
  }

  async function send() {
    if (isBusy() || !composer.value.trim() || (external.value && pendingRequest.value)) {
      return
    }
    const discussionVersionId = discussionVersion.value.id
    errorMessage.value = ''
    operation.value = 'chat'
    try {
      await flushNotes()
      const text = composer.value
      pendingText.value = text
      composer.value = ''
      await scrollEnd()
      work.value = await window.api.pagesChat(
        work.value.id,
        work.value.revision,
        text,
        [...selectedRegionIds.value],
        [...references.value],
        frontendContext()?.actionId,
        discussionVersionId,
      )
      references.value = []
      savedNotes.value = JSON.stringify(notesValue())
      updated()
    } catch (error) {
      errorMessage.value = cleanErr(error)
      try {
        work.value = await window.api.pagesRead(work.value.id)
        composer.value = work.value.composer
        savedNotes.value = JSON.stringify(notesValue())
      } catch {
        /* Preserve local state if reading also fails. */
      }
    } finally {
      pendingText.value = ''
      operation.value = ''
      await scrollEnd()
      focusComposer()
    }
  }

  return { pendingText, chatProgress, setAgentMode, cancelExternal, cancelChat, send }
}
