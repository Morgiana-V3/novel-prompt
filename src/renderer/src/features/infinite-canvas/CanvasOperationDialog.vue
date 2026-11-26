<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { ImageCollection } from '@shared/images/collections'
import type { NaiImage } from '@shared/images/types'
import type { InpaintDraft } from '@shared/prompts/types'
import { cleanErr } from '../../shared/lib/format'
import { vSegIndicator } from '../../shared/lib/seg-indicator'
import Icon from '../../shared/ui/Icon.vue'
import GenerationParameters from '../generation/components/GenerationParameters.vue'
import PreciseReferences from '../generation/components/PreciseReferences.vue'
import VibeReferences from '../generation/components/VibeReferences.vue'
import { PromptEditor } from '../prompts/public/components'
import CanvasMask from './CanvasMask.vue'
import {
  cardErrors,
  isGenerateKind,
  operationLabel,
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
}>()

const dialogRef = ref<HTMLDialogElement | null>(null)
const activeTab = ref<OperationDialogTab>('prompt')
const collections = ref<ImageCollection[]>([])
const collectionsLoaded = ref(false)
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
    url: `np-img://image/${encodeURIComponent(asset.name)}`,
    createdAt: asset.modifiedAt ?? 0,
    width: asset.width,
    height: asset.height,
  }
})

