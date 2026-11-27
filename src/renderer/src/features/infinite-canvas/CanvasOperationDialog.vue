<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { NaiImage } from '@shared/images/types'
import type { InpaintDraft } from '@shared/prompts/types'
import { backdropCloser } from '../../shared/lib/dialog-motion'
import Icon from '../../shared/ui/Icon.vue'
import CanvasOperationParams from './CanvasOperationParams.vue'
import CanvasOperationReferences from './CanvasOperationReferences.vue'
import { PromptEditor } from '../prompts/public/components'
import { canvasImageUrl } from './use-canvas-previews'
import CanvasMask from './CanvasMask.vue'
import {
  cardErrors,
  isGenerateKind,
  operationLabel,
  operationSize,
  runningCards,
  TOOL_ICONS,
  TOOL_TONES,
} from './operations'
import type { CanvasOperation, CanvasSession } from './session'

export type OperationDialogTab = 'prompt' | 'params' | 'references' | 'mask'

const props = defineProps<{
  node: CanvasOperation | null
  initialTab: OperationDialogTab
  session: CanvasSession
}>()

const emit = defineEmits<{
  close: []
  run: []
  bindGallery: [image: NaiImage]
}>()

const dialogRef = ref<HTMLDialogElement | null>(null)
const activeTab = ref<OperationDialogTab>('prompt')
const bindingImage = ref(false)
const card = computed(() => props.node)

const busy = computed(() => (props.node ? runningCards.has(props.node) : false))
const errorMessage = computed(() => (props.node ? (cardErrors.get(props.node) ?? '') : ''))
const sourceAsset = computed(() => {
  if (!props.node || props.node.sourceId === null) {
    return undefined
  }
  return props.session.images.find((image) => image.id === props.node?.sourceId)?.asset
})
const sourceImageForEditor = computed<NaiImage | null>(() => {
  const asset = sourceAsset.value
  if (asset?.kind !== 'gallery') {
    return null
  }
  return {
    name: asset.name,
    url: canvasImageUrl(asset),
    createdAt: asset.modifiedAt ?? 0,
    width: asset.width,
    height: asset.height,
  }
})

const targetSize = computed(() => card.value && operationSize(card.value, sourceAsset.value))
const tabs = computed<{ id: OperationDialogTab; label: string }[]>(() => {
  if (!props.node || props.node.kind === 'upscale') {
    return []
  }
  return [
    { id: 'prompt', label: '提示词与角色' },
    ...(props.node.kind === 'inpaint' ? [{ id: 'mask' as const, label: '重绘遮罩' }] : []),
    { id: 'params', label: '生图参数' },
    { id: 'references', label: '底图与参考' },
  ]
})

const promptDraft = computed<InpaintDraft>(() => {
  const card = props.node
  if (!card) {
    return { base: '', negative: '', characters: [] }
  }
  return {
    base: card.request.base,
    negative: card.request.negative,
    characters: card.request.characters,
  }
})

const mode = computed(() => {
  if (!card.value || !isGenerateKind(card.value.kind)) {
    return ''
  }
  return sourceAsset.value ? '图生图' : '文生图'
})

const canRun = computed(
  () =>
    card.value &&
    !busy.value &&
    !bindingImage.value &&
    !(card.value.request.version === 'v5' && card.value.request.params.vibeReferences?.length),
)

watch(
  () => [props.node, props.initialTab] as const,
  async ([nextNode, nextTab]) => {
    const dialog = dialogRef.value
    if (!nextNode) {
      if (dialog?.open) {
        dialog.close()
      }
      return
    }
    const validTab = tabs.value.some((tab) => tab.id === nextTab)
      ? nextTab
      : (tabs.value[0]?.id ?? 'prompt')
    activeTab.value = validTab
    await nextTick()
    if (nextNode !== props.node) {
      return
    }
    if (dialogRef.value && !dialogRef.value.open) {
      dialogRef.value.showModal()
    }
  },
  { immediate: true },
)

function updateDraft(patch: Partial<InpaintDraft>) {
  const current = card.value
  if (!current || busy.value) {
    return
  }
  if (patch.base !== undefined) {
    current.request.base = patch.base
  }
  if (patch.negative !== undefined) {
    current.request.negative = patch.negative
  }
  if (patch.characters !== undefined) {
    current.request.characters = patch.characters
  }
}

