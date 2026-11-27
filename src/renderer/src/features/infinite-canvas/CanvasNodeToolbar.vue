<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { DEFAULT_COLLECTION, type ImageCollection } from '@shared/images/collections'
import { cleanErr } from '../../shared/lib/format'
import { vSegIndicator } from '../../shared/lib/seg-indicator'
import Icon from '../../shared/ui/Icon.vue'
import type { IconName } from '../../shared/ui/icons'
import type { OperationDialogTab } from './CanvasOperationDialog.vue'
import { DRAG_ASSET_MIME, writeCanvasDrag } from './canvas-drag'
import CanvasThumbnail from './CanvasThumbnail.vue'
import { reportError, toast } from '../../shared/lib/notifications'
import {
  activeOperationOutput,
  allOperationOutputs,
  ensureOutputBranch,
  extractOutputAsCanvasImage,
  fitInlineOutput,
  type CanvasOperationOutput,
} from './session'
import {
  cardErrors,
  connectImageToOperation,
  executeCard,
  fitOperationBoxToImage,
  isGenerateKind,
  operationLabel,
  OperationInputError,
  operationSize,
  runningCards,
  TOOL_ICONS,
} from './operations'
import type {
  CanvasAsset,
  CanvasGalleryAsset,
  CanvasImage,
  CanvasOperation,
  CanvasSession,
  CanvasTool,
} from './session'
import {
  useCanvasOverlayPlacement,
  type ScreenRect,
  type ViewportExtent,
} from './use-canvas-overlay'
import type { CanvasPreview } from './use-canvas-previews'

export type SelectedCanvasTarget =
  { kind: 'image'; image: CanvasImage } | { kind: 'operation'; node: CanvasOperation }

type QuickPopoverId = 'source' | 'margins' | 'enhance' | 'history'
type ToolbarActionId = QuickPopoverId | OperationDialogTab

interface ToolActionSpec {
  id: ToolbarActionId
  label: string
  title: string
  icon: IconName
  opensDialog?: boolean
}

const IMAGE_TOOLS: { kind: CanvasTool; label: string; icon: IconName }[] = [
  { kind: 'generate', label: '生图', icon: TOOL_ICONS.generate },
  { kind: 'inpaint', label: '局部重绘', icon: TOOL_ICONS.inpaint },
  { kind: 'outpaint', label: '扩图', icon: TOOL_ICONS.outpaint },
  { kind: 'enhance', label: '增强', icon: TOOL_ICONS.enhance },
  { kind: 'upscale', label: '放大 2×', icon: TOOL_ICONS.upscale },
]

const OPERATION_ACTIONS: Record<CanvasTool, ToolActionSpec[]> = {
  generate: [
    { id: 'prompt', label: '提示词', title: '提示词与角色', icon: 'edit', opensDialog: true },
    { id: 'params', label: '参数', title: '模型与生图参数', icon: 'sliders', opensDialog: true },
    {
      id: 'references',
      label: '参考图',
      title: '底图、精确参考与 Vibe',
      icon: 'layers',
      opensDialog: true,
    },
  ],
  img2img: [
    { id: 'source', label: '底图', title: '选择底图', icon: 'image' },
    { id: 'prompt', label: '提示词', title: '提示词与角色', icon: 'edit', opensDialog: true },
    { id: 'params', label: '参数', title: '模型与生图参数', icon: 'sliders', opensDialog: true },
    {
      id: 'references',
      label: '参考图',
      title: '底图、精确参考与 Vibe',
      icon: 'layers',
      opensDialog: true,
    },
  ],
  inpaint: [
    { id: 'source', label: '底图', title: '选择底图', icon: 'image' },
    { id: 'mask', label: '涂抹遮罩', title: '涂抹重绘区域', icon: 'brush', opensDialog: true },
    { id: 'prompt', label: '提示词', title: '提示词与角色', icon: 'edit', opensDialog: true },
    { id: 'params', label: '参数', title: '重绘强度与参数', icon: 'sliders', opensDialog: true },
    {
      id: 'references',
      label: '参考图',
      title: '底图、精确参考与 Vibe',
      icon: 'layers',
      opensDialog: true,
    },
  ],
  outpaint: [
    { id: 'source', label: '底图', title: '选择底图', icon: 'image' },
    { id: 'margins', label: '扩展边距', title: '设置扩展边距', icon: 'tool-outpaint' },
    { id: 'prompt', label: '提示词', title: '提示词与角色', icon: 'edit', opensDialog: true },
    { id: 'params', label: '参数', title: '模型与生图参数', icon: 'sliders', opensDialog: true },
    {
      id: 'references',
      label: '参考图',
      title: '底图、精确参考与 Vibe',
      icon: 'layers',
      opensDialog: true,
    },
  ],
  enhance: [
    { id: 'source', label: '底图', title: '选择底图', icon: 'image' },
    { id: 'enhance', label: '增强设置', title: '倍率与增强强度', icon: 'tool-enhance' },
    { id: 'prompt', label: '提示词', title: '提示词与角色', icon: 'edit', opensDialog: true },
    { id: 'params', label: '参数', title: '模型与生图参数', icon: 'sliders', opensDialog: true },
    {
      id: 'references',
      label: '参考图',
      title: '底图、精确参考与 Vibe',
      icon: 'layers',
      opensDialog: true,
    },
  ],
  upscale: [{ id: 'source', label: '底图', title: '选择底图', icon: 'image' }],
}

