import type { Ref } from 'vue'
import { pageLatestProposal, type PageWorkspace } from '@shared/workspace/model'
interface RemoteWorkspaceHost {
  busy: Ref<boolean>
  editing: Ref<boolean>
  renaming: Ref<boolean>
  remoteBusy: Ref<boolean>
  current: Ref<PageWorkspace['versions'][number]>
  work: Ref<PageWorkspace>
  title: Ref<string>
  composer: Ref<string>
  savedNotes: Ref<string>
  viewedId: Ref<string>
  pane: Ref<'canvas' | 'prompt' | 'changes' | 'images'>
  historical: Ref<boolean>
  flushNotes: () => Promise<void>
  notesValue: () => unknown
  showSuggestions: (id: string) => Promise<void>
  refreshOverlay: () => Promise<void>
  scrollEnd: () => Promise<void>
  emit: (event: 'updated') => void
}
/** Owns remote leases and refreshes the editor after external changes. */
export function useRemoteWorkspace(host: RemoteWorkspaceHost) {
  let remoteLease = ''
  const {
    busy,
    editing,
    renaming,
    remoteBusy,
    current,
    work,
    title,
    composer,
    savedNotes,
    viewedId,
    pane,
    historical,
    flushNotes,
    notesValue,
    showSuggestions,
    refreshOverlay,
    scrollEnd,
    emit,
  } = host
  async function beginRemote(lease: string) {
    if (busy.value || editing.value || renaming.value) {
      throw new Error('工作台正在编辑或执行操作，请等待用户完成后重试')
    }
    remoteLease = lease
    remoteBusy.value = true
    try {
      await flushNotes()
    } catch (error2) {
      remoteLease = ''
      remoteBusy.value = false
      throw error2
    }
  }
  async function endRemote(lease: string) {
    if (remoteLease !== lease) {
      return
    }
    try {
      const oldVersion = current.value.id
      const oldGenerated = work.value.latestGeneratedVersionId
      const oldProposal = pageLatestProposal(work.value, oldVersion)?.id
      work.value = await window.api.pagesRead(work.value.id)
      title.value = work.value.title
      composer.value = work.value.composer
      savedNotes.value = JSON.stringify(notesValue())
      if (
        oldGenerated !== work.value.latestGeneratedVersionId &&
        work.value.latestGeneratedVersionId
      ) {
        viewedId.value = work.value.latestGeneratedVersionId
        pane.value = 'canvas'
      } else if (oldVersion !== current.value.id) {
        viewedId.value = current.value.id
        pane.value = 'canvas'
      } else if (
        !historical.value &&
        pageLatestProposal(work.value, current.value.id)?.id !== oldProposal &&
        pageLatestProposal(work.value, current.value.id)?.proposal?.status === 'pending'
      ) {
        await showSuggestions(current.value.id)
      }
      await refreshOverlay()
      await scrollEnd()
      emit('updated')
    } finally {
      remoteLease = ''
      remoteBusy.value = false
    }
  }
  return { beginRemote, endRemote }
}
