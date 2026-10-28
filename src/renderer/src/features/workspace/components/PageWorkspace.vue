<script setup lang="ts">
import { regionIds } from '@shared/workspace/regions'
import { regionOverlay } from '../region-overlay'
import { useDiscussionComposer } from '../use-discussion-composer'

import { reportError } from '../../../shared/lib/notifications'
import type { FrontendContext } from '@shared/contracts/desktop'

import WorkspaceCanvas from './WorkspaceCanvas.vue'
import WorkspaceConversation from './WorkspaceConversation.vue'
import WorkspaceExecutionBar from './WorkspaceExecutionBar.vue'
import { useConfigEditor } from '../use-config-editor'

import { useAgentState } from '../use-agent-state'

import WorkspaceCandidates from './WorkspaceCandidates.vue'
import WorkspaceVersionSidebar from './WorkspaceVersionSidebar.vue'
import { createWorkspaceCommands } from '../commands'

import { useWorkspaceAutosave } from '../use-autosave'

import { useVersionBrowser } from '../use-version-browser'

import { shellState } from '../../../shared/state/shell'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  PageExecution,
  PageEditorState,
  PageMessage,
  PageWorkspace,
} from '@shared/workspace/model'
import { pageContextKey, pageLatestProposal } from '@shared/workspace/model'

import { cleanErr } from '../../../shared/lib/format'

import Icon from '../../../shared/ui/Icon.vue'

import InpaintEditor from '../../inpaint/components/InpaintEditor.vue'
import ThemeSelect from '../../../shared/ui/ThemeSelect.vue'

import WorkspacePrompt from './WorkspacePrompt.vue'
import WorkspaceIterations from './WorkspaceIterations.vue'

import { taskState, cancelTask } from '../../../shared/state/tasks'
import { taskIsActive } from '@shared/tasks/model'

const props = defineProps<{ workspace: PageWorkspace }>()
const inpaintEditor = ref<InstanceType<typeof InpaintEditor>>()
let frontendContext: FrontendContext | undefined
const emit = defineEmits<{ close: []; updated: [] }>()
const work = ref<PageWorkspace>(props.workspace)
const {
  current,
  viewedId,
  viewed,
  viewedGroup,
  viewedCandidates,
  groupCards,
  historical,
  compareOptions,
  compareVersionId,
  comparison,
  selectedProposalId,
  discussionVersion,
  label,
} = useVersionBrowser(work)

async function recoverImage() {
  if (busy.value) {
    return
  }
  operation.value = 'save'
  try {
    await flushNotes()
    const workspace = await window.api.pagesRecoverImage(
      work.value.id,
      work.value.revision,
      viewed.value.id,
    )
    if (workspace) {
      work.value = workspace
      emit('updated')
    }
  } catch (error2) {
    error.value = cleanErr(error2)
  } finally {
    operation.value = ''
  }
}
const { regionId, selectedRegionIds, references, composer, discussionContext, reference } =
  useDiscussionComposer(
    work,
    current,
    discussionVersion,
    () => pendingRequest.value,
    label,
    (message) => {
      error.value = message
    },
    () => conversation.value?.focusComposer(),
  )

const title = ref(work.value.title)
const pane = ref<'canvas' | 'prompt' | 'changes' | 'images'>('canvas')
const {
  editingPrompt,
  configDraft,
  configOwner,
  nextEditor,
  snapshotEditor,
  configSizeLocked,
  beginConfig,
  finishConfig,
} = useConfigEditor(
  work,
  current,
  viewed,
  () => busy.value || editing.value,
  () => flushNotes(),
  saveEditor,
)