const MARGIN_SIDES = { left: '左', right: '右', top: '上', bottom: '下' } as const

const props = defineProps<{
  target: SelectedCanvasTarget
  anchor: ScreenRect
  viewportSize: ViewportExtent
  session: CanvasSession
  title: string
  historyPreview: (asset: CanvasGalleryAsset) => CanvasPreview | undefined
  imagePreview: (asset: CanvasAsset) => CanvasPreview | undefined
}>()

const emit = defineEmits<{
  remove: []
  spawnOperation: [kind: CanvasTool]
  startWire: [image: CanvasImage, event: PointerEvent]
  openDialog: [node: CanvasOperation, tab: OperationDialogTab]
  showResult: [operationId: number]
  extracted: [image: CanvasImage]
  dismiss: []
}>()

const barRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const activePopover = ref<QuickPopoverId | null>(null)
const historyStart = ref(0)
const recipeFeedback = ref('')
const saveMenu = ref<HTMLElement>()
const collections = ref<ImageCollection[]>([])
const collectionError = ref('')
let closeTimer: ReturnType<typeof setTimeout> | undefined
let loadingCollections = false

const operation = computed(() => (props.target.kind === 'operation' ? props.target.node : null))
const targetKey = computed(() =>
  props.target.kind === 'image' ? `img-${props.target.image.id}` : `op-${props.target.node.id}`,
)

const collectionId = computed(() => operation.value?.request.collectionId ?? DEFAULT_COLLECTION)
const saveOptions = computed(() => [
  { id: DEFAULT_COLLECTION, name: '默认图集' },
  ...collections.value.filter(({ id }) => id !== DEFAULT_COLLECTION),
])
const saveTitle = computed(() => {
  if (operation.value?.saveToGallery === false) {
    return '当前不保存到图集（点击恢复保存）'
  }
  const name = saveOptions.value.find(({ id }) => id === collectionId.value)?.name ?? '所选图集'
  return `保存到：${name}（点击关闭保存，悬停切换图集）`
})

async function loadCollections() {
  if (loadingCollections) {
    return
  }
  loadingCollections = true
  try {
    collections.value = await window.canvasApi.collectionsList()
    collectionError.value = ''
  } catch (reason) {
    collectionError.value = cleanErr(reason)
  } finally {
    loadingCollections = false
  }
}

watch(
  collectionId,
  async (id) => {
    if (id !== DEFAULT_COLLECTION) {
      await loadCollections()
    }
  },
  { immediate: true },
)

function cancelMenuTimer() {
  clearTimeout(closeTimer)
}

function closeSaveMenu() {
  cancelMenuTimer()
  saveMenu.value?.hidePopover()
}

async function openSaveMenu() {
  cancelMenuTimer()
  if (saveMenu.value && !saveMenu.value.matches(':popover-open')) {
    activePopover.value = null
    saveMenu.value.showPopover()
    await loadCollections()
  }
}

function scheduleMenuClose() {
  cancelMenuTimer()
  closeTimer = setTimeout(closeSaveMenu, 140)
}

function chooseCollection(id: string | null) {
  const card = operation.value
  if (!card || busy.value) {
    return
  }
  card.saveToGallery = id !== null
  if (id !== null) {
    card.request.collectionId = id === DEFAULT_COLLECTION ? undefined : id
  }
  closeSaveMenu()
}

function toggleSave() {
  const card = operation.value
  if (card && !busy.value) {
    card.saveToGallery = card.saveToGallery === false
  }
}

onBeforeUnmount(cancelMenuTimer)
watch(targetKey, () => {
  closeSaveMenu()
  activePopover.value = null
  recipeFeedback.value = ''
})

const placement = useCanvasOverlayPlacement(
  () => props.anchor,
  () => props.viewportSize,
  () => 24,
  barRef,
  panelRef,
)

const isLocked = computed(() => {
  const id = props.target.kind === 'image' ? props.target.image.id : props.target.node.id
  return props.session.operations.some(
    (node) => runningCards.has(node) && (node.id === id || node.sourceId === id),
  )
})

