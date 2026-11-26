<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  hasOutfitPreference,
  REFERENCE_LABELS,
  referenceModes,
  type PreciseReference,
} from '@shared/generation/references'
import { cleanErr } from '../../shared/lib/format'
import { vSegIndicator } from '../../shared/lib/seg-indicator'
import Icon from '../../shared/ui/Icon.vue'
import {
  connectImageToOperation,
  disconnectImageFromOperation,
  isGenerateKind,
  operationLabel,
  referenceAliases,
  resolvedReferenceName,
  type CanvasWireRole,
} from './operations'
import type { CanvasImage, CanvasOperation } from './session'

export interface ActiveWireEditor {
  imageId: number
  operationId: number
  role: CanvasWireRole
  x: number
  y: number
}

const props = defineProps<{
  editor: ActiveWireEditor
  image: CanvasImage
  node: CanvasOperation
  viewportWidth: number
  viewportHeight: number
}>()

const emit = defineEmits<{
  'update:role': [role: CanvasWireRole]
  close: []
}>()

const card = computed(() => props.node)
const feedback = ref('')
const error = ref('')

const isGenerateTarget = computed(() => isGenerateKind(card.value.kind))
const modes = computed(() => referenceModes(card.value.request.version))
const isV5 = computed(() => card.value.request.version === 'v5')

const preciseEntry = computed(() => {
  const asset = props.image.asset
  if (asset.kind !== 'gallery') {
    return undefined
  }
  const alias = resolvedReferenceName(asset.name)
  return (card.value.request.params.preciseReferences ?? []).find(
    (entry) => entry.imageName === asset.name || entry.imageName === alias,
  )
})

const vibeEntry = computed(() => {
  const asset = props.image.asset
  if (asset.kind !== 'gallery') {
    return undefined
  }
  const alias = resolvedReferenceName(asset.name)
  return (card.value.request.params.vibeReferences ?? []).find(
    (entry) => entry.imageName === alias || entry.imageName === asset.name,
  )
})