watch(
  viewedId,
  () => {
    compareVersionId.value = ''
    selectedProposalId.value = null
  },
  { flush: 'sync' },
)
const {
  connections,
  external,
  agentConnected,
  pendingRequest,
  agentActivity,
  agentStatus,
  agentLabel,
} = useAgentState(work)
const overlayMode = ref<'annotation' | 'execution'>('annotation')
const executionRegions = computed(() =>
  current.value.editor.regions.filter((region) =>
    regionIds(work.value.execution).includes(region.id),
  ),
)
const displayRegions = computed(() => {
  if (overlayMode.value === 'execution') {
    return executionRegions.value
  }
  const ids = new Set([...selectedRegionIds.value, ...(regionId.value ? [regionId.value] : [])])
  return current.value.editor.regions.filter((region) => ids.has(region.id))
})
watch(
  () => current.value.editor.regions,
  (regions) => {
    selectedRegionIds.value = selectedRegionIds.value.filter((id) =>
      regions.some((region) => region.id === id),
    )
  },
  { deep: true },
)
function locateRegion(id: string) {
  regionId.value = id
  overlayMode.value = 'annotation'
  showMask.value = true
  viewedId.value = current.value.id
  pane.value = 'canvas'
}
function updateSelection() {
  regionId.value = null
  overlayMode.value = 'annotation'
  showMask.value = true
}
const historyOpen = ref(false)
const editing = ref(false)
const clearingImage = ref<string | null>(null)
watch([viewedId, pane, editingPrompt, () => shellState.tab], () => {
  clearingImage.value = null
})
async function clearImage(versionId: string) {
  if (busy.value || !work.value.versions.find((image) => image.id === versionId)?.image) {
    return
  }
  operation.value = 'save'
  error.value = ''
  try {
    await flushNotes()
    work.value = await window.api.pagesClearImage(work.value.id, work.value.revision, versionId)
    clearingImage.value = null
    if (!current.value.editor.regions.some((region2) => region2.id === regionId.value)) {
      regionId.value = null
    }
    await refreshOverlay()
    emit('updated')
  } catch (error2) {
    error.value = cleanErr(error2)
    try {
      work.value = await window.api.pagesRead(work.value.id)
    } catch {
      /* Keep current inputs if refresh fails. */
    }
  } finally {
    operation.value = ''
  }
}
const operation = ref<'chat' | 'generate' | 'save' | ''>('')
const error = ref('')
const progress = ref('')
const zoom = ref(100)
const overlay = ref('')
const remoteBusy = ref(false)
let remoteLease = ''
const pendingText = ref('')
const showMask = ref(true)
const conversation = ref<InstanceType<typeof WorkspaceConversation>>()
const dialog = ref<HTMLElement>()
const viewport = ref<InstanceType<typeof WorkspaceCanvas>>()
const promptEditor = ref<InstanceType<typeof WorkspacePrompt>>()
const renaming = ref(false)
const nameInput = ref<HTMLInputElement>()
const nameDraft = ref('')
const renameSaving = ref(false)
const renameButton = ref<HTMLButtonElement>()
async function startRename() {
  nameDraft.value = title.value
  renaming.value = true
  await nextTick()
  nameInput.value?.focus()
  nameInput.value?.select()
}
async function cancelRename() {
  if (renameSaving.value) {
    return
  }
  renaming.value = false
  await nextTick()
  renameButton.value?.focus()
}
async function rename() {
  if (!renaming.value || renameSaving.value) {
    return
  }
  const previous = title.value
  title.value = nameDraft.value.trim() || title.value
  renameSaving.value = true
  try {
    await flushNotes()
    renaming.value = false
    await nextTick()
    renameButton.value?.focus()
  } catch (error2) {
    title.value = previous
    error.value = cleanErr(error2)
  } finally {
    renameSaving.value = false
  }
}
const previousFocus = document.activeElement as HTMLElement | null
const { notesValue, savedNotes, mutate, flushNotes } = useWorkspaceAutosave(
  work,
  title,
  composer,
  error,
  () => busy.value,
  () => emit('updated'),
)

let unsubscribe: (() => void) | undefined
let alive = true
const busy = computed(() => !!operation.value || editingPrompt.value || remoteBusy.value)
/** 本会话正在进行的生成任务，用于在执行区直接停止 */
const generateTask = computed(() =>
  taskState.tasks.find(
    (task) =>
      task.kind === 'page-generate' && task.targetId === work.value.id && taskIsActive(task),
  ),
)
const time = (at: number) =>
  new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
const status = (text: string) =>
  ({ pending: '待采纳', accepted: '已采纳', rejected: '未采纳', withdrawn: '已撤销' })[text] ?? text