const busy = computed(() => (operation.value ? runningCards.has(operation.value) : false))
const sourceAsset = computed(() => {
  const card = operation.value
  if (!card) {
    return undefined
  }
  return props.session.images.find((image) => image.id === card.sourceId)?.asset
})
const targetSize = computed(
  () => operation.value && operationSize(operation.value, sourceAsset.value),
)
const hasResults = computed(() => {
  const card = operation.value
  if (!card) {
    return false
  }
  return props.session.images.some((image) => image.operationId === card.id)
})
const operationActions = computed(() =>
  operation.value ? OPERATION_ACTIONS[operation.value.kind] : [],
)
const outputs = computed(() =>
  operation.value ? allOperationOutputs(props.session, operation.value) : [],
)
const activeOutput = computed(
  () => operation.value && activeOperationOutput(operation.value, outputs.value),
)
const newestFirst = computed(() => [...outputs.value].reverse())
const inline = computed(() => operation.value?.outputMode !== 'branch')
const modeTitle = computed(() =>
  inline.value
    ? '输出展示：容器内（点击切换为连线输出）'
    : '输出展示：连线到画布（点击切换为容器内）',
)
const historyAssets = computed(() => {
  if (activePopover.value !== 'history') {
    return []
  }
  const ordered = newestFirst.value
  return ordered.slice(historyStart.value, historyStart.value + 24).map((output) => output.asset)
})

function trackHistoryScroll(event: Event) {
  const scroller = event.currentTarget as HTMLElement
  const row = scroller.querySelector<HTMLElement>('.history-card')
  if (row) {
    historyStart.value = Math.max(0, Math.floor(scroller.scrollTop / row.offsetHeight) - 1)
  }
}

function openHistory() {
  historyStart.value = 0
  activePopover.value = 'history'
}

function toggleMode() {
  const node = operation.value
  if (!node) {
    return
  }
  const session = props.session
  const output = activeOutput.value ?? undefined
  node.outputMode = inline.value ? 'branch' : 'inline'
  if (node.outputMode === 'inline') {
    fitInlineOutput(node, output)
    return
  }
  const source = session.images.find((image) => image.id === node.sourceId)
  if (source) {
    fitOperationBoxToImage(node, source)
  }
  if (output) {
    ensureOutputBranch(session, node, output)
  }
}

function dragVersion(event: DragEvent, output: CanvasOperationOutput) {
  event.dataTransfer?.setData(DRAG_ASSET_MIME, JSON.stringify(output.asset))
  writeCanvasDrag(event, { kind: 'gallery', asset: output.asset })
}

function selectVersion(output: CanvasOperationOutput) {
  const node = operation.value
  if (node) {
    node.outputs = outputs.value
    node.activeOutputId = output.id
    node.outputMode = 'inline'
    fitInlineOutput(node, output)
  }
}

function extractVersion(output: CanvasOperationOutput) {
  if (operation.value) {
    const image = extractOutputAsCanvasImage(props.session, operation.value, output)
    if (image) {
      emit('extracted', image)
    }
  }
}

function copyVersion(output: CanvasOperationOutput) {
  window.canvasApi
    .naiCopyImage(output.asset.name)
    .then((copied) => {
      toast(copied ? '图片已复制到系统剪贴板' : '未能复制图片')
    })
    .catch(reportError)
}

const activePopoverSpec = computed(() => {
  if (activePopover.value === 'history') {
    return { id: 'history', title: '历史生成版本', icon: 'history' as const }
  }
  return operationActions.value.find((action) => action.id === activePopover.value)
})
const currentError = computed(() =>
  operation.value ? (cardErrors.get(operation.value) ?? '') : '',
)

function actionBadge(actionId: ToolbarActionId): string {
  const card = operation.value
  if (!card) {
    return ''
  }
  if (actionId === 'source' && card.sourceId) {
    return `#${card.sourceId}`
  }
  if (actionId === 'mask' && card.strokes.length) {
    return String(card.strokes.length)
  }
  if (actionId === 'references') {
    const count =
      Number(card.sourceId !== null) +
      (card.request.params.preciseReferences?.length ?? 0) +
      (card.request.params.vibeReferences?.length ?? 0)
    return count ? String(count) : ''
  }
  return ''
}

function actionTitle(action: ToolActionSpec) {
  const card = operation.value
  if (action.id !== 'references' || !card) {
    return action.title
  }
  const source = card.sourceId === null ? '未绑定底图' : '底图 #' + card.sourceId
  return [
    source,
    '精确参考 ' + (card.request.params.preciseReferences?.length ?? 0),
    'Vibe ' + (card.request.params.vibeReferences?.length ?? 0),
  ].join(' · ')
}

function actionHasDot(actionId: ToolbarActionId): boolean {
  const card = operation.value
  if (!card) {
    return false
  }
  if (actionId === 'prompt') {
    return Boolean(card.request.base.trim() || card.request.characters.length)
  }
  return false
}

function triggerAction(action: ToolActionSpec) {
  const card = operation.value
  if (!card) {
    return
  }
  if (action.opensDialog) {
    activePopover.value = null
    emit('openDialog', card, action.id as OperationDialogTab)
    return
  }
  const popoverId = action.id as QuickPopoverId
  activePopover.value = activePopover.value === popoverId ? null : popoverId
  recipeFeedback.value = ''
}

function closeTool(): boolean {
  if (saveMenu.value?.matches(':popover-open')) {
    closeSaveMenu()
    return true
  }
  if (activePopover.value) {
    activePopover.value = null
    return true
  }
  return false
}

