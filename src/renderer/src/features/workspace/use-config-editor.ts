import type { PageEditorState, PageWorkspace } from '@shared/workspace/model'
import type { ComputedRef, Ref } from 'vue'
import { computed, ref } from 'vue'
export function useConfigEditor(
  work: Ref<PageWorkspace>,
  current: ComputedRef<PageWorkspace['versions'][number]>,
  viewed: ComputedRef<PageWorkspace['versions'][number]>,
  isBlocked: () => boolean,
  flushNotes: () => Promise<void>,
  saveEditor: (editor: PageEditorState) => Promise<void>,
) {
  const editingPrompt = ref(false)

  const configDraft = ref<PageEditorState | null>(null)

  const configOwner = ref<string | null>(null)

  const cloneEditor = (editor: PageEditorState): PageEditorState =>
    JSON.parse(JSON.stringify(editor))

  const nextEditor = computed(() => configDraft.value ?? current.value.editor)

  const snapshotEditor = computed(() => {
    const version = viewed.value
    const recipe = version.generated ?? version.initial
    return recipe
      ? cloneEditor({
          model: recipe.model ?? version.editor.model ?? work.value.model,
          draft: recipe.draft,
          params: recipe.params,
          regions: [],
          strength: version.generated?.inpaint?.strength ?? 1,
        })
      : null
  })

  const configSizeLocked = computed(
    () => work.value.execution.kind === 'inpaint' || !!nextEditor.value.regions.length,
  )

  async function beginConfig(owner: string | null = null) {
    if (isBlocked()) {
      throw new Error('请先完成当前操作')
    }
    await flushNotes()
    configDraft.value = cloneEditor(current.value.editor)
    configOwner.value = owner
    editingPrompt.value = true
  }

  async function finishConfig(discard = false) {
    if (!editingPrompt.value || !configDraft.value) {
      return
    }
    if (!discard) {
      const draft = cloneEditor(configDraft.value)
      if (typeof draft.params.seed === 'string') {
        draft.params.seed = null
      }
      if (JSON.stringify(draft) !== JSON.stringify(current.value.editor)) {
        await saveEditor(draft)
      }
    }
    editingPrompt.value = false
    configDraft.value = null
    configOwner.value = null
  }
  return {
    editingPrompt,
    configDraft,
    configOwner,
    cloneEditor,
    nextEditor,
    snapshotEditor,
    configSizeLocked,
    beginConfig,
    finishConfig,
  }
}