function stale(message: PageMessage) {
  return (
    !!message.proposal &&
    (message.proposal.superseded ||
      message.versionId !== current.value.id ||
      message.proposal.contextKey !==
        pageContextKey(current.value, regionIds(message.proposal), work.value))
  )
}
async function setAgentMode(mode: 'internal' | 'external') {
  if (busy.value) {
    return
  }
  operation.value = 'save'
  error.value = ''
  try {
    await flushNotes()
    work.value = await window.api.pagesAgent(
      work.value.id,
      work.value.revision,
      mode,
      frontendContext?.actionId,
    )
    savedNotes.value = JSON.stringify(notesValue())
    emit('updated')
  } catch (error2) {
    error.value = cleanErr(error2)
  } finally {
    operation.value = ''
    await scrollEnd()
  }
}
async function cancelExternal() {
  if (busy.value) {
    return
  }
  operation.value = 'save'
  error.value = ''
  try {
    await flushNotes()
    work.value = await window.api.pagesExternalCancel(
      work.value.id,
      work.value.revision,
      frontendContext?.actionId,
    )
    emit('updated')
  } catch (error2) {
    error.value = cleanErr(error2)
  } finally {
    operation.value = ''
  }
}
async function cancelChat() {
  try {
    await window.api.pagesCancel(work.value.id)
  } catch (error2) {
    error.value = cleanErr(error2)
  }
}
async function saveEditor(editor: PageEditorState) {
  await mutate({ type: 'editor', versionId: current.value.id, editor })
}
async function returnFromConfig() {
  operation.value = 'save'
  error.value = ''
  try {
    await finishConfig()
  } catch (error2) {
    error.value = cleanErr(error2)
  } finally {
    operation.value = ''
  }
}
/** 打开选区编辑器前已有的区域；关闭时据此判断用户是否新画了区域 */
let regionsBeforeEditor = new Set<string>()
async function openEditor() {
  if (busy.value) {
    return
  }
  operation.value = 'save'
  try {
    await flushNotes()
    viewedId.value = current.value.id
    regionsBeforeEditor = new Set(current.value.editor.regions.map((region2) => region2.id))
    editing.value = true
  } catch (error2) {
    error.value = cleanErr(error2)
  } finally {
    operation.value = ''
  }
}
async function closeEditor() {
  editing.value = false
  const regions = current.value.editor.regions
  // 只在用户刚新增了区域时自动选中它（下一条消息会附带）；
  // 原来选「不附加」又没新画区域时保持不附加，避免整图需求被悄悄当成局部需求
  const added = regions.filter((region2) => !regionsBeforeEditor.has(region2.id))
  if (added.length) {
    selectedRegionIds.value = [
      ...new Set([...selectedRegionIds.value, ...added.map((region) => region.id)]),
    ]
    regionId.value = added[added.length - 1].id
  } else if (regionId.value && !regions.some((region2) => region2.id === regionId.value)) {
    regionId.value = null
  }
  overlayMode.value = 'annotation'
  await refreshOverlay()
}
async function send() {
  if (busy.value || !composer.value.trim() || (external.value && pendingRequest.value)) {
    return
  }
  const discussionVersionId = discussionVersion.value.id
  error.value = ''
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
      frontendContext?.actionId,
      discussionVersionId,
    )
    references.value = []
    savedNotes.value = JSON.stringify(notesValue())
    emit('updated')
  } catch (error2) {
    error.value = cleanErr(error2)
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
    conversation.value?.focusComposer()
  }
}
async function proposal(message: PageMessage, decision: 'accept' | 'reject' | 'undo') {
  if (busy.value) {
    return
  }
  error.value = ''
  operation.value = 'save'
  try {
    await flushNotes()
    await mutate({ type: 'proposal', messageId: message.id, decision })
    selectedProposalId.value = null
    if (message.proposal?.regionId) {
      regionId.value = message.proposal.regionId
      selectedRegionIds.value = regionIds(message.proposal)
    }
  } catch (error2) {
    error.value = cleanErr(error2)
  } finally {
    operation.value = ''
  }
  if (decision === 'accept' && !error.value) {
    await beginConfig(frontendContext?.agentSession ?? null)
  }
}
async function setExecution(execution: PageExecution) {
  if (operation.value || remoteBusy.value) {
    return
  }
  operation.value = 'save'
  error.value = ''
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
    overlayMode.value = 'execution'
    if (execution.kind === 'inpaint') {
      inspectMask()
      await refreshOverlay()
    }
  } catch (error2) {
    error.value = cleanErr(error2)
  } finally {
    operation.value = ''
  }
}

function planLabel(execution?: PageExecution, versionId = current.value.id) {
  if (execution?.kind !== 'inpaint') {
    return '按提示词生成新图'
  }
  const version = work.value.versions.find((item) => item.id === versionId)
  const labels = regionIds(execution).map(
    (id) => version?.editor.regions.find((region) => region.id === id)?.label ?? '已移除区域',
  )
  return `${labels.length > 1 ? '合并重绘' : '局部重绘'} · ${labels.join('、')}`
}
function review(id: string) {
  viewedId.value = id
  pane.value = 'changes'
}
async function showSuggestions(id: string, messageId: string | null = null) {
  selectedProposalId.value = messageId ?? pageLatestProposal(work.value, id)?.id ?? null
  await nextTick()
  if (selectedProposalId.value) {
    document
      .getElementById('proposal-' + selectedProposalId.value)
      ?.scrollIntoView({ block: 'nearest' })
  }
}
function inspectMask() {
  overlayMode.value = 'execution'
  showMask.value = true
  viewedId.value = current.value.id
  pane.value = 'canvas'
}