function openPrimaryTool() {
  const card = operation.value
  if (!card) {
    return
  }
  if (!isGenerateKind(card.kind) && !card.sourceId) {
    activePopover.value = 'source'
    return
  }
  if (card.kind === 'inpaint') {
    emit('openDialog', card, 'mask')
  } else if (card.kind === 'outpaint') {
    activePopover.value = 'margins'
  } else if (card.kind === 'enhance') {
    activePopover.value = 'enhance'
  } else if (card.kind === 'upscale') {
    activePopover.value = 'source'
  } else {
    emit('openDialog', card, 'prompt')
  }
}

function syncSourceSize(card: CanvasOperation, asset?: CanvasAsset) {
  if (card.kind === 'inpaint' && asset?.width && asset.height) {
    Object.assign(card.request.params, { width: asset.width, height: asset.height })
  }
}

function selectSourceImage(imageId: number | null) {
  const card = operation.value
  if (!card) {
    return
  }
  const source = props.session.images.find((image) => image.id === imageId)
  card.strokes = []
  if (source) {
    connectImageToOperation(card, source, 'source')
  } else {
    card.sourceId = null
  }
  cardErrors.delete(card)
}

async function useSourceRecipe() {
  const card = operation.value
  if (!card || sourceAsset.value?.kind !== 'gallery') {
    return
  }
  recipeFeedback.value = ''
  try {
    const recipe = await window.canvasApi.naiRecipe(sourceAsset.value.name)
    if (!recipe) {
      throw new Error('该底图没有生成记录')
    }
    card.request = recipe.request
    syncSourceSize(card, sourceAsset.value)
    cardErrors.delete(card)
    recipeFeedback.value = '已载入底图配置'
  } catch (reason) {
    cardErrors.set(card, cleanErr(reason))
  }
}

function applyMarginPreset(preset: { left: number; right: number; top: number; bottom: number }) {
  if (!operation.value) {
    return
  }
  Object.assign(operation.value.margins, preset)
}

function setEnhanceScale(scale: 1 | 1.5) {
  if (operation.value) {
    operation.value.scale = scale
  }
}

async function runOperation() {
  const card = operation.value
  if (!card || busy.value) {
    return
  }
  cardErrors.delete(card)
  try {
    await executeCard(props.session, card, props.title)
    activePopover.value = null
  } catch (reason) {
    const message = cleanErr(reason)
    cardErrors.set(card, message)
    if (reason instanceof OperationInputError && operation.value === card) {
      const panel = reason.panel
      if (panel === 'source' || panel === 'margins' || panel === 'enhance') {
        activePopover.value = panel
      } else {
        activePopover.value = null
        emit('openDialog', card, panel)
      }
    }
  }
}

function handleOverlayEscape(event: KeyboardEvent) {
  event.stopPropagation()
  if (!closeTool()) {
    emit('dismiss')
  }
}

defineExpose({ openPrimaryTool, closeTool, runOperation, openHistory, historyAssets })
</script>

