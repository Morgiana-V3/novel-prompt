<script setup lang="ts">
import IconSwap from '../../../shared/ui/IconSwap.vue'
import { vSegIndicator } from '../../../shared/lib/seg-indicator'
import { displayVersionLabel } from '../labels'
import { useRemoteWorkspace } from '../use-remote-workspace'
import { useDiscussionActions } from '../use-discussion-actions'
import { useProposalActions } from '../use-proposal-actions'
import { useExecutionActions } from '../use-execution-actions'
import type { WorkspaceOperation } from '../action-context'
import { settingsState, saveSettings } from '../../settings/state'
const aiCollapsed = computed(() => settingsState.settings?.workspaceAiCollapsed ?? false)
const toggleAi = () => saveSettings({ workspaceAiCollapsed: !aiCollapsed.value }).catch(reportError)
import { regionIds } from '@shared/workspace/regions'
import { latestPageExecution } from '@shared/workspace/events'
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
import WorkspaceOutpaintDialog from './WorkspaceOutpaintDialog.vue'
import WorkspaceToolPopover from './WorkspaceToolPopover.vue'
import WorkspaceVersionSidebar from './WorkspaceVersionSidebar.vue'
import { createWorkspaceCommands } from '../commands'

import { useWorkspaceAutosave } from '../use-autosave'

import { useVersionBrowser } from '../use-version-browser'

import { shellState } from '../../../shared/state/shell'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  PageExecution,
  PageEditorState,
  PageImageTool,
  PageWorkspace,
} from '@shared/workspace/model'
import { pageEditorBaseline, pageEditorChanges, pageLatestProposal } from '@shared/workspace/model'

import { cleanErr } from '../../../shared/lib/format'

import Icon from '../../../shared/ui/Icon.vue'

import InpaintEditor from '../../inpaint/components/InpaintEditor.vue'
import ThemeSelect from '../../../shared/ui/ThemeSelect.vue'
import SplitHandle from '../../../shared/ui/SplitHandle.vue'

import WorkspacePrompt from './WorkspacePrompt.vue'
import WorkspaceIterations from './WorkspaceIterations.vue'

import { cancelTask } from '../../../shared/state/tasks'

const props = defineProps<{
  workspace: PageWorkspace
  /** 从生图创作「去增强」下拉进入时，项目打开后直接打开的工具 */
  initialTool?: 'outpaint' | 'enhance' | 'upscale' | null
}>()
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
    () => {
      void saveSettings({ workspaceAiCollapsed: false })
        .then(async () => {
          await nextTick()
          conversation.value?.focusComposer()
        })
        .catch(reportError)
    },
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
const historyOpen = ref(true)
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
const operation = ref<WorkspaceOperation>('')
const error = ref('')
const zoom = ref(100)
const overlay = ref('')
const remoteBusy = ref(false)
const showMask = ref(true)
const conversation = ref<InstanceType<typeof WorkspaceConversation>>()
const dialog = ref<HTMLElement>()
const viewport = ref<InstanceType<typeof WorkspaceCanvas>>()
const promptEditor = ref<InstanceType<typeof WorkspacePrompt>>()
const snapshotPrompt = ref<InstanceType<typeof WorkspacePrompt>>()
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

let alive = true
const busy = computed(() => !!operation.value || editingPrompt.value || remoteBusy.value)
const actionContext = {
  work,
  operation,
  error,
  flushNotes,
  updated: () => emit('updated'),
  frontendContext: () => frontendContext,
}
const { pendingText, chatProgress, setAgentMode, cancelExternal, cancelChat, send } =
  useDiscussionActions(actionContext, {
    isBusy: () => busy.value,
    external,
    pendingRequest,
    discussionVersion,
    composer,
    selectedRegionIds,
    references,
    savedNotes,
    notesValue,
    scrollEnd,
    focusComposer: () => conversation.value?.focusComposer(),
  })