async function generate() {
  if (
    operation.value ||
    remoteBusy.value ||
    (work.value.execution.kind === 'inpaint' && !executionRegions.value.length)
  ) {
    return
  }
  error.value = ''
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
      frontendContext?.actionId,
    )
    await nextTick()
    viewedId.value = work.value.latestGeneratedVersionId ?? current.value.id
    pane.value = 'canvas'
    if (!current.value.editor.regions.some((region2) => region2.id === regionId.value)) {
      regionId.value = null
    }
    emit('updated')
  } catch (error2) {
    error.value = cleanErr(error2)
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
async function continueVersion(id: string) {
  if (busy.value) {
    return
  }
  operation.value = 'save'
  try {
    await flushNotes()
    await mutate({ type: 'switch', versionId: id })
    viewedId.value = id
    regionId.value = null
    selectedRegionIds.value = []
    await scrollEnd()
  } catch (error2) {
    error.value = cleanErr(error2)
  } finally {
    operation.value = ''
  }
}
async function scrollEnd() {
  await nextTick()
  conversation.value?.scrollEnd()
}
let overlayEpoch = 0
async function refreshOverlay() {
  const epoch = ++overlayEpoch
  overlay.value = ''
  if (!displayRegions.value.length || historical.value) {
    return
  }
  try {
    const preview = await regionOverlay(
      displayRegions.value,
      overlayMode.value === 'annotation' ? regionId.value : null,
    )
    if (alive && epoch === overlayEpoch) {
      overlay.value = preview
    }
  } catch {
    error.value = '选区预览读取失败，请在选区编辑器中检查'
  }
}
watch([displayRegions, regionId, overlayMode, viewedId, () => current.value.id], refreshOverlay)
watch(viewedId, async () => {
  zoom.value = 100
  await nextTick()
  viewport.value?.reset()
})
async function prepareLeave(): Promise<boolean> {
  if (busy.value || editing.value || renaming.value) {
    error.value = '请先保存或完成当前编辑，再继续操作。'
    return false
  }
  try {
    await flushNotes()
    return true
  } catch (error2) {
    error.value = cleanErr(error2)
    return false
  }
}
function desktopState() {
  const latest = pageLatestProposal(work.value, current.value.id)
  return {
    id: work.value.id,
    revision: work.value.revision,
    title: title.value,
    versionId: current.value.id,
    regionId: regionId.value,
    regionIds: [...selectedRegionIds.value],
    pane: editingPrompt.value ? 'config-edit' : pane.value,
    editing: !!operation.value || editingPrompt.value || editing.value || renaming.value,
    composer: composer.value,
    config: {
      open: editingPrompt.value,
      sourceVersionId: current.value.id,
      owner: configOwner.value,
      dirty:
        !!configDraft.value &&
        JSON.stringify(configDraft.value) !== JSON.stringify(current.value.editor),
      draft: JSON.parse(JSON.stringify(nextEditor.value.draft)),
      params: { ...nextEditor.value.params },
      strength: nextEditor.value.strength,
      disabledFields: {
        ...(configSizeLocked.value
          ? { width: '已有遮罩或正在局部重绘', height: '已有遮罩或正在局部重绘' }
          : {}),
      },
    },
    viewedVersionId: viewed.value.id,
    viewedGroupId: viewedGroup.value.id,
    adoptedVersionId: current.value.id,
    focusedProposalId: selectedProposalId.value,
    comparisonVersionId: pane.value === 'changes' ? (comparison.value.source?.id ?? null) : null,
    comparisonMode: compareVersionId.value ? ('specified' as const) : ('source' as const),
    discussionVersionId: discussionContext.value.versionId,
    historyOpen: historyOpen.value,
    references: [...references.value],
    image: viewed.value.image ? { ...viewed.value.image } : null,
    regions: current.value.editor.regions.map((region2) => ({
      id: region2.id,
      label: region2.label,
      instruction: region2.instruction,
      target: region2.target,
    })),
    latestProposal: latest?.proposal
      ? { id: latest.id, title: latest.proposal.title, status: latest.proposal.status }
      : null,
    lastMessage: work.value.messages.at(-1)?.text ?? '',
    agentMode: work.value.agentMode ?? 'internal',
    agentName: agentLabel.value,
    agentConnected: agentConnected.value,
    agentStatus: agentStatus.value,
    agentActivity: agentActivity.value ? { ...agentActivity.value } : null,
    pendingRequestId: pendingRequest.value?.id ?? null,
  }
}
const frontendAction = createWorkspaceCommands({
  configOwner,
  operation,
  remoteBusy,
  editing,
  renaming,
  editingPrompt,
  connections,
  error,
  work,
  current,
  nameDraft,
  viewedId,
  pane,
  clearingImage,
  configDraft,
  configSizeLocked,
  external,
  savedNotes,
  viewed,
  historyOpen,
  compareVersionId,
  composer,
  regionId,
  selectedRegionIds,
  references,
  overlayMode,
  pendingRequest,
  inpaintEditor,
  flushNotes,
  startRename,
  rename,
  clearImage,
  beginConfig,
  finishConfig,
  setAgentMode,
  cancelExternal,
  notesValue,
  emit,
  scrollEnd,
  showSuggestions,
  review,
  refreshOverlay,
  send,
  openEditor,
  closeEditor,
  continueVersion,
  setExecution,
  inspectMask,
  generate,
  proposal,
  get frontendContext() {
    return frontendContext
  },
  set frontendContext(value) {
    frontendContext = value
  },
})

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
defineExpose({ prepareLeave, desktopState, beginRemote, endRemote, frontendAction })
async function close() {
  if (busy.value || editing.value) {
    return
  }
  try {
    await flushNotes()
    emit('close')
  } catch (error2) {
    error.value = `保存失败，窗口暂未关闭：${cleanErr(error2)}`
  }
}
function key(event2: KeyboardEvent) {
  if (editing.value || shellState.tab !== 'workspace' || document.querySelector('.pos-mask')) {
    return
  }
  if (event2.key === 'Escape') {
    event2.preventDefault()
    if (historyOpen.value) {
      historyOpen.value = false
    }
  }
}
onMounted(() => {
  window.addEventListener('keydown', key)
  unsubscribe = window.api.onNaiStep('page-generate', (text) => {
    if (operation.value === 'generate') {
      progress.value = text
    }
  })
  void scrollEnd().catch(reportError)
})
onBeforeUnmount(() => {
  alive = false
  window.removeEventListener('keydown', key)
  unsubscribe?.()
  previousFocus?.focus()
})
function markVersionMissing(version: PageWorkspace['versions'][number]) {
  if (version.image) {
    version.image.missing = true
  }
}
function viewCandidate(versionId: string) {
  viewedId.value = versionId
  pane.value = 'canvas'
}
function updateConfigDraft(patch: Partial<PageEditorState>) {
  if (!configDraft.value || operation.value || remoteBusy.value) {
    return
  }
  configOwner.value = null
  Object.assign(configDraft.value, patch)
}
async function beginConfigFromButton() {
  try {
    await beginConfig()
  } catch (cause) {
    error.value = cleanErr(cause)
  }
}
</script>

<template>
  <section
    ref="dialog"
    class="pw-shell"
    aria-label="AI 图像创作项目"
  >
    <header class="pw-header">
      <div class="pw-header-tools">
        <b
          v-if="editingPrompt"
          class="pw-edit-title"
          >编辑下一版配置</b
        >
        <div
          v-else
          class="pw-view-tabs seg"
        >
          <button
            :class="{ on: pane === 'canvas' }"
            @click="pane = 'canvas'"
          >
            画布</button
          ><button
            :class="{ on: pane === 'prompt' }"
            @click="pane = 'prompt'"
          >
            生图配置</button
          ><button
            :class="{ on: pane === 'changes' }"
            @click="review(viewed.id)"
          >
            修改对比</button
          ><button
            class="pw-images-tab"
            :class="{ on: pane === 'images' }"
            title="本版图片"
            aria-label="本版图片"
            @click="pane = 'images'"
          >
            <Icon
              name="image"
              :size="16"
            />
          </button>
        </div>
        <div
          v-if="!editingPrompt"
          class="pw-header-actions"
        >
          <button
            class="icon-btn sm"
            :aria-pressed="historyOpen"
            title="展开版本历史"
            aria-label="版本记录"
            @click="historyOpen = !historyOpen"
          >
            <Icon
              name="layers"
              :size="17"
            />
          </button>
          <button
            class="icon-btn sm pw-back"
            :disabled="busy || editing"
            title="返回项目"
            aria-label="返回项目"
            @click="close"
          >
            <Icon
              name="arrow"
              class="pw-back-arrow"
              :size="17"
            />
          </button>
        </div>
      </div>
      <div class="pw-heading">
        <form
          v-if="renaming"
          class="pw-name-form"
          @submit.prevent="rename"
          @keydown.esc.stop.prevent="cancelRename"
        >
          <input
            ref="nameInput"
            v-model="nameDraft"
            class="pw-name-input"
            :disabled="renameSaving"
            maxlength="100"
            aria-label="项目名称"
            @keydown.enter.prevent="!$event.isComposing && rename()"
          />
          <button
            type="submit"
            class="icon-btn sm pw-name-save"
            :disabled="renameSaving"
            title="保存名称（Enter）"
            aria-label="保存项目名称"
          >
            <Icon
              name="check"
              :size="14"
            />
          </button>
          <button
            type="button"
            class="icon-btn sm"
            :disabled="renameSaving"
            title="取消（Esc）"
            aria-label="取消重命名"
            @click="cancelRename"
          >
            <Icon
              name="x"
              :size="14"
            />
          </button>
        </form>
        <button
          v-else
          ref="renameButton"
          class="pw-rename"
          :disabled="busy"
          :title="title + ' · 重命名项目'"
          @click="startRename"
        >
          <b>{{ title }}</b
          ><Icon
            name="edit"
            :size="14"
          />
        </button>
      </div>
    </header>
    <div class="pw-main">
      <WorkspaceVersionSidebar
        v-if="historyOpen && !editingPrompt"
        :group-cards="groupCards"
        :viewed-group="viewedGroup"
        :editing-prompt="editingPrompt"
        @view="viewedId = $event"
        @missing="markVersionMissing"
      />
      <div class="pw-canvas-column">
        <div
          v-if="editingPrompt"
          class="pw-scope-bar"
        >
          <span class="muted small">基于 {{ current.label }}</span
          ><span class="muted small ml-auto">返回时保存</span>
        </div>
        <div
          v-else
          class="pw-scope-bar"
          :data-historical="historical"
        >
          <div
            class="pw-scope-label"
            :title="viewed.label"
          >
            <b>{{ viewedGroup.label.replace('方案 ', '版本 ') }}</b
            ><span class="muted small"
              >第 {{ viewedGroup.versions.findIndex((v) => v.id === viewed.id) + 1 }} 张</span
            >
          </div>
          <div class="pw-scope-actions">
            <button
              class="icon-btn sm"
              title="引用此版参与讨论"
              aria-label="引用此版"
              :disabled="busy || !viewed.image"
              @click="reference(viewed.id)"
            >
              <Icon
                name="chat"
                :size="15"
              />
            </button>
            <button
              class="btn small pw-adopt"
              :class="{ ghost: !historical }"
              :disabled="busy || !historical || viewed.image?.missing"
              :title="
                historical
                  ? '设为创作蓝本，从这张图片继续修改和重绘'
                  : '下一版配置与重绘基于这张图片'
              "
              @click="continueVersion(viewed.id)"
            >
              {{ historical ? '设为蓝本' : '当前蓝本' }}
            </button>
            <button
              v-if="pane === 'canvas' && viewed.image"
              class="btn ghost small"
              @click="viewport?.reset()"
            >
              {{ zoom }}% · 适应画布
            </button>
            <ThemeSelect
              v-if="pane === 'changes'"
              v-model="compareVersionId"
              class="pw-compare"
              :options="compareOptions"
              aria-label="对比对象"
            />
          </div>
          <div
            v-if="pane === 'prompt'"
            class="pw-prompt-actions"
          >
            <button
              class="icon-btn sm"
              title="复制完整提示词"
              @click="promptEditor?.copyPrompt()"
            >
              <Icon
                name="copy"
                :size="15"
              />
            </button>
          </div>
        </div>
        <WorkspacePrompt
          v-if="editingPrompt && configDraft"
          ref="promptEditor"
          :editor="configDraft"
          :model="configDraft.model ?? work.model"
          :image="current.image"
          editable
          :disabled="!!operation || remoteBusy"
          :size-locked="configSizeLocked"
          @change-editor="updateConfigDraft"
          @input.capture="configOwner = null"
          @change.capture="configOwner = null"
          @click.capture="configOwner = null"
        />
        <WorkspaceCanvas
          v-else-if="pane === 'canvas'"
          ref="viewport"
          v-model:zoom="zoom"
          v-model:show-mask="showMask"
          :viewed="viewed"
          :current="current"
          :overlay="overlay"
          :historical="historical"
          :busy="busy"
          :display-regions="displayRegions"
          :overlay-mode="overlayMode"
          @missing="markVersionMissing"
          @recover="recoverImage"
          @edit="openEditor"
        />
        <WorkspaceCandidates
          v-else-if="pane === 'images'"
          :viewed-candidates="viewedCandidates"
          :viewed="viewed"
          :current="current"
          :viewed-group="viewedGroup"
          :busy="busy"
          :operation="operation"
          :clearing-image="clearingImage"
          @view="viewCandidate"
          @missing="markVersionMissing"
          @confirm="clearingImage = $event"
          @remove="clearImage"
        />
        <template v-else-if="pane === 'prompt'"
          ><WorkspacePrompt
            v-if="snapshotEditor"
            ref="promptEditor"
            :key="viewed.id"
            :editor="snapshotEditor"
            :model="snapshotEditor.model ?? work.model"
            :image="viewed.image"
          />
          <div
            v-else
            class="pw-blank"
          >
            此版本未保存生图配置快照
          </div></template
        >
        <div
          v-else-if="pane === 'changes'"
          class="pw-change-board scroll"
        >
          <WorkspaceIterations
            :work="work"
            :version-id="viewed.id"
            :compare-id="compareVersionId"
          />
        </div>
        <WorkspaceExecutionBar
          :current="current"
          :selected-region-ids="selectedRegionIds"
          :execution="work.execution"
          :next-editor="nextEditor"
          :operation="operation"
          :remote-busy="remoteBusy"
          :busy="busy"
          :editing-prompt="editingPrompt"
          :has-execution-region="!!executionRegions.length"
          :progress="progress"
          :generate-task="generateTask"
          @execution="setExecution"
          @edit-config="beginConfigFromButton"
          @return-from-config="returnFromConfig"
          @generate="generate"
          @preview="inspectMask"
          @cancel="cancelTask"
        />
      </div>
      <WorkspaceConversation
        ref="conversation"
        v-model:composer="composer"
        v-model:region-ids="selectedRegionIds"
        :work="work"
        :current="current"
        :busy="busy"
        :historical="historical"
        :external="external"
        :agent-label="agentLabel"
        :agent-connected="agentConnected"
        :agent-status="agentStatus"
        :agent-activity="agentActivity"
        :pending-request="pendingRequest"
        :pending-text="pendingText"
        :operation="operation"
        :progress="progress"
        :error="error"
        :editing-prompt="editingPrompt"
        :selected-proposal-id="selectedProposalId"
        :references="references"
        :discussion-context="discussionContext"
        :label="label"
        :time="time"
        :status="status"
        :stale="stale"
        :plan-label="planLabel"
        @agent-mode="setAgentMode"
        @view="viewCandidate"
        @proposal="proposal"
        @cancel-external="cancelExternal"
        @cancel-chat="cancelChat"
        @clear-error="error = ''"
        @reference="reference"
        @annotation="updateSelection"
        @locate="locateRegion"
        @send="send"
      />
    </div>

    <InpaintEditor
      v-if="editing && current.image"
      ref="inpaintEditor"
      :image="current.image"
      :params="current.editor.params"
      :initial-editor="current.editor"
      :initial-model="work.model"
      :initial-region-id="regionId"
      :save-editor="saveEditor"
      selection-only
      @close="closeEditor"
    />
  </section>
</template>

<style scoped>
.pw-header .pw-view-tabs {
  flex-shrink: 0;
}

.pw-header .pw-back {
  margin-left: auto;
  flex-shrink: 0;
}

.pw-header .pw-rename b {
  font-size: 12px;
}

.pw-header > .btn:last-child {
  flex-shrink: 0;
}

.pw-scope-bar > b {
  font-size: 13px;
}

.pw-scope-bar :deep(.theme-select) {
  min-width: 140px;
  max-width: 240px;
}

.pw-heading {
  min-width: 0;
  flex: 1;
}

.pw-rename {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  padding: 5px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  text-align: left;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.pw-rename b {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pw-rename .icon {
  flex-shrink: 0;
  color: var(--muted);
}

.pw-rename:hover,
.pw-rename:focus-visible {
  background: var(--hover);
  border-color: var(--line2);
}

.pw-notes {
  padding: 16px 24px;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 18px;
  flex-shrink: 0;
}

.pw-notes label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text2);
}

.pw-notes textarea {
  height: 64px;
  min-height: 64px;
  resize: none;
}

.pw-notes p {
  grid-column: 1/-1;
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}

.pw-main {
  display: flex;
  flex: 1;
  min-height: 0;
}

.pw-section-title {
  font-size: 12px;
  font-weight: 650;
  margin: 0 0 12px;
}

.pw-section-title span {
  color: var(--muted);
  font-size: 10px;
  font-weight: 400;
  margin-left: 6px;
}

.pw-canvas-column {
  flex: 1;
  min-width: 240px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  padding: 0 18px;
}

.pw-change-board {
  flex: 1;
  min-height: 0;
  padding: 8px 0;
  animation: fade-in var(--dur-base) var(--ease-out);
}

.pw-canvas-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 54px;
  flex-shrink: 0;
}