function updateParams(patch: Partial<CanvasOperation['request']['params']>) {
  const current = card.value
  if (current && !busy.value) {
    Object.assign(current.request.params, patch)
  }
}

const backdrop = backdropCloser(() => emit('close'))

function handleRun() {
  emit('run')
  emit('close')
}
</script>

<template>
  <dialog
    ref="dialogRef"
    class="op-dialog"
    aria-label="编辑盒子配置"
    @cancel.self.prevent="emit('close')"
    @keydown.esc.stop
    @pointerdown="backdrop.onPointerdown"
    @click="backdrop.onClick"
  >
    <div
      v-if="card"
      class="op-dialog-shell"
      @pointerdown.stop
      @wheel.stop
    >
      <header class="op-dialog-header">
        <div class="op-dialog-title-group">
          <span
            class="op-dialog-badge"
            :class="'tone-' + TOOL_TONES[card.kind]"
          >
            <Icon
              :name="TOOL_ICONS[card.kind]"
              :size="16"
            />
          </span>
          <h2>{{ operationLabel(card.kind) }} #{{ card.id }}</h2>
          <span
            v-if="mode"
            class="mode-pill"
            >{{ mode }}</span
          >
          <span class="format-pill"
            >{{ card.request.version.toUpperCase() }} ·
            {{ targetSize ? targetSize.width + '×' + targetSize.height : '待选择底图' }}</span
          >
        </div>

        <button
          class="icon-btn sm op-dialog-close"
          type="button"
          title="关闭 (Esc)"
          aria-label="关闭弹窗"
          @click="emit('close')"
        >
          <Icon
            name="x"
            :size="16"
          />
        </button>
      </header>
      <div
        v-if="tabs.length > 1"
        class="op-dialog-tabs"
        role="tablist"
        aria-label="编辑分页"
      >
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          role="tab"
          :disabled="bindingImage"
          :aria-selected="activeTab === tab.id"
          :class="{ on: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <p
        v-if="errorMessage"
        class="op-dialog-alert"
        role="alert"
      >
        {{ errorMessage }}
      </p>

      <div
        :key="activeTab"
        class="op-dialog-body scroll"
        role="tabpanel"
      >
        <div
          v-if="activeTab === 'prompt'"
          class="op-dialog-prompt"
        >
          <PromptEditor
            :draft="promptDraft"
            show-presets
            :preset-params="card.request.params"
            :model="card.request.version"
            :params="card.request.params"
            :image="sourceImageForEditor"
            :disabled="busy"
            base-hint="支持 / 快捷搜词、自动补全、粘贴元数据自动拆分与片段收藏"
            @change-draft="updateDraft"
            @change-params="updateParams"
          />
        </div>

        <div
          v-else-if="activeTab === 'mask'"
          class="op-dialog-mask"
        >
          <CanvasMask
            v-if="sourceAsset?.kind === 'gallery'"
            :key="card.id + sourceAsset.name"
            v-model:strokes="card.strokes"
            :disabled="busy"
            :source="sourceAsset"
          />
          <p
            v-else
            class="op-dialog-empty"
          >
            请先将一张画布图片连线或绑定为底图，再绘制重绘区域。
          </p>
        </div>

        <CanvasOperationParams
          v-else-if="activeTab === 'params'"
          :card="card"
          :source="sourceAsset"
          :disabled="busy"
          @references="activeTab = 'references'"
        />
        <CanvasOperationReferences
          v-else-if="activeTab === 'references'"
          :key="card.id"
          :card="card"
          :images="session.images"
          :source="sourceImageForEditor"
          :disabled="busy"
          @pending="bindingImage = $event"
          @bind-gallery="emit('bindGallery', $event)"
        />
      </div>

      <footer class="op-dialog-footer">
        <span class="op-dialog-hint">修改会自动同步到画布盒子</span>
        <div class="op-dialog-footer-actions">
          <button
            class="btn small"
            type="button"
            @click="emit('close')"
          >
            完成
          </button>
          <button
            class="btn small accent"
            type="button"
            :disabled="!canRun"
            @click="handleRun"
          >
            <Icon
              :name="TOOL_ICONS[card.kind]"
              :size="14"
            />
            {{ busy ? '执行中…' : '立即执行' }}
          </button>
        </div>
      </footer>
    </div>
  </dialog>
</template>