const tabs = computed<{ id: OperationDialogTab; label: string }[]>(() => {
  if (!props.node || props.node.kind === 'upscale') {
    return []
  }
  return [
    { id: 'prompt', label: '提示词与角色' },
    ...(props.node.kind === 'inpaint' ? [{ id: 'mask' as const, label: '重绘遮罩' }] : []),
    { id: 'params', label: '生图参数' },
    { id: 'references', label: '参考与 Vibe' },
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

const showStrengthSlider = computed(() => {
  const card = props.node
  if (!card) {
    return false
  }
  if (card.kind === 'inpaint' || card.kind === 'enhance' || card.kind === 'img2img') {
    return true
  }
  return isGenerateKind(card.kind) && card.sourceId !== null
})

const showNoiseSlider = computed(() => {
  const card = props.node
  if (!card) {
    return false
  }
  if (card.kind === 'enhance' || card.kind === 'img2img') {
    return true
  }
  return isGenerateKind(card.kind) && card.sourceId !== null
})

const canRun = computed(() => {
  const card = props.node
  if (!card || busy.value) {
    return false
  }
  return card.kind === 'generate' || Boolean(sourceAsset.value)
})

async function ensureCollections() {
  if (collectionsLoaded.value) {
    return
  }
  try {
    collections.value = await window.canvasApi.collectionsList()
    collectionsLoaded.value = true
  } catch (reason) {
    if (props.node) {
      cardErrors.set(props.node, cleanErr(reason))
    }
  }
}

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
    if (dialog && !dialog.open) {
      dialog.showModal()
    }
    if (validTab === 'params') {
      void ensureCollections().catch(() => {})
    }
  },
  { immediate: true },
)

watch(activeTab, (tab) => {
  if (tab === 'params') {
    void ensureCollections().catch(() => {})
  }
})

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

function setModelVersion(version: 'v4.5' | 'v5') {
  const current = card.value
  if (current && !busy.value) {
    current.request.version = version
  }
}

function handleBackdropClick(event: MouseEvent) {
  if (event.target === dialogRef.value) {
    emit('close')
  }
}

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
    @cancel.prevent="emit('close')"
    @click="handleBackdropClick"
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
        </div>

        <div
          v-if="tabs.length > 1"
          v-seg-indicator
          class="seg op-dialog-tabs"
          role="tablist"
          aria-label="编辑分页"
        >
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            role="tab"
            :aria-selected="activeTab === tab.id"
            :class="{ on: activeTab === tab.id }"
            @click="activeTab = tab.id"
          >
            {{ tab.label }}
          </button>
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

      <p
        v-if="errorMessage"
        class="op-dialog-alert"
        role="alert"
      >
        {{ errorMessage }}
      </p>

      <div class="op-dialog-body scroll">
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
            v-model:strokes="card.strokes"
            :source="sourceAsset"
          />
          <p
            v-else
            class="op-dialog-empty"
          >
            请先将一张画布图片连线或绑定为底图，再绘制重绘区域。
          </p>
        </div>

        <div
          v-else-if="activeTab === 'params'"
          class="op-dialog-params"
        >
          <div class="op-dialog-row">
            <div class="op-param-group">
              <span class="op-param-label">生成模型</span>
              <div
                v-seg-indicator
                class="seg block"
              >
                <button
                  type="button"
                  :disabled="busy"
                  :class="{ on: card.request.version === 'v4.5' }"
                  @click="setModelVersion('v4.5')"
                >
                  NovelAI V4.5 Full
                </button>
                <button
                  type="button"
                  :disabled="busy"
                  :class="{ on: card.request.version === 'v5' }"
                  @click="setModelVersion('v5')"
                >
                  NovelAI V5
                </button>
              </div>
            </div>

            <label class="op-param-group">
              <span class="op-param-label">结果保存图集</span>
              <select
                v-model="card.request.collectionId"
                class="input sm"
                :disabled="busy"
              >
                <option :value="undefined">默认图集</option>
                <option
                  v-for="collection in collections.filter((item) => item.id !== 'default')"
                  :key="collection.id"
                  :value="collection.id"
                >
                  {{ collection.name }}
                </option>
              </select>
            </label>
          </div>

          <div
            v-if="showStrengthSlider"
            class="op-dialog-row"
          >
            <div class="op-param-group">
              <span class="op-param-label">修改强度 · {{ card.strength.toFixed(2) }}</span>
              <input
                v-model.number="card.strength"
                class="range"
                aria-label="修改强度"
                type="range"
                min="0.01"
                :max="card.kind === 'inpaint' ? 1 : 0.99"
                step="0.01"
                :disabled="busy"
              />
            </div>
            <div
              v-if="showNoiseSlider"
              class="op-param-group"
            >
              <span class="op-param-label">噪声 · {{ card.noise.toFixed(2) }}</span>
              <input
                v-model.number="card.noise"
                class="range"
                aria-label="噪声"
                type="range"
                min="0"
                max="0.99"
                step="0.01"
                :disabled="busy"
              />
            </div>
          </div>

          <GenerationParameters
            :gen="card.request.params"
            :params="card.request.params"
            expanded-sizes
            prompt-presets-in-editor
            :disabled="busy"
            :size-locked="card.kind === 'inpaint'"
            @change-gen="updateParams"
            @change-params="updateParams"
          />
        </div>

        <div
          v-else-if="activeTab === 'references'"
          class="op-dialog-refs"
        >
          <PreciseReferences
            show-heading
            :images="card.request.params.preciseReferences ?? []"
            :model="card.request.version"
            :count="card.request.params.count"
            :current="sourceImageForEditor"
            :conflict="!!card.request.params.vibeReferences?.length"
            :disabled="busy"
            @change="updateParams({ preciseReferences: $event })"
          />
          <div class="op-dialog-vibe-block">
            <h3 class="op-dialog-subhead">Vibe Transfer</h3>
            <VibeReferences
              :entries="card.request.params.vibeReferences ?? []"
              :version="card.request.version"
              :current="sourceImageForEditor"
              :conflict="!!card.request.params.preciseReferences?.length"
              :disabled="busy"
              @change="updateParams({ vibeReferences: $event })"
            />
          </div>
        </div>
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
  width: min(860px, calc(100vw - 48px));
  height: min(740px, calc(100vh - 56px));
  max-width: none;
  max-height: none;
  padding: 0;
  overflow: hidden;
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
  height: 100%;
  min-height: 0;
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
  margin: 0 auto;
}

.op-dialog-close {
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
  flex: 1;
  min-height: 0;
  padding: 18px 20px 24px;
}

.op-dialog-prompt,
.op-dialog-params,
.op-dialog-refs {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.op-dialog-prompt :deep(.field) {
  margin: 0;
}

.op-dialog-mask :deep(.canvas-mask) {
  max-height: 460px;
}

.op-dialog-empty {
  margin: 24px 0;
  color: var(--text2);
  font-size: 13px;
  text-align: center;
}

.op-dialog-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.op-param-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.op-param-label {
  color: var(--text2);
  font-size: 12px;
  font-weight: 550;
}

.op-dialog-vibe-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.op-dialog-subhead {
  margin: 0;
  color: var(--text2);
  font-size: 12.5px;
  font-weight: 650;
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

@media (width <= 680px) {
  .op-dialog-row {
    grid-template-columns: 1fr;
  }
}
</style>