.pw-canvas-bar > div {
  display: flex;
  gap: 12px;
  align-items: center;
}

.pw-canvas-bar b {
  font-size: 13px;
}

.pw-regions {
  display: flex;
  gap: 6px;
  padding-bottom: 15px;
  flex-wrap: wrap;
}

.pw-regions button {
  font-size: 11px;
  padding: 5px 11px;
  background: var(--bg);
  border: 1px solid var(--line2);
  border-radius: 20px;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    transform var(--dur-slow) var(--bounce);
}

.pw-regions button:hover:not(.on) {
  border-color: var(--pink-line);
  color: var(--text);
}

.pw-regions button:active {
  transform: scale(var(--press-sm));
}

.pw-regions .on {
  background: var(--pink-soft);
  border-color: var(--pink-line);
  color: var(--pink-deep);
}

.pw-regions i {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ok);
  margin-left: 5px;
}

@media (width <= 1050px) {
  .pw-canvas-column {
    padding: 0 12px;
  }
}

@media (width <= 800px) {
  .pw-header > .pill {
    display: none;
  }

  .pw-header .btn {
    font-size: 11px;
  }

  .pw-notes {
    padding: 12px;
  }
}

.pw-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
  min-height: 52px;
  padding: 8px 0;
  flex-wrap: wrap;
}