<template>
  <div
    class="canvas-tools-layer"
    @keydown.esc="handleOverlayEscape"
  >
    <div
      ref="barRef"
      class="canvas-context-bar"
      role="toolbar"
      :aria-label="
        target.kind === 'image' ? '图片操作工具栏' : operationLabel(target.node.kind) + '工具栏'
      "
      :style="placement.bar"
      @pointerdown.stop
      @wheel.stop
      @keydown.stop
    >
      <template v-if="target.kind === 'image'">
        <button
          v-for="tool in IMAGE_TOOLS"
          :key="tool.kind"
          class="ctx-btn"
          type="button"
          @click="emit('spawnOperation', tool.kind)"
        >
          <Icon
            :name="tool.icon"
            :size="15"
          />
          <span>{{ tool.label }}</span>
        </button>
        <span
          class="ctx-divider"
          aria-hidden="true"
        />
        <button
          class="ctx-btn"
          type="button"
          title="拖线连接到画布上的操作盒（设为图生图 / 精确参考 / Vibe）"
          @pointerdown.stop.prevent="emit('startWire', target.image, $event)"
        >
          <Icon
            name="link"
            :size="14"
          />
          <span>连线</span>
        </button>
        <button
          class="ctx-btn ctx-icon-only ctx-danger"
          type="button"
          title="从画布移除 (Delete)"
          aria-label="从画布移除"
          :disabled="isLocked"
          @click="emit('remove')"
        >
          <Icon
            name="trash"
            :size="15"
          />
        </button>
      </template>

      <template v-else-if="operation">
        <button
          v-for="action in operationActions"
          :key="action.id"
          class="ctx-btn"
          :class="{ active: activePopover === action.id }"
          type="button"
          :title="actionTitle(action)"
          :aria-expanded="!action.opensDialog ? activePopover === action.id : undefined"
          @click="triggerAction(action)"
        >
          <Icon
            :name="action.icon"
            :size="15"
          />
          <span>{{ action.label }}</span>
          <span
            v-if="actionBadge(action.id)"
            class="ctx-badge"
          >
            {{ actionBadge(action.id) }}
          </span>
          <span
            v-else-if="actionHasDot(action.id)"
            class="ctx-dot"
            aria-hidden="true"
          />
        </button>

        <span
          class="ctx-divider"
          aria-hidden="true"
        />

        <button
          class="ctx-btn ctx-icon-only"
          type="button"
          :class="{ active: !inline }"
          :title="modeTitle"
          :aria-label="modeTitle"
          :aria-pressed="!inline"
          :disabled="busy"
          @click="toggleMode"
        >
          <Icon
            :name="inline ? 'image' : 'link'"
            :size="16"
          />
        </button>
        <button
          v-if="outputs.length"
          class="ctx-btn"
          type="button"
          title="历史生成版本"
          :aria-expanded="activePopover === 'history'"
          :class="{ active: activePopover === 'history' }"
          @click="activePopover === 'history' ? closeTool() : openHistory()"
        >
          <Icon
            name="history"
            :size="15"
          />
          历史 <span class="ctx-badge">{{ outputs.length }}</span>
        </button>
        <button
          class="ctx-btn ctx-icon-only ctx-save"
          :class="{ 'is-off': operation.saveToGallery === false }"
          type="button"
          :title="saveTitle"
          :aria-label="saveTitle"
          :aria-pressed="operation.saveToGallery !== false"
          :disabled="busy"
          @pointerenter="openSaveMenu"
          @pointerleave="scheduleMenuClose"
          @keydown.down.prevent="openSaveMenu"
          @keydown.esc="handleOverlayEscape"
          @click="toggleSave"
        >
          <Icon
            name="folder"
            :size="16"
          />
          <span
            v-if="operation.saveToGallery !== false && collectionId !== DEFAULT_COLLECTION"
            class="ctx-dot"
          />
        </button>
        <section
          ref="saveMenu"
          class="canvas-save-menu"
          popover="auto"
          aria-label="保存到图集"
          @pointerenter="cancelMenuTimer"
          @pointerleave="scheduleMenuClose"
          @keydown.esc.stop="closeSaveMenu"
        >
          <h3>保存到图集</h3>
          <p
            v-if="collectionError"
            role="alert"
          >
            {{ collectionError }}
          </p>
          <div class="save-collection-list">
            <button
              v-for="option in saveOptions"
              :key="option.id"
              type="button"
              :aria-pressed="operation.saveToGallery !== false && collectionId === option.id"
              @click="chooseCollection(option.id)"
            >
              <span>{{ option.name }}</span>
              <Icon
                v-if="operation.saveToGallery !== false && collectionId === option.id"
                name="check"
                :size="14"
              />
            </button>
          </div>
          <button
            class="save-temporary"
            type="button"
            :aria-pressed="operation.saveToGallery === false"
            @click="chooseCollection(null)"
          >
            <span>不保存到图集（仅临时）</span>
            <Icon
              v-if="operation.saveToGallery === false"
              name="check"
              :size="14"
            />
          </button>
        </section>

        <button
          v-if="hasResults && !inline"
          class="ctx-btn"
          type="button"
          title="定位到生成结果"
          @click="emit('showResult', operation.id)"
        >
          <Icon
            name="eye"
            :size="14"
          />
          <span>结果</span>
        </button>

        <button
          class="btn small accent ctx-run"
          type="button"
          :disabled="busy"
          @click="runOperation"
        >
          <Icon
            :name="TOOL_ICONS[operation.kind]"
            :size="14"
          />
          <span>{{ busy ? '执行中…' : '执行' }}</span>
        </button>

        <span
          class="ctx-divider"
          aria-hidden="true"
        />

        <button
          class="ctx-btn ctx-icon-only ctx-danger"
          type="button"
          title="从画布移除 (Delete)"
          aria-label="从画布移除"
          :disabled="isLocked"
          @click="emit('remove')"
        >
          <Icon
            name="trash"
            :size="15"
          />
        </button>
      </template>
    </div>

    <Transition
      name="tool-panel"
      mode="out-in"
    >
      <section
        v-if="operation && activePopoverSpec"
        :key="activePopoverSpec.id"
        ref="panelRef"
        class="canvas-tool-panel"
        :aria-label="activePopoverSpec.title"
        :style="placement.panel"
        @keydown.esc.stop="handleOverlayEscape"
        @pointerdown.stop
        @wheel.stop
        @keydown.stop
      >
        <header class="tool-panel-head">
          <Icon
            :name="activePopoverSpec.icon"
            :size="15"
          />
          <h3>{{ activePopoverSpec.title }}</h3>
          <button
            class="icon-btn sm"
            type="button"
            title="收起编辑面板 (Esc)"
            aria-label="收起编辑面板"
            @click="closeTool"
          >
            <Icon
              name="x"
              :size="14"
            />
          </button>
        </header>

        <div
          class="tool-panel-scroll"
          @scroll="trackHistoryScroll"
        >
          <div class="tool-panel-content">
            <p
              v-if="currentError"
              class="tool-panel-alert"
              role="alert"
            >
              {{ currentError }}
            </p>

            <p
              v-if="activePopover === 'history'"
              class="history-summary"
            >
              共 {{ outputs.length }} 版 · {{ inline ? '容器内展示' : '连线输出' }}
            </p>
            <div
              v-if="activePopover === 'history'"
              class="history-list"
            >
              <div
                v-for="(output, index) in newestFirst"
                :key="output.id"
                class="history-card"
                :class="{ 'is-active': inline && output.id === activeOutput?.id }"
                draggable="true"
                title="点击切换版本，或直接拖到画布中"
                @dragstart="dragVersion($event, output)"
              >
                <button
                  class="history-version"
                  type="button"
                  :aria-pressed="inline && output.id === activeOutput?.id"
                  @click="selectVersion(output)"
                >
                  <span class="history-thumb"
                    ><CanvasThumbnail
                      :preview="historyPreview(output.asset)"
                      show-error
                  /></span>
                  <span class="history-caption">
                    <strong>第 {{ outputs.length - index }} 版</strong>
                    <small>{{
                      output.asset.width && output.asset.height
                        ? output.asset.width + '×' + output.asset.height
                        : '尺寸未知'
                    }}</small>
                    <small>{{
                      output.createdAt ? new Date(output.createdAt).toLocaleString() : '时间未记录'
                    }}</small>
                  </span>
                </button>
                <div class="history-card-actions">
                  <button
                    class="icon-btn sm"
                    type="button"
                    title="放到画布（独立图片）"
                    aria-label="放到画布（独立图片）"
                    draggable="false"
                    @pointerdown.stop.prevent
                    @click.stop="extractVersion(output)"
                  >
                    <Icon
                      name="plus"
                      :size="15"
                    />
                  </button>
                  <button
                    class="icon-btn sm"
                    type="button"
                    title="复制图片"
                    aria-label="复制图片"
                    draggable="false"
                    @pointerdown.stop.prevent
                    @click.stop="copyVersion(output)"
                  >
                    <Icon
                      name="copy"
                      :size="14"
                    />
                  </button>
                </div>
              </div>
            </div>
            <fieldset
              v-else
              class="tool-panel-body"
              :disabled="busy"
            >
              <p
                v-if="
                  sourceAsset?.width &&
                  sourceAsset.height &&
                  targetSize &&
                  ['outpaint', 'enhance', 'upscale'].includes(operation.kind)
                "
                class="tool-panel-empty"
              >
                原图 {{ sourceAsset.width }}×{{ sourceAsset.height }} →
                {{ operationLabel(operation.kind) }}后 {{ targetSize.width }}×{{
                  targetSize.height
                }}
              </p>
              <template v-if="activePopover === 'source'">
                <p
                  v-if="!session.images.length"
                  class="tool-panel-empty"
                >
                  画布中还没有图片，先从左侧素材库拖入或本地导入一张图片。
                </p>
                <div
                  v-else
                  class="source-grid"
                >
                  <button
                    v-for="image in session.images"
                    :key="image.id"
                    class="source-item"
                    :class="{ selected: operation.sourceId === image.id }"
                    type="button"
                    @click="selectSourceImage(image.id)"
                  >
                    <span class="source-thumb">
                      <CanvasThumbnail :preview="imagePreview(image.asset)" />
                    </span>
                    <span class="source-name"
                      >#{{ image.id }} {{ image.asset.label ?? '图片' }}</span
                    >
                  </button>
                </div>
                <div
                  v-if="sourceAsset"
                  class="source-footer"
                >
                  <button
                    v-if="operation.kind !== 'upscale'"
                    class="btn small"
                    type="button"
                    @click="useSourceRecipe"
                  >
                    <Icon
                      name="import"
                      :size="13"
                    />
                    载入底图生图配置
                  </button>
                  <button
                    class="btn small ghost"
                    type="button"
                    @click="selectSourceImage(null)"
                  >
                    取消绑定
                  </button>
                  <span
                    v-if="recipeFeedback"
                    class="source-feedback"
                  >
                    {{ recipeFeedback }}
                  </span>
                </div>
              </template>

              <template v-else-if="activePopover === 'margins'">
                <div class="margin-presets">
                  <button
                    class="chip"
                    type="button"
                    @click="applyMarginPreset({ left: 0, right: 128, top: 0, bottom: 0 })"
                  >
                    右侧 +128
                  </button>
                  <button
                    class="chip"
                    type="button"
                    @click="applyMarginPreset({ left: 128, right: 128, top: 0, bottom: 0 })"
                  >
                    左右 +128
                  </button>
                  <button
                    class="chip"
                    type="button"
                    @click="applyMarginPreset({ left: 0, right: 0, top: 128, bottom: 128 })"
                  >
                    上下 +128
                  </button>
                  <button
                    class="chip"
                    type="button"
                    @click="applyMarginPreset({ left: 128, right: 128, top: 128, bottom: 128 })"
                  >
                    四周 +128
                  </button>
                  <button
                    class="chip"
                    type="button"
                    @click="applyMarginPreset({ left: 0, right: 0, top: 0, bottom: 0 })"
                  >
                    清零
                  </button>
                </div>
                <div class="margin-grid">
                  <label
                    v-for="(name, side) in MARGIN_SIDES"
                    :key="side"
                    class="tp-field"
                  >
                    <span class="tp-label">{{ name }}侧扩展 (px)</span>
                    <input
                      v-model.number="operation.margins[side]"
                      class="tp-input"
                      type="number"
                      min="0"
                      max="2048"
                      step="64"
                    />
                  </label>
                </div>
              </template>

              <template v-else-if="activePopover === 'enhance'">
                <div class="tp-field">
                  <span class="tp-label">增强倍率</span>
                  <div
                    v-seg-indicator
                    class="seg block"
                  >
                    <button
                      type="button"
                      :class="{ on: operation.scale === 1 }"
                      @click="setEnhanceScale(1)"
                    >
                      1× 保持原尺寸
                    </button>
                    <button
                      type="button"
                      :class="{ on: operation.scale === 1.5 }"
                      @click="setEnhanceScale(1.5)"
                    >
                      1.5× 高清放大
                    </button>
                  </div>
                </div>
                <div class="tp-range">
                  <div class="tp-range-head">
                    <span class="tp-label">修改强度</span>
                    <span class="tp-range-value">{{ operation.strength.toFixed(2) }}</span>
                  </div>
                  <input
                    v-model.number="operation.strength"
                    class="range"
                    aria-label="修改强度"
                    type="range"
                    min="0.2"
                    max="0.8"
                    step="0.05"
                  />
                </div>
                <div class="tp-range">
                  <div class="tp-range-head">
                    <span class="tp-label">噪声</span>
                    <span class="tp-range-value">{{ operation.noise.toFixed(2) }}</span>
                  </div>
                  <input
                    v-model.number="operation.noise"
                    class="range"
                    aria-label="噪声"
                    type="range"
                    min="0"
                    max="0.5"
                    step="0.05"
                  />
                </div>
              </template>
            </fieldset>
          </div>
        </div>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.canvas-tools-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.canvas-context-bar,