const popoverStyle = computed(() => {
  const width = 316
  const left = Math.max(16, Math.min(props.editor.x - width / 2, props.viewportWidth - width - 16))
  const top = Math.max(54, Math.min(props.editor.y + 14, props.viewportHeight - 310))
  return {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${width}px`,
  }
})

async function switchRole(nextRole: CanvasWireRole) {
  if (nextRole === props.editor.role) {
    return
  }
  feedback.value = ''
  error.value = ''
  let overrideImageName: string | undefined
  if (nextRole === 'vibe') {
    const asset = props.image.asset
    if (asset.kind !== 'gallery') {
      error.value = '仅支持已入库图片用于 Vibe Transfer'
      return
    }
    try {
      const refName = await window.canvasApi.naiImportReference(asset.name)
      referenceAliases.set(asset.name, refName)
      overrideImageName = refName
    } catch (reason) {
      error.value = cleanErr(reason)
      return
    }
  }
  disconnectImageFromOperation(card.value, props.image, props.editor.role)
  connectImageToOperation(card.value, props.image, nextRole, overrideImageName)
  emit('update:role', nextRole)
}

function setPreciseMode(mode: PreciseReference['mode']) {
  const entry = preciseEntry.value
  if (!entry) {
    return
  }
  entry.mode = mode
  if (isV5.value) {
    entry.preferSameOutfit = hasOutfitPreference(mode) ? mode === 'character&style' : undefined
  }
}

async function loadSourceRecipe() {
  const asset = props.image.asset
  if (asset.kind !== 'gallery') {
    return
  }
  error.value = ''
  feedback.value = ''
  try {
    const recipe = await window.canvasApi.naiRecipe(asset.name)
    if (!recipe) {
      throw new Error('该图片没有生成记录')
    }
    card.value.request = recipe.request
    feedback.value = '已载入该图片的生图配置'
  } catch (reason) {
    error.value = cleanErr(reason)
  }
}

function disconnect() {
  disconnectImageFromOperation(card.value, props.image, props.editor.role)
  emit('close')
}
</script>

<template>
  <section
    class="wire-popover"
    :style="popoverStyle"
    aria-label="连线配置"
    @pointerdown.stop
    @wheel.stop
    @keydown.stop
    @keydown.esc.stop.prevent="emit('close')"
  >
    <header class="wire-head">
      <Icon
        name="link"
        :size="14"
      />
      <h3>图片 #{{ image.id }} → {{ operationLabel(card.kind) }} #{{ card.id }}</h3>
      <button
        class="icon-btn sm"
        type="button"
        aria-label="关闭连线配置"
        @click="emit('close')"
      >
        <Icon
          name="x"
          :size="14"
        />
      </button>
    </header>

    <div class="wire-body">
      <div
        v-if="isGenerateTarget"
        class="wire-field"
      >
        <span class="wire-label">连线用途</span>
        <div
          v-seg-indicator
          class="seg block wire-role-seg"
          role="group"
          aria-label="连线用途"
        >
          <button
            type="button"
            :class="{ on: editor.role === 'img2img' }"
            @click="switchRole('img2img')"
          >
            图生图
          </button>
          <button
            type="button"
            :class="{ on: editor.role === 'precise' }"
            @click="switchRole('precise')"
          >
            精确参考
          </button>
          <button
            v-if="!isV5"
            type="button"
            :class="{ on: editor.role === 'vibe' }"
            @click="switchRole('vibe')"
          >
            Vibe
          </button>
        </div>
      </div>

      <template v-if="editor.role === 'img2img' || editor.role === 'source'">
        <div
          v-if="card.kind !== 'upscale' && card.kind !== 'outpaint'"
          class="wire-range"
        >
          <div class="wire-range-head">
            <span class="wire-label">修改强度</span>
            <span class="wire-val">{{ card.strength.toFixed(2) }}</span>
          </div>
          <input
            v-model.number="card.strength"
            class="range"
            aria-label="修改强度"
            type="range"
            min="0.01"
            :max="card.kind === 'inpaint' ? 1 : 0.99"
            step="0.01"
          />
        </div>
        <div
          v-if="editor.role === 'img2img' || card.kind === 'enhance'"
          class="wire-range"
        >
          <div class="wire-range-head">
            <span class="wire-label">噪声</span>
            <span class="wire-val">{{ card.noise.toFixed(2) }}</span>
          </div>
          <input
            v-model.number="card.noise"
            class="range"
            aria-label="噪声"
            type="range"
            min="0"
            max="0.99"
            step="0.01"
          />
        </div>
        <button
          v-if="card.kind !== 'upscale'"
          class="btn small wire-recipe-btn"
          type="button"
          @click="loadSourceRecipe"
        >
          <Icon
            name="import"
            :size="13"
          />
          载入该图片的生图配置
        </button>
      </template>

      <template v-else-if="editor.role === 'precise' && preciseEntry">
        <div class="wire-field">
          <span class="wire-label">参考类型</span>
          <div class="wire-chips">
            <button
              v-for="mode in modes"
              :key="mode"
              class="chip"
              :class="{ on: preciseEntry.mode === mode }"
              type="button"
              @click="setPreciseMode(mode)"
            >
              {{ REFERENCE_LABELS[mode] }}
            </button>
          </div>
        </div>
        <div class="wire-range">
          <div class="wire-range-head">
            <span class="wire-label">参考强度</span>
            <span class="wire-val">{{ preciseEntry.strength.toFixed(2) }}</span>
          </div>
          <input
            v-model.number="preciseEntry.strength"
            class="range"
            aria-label="参考强度"
            type="range"
            min="0"
            :max="isV5 ? 5 : 1"
            step="0.05"
          />
        </div>
        <div
          v-if="!isV5"
          class="wire-range"
        >
          <div class="wire-range-head">
            <span class="wire-label">还原度</span>
            <span class="wire-val">{{ (preciseEntry.fidelity ?? 0.8).toFixed(2) }}</span>
          </div>
          <input
            v-model.number="preciseEntry.fidelity"
            class="range"
            aria-label="还原度"
            type="range"
            min="0"
            max="1"
            step="0.05"
          />
        </div>
        <label
          v-if="isV5 && hasOutfitPreference(preciseEntry.mode)"
          class="wire-check"
        >
          <input
            v-model="preciseEntry.preferSameOutfit"
            type="checkbox"
          />
          <span>尽量保持相同服装</span>
        </label>
      </template>

      <template v-else-if="editor.role === 'vibe' && vibeEntry">
        <div class="wire-range">
          <div class="wire-range-head">
            <span class="wire-label">Vibe 强度</span>
            <span class="wire-val">{{ vibeEntry.strength.toFixed(2) }}</span>
          </div>
          <input
            v-model.number="vibeEntry.strength"
            class="range"
            aria-label="Vibe 强度"
            type="range"
            min="0"
            max="1"
            step="0.02"
          />
        </div>
        <div class="wire-range">
          <div class="wire-range-head">
            <span class="wire-label">信息提取量</span>
            <span class="wire-val">{{ vibeEntry.information.toFixed(2) }}</span>
          </div>
          <input
            v-model.number="vibeEntry.information"
            class="range"
            aria-label="信息提取量"
            type="range"
            min="0"
            max="1"
            step="0.02"
          />
        </div>
      </template>

      <p
        v-if="error"
        class="wire-msg is-error"
        role="alert"
      >
        {{ error }}
      </p>
      <p
        v-else-if="feedback"
        class="wire-msg is-ok"
      >
        {{ feedback }}
      </p>
    </div>

    <footer class="wire-footer">
      <button
        class="btn small ghost wire-disconnect"
        type="button"
        @click="disconnect"
      >
        <Icon
          name="trash"
          :size="13"
        />
        断开连线
      </button>
      <button
        class="btn small primary"
        type="button"
        @click="emit('close')"
      >
        完成
      </button>
    </footer>
  </section>
</template>

<style scoped>
.wire-popover {
  position: absolute;
  z-index: 9;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--line2);
  border-radius: 14px;
  background: color-mix(in srgb, var(--bg) 96%, transparent);
  color: var(--text);
  box-shadow: var(--shadow-pop);
  backdrop-filter: blur(14px);
  pointer-events: auto;
}

.wire-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 10px 9px 13px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--side) 75%, var(--bg));
}

.wire-head .icon {
  color: var(--pink-deep);
}

.wire-head h3 {
  margin: 0;
  margin-right: auto;
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wire-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

.wire-field {
  display: grid;
  gap: 6px;
}

.wire-label {
  color: var(--text2);
  font-size: 11.5px;
  font-weight: 550;
}

.wire-role-seg button {
  padding: 3px 8px;
  font-size: 12px;
}

.wire-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.wire-chips .chip {
  height: 25px;
  padding: 0 9px;
  font-size: 11.5px;
}

.wire-range {
  display: grid;
  gap: 2px;
}

.wire-range-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.wire-val {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--panel);
  color: var(--text);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.wire-check {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--text2);
  font-size: 12px;
  cursor: pointer;
}

.wire-recipe-btn {
  align-self: flex-start;
}

.wire-msg {
  margin: 0;
  font-size: 11.5px;
}

.wire-msg.is-error {
  color: var(--bad);
}

.wire-msg.is-ok {
  color: var(--ok);
}

.wire-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 11px;
  border-top: 1px solid var(--line);
  background: color-mix(in srgb, var(--side) 55%, var(--bg));
}

.wire-disconnect:hover {
  background: var(--bad-soft);
  color: var(--bad);
}
</style>