.pw-view-tabs {
  max-width: 100%;
  overflow-x: auto;
  margin: 0;
  flex-shrink: 0;
}

.pw-prompt-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

:deep(.pw-blank) {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  color: var(--muted);
  gap: 15px;
  text-align: center;
  padding: 20px;
}

:deep(.pw-blank) p {
  font-size: 12px;
  line-height: 1.8;
}

.pw-empty-plan {
  margin: 50px 10px;
  color: var(--muted);
  font-size: 13px;
}

.pw-locator-help {
  font-size: 10px;
  color: var(--muted);
  margin: 0 0 12px;
}

.pw-understanding {
  padding: 14px 24px;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  font-size: 12px;
  max-height: 180px;
  overflow: auto;
  flex-shrink: 0;
}

.pw-understanding p {
  white-space: pre-wrap;
  line-height: 1.7;
  margin: 5px 0;
}

.pw-understanding > span {
  grid-column: 1/-1;
  color: var(--muted);
  font-size: 11px;
}

.pw-historical-prompt {
  max-height: 160px;
  font-size: 11px;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.pw-historical-prompt pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 11px;
}

.pw-scope-label b {
  font-size: 13px;
}

.pw-scope-label span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.pw-adopt {
  min-width: 70px;
}

.pw-scope-bar .pw-prompt-actions {
  margin-left: 0;
}