.canvas-tool-panel {
  position: absolute;
  border: 1px solid color-mix(in srgb, var(--line2) 90%, transparent);
  background: color-mix(in srgb, var(--bg) 94%, transparent);
  box-shadow: var(--shadow-pop);
  backdrop-filter: blur(14px);
  pointer-events: auto;
}

.canvas-context-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  width: max-content;
  padding: 4px;
  overflow: auto hidden;
  border-radius: 12px;
  scrollbar-width: none;
}

.canvas-context-bar::-webkit-scrollbar {
  display: none;
}

.ctx-btn {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 29px;
  padding: 0 9px;
  border-radius: 8px;
  color: var(--text2);
  font-size: 12px;
  font-weight: 550;
  white-space: nowrap;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    transform var(--dur-slow) var(--bounce);
}

.ctx-btn:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}

.ctx-btn:active:not(:disabled) {
  transform: scale(var(--press-sm));
}

.ctx-btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.ctx-btn.active {
  background: var(--pink-soft);
  color: var(--pink-deep);
}

.ctx-btn.ctx-icon-only {
  width: 29px;
  padding: 0;
}

.ctx-btn.ctx-danger:hover:not(:disabled) {
  background: var(--bad-soft);
  color: var(--bad);
}

.ctx-badge {
  padding: 0 5px;
  border-radius: 999px;
  background: var(--hover);
  color: var(--text2);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}