<style scoped>
.op-dialog {
  align-self: center;
  width: min(680px, calc(100vw - 48px));
  height: auto;
  min-height: min(460px, calc(100vh - 56px));
  max-width: none;
  max-height: min(760px, calc(100vh - 56px));
  padding: 0;
  overflow: visible;
  border: 1px solid var(--line2);
  border-radius: 18px;
  background: var(--bg);
  color: var(--text);
  box-shadow: var(--shadow-modal);
}

.op-dialog::backdrop {
  background: var(--scrim);
  backdrop-filter: blur(3px);
}

.op-dialog-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: inherit;
  max-height: inherit;
  border-radius: inherit;
  overflow: hidden;
}

.op-dialog-header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 14px;
  padding: 12px 14px 12px 18px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--side) 70%, var(--bg));
}

.op-dialog-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.op-dialog-title-group h2 {
  margin: 0;
  font-size: 14.5px;
  font-weight: 650;
}

.op-dialog-badge {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 9px;
}

.op-dialog-badge.tone-pink {
  background: var(--pink-soft);
  color: var(--pink-deep);
}

.op-dialog-badge.tone-blue {
  background: var(--nl-soft);
  color: var(--nl);
}

.op-dialog-badge.tone-amber {
  background: var(--alias-soft);
  color: var(--alias);
}

.op-dialog-badge.tone-green {
  background: var(--ok-soft);
  color: var(--ok);
}

.op-dialog-tabs {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
  padding: 5px 17px;
  border-bottom: 1px solid var(--line);
  background: var(--bg);
}

.op-dialog-close {
  margin-left: auto;
  flex: 0 0 auto;
}

.op-dialog-alert {
  flex: 0 0 auto;
  margin: 12px 18px 0;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--bad-soft);
  color: var(--bad);
  font-size: 12.5px;
}

.op-dialog-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 14px 18px;
  background: var(--panel);
}

.op-dialog:has(> .pos-mask, > .position-compare-mask) .op-dialog-shell {
  interactivity: inert;
}

.op-dialog-tabs button {
  padding: 6px 12px;
  border-radius: 7px;
  font-size: 12px;
  color: var(--text2);
}

.op-dialog-tabs button:hover {
  background: var(--hover);
}

.op-dialog-tabs button.on {
  color: var(--pink-deep);
  background: var(--pink-soft);
  font-weight: 650;
}

.mode-pill,
.format-pill {
  padding: 3px 8px;
  border-radius: 12px;
  background: var(--bg);
  color: var(--text2);
  font-size: 11px;
  white-space: nowrap;
}

.mode-pill {
  background: var(--pink-soft);
  color: var(--pink-deep);
}

.op-dialog-prompt {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.op-dialog-body :deep(.op-card) {
  display: grid;
  gap: 10px;
  margin: 0;
  min-width: 0;
  padding: 13px 15px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--side);
}

.op-dialog-body :deep(.op-card h3) {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  font-size: 13px;
  font-weight: 650;
}

.op-dialog-body :deep(.op-card h3 small) {
  color: var(--muted);
  font-size: 11px;
  font-weight: 450;
}

.op-dialog-body :deep(.source-card) {
  background: var(--bg);
  border-color: var(--pink-line);
}

.op-dialog-body :deep(.op-range) {
  display: grid;
  grid-template-columns: minmax(90px, 112px) minmax(60px, 210px) 48px;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--text2);
}

.op-dialog-body :deep(.op-range input) {
  min-width: 0;
  width: 100%;
}

.op-dialog-body :deep(.op-range output) {
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--pink-soft);
  color: var(--pink-deep);
  font-family: var(--mono);
  text-align: center;
}

.op-dialog-empty {
  margin: 24px 0;
  color: var(--text2);
  font-size: 13px;
  text-align: center;
}

.op-dialog-footer {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 18px;
  border-top: 1px solid var(--line);
  background: color-mix(in srgb, var(--side) 55%, var(--bg));
}

.op-dialog-hint {
  color: var(--muted);
  font-size: 12px;
}

.op-dialog-footer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

@media (width <= 560px) {
  .op-dialog-header,
  .op-dialog-title-group {
    flex-wrap: wrap;
    gap: 5px;
  }

  .op-dialog-tabs {
    padding-inline: 8px;
  }

  .op-dialog-tabs button {
    padding-inline: 7px;
  }
}
</style>