.pw-images-tab {
  display: flex;
  align-items: center;
  justify-content: center;
}

.pw-edit-title {
  font-size: 14px;
}

.pw-scope-bar {
  align-items: center;
  flex-shrink: 0;
  height: 52px;
  min-height: 52px;
  flex-wrap: nowrap;
  padding: 8px 0;
  gap: 8px;
  display: flex;
}

.pw-scope-actions .pw-compare {
  width: 180px;
  max-width: 220px;
}

.pw-scope-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  min-width: 0;
}

.pw-scope-label {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
}

.pw-compare :deep(.theme-select-trigger) {
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (width <= 1250px) {
  .pw-scope-actions .pw-compare {
    width: 140px;
  }

  .pw-scope-actions {
    gap: 3px;
  }
}

.pw-shell {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  outline: none;
  --pw-chat-width: 380px;
}

.pw-header {
  height: 46px;
  flex-shrink: 0;
  align-items: center;
  border-bottom: 1px solid var(--line);
  padding: 0;
  gap: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--pw-chat-width);
}

.pw-header-tools {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 0 18px;
  height: 100%;
}

.pw-header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.pw-header-actions .icon-btn {
  width: 30px;
  height: 30px;
  border-radius: 9px;
}

.pw-header-actions [aria-pressed='true'] {
  background: var(--pink-soft);
  color: var(--pink-deep);
}