.ctx-btn.active .ctx-badge {
  background: color-mix(in srgb, var(--pink) 18%, var(--bg));
  color: var(--pink-deep);
}

.ctx-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--pink);
}

.ctx-divider {
  flex: 0 0 auto;
  width: 1px;
  height: 16px;
  margin: 0 3px;
  background: var(--line2);
}

.ctx-save {
  position: relative;
  anchor-name: --canvas-save;
}

.ctx-save .ctx-dot {
  position: absolute;
  top: 4px;
  right: 3px;
}

.ctx-save.is-off {
  background: var(--panel);
  color: var(--muted);
  opacity: 0.6;
}

.canvas-save-menu {
  position: fixed;
  position-anchor: --canvas-save;
  inset: auto;
  position-area: bottom span-left;
  position-try-fallbacks:
    flip-block,
    flip-inline,
    flip-block flip-inline;
  justify-self: end;
  width: 206px;
  max-height: min(320px, 100%);
  margin: 6px 0;
  padding: 6px;
  overflow: auto;
  border: 1px solid var(--line2);
  border-radius: 13px;
  background: var(--bg);
  color: var(--text);
  box-shadow: var(--shadow-pop);
  pointer-events: auto;
}

.canvas-save-menu:popover-open {
  animation: fade-up var(--dur-fast) var(--ease-out);
}

