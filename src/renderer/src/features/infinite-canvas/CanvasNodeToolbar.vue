<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { cleanErr } from '../../shared/lib/format'
import { vSegIndicator } from '../../shared/lib/seg-indicator'
import Icon from '../../shared/ui/Icon.vue'
import type { IconName } from '../../shared/ui/icons'
import type { OperationDialogTab } from './CanvasOperationDialog.vue'
import CanvasThumbnail from './CanvasThumbnail.vue'
import { freePosition } from './layout'
import {
  cardErrors,
  executeCard,
  isGenerateKind,
  operationLabel,
  runningCards,
  TOOL_ICONS,
} from './operations'
import type {
  CanvasAsset,
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

type QuickPopoverId = 'source' | 'margins' | 'enhance'
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
      title: '精确参考与 Vibe',
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
      title: '精确参考与 Vibe',
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
      title: '精确参考与 Vibe',
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
      title: '精确参考与 Vibe',
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
      title: '精确参考与 Vibe',
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
  imagePreview: (asset: CanvasAsset) => CanvasPreview | undefined
}>()

const emit = defineEmits<{
  remove: []
  spawnOperation: [kind: CanvasTool]
  startWire: [image: CanvasImage, event: PointerEvent]
  openDialog: [node: CanvasOperation, tab: OperationDialogTab]
  showResult: [operationId: number]
  dismiss: []
}>()

const barRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const activePopover = ref<QuickPopoverId | null>(null)
const recipeFeedback = ref('')

const operation = computed(() => (props.target.kind === 'operation' ? props.target.node : null))
const targetKey = computed(() =>
  props.target.kind === 'image' ? `img-${props.target.image.id}` : `op-${props.target.node.id}`,
)

watch(targetKey, () => {
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
const activePopoverSpec = computed(() =>
  operationActions.value.find((action) => action.id === activePopover.value),
)
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
      (card.request.params.preciseReferences?.length ?? 0) +
      (card.request.params.vibeReferences?.length ?? 0)
    return count ? String(count) : ''
  }
  return ''
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
  card.sourceId = imageId
  card.strokes = []
  const nextAsset = props.session.images.find((image) => image.id === imageId)?.asset
  syncSourceSize(card, nextAsset)
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
    const startId = props.session.nextImageId
    await executeCard(props.session, card, props.title)
    for (const image of props.session.images) {
      if (image.operationId === card.id && image.id >= startId) {
        image.x = freePosition(props.session, image)
      }
    }
    activePopover.value = null
  } catch (reason) {
    const message = cleanErr(reason)
    cardErrors.set(card, message)
    if (message.includes('底图')) {
      activePopover.value = 'source'
    } else if (message.includes('重绘区域')) {
      emit('openDialog', card, 'mask')
    } else if (message.includes('提示词')) {
      emit('openDialog', card, 'prompt')
    }
  }
}

function handleOverlayEscape(event: KeyboardEvent) {
  event.stopPropagation()
  if (!closeTool()) {
    emit('dismiss')
  }
}

defineExpose({ openPrimaryTool, closeTool, runOperation })
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
          v-if="hasResults"
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
          :disabled="busy || (operation.kind !== 'generate' && !sourceAsset)"
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

        <p
          v-if="currentError"
          class="tool-panel-alert"
          role="alert"
        >
          {{ currentError }}
        </p>

        <div class="tool-panel-scroll">
          <fieldset
            class="tool-panel-body"
            :disabled="busy"
          >
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
                  <span class="source-name">#{{ image.id }} {{ image.asset.label ?? '图片' }}</span>
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
                  min="0.01"
                  max="0.99"
                  step="0.01"
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
                  max="0.99"
                  step="0.01"
                />
              </div>
            </template>
          </fieldset>
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

.tool-panel-scroll {
  flex: 1;
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
</style>