.pw-header .pw-heading {
  flex: 0 1 260px;
  width: 100%;
  min-width: 0;
  height: 100%;
  padding: 0 20px;
  border-left: 1px solid var(--line);
  display: flex;
  align-items: center;
}

.pw-heading .pw-rename {
  width: 100%;
  min-width: 0;
  padding: 5px 0;
  gap: 8px;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.pw-heading .pw-rename:hover,
.pw-heading .pw-rename:focus-visible {
  background: transparent;
}

.pw-heading .pw-rename b {
  min-width: 0;
  flex: 0 1 auto;
  text-align: left;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}

.pw-heading .pw-rename .icon {
  opacity: 0;
  transition:
    opacity var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.pw-heading .pw-rename:hover .icon,
.pw-heading .pw-rename:focus-visible .icon {
  opacity: 1;
  color: var(--text2);
}

.pw-name-form {
  display: flex;
  align-items: center;
  gap: 3px;
  width: 100%;
  min-width: 0;
  height: 32px;
  padding: 3px 4px 3px 10px;
  border: 1px solid var(--pink-line);
  border-radius: 9px;
  background: var(--bg);
  box-shadow: 0 0 0 3px var(--pink-soft);
}

.pw-name-form .pw-name-input {
  flex: 1;
  min-width: 0;
  width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  outline: none;
  font-size: 12px;
  font-weight: 600;
}

.pw-name-form .icon-btn {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
}

.pw-name-save {
  color: var(--pink-deep);
}

.pw-heading input {
  width: 100%;
  max-width: none;
}

@media (width <= 1050px) {
  .pw-shell {
    --pw-chat-width: 320px;
  }

  .pw-header-tools {
    padding: 0 12px;
    gap: 6px;
  }

  .pw-header .pw-heading {
    padding: 0 16px;
  }
}

@media (width <= 800px) {
  .pw-shell {
    --pw-chat-width: 280px;
  }

  .pw-header-actions {
    gap: 2px;
  }

  .pw-header-tools {
    gap: 4px;
  }
}

:deep(.pw-current) {
  font-size: 9px;
  color: var(--pink-deep);
  margin-left: auto;
  flex-shrink: 0;
}
</style>