const { stale, proposal } = useProposalActions(actionContext, {
  current,
  isBusy: () => busy.value,
  mutate,
  selectedProposalId,
  regionId,
  selectedRegionIds,
  beginConfig,
})
const { progress, generateTask, setExecution, setCollection, generate, runImageTool } =
  useExecutionActions(actionContext, {
    current,
    remoteBusy,
    configDraft,
    hasExecutionRegions: () => !!executionRegions.value.length,
    mutate,
    finishConfig,
    showExecutionOverlay: () => {
      overlayMode.value = 'execution'
    },
    inspectMask,
    refreshOverlay,
    showResult: showGeneratedResult,
    scrollEnd,
  })

async function showGeneratedResult(kind: 'generate' | 'image-tool') {
  await nextTick()
  viewedId.value = work.value.latestGeneratedVersionId ?? current.value.id
  pane.value = 'canvas'
  if (
    kind === 'generate' &&
    !current.value.editor.regions.some((region) => region.id === regionId.value)
  ) {
    regionId.value = null
  }
}
const time = (at: number) =>
  new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
const status = (text: string) =>
  ({ pending: '待采纳', accepted: '已采纳', rejected: '未采纳', withdrawn: '已撤销' })[text] ?? text
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

/** 扩图用对话框；放大、增强用按钮下方的轻量面板 */
const openTool = ref<{
  kind: PageImageTool['kind']
  anchor: { left: number; bottom: number }
} | null>(null)
function openImageTool(kind: PageImageTool['kind'], anchor: { left: number; bottom: number }) {
  openTool.value = openTool.value?.kind === kind ? null : { kind, anchor }
}
/** 等画布工具栏渲染出来再打开指定工具（面板锚定在对应按钮下方） */
function openToolWhenReady(kind: PageImageTool['kind'], tries = 30) {
  requestAnimationFrame(() => {
    const button = document.querySelector<HTMLElement>(`.pw-tool[data-tool-key="${kind}"]`)
    if (button && !button.hasAttribute('disabled')) {
      const rect = button.getBoundingClientRect()
      openImageTool(kind, { left: rect.left, bottom: rect.bottom })
    } else if (tries > 0) {
      openToolWhenReady(kind, tries - 1)
    }
  })
}
async function runToolFromPanel(tool: PageImageTool) {
  openTool.value = null
  await runImageTool(tool)
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
    latestExecution: latestPageExecution(work.value.messages),
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

const { beginRemote, endRemote } = useRemoteWorkspace({
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
})
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
  if (props.initialTool) {
    openToolWhenReady(props.initialTool)
  }
  window.addEventListener('keydown', key)
  void scrollEnd().catch(reportError)
})
onBeforeUnmount(() => {
  alive = false
  window.removeEventListener('keydown', key)
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
async function viewHistory(versionId: string) {
  if (operation.value || remoteBusy.value || editing.value) {
    return
  }
  if (editingPrompt.value) {
    await returnFromConfig()
    if (editingPrompt.value) {
      return
    }
  }
  viewCandidate(versionId)
}
function updateConfigDraft(patch: Partial<PageEditorState>) {
  if (!configDraft.value || operation.value || remoteBusy.value) {
    return
  }
  configOwner.value = null
  Object.assign(configDraft.value, patch)
}
/* ---------- 下一版配置：本版配置只读，修改都写进基于底稿的下一版 ---------- */
const tabsLocked = computed(() => editingPrompt.value && (!!operation.value || remoteBusy.value))
const currentBaseline = computed(() => pageEditorBaseline(current.value))
const nextChanges = computed(() => {
  if (!currentBaseline.value) {
    return null
  }
  return pageEditorChanges(currentBaseline.value, {
    ...nextEditor.value,
    model: nextEditor.value.model ?? work.value.model,
  })
})
const nextChangesText = computed(() => {
  if (!nextChanges.value) {
    return ''
  }
  if (!nextChanges.value.count) {
    return '与底稿配置相同'
  }
  const parts = []
  if (nextChanges.value.prompt.length) {
    parts.push(`提示词 ${nextChanges.value.prompt.length} 处`)
  }
  if (nextChanges.value.parameters.length) {
    parts.push(`参数 ${nextChanges.value.parameters.length} 项`)
  }
  return `已修改 ${parts.join(' · ')}`
})
const nextChangesTitle = computed(() => {
  const labels = nextChanges.value?.parameters ?? []
  return labels.length ? `修改的参数：${labels.join('、')}` : nextChangesText.value
})
const configDirty = computed(
  () =>
    !!configDraft.value &&
    JSON.stringify(configDraft.value) !== JSON.stringify(current.value.editor),
)
async function openPane(target: typeof pane.value) {
  if (editingPrompt.value) {
    await returnFromConfig()
    if (editingPrompt.value) {
      return
    }
  }
  pane.value = target
}
async function openNextConfig() {
  if (editingPrompt.value) {
    await returnFromConfig()
  } else {
    await beginConfigFromButton()
  }
}
async function discardConfig() {
  if (!configDraft.value || operation.value || remoteBusy.value) {
    return
  }
  configDraft.value = JSON.parse(JSON.stringify(current.value.editor))
  configOwner.value = null
}
function baselinePatch(baseline: {
  model?: PageEditorState['model']
  draft: PageEditorState['draft']
  params: PageEditorState['params']
}): Partial<PageEditorState> {
  const params = { ...JSON.parse(JSON.stringify(baseline.params)) }
  if (configSizeLocked.value && configDraft.value) {
    params.width = configDraft.value.params.width
    params.height = configDraft.value.params.height
  }
  return {
    draft: JSON.parse(JSON.stringify(baseline.draft)),
    params,
    ...(baseline.model ? { model: baseline.model } : {}),
  }
}
function restoreBaseline() {
  if (!currentBaseline.value) {
    return
  }
  updateConfigDraft(baselinePatch(currentBaseline.value))
}
/** 从「本版配置」进入下一版：底稿直接编辑；历史版本把它的配置载入下一版 */
async function editFromSnapshot() {
  const source = viewed.value
  const baseline = pageEditorBaseline(source)
  const snapshot = snapshotEditor.value
  const loadSnapshot = historical.value
  await beginConfigFromButton()
  if (!editingPrompt.value || !loadSnapshot) {
    return
  }
  if (baseline) {
    updateConfigDraft(baselinePatch(baseline))
  } else if (snapshot) {
    // 旧版本只有实际请求（质量词已拼入），载入后不重复追加，并恢复随机种子
    updateConfigDraft(
      baselinePatch({
        model: snapshot.model,
        draft: snapshot.draft,
        params: { ...snapshot.params, seed: null },
      }),
    )
  }
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
    :class="{ 'pw-ai-collapsed': aiCollapsed }"
    aria-label="图像创作工作台"
  >
    <header class="pw-header">
      <div class="pw-header-tools">
        <div
          v-seg-indicator
          class="pw-view-tabs seg"
        >
          <button
            :class="{ on: !editingPrompt && pane === 'canvas' }"
            :disabled="tabsLocked"
            @click="openPane('canvas')"
          >
            画布</button
          ><button
            :class="{ on: !editingPrompt && pane === 'prompt' }"
            :disabled="tabsLocked"
            title="查看这张图生成时使用的配置（只读）"
            @click="openPane('prompt')"
          >
            生成记录</button
          ><button
            :class="{ on: !editingPrompt && pane === 'changes' }"
            :disabled="tabsLocked"
            @click="openPane('changes')"
          >
            修改对比</button
          ><button
            class="pw-images-tab"
            :class="{ on: !editingPrompt && pane === 'images' }"
            :disabled="tabsLocked"
            title="本版图片"
            aria-label="本版图片"
            @click="openPane('images')"
          >
            <Icon
              name="image"
              :size="16"
            />
          </button>
        </div>
        <div class="pw-header-actions">
          <button
            class="btn ghost small pw-next-entry"
            :class="{ on: editingPrompt }"
            :aria-pressed="editingPrompt"
            :disabled="!!operation || remoteBusy || editing"
            :title="
              editingPrompt
                ? '保存配置并返回查看'
                : '基于底稿 ' + displayVersionLabel(current.label) + ' 编辑下一次生成的配置'
            "
            @click="openNextConfig"
          >
            <IconSwap
              :name="editingPrompt ? 'check' : 'sliders'"
              :size="15"
            /><span class="pw-entry-label">{{ editingPrompt ? '保存配置' : '编辑配置' }}</span>
            <span
              class="pw-entry-count"
              :class="{ visible: !!nextChanges?.count }"
              :aria-hidden="!nextChanges?.count"
              ><span class="pw-tab-badge">{{ nextChanges?.count || 0 }}</span></span
            >
          </button>
          <button
            class="icon-btn sm"
            :aria-pressed="historyOpen"
            title="展开版本历史"
            aria-label="版本记录"
            @click="historyOpen = !historyOpen"
          >
            <Icon
              name="history"
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
        <button
          class="pw-ai-toggle"
          :class="{ on: !aiCollapsed }"
          :aria-expanded="!aiCollapsed"
          aria-controls="workspace-ai-panel"
          :aria-label="aiCollapsed ? '展开 AI 对话' : '收起 AI 对话'"
          :title="aiCollapsed ? '展开 AI 对话' : '收起 AI 对话，画布占满宽度'"
          @click="toggleAi"
        >
          <Icon
            name="sparkle"
            :size="14"
          /><span>AI</span
          ><Icon
            name="panel"
            :size="15"
          />
        </button>
      </div>
    </header>
    <div class="pw-main">
      <WorkspaceVersionSidebar
        v-if="historyOpen"
        :group-cards="groupCards"
        :viewed-group="viewedGroup"
        :disabled="!!operation || remoteBusy || editing"
        @view="viewHistory"
        @missing="markVersionMissing"
      />
      <div class="pw-canvas-column">
        <div
          v-if="aiCollapsed && error"
          class="error-box"
          role="alert"
        >
          {{ error }}
        </div>
        <div
          v-if="editingPrompt"
          class="pw-scope-bar pw-next-bar"
        >
          <div class="pw-scope-label">
            <b>下一次生成</b
            ><span
              class="muted small"
              :title="'基于底稿 ' + current.label"
              >底稿 {{ displayVersionLabel(current.label) }}</span
            >
            <span
              class="small pw-next-summary"
              :class="{ changed: !!nextChanges?.count }"
              :title="nextChangesTitle"
              >{{ nextChangesText }}</span
            >
          </div>
          <div class="pw-scope-actions">
            <button
              v-if="configDirty"
              class="btn ghost small"
              :disabled="!!operation || remoteBusy"
              title="放弃这次打开后的修改，恢复到打开前的下一版配置"
              aria-label="撤销本次修改"
              @click="discardConfig"
            >
              <Icon
                name="undo"
                :size="13"
              /><span>撤销本次修改</span>
            </button>
            <button
              v-if="currentBaseline"
              class="btn ghost small"
              :disabled="!!operation || remoteBusy || !nextChanges?.count"
              title="把提示词和参数恢复为生成底稿时使用的配置"
              aria-label="恢复底稿配置"
              @click="restoreBaseline"
            >
              <Icon
                name="reset"
                :size="13"
              /><span>恢复底稿配置</span>
            </button>
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
        <div
          v-else
          class="pw-scope-bar"
          :data-historical="historical"
        >
          <div
            class="pw-scope-label"
            :title="viewed.label"
          >
            <b>{{ displayVersionLabel(viewedGroup.label) }}</b
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
                :size="16"
              />
            </button>
            <button
              class="btn small pw-adopt"
              :class="{ ghost: !historical }"
              :disabled="busy || !historical || viewed.image?.missing"
              :title="
                historical
                  ? '设为创作底稿，从这张图片继续修改和重绘'
                  : '下一版配置与重绘基于这张图片'
              "
              @click="continueVersion(viewed.id)"
            >
              {{ historical ? '设为底稿' : '当前底稿' }}
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
              v-if="snapshotEditor && historical"
              class="btn ghost small"
              :disabled="busy"
              :title="
                historical
                  ? '把这一版的提示词和参数载入下一版配置（底稿图片不变）'
                  : '在本版配置的基础上编辑下一版'
              "
              @click="editFromSnapshot"
            >
              <Icon
                name="import"
                :size="13"
              />{{ historical ? '载入到下一版' : '编辑下一版' }}
            </button>
            <button
              class="icon-btn sm"
              title="复制完整提示词"
              @click="snapshotPrompt?.copyPrompt()"
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
          :active-tool="openTool?.kind ?? null"
          @missing="markVersionMissing"
          @recover="recoverImage"
          @edit="openEditor"
          @tool="openImageTool"
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
            ref="snapshotPrompt"
            :key="viewed.id"
            :editor="snapshotEditor"
            :model="snapshotEditor.model ?? work.model"
            :image="viewed.image"
            :initial="!viewed.generated"
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
          :model="work.model"
          :operation="operation"
          :remote-busy="remoteBusy"
          :busy="busy"
          :has-execution-region="!!executionRegions.length"
          :progress="progress"
          :generate-task="generateTask"
          :collection-id="work.collectionId"
          @execution="setExecution"
          @collection="setCollection"
          @generate="generate"
          @preview="inspectMask"
          @cancel="cancelTask"
        />
      </div>
      <SplitHandle
        v-show="!aiCollapsed"
        storage-key="workspace-chat"
        variable="--pw-chat-user"
        scope=".pw-shell"
        side="end"
        :min="300"
        :max="820"
        :reserve="420"
        label="AI 对话栏宽度"
      />
      <div
        id="workspace-ai-panel"
        class="pw-ai-dock"
        :inert="aiCollapsed"
        :aria-hidden="aiCollapsed"
      >
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
          :progress="operation === 'chat' ? chatProgress : progress"
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
    </div>

    <WorkspaceOutpaintDialog
      v-if="openTool?.kind === 'outpaint' && current.image"
      :width="current.image.width ?? current.editor.params.width"
      :height="current.image.height ?? current.editor.params.height"
      :image-url="current.image.url"
      :count="current.editor.params.count"
      :steps="current.editor.params.steps"
      :model="work.model"
      :disabled="busy"
      @run="runImageTool"
      @close="openTool = null"
    />
    <WorkspaceToolPopover
      v-if="openTool && openTool.kind !== 'outpaint' && current.image"
      :key="openTool.kind"
      :kind="openTool.kind"
      :anchor="openTool.anchor"
      :width="current.image.width ?? current.editor.params.width"
      :height="current.image.height ?? current.editor.params.height"
      :count="current.editor.params.count"
      :steps="current.editor.params.steps"
      :model="work.model"
      :disabled="busy"
      @run="runToolFromPanel"
      @close="openTool = null"
    />
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
/*
 * AI 对话栏开合：dock 宽度与标题栏右列用同一时长、同一曲线逐帧收放，左侧画布与右侧对话栏同步移动，
 * 不再出现“左边先跳、右边再挤”的错位帧；对话栏本身固定宽度，只被 dock 裁切，内容不重排。
 */
.pw-ai-collapsed .pw-header {
  grid-template-columns: minmax(0, 1fr) 240px;
}

.pw-ai-dock {
  display: flex;
  justify-content: flex-start;
  flex-shrink: 0;
  width: var(--pw-chat-width);
  overflow: hidden;
  transition: width var(--dur-emph) var(--ease-morph);
}

.pw-next-entry {
  display: inline-flex;
  align-items: center;
  gap: 0;
  flex-shrink: 0;
  white-space: nowrap;
}

.pw-entry-label {
  margin-left: 5px;
}

.pw-entry-count {
  max-width: 0;
  overflow: hidden;
  opacity: 0;
  transform: translateX(-4px);
  transition:
    max-width var(--dur-slow) var(--ease-out),
    opacity var(--dur-base) var(--ease-out),
    transform var(--dur-slow) var(--ease-out);
}

.pw-entry-count.visible {
  max-width: 4em;
  opacity: 1;
  transform: translateX(0);
}

.pw-entry-count .pw-tab-badge {
  display: block;
}

@media (prefers-reduced-motion: reduce) {
  .pw-entry-count {
    transition: none;
  }
}

.pw-ai-dock > :deep(.pw-conversation) {
  transition:
    opacity var(--dur-slow) var(--ease-morph),
    transform var(--dur-emph) var(--ease-morph);
}

.pw-ai-collapsed .pw-ai-dock {
  width: 0;
}

.pw-ai-collapsed .pw-ai-dock > :deep(.pw-conversation) {
  opacity: 0;
  transform: translateX(16px);
}

.pw-ai-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  height: 28px;
  margin-left: auto;
  padding: 0 8px 0 9px;
  border: 1px solid var(--line2);
  border-radius: 999px;
  color: var(--text2);
  font-size: 12px;
  font-weight: 600;
  transition:
    background-color var(--dur-base) var(--ease-out),
    border-color var(--dur-base) var(--ease-out),
    color var(--dur-base) var(--ease-out),
    transform var(--dur-slow) var(--bounce);
}

.pw-ai-toggle:hover {
  color: var(--text);
  background: var(--hover);
}

.pw-ai-toggle:active {
  transform: scale(var(--press-sm));
}

.pw-ai-toggle .icon:first-child {
  color: var(--pink);
}

.pw-ai-toggle .icon:last-child {
  margin-left: 2px;
  color: var(--muted);
  transition: color var(--dur-base) var(--ease-out);
}

.pw-ai-toggle.on {
  border-color: var(--pink-line);
  background: var(--pink-soft);
  color: var(--pink-deep);
}

.pw-ai-toggle.on .icon:last-child {
  color: var(--pink-deep);
}

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
  position: relative;
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
  animation: view-in var(--dur-base) var(--ease-out);
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

/* 与旁边「当前底稿 / 设为底稿」文字按钮的中文墨迹对齐 */
.pw-scope-actions > .icon-btn > .icon {
  transform: translateY(0.5px);
}

.pw-tab-badge {
  min-width: 16px;
  height: 16px;
  margin-left: 5px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--pink);
  color: #fff;
  font-size: 10px;
  font-weight: 650;
  line-height: 16px;
  text-align: center;
}

.pw-next-summary {
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
}

.pw-next-summary.changed {
  color: var(--pink-deep);
}

.pw-next-bar .pw-scope-actions .btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

@media (width <= 1250px) {
  .pw-next-bar .pw-scope-actions .btn span {
    display: none;
  }
}

.pw-prompt-actions .btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.pw-scope-bar .pw-prompt-actions {
  margin-left: 0;
}

.pw-images-tab {
  display: flex;
  align-items: center;
  justify-content: center;
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
  --pw-chat-width: var(--pw-chat-user, 380px);
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
  transition: grid-template-columns var(--dur-emph) var(--ease-morph);
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
  gap: 10px;
}

.pw-heading .pw-rename {
  flex: 1 1 0;
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
  flex: 1 1 0;
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
    --pw-chat-width: var(--pw-chat-user, 320px);
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
    --pw-chat-width: var(--pw-chat-user, 280px);
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