.canvas-save-menu h3,
.canvas-save-menu p {
  margin: 4px 9px 6px;
  color: var(--text2);
  font-size: 12px;
}

.canvas-save-menu button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 7px 9px;
  border-radius: 7px;
  color: inherit;
  font-size: 12px;
  text-align: left;
}

.canvas-save-menu button span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.canvas-save-menu button .icon {
  flex-shrink: 0;
}

.canvas-save-menu button:hover,
.canvas-save-menu button:focus-visible {
  background: var(--hover);
}

.canvas-save-menu button[aria-pressed='true'] {
  color: var(--pink-deep);
}

.save-collection-list {
  max-height: 196px;
  overflow: auto;
  overscroll-behavior: contain;
  padding-bottom: 5px;
  border-bottom: 1px solid var(--line);
}

.save-temporary {
  margin-top: 5px;
}

.ctx-run {
  height: 28px;
  padding: 0 11px;
  border-radius: 8px;
}

/* ---------- 轻量快捷浮层面板（可正常滚动） ---------- */
.canvas-tool-panel {
  display: flex;
  flex-direction: column;
  width: 332px;
  overflow: hidden;
  border-radius: 14px;
  color: var(--text);
  user-select: text;
}

.tool-panel-head {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 7px;
  padding: 9px 10px 9px 13px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--side) 72%, var(--bg));
}

.tool-panel-head .icon {
  color: var(--pink-deep);
}

.tool-panel-head h3 {
  margin: 0;
  margin-right: auto;
  font-size: 13px;
  font-weight: 650;
}

.tool-panel-alert {
  flex: 0 0 auto;
  margin: 10px 12px 0;
  padding: 7px 10px;
  border-radius: 8px;
  background: var(--bad-soft);
  color: var(--bad);
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.tool-panel-content {
  display: flow-root;
}

.tool-panel-scroll {
  scrollbar-gutter: stable;
  flex: 0 1 auto;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}

.tool-panel-body {
  display: flex;
  flex-direction: column;
  gap: 11px;
  min-width: 0;
  margin: 0;
  padding: 12px;
  border: 0;
}

.tool-panel-empty {
  margin: 0;
  color: var(--text2);
  font-size: 12px;
  line-height: 1.5;
}

.source-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.source-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  padding: 5px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
  text-align: left;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out);
}

.source-item:hover {
  border-color: var(--pink-line);
}

.source-item.selected {
  border-color: var(--pink);
  background: var(--pink-soft);
}

.source-thumb {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 7px;
  background: var(--bg);
}

.source-name {
  overflow: hidden;
  color: var(--text2);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-item.selected .source-name {
  color: var(--pink-deep);
  font-weight: 600;
}

.source-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.source-feedback {
  color: var(--ok);
  font-size: 11.5px;
}

.margin-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.margin-presets .chip {
  height: 25px;
  padding: 0 9px;
  font-size: 11.5px;
}

.margin-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.tp-field {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.tp-label {
  color: var(--text2);
  font-size: 11.5px;
  font-weight: 550;
}

.tp-input {
  width: 100%;
  min-width: 0;
  height: 31px;
  padding: 0 9px;
  border: 1px solid var(--line2);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  font-size: 12.5px;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

.tp-input:focus {
  border-color: var(--pink-line);
  background: var(--bg);
  box-shadow: 0 0 0 3px var(--pink-soft);
}

.tp-range {
  display: grid;
  gap: 2px;
}

.tp-range-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tp-range-value {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--panel);
  color: var(--text);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.tool-panel-enter-active,
.tool-panel-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-out),
    transform var(--dur-base) var(--ease-out);
}

.tool-panel-enter-from,
.tool-panel-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}

.tool-panel-leave-active {
  pointer-events: none;
}

.history-summary {
  margin: 4px 12px;
  color: var(--text2);
  font-size: 12px;
}

.history-list {
  padding: 0 8px 8px;
}

.history-card {
  position: relative;
  width: 100%;
  padding-bottom: 6px;
  user-select: none;
  cursor: grab;
}

.history-version {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 70px;
  padding: 6px 60px 6px 7px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--bg);
  text-align: left;
  cursor: inherit;
}

.history-card:active {
  cursor: grabbing;
}

.history-card.is-active .history-version {
  border-color: var(--pink);
  background: var(--pink-soft);
  color: var(--pink-deep);
}

.history-card-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 2px;
}

.history-card-actions .icon-btn {
  width: 24px;
  height: 24px;
  padding: 0;
}

.history-thumb {
  pointer-events: none;
  flex: 0 0 50px;
  height: 54px;
  overflow: hidden;
  border-radius: 5px;
  background: var(--panel);
}

.history-caption {
  display: grid;
  flex: 1;
  gap: 2px;
  font-size: 12px;
}

.history-caption small {
  color: var(--text2);
  font-size: 10px;
}
</style>
