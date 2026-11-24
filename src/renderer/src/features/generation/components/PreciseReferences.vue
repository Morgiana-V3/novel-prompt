<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { NaiImage } from '@shared/images/types'
import type { NaiVersion } from '@shared/generation/types'
import {
  MAX_REFERENCES,
  REFERENCE_FEE,
  REFERENCE_LABELS,
  REFERENCE_MODES,
  type PreciseReference,
} from '@shared/generation/references'
import ReferenceGalleryDialog from './ReferenceGalleryDialog.vue'
import Icon from '../../../shared/ui/Icon.vue'
import ThemeSelect from '../../../shared/ui/ThemeSelect.vue'
import { cleanErr } from '../../../shared/lib/format'

const props = defineProps<{
  images: PreciseReference[]
  model: NaiVersion
  disabled?: boolean
  current?: NaiImage | null
  canSwitch?: boolean
  canChooseBase?: boolean
}>()
const emit = defineEmits<{
  change: [images: PreciseReference[]]
  switchModel: []
  useBase: [image: NaiImage]
}>()
const modeOptions = REFERENCE_MODES.map((value) => ({ value, label: REFERENCE_LABELS[value] }))
const fileInput = ref<HTMLInputElement>()
const galleryOpen = ref(false)
const usesBaseImage = computed(() => props.model === 'v5')
watch(
  () => props.model,
  () => {
    galleryOpen.value = false
  },
)
const busy = ref(false)
const error = ref('')
let mounted = true
onBeforeUnmount(() => {
  mounted = false
})
const canAdd = computed(
  () =>
    props.model === 'v4.5' &&
    props.images.length < MAX_REFERENCES &&
    !props.disabled &&
    !busy.value,
)
function showGallery() {
  error.value = ''
  galleryOpen.value = true
}
function useBase(image: NaiImage) {
  galleryOpen.value = false
  emit('useBase', image)
}
async function selectFromGallery(image: NaiImage) {
  if (usesBaseImage.value) {
    useBase(image)
  } else {
    await add(image.name)
  }
}
async function add(source: File | string) {
  if (!canAdd.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    if (typeof source !== 'string' && source.size > 40 * 1024 * 1024) {
      throw new Error('参考图不能超过 40 MB')
    }
    const imageName = await window.api.naiImportReference(
      typeof source === 'string' ? source : new Uint8Array(await source.arrayBuffer()),
    )
    if (
      !mounted ||
      props.disabled ||
      props.model !== 'v4.5' ||
      props.images.length >= MAX_REFERENCES
    ) {
      return
    }
    if (props.images.some((image) => image.imageName === imageName)) {
      throw new Error('这张参考图已添加，可在下方调整用途')
    }
    const mode = props.images.some((image) => image.mode === 'character') ? 'style' : 'character'
    emit('change', [...props.images, { imageName, mode, strength: 1, fidelity: 1 }])
    galleryOpen.value = false
  } catch (cause) {
    error.value = cleanErr(cause)
  } finally {
    busy.value = false
  }
}
async function pickFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) {
    await add(file)
  }
}
function update(index: number, patch: Partial<PreciseReference>) {
  emit(
    'change',
    props.images.map((image, i) => (i === index ? { ...image, ...patch } : image)),
  )
}
</script>
<template>
  <section
    class="reference-editor"
    aria-label="图片参考"
  >
    <template v-if="usesBaseImage">
      <header>
        <Icon
          name="image"
          :size="15"
        />
        <strong>图生图</strong><span>V5 Full 可用</span>
      </header>
      <p
        v-if="canChooseBase"
        class="reference-note"
      >
        以一张图片为底图，按提示词改画。有生成记录的底图会沿用原模型。
      </p>
      <p
        v-else
        class="reference-note"
      >
        有底图时，可在画布工具栏通过「增强」使用图生图。
      </p>
      <div
        v-if="canChooseBase"
        class="reference-actions"
      >
        <button
          v-if="current && !current.missing"
          class="btn small"
          :disabled="disabled"
          @click="useBase(current)"
        >
          <Icon
            name="image"
            :size="14"
          />用当前图改画
        </button>
        <button
          class="btn small"
          :disabled="disabled"
          aria-haspopup="dialog"
          :aria-expanded="galleryOpen"
          @click="showGallery"
        >
          <Icon
            name="folder"
            :size="14"
          />从图库选底图
        </button>
      </div>
      <div class="reference-legacy">
        <span>角色与画风精确参考适用 V4.5 Full</span>
        <button
          v-if="canSwitch"
          class="btn ghost small"
          :disabled="disabled"
          @click="emit('switchModel')"
        >
          切到 V4.5
        </button>
      </div>
    </template>
    <header v-else>
      <Icon
        name="layers"
        :size="15"
      />
      <strong>角色与画风参考</strong><span>每张参考 · 每张输出 +{{ REFERENCE_FEE }} Anlas</span>
    </header>
    <div
      v-if="model === 'v4.5'"
      class="reference-actions"
    >
      <button
        class="btn small"
        :disabled="!canAdd"
        @click="fileInput?.click()"
      >
        <Icon
          name="upload"
          :size="14"
        />
        上传图片
      </button>
      <input
        ref="fileInput"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        @change="pickFile"
      />
      <button
        class="btn small"
        :disabled="!canAdd"
        aria-haspopup="dialog"
        :aria-expanded="galleryOpen"
        @click="showGallery"
      >
        <Icon
          name="folder"
          :size="14"
        />
        从图库选
      </button>
      <button
        v-if="current"
        class="btn small"
        :disabled="!canAdd"
        @click="add(current.name)"
      >
        <Icon
          name="image"
          :size="14"
        />
        用当前图片
      </button>
    </div>
    <ReferenceGalleryDialog
      v-if="galleryOpen"
      :busy="busy"
      :disabled="usesBaseImage ? !!disabled : !canAdd"
      :error="error"
      :base-image="usesBaseImage"
      @select="selectFromGallery"
      @close="galleryOpen = false"
    />
    <div
      v-if="images.length"
      class="reference-grid"
    >
      <article
        v-for="(image, index) in images"
        :key="image.imageName"
        class="reference-card"
      >
        <img
          class="reference-preview"
          :src="'np-img://img/' + encodeURIComponent(image.imageName)"
          :alt="REFERENCE_LABELS[image.mode] + '参考图'"
        />
        <div class="reference-role">
          <ThemeSelect
            compact
            :model-value="image.mode"
            :options="modeOptions"
            :disabled="disabled"
            :aria-label="'参考图 ' + (index + 1) + ' 用途'"
            @update:model-value="update(index, { mode: $event })"
          />
          <button
            class="reference-remove"
            title="移除参考图"
            :aria-label="'移除第 ' + (index + 1) + ' 张参考图'"
            :disabled="disabled"
            @click="
              emit(
                'change',
                images.filter((_, i) => i !== index),
              )
            "
          >
            <Icon
              name="x"
              :size="14"
            />
          </button>
        </div>
        <div class="reference-levels">
          <label
            v-for="field in ['strength', 'fidelity'] as const"
            :key="field"
          >
            <span>{{ field === 'strength' ? '强度' : '还原度' }}</span>
            <input
              type="range"
              :aria-label="'参考图 ' + (index + 1) + (field === 'strength' ? '强度' : '还原度')"
              min="0"
              max="1"
              step="0.05"
              :value="image[field]"
              :disabled="disabled"
              :style="{ '--progress': image[field] * 100 + '%' }"
              @input="update(index, { [field]: Number(($event.target as HTMLInputElement).value) })"
            />
            <output>{{ image[field].toFixed(2) }}</output>
          </label>
        </div>
      </article>
    </div>
    <span
      v-if="busy"
      role="status"
      >正在载入参考图…</span
    ><span
      v-if="error && !galleryOpen"
      role="alert"
      >{{ error }}</span
    >
  </section>
