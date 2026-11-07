import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import type {
  PageEditorState,
  PageExecution,
  PageImageTool,
  PageVersion,
} from '@shared/workspace/model'
import { taskIsActive } from '@shared/tasks/model'
import { taskState } from '../../shared/state/tasks'
import { cleanErr } from '../../shared/lib/format'
import type { WorkspaceActionContext, WorkspaceMutation } from './action-context'

interface ExecutionOptions {
  current: Ref<PageVersion>
  remoteBusy: Ref<boolean>
  configDraft: Ref<PageEditorState | null>
  hasExecutionRegions: () => boolean
  mutate: WorkspaceMutation
  finishConfig: () => Promise<void>
  showExecutionOverlay: () => void
  inspectMask: () => void
  refreshOverlay: () => Promise<void>
  showResult: (kind: 'generate' | 'image-tool') => Promise<void>
  scrollEnd: () => Promise<void>
}

/** Owns generation/image-tool requests, their shared operation lock and progress subscription. */
export function useExecutionActions(context: WorkspaceActionContext, options: ExecutionOptions) {
  const { work, operation, error: errorMessage, flushNotes, updated, frontendContext } = context
  const {
    current,
    remoteBusy,
    configDraft,
    hasExecutionRegions,
    mutate,
    finishConfig,
    showExecutionOverlay,
    inspectMask,
    refreshOverlay,
    showResult,
    scrollEnd,
  } = options
  const progress = ref('')
  const generateTask = computed(() =>
    taskState.tasks.find(
      (task) =>
        task.kind === 'page-generate' && task.targetId === work.value.id && taskIsActive(task),
    ),
  )
  let unsubscribe: (() => void) | undefined
  onMounted(() => {
    unsubscribe = window.api.onNaiStep('page-generate', (text) => {
      if (operation.value === 'generate') {
        progress.value = text
      }
    })
  })
  onBeforeUnmount(() => unsubscribe?.())

  async function setExecution(execution: PageExecution) {
    if (operation.value || remoteBusy.value) {
      return
    }
    operation.value = 'save'
    errorMessage.value = ''
    try {
      if (
        execution.kind === 'inpaint' &&
        configDraft.value &&
        (configDraft.value.params.width !== current.value.editor.params.width ||
          configDraft.value.params.height !== current.value.editor.params.height)
      ) {
        throw new Error('局部重绘需保持底图尺寸，请先恢复尺寸')
      }
      await flushNotes()
      await mutate({ type: 'execution', execution })
      showExecutionOverlay()
      if (execution.kind === 'inpaint') {
        inspectMask()
        await refreshOverlay()
      }
    } catch (error) {
      errorMessage.value = cleanErr(error)
    } finally {
      operation.value = ''
    }
  }

  async function setCollection(collectionId: string) {
    if (operation.value || remoteBusy.value || collectionId === work.value.collectionId) {
      return
    }
    operation.value = 'save'
    errorMessage.value = ''
    try {
      await flushNotes()
      await mutate({ type: 'collection', collectionId })
    } catch (error) {
      errorMessage.value = cleanErr(error)
    } finally {
      operation.value = ''
    }
  }

  async function generate() {
    if (
      operation.value ||
      remoteBusy.value ||
      (work.value.execution.kind === 'inpaint' && !hasExecutionRegions())
    ) {
      return
    }
    errorMessage.value = ''
    progress.value = '正在检查重绘参数…'
    operation.value = 'generate'
    try {
      await finishConfig()
      await flushNotes()
      if (work.value.execution.kind === 'inpaint') {
        inspectMask()
        await refreshOverlay()
      }
      work.value = await window.api.pagesGenerate(
        work.value.id,
        work.value.revision,
        JSON.parse(JSON.stringify(work.value.execution)),
        frontendContext()?.actionId,
      )
      await showResult('generate')
      updated()
    } catch (error) {
      errorMessage.value = cleanErr(error)
      try {
        work.value = await window.api.pagesRead(work.value.id)
      } catch {
        /* Keep existing state. */
      }
    } finally {
      operation.value = ''
      progress.value = ''
      await scrollEnd()
    }
  }

  async function runImageTool(tool: PageImageTool) {
    if (operation.value || remoteBusy.value) {
      return
    }
    errorMessage.value = ''
    progress.value = '正在准备修图…'
    operation.value = 'generate'
    try {
      await finishConfig()
      await flushNotes()
      work.value = await window.api.pagesImageTool(
        work.value.id,
        work.value.revision,
        JSON.parse(JSON.stringify(tool)),
      )
      await showResult('image-tool')
      updated()
    } catch (error) {
      errorMessage.value = cleanErr(error)
      try {
        work.value = await window.api.pagesRead(work.value.id)
      } catch {
        /* Keep existing state. */
      }
    } finally {
      operation.value = ''
      progress.value = ''
      await scrollEnd()
    }
  }

  return { progress, generateTask, setExecution, setCollection, generate, runImageTool }
}