</template>
<style scoped>
.reference-editor {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 10px 0;
}

.reference-editor header,
.reference-actions,
.reference-actions button,
.reference-role {
  display: flex;
  align-items: center;
  gap: 7px;
}

.reference-editor header,
.reference-actions {
  flex-wrap: wrap;
}

.reference-editor header {
  font-size: 13px;
  color: var(--text);
}

.reference-editor header .icon {
  color: var(--pink-deep);
}

.reference-editor header span {
  color: var(--muted);
  font-size: 10px;
  font-weight: 400;
}

.reference-actions button {
  min-height: 28px;
  border-radius: 8px;
  padding: 3px 9px;
}

.reference-note {
  margin: 0;
  color: var(--text2);
  font-size: 12px;
  line-height: 1.5;
}

.reference-legacy {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding-top: 7px;
  border-top: 1px solid var(--line);
  color: var(--text2);
  font-size: 11px;
}

.reference-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr));
  gap: 8px;
}

.reference-card {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  grid-template-rows: auto 1fr;
  gap: 5px 10px;
  padding: 9px;
  background: var(--bg);
  border: 1px solid var(--line2);
  border-radius: 12px;
}

.reference-preview {
  grid-row: span 2;
  width: 64px;
  height: 80px;
  align-self: center;
  object-fit: contain;
  background: var(--panel);
  border-radius: 7px;
}

.reference-role {
  justify-content: space-between;
  gap: 4px;
  min-width: 0;
}

.reference-remove {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--muted);
  flex-shrink: 0;
}

.reference-remove:hover {
  background: var(--bad-soft);
  color: var(--bad);
}

.reference-levels {
  display: grid;
  align-content: center;
  gap: 1px;
}

.reference-levels label {
  display: grid;
  grid-template-columns: 3em minmax(22px, 1fr) 3em;
  align-items: center;
  gap: 5px;
  color: var(--text2);
  font-size: 10px;
}

.reference-levels output {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.reference-levels input {
  appearance: none;
  width: 100%;
  min-width: 0;
  height: 18px;
  cursor: pointer;
  background: transparent;
}

.reference-levels input::-webkit-slider-runnable-track {
  height: 3px;
  border-radius: 4px;
  background: linear-gradient(to right, var(--pink) var(--progress), var(--line2) var(--progress));
}

.reference-levels input::-webkit-slider-thumb {
  appearance: none;
  width: 10px;
  height: 10px;
  margin-top: -3.5px;
  background: var(--pink);
  border-radius: 50%;
}

.reference-editor [role='alert'] {
  color: var(--bad);
  font-size: 11px;
}
</style>
