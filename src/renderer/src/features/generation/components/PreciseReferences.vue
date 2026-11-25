<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { NaiImage } from '@shared/images/types'
import type { NaiVersion } from '@shared/generation/types'
import {
  MAX_REFERENCES,
  REFERENCE_FEE,
  REFERENCE_LABELS,
  referenceModes,
  hasOutfitPreference,
  validReferences,
  type PreciseReference,
} from '@shared/generation/references'
import ReferenceGalleryDialog from './ReferenceGalleryDialog.vue'
import Icon from '../../../shared/ui/Icon.vue'
import ThemeSelect from '../../../shared/ui/ThemeSelect.vue'
import { cleanErr } from '../../../shared/lib/format'
import { detachLeaving } from '../../../shared/lib/list-motion'
import { vFadeImg } from '../../../shared/lib/fade-image'

const props = defineProps<{
  images: PreciseReference[]
  model: NaiVersion
  disabled?: boolean
  current?: NaiImage | null
  count: number
  showHeading?: boolean
  conflict?: boolean
}>()
const emit = defineEmits<{
  change: [images: PreciseReference[]]
}>()
const levelHints = {
  strength: '调高会突出所选的参考特征，调低让角色或画风有更多变化。',
  fidelity: '调高会更严格地还原参考细节，调低更容易用提示词改变这些细节。',
}
const outfitHint = '开启后优先沿用参考图的服装，关闭后更容易更换造型。'
const modeOptions = computed(() =>
  referenceModes(props.model).map((value) => ({ value, label: REFERENCE_LABELS[value] })),
)
const levels = computed(() =>
  props.model === 'v5' ? (['strength'] as const) : (['strength', 'fidelity'] as const),
)
function maximum(field: 'strength' | 'fidelity') {
  return field === 'strength' && props.model === 'v5' ? 5 : 1
}
function setMode(index: number, mode: PreciseReference['mode']) {
  update(index, { mode, preferSameOutfit: undefined })
}
function adaptToV45(index: number) {
  const image = props.images[index]
  update(index, {
    mode: image.mode === 'costume' ? 'character' : image.mode,
    strength: Math.min(image.strength, 1),
    fidelity: image.fidelity ?? 1,
    preferSameOutfit: undefined,
  })
}
const fileInput = ref<HTMLInputElement>()
const galleryOpen = ref(false)
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
  () => props.images.length < MAX_REFERENCES && !props.conflict && !props.disabled && !busy.value,
)
function showGallery() {
  error.value = ''
  galleryOpen.value = true
}
async function add(source: File | string) {
  if (!canAdd.value) {
    return
  }
  const model = props.model
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
      props.model !== model ||
      props.conflict ||
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
    aria-label="精确参考"
  >
    <input
      ref="fileInput"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      hidden
      @change="pickFile"
    />
    <header v-if="showHeading">
      <Icon
        name="layers"
        :size="15"
      />
      <strong>精确参考</strong>
      <span
        v-if="!images.length"
        class="reference-fee"
        >每张参考、每张输出 +{{ REFERENCE_FEE }} Anlas</span
      >
    </header>
    <p
      v-if="conflict"
      class="reference-callout"
    >
      <Icon
        name="info"
        :size="14"
      />
      <span>当前已启用 Vibe Transfer，请先移除 Vibe 再添加精确参考。</span>
    </p>
    <div class="reference-actions">
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
      <span
        v-if="images.length"
        class="reference-fee"
        :title="`${images.length} 张参考图 × ${count} 张输出 × ${REFERENCE_FEE} Anlas`"
        >参考费 +{{ images.length * REFERENCE_FEE * count }} Anlas</span
      >
      <small v-if="images.length >= MAX_REFERENCES"
        >已达到本应用每次 {{ MAX_REFERENCES }} 张的上限</small
      >
    </div>
    <ReferenceGalleryDialog
      v-if="galleryOpen"
      :busy="busy"
      :disabled="!canAdd"
      :error="error"
      @select="add($event.name)"
      @close="galleryOpen = false"
    />
    <TransitionGroup
      v-if="images.length"
      tag="div"
      name="list"
      class="reference-grid list-motion"
      @before-leave="detachLeaving"
    >
      <article
        v-for="(image, index) in images"
        :key="image.imageName"
        class="reference-card"
      >
        <img
          v-fade-img
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
            @update:model-value="setMode(index, $event)"
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
            v-for="field in levels"
            :key="field"
          >
            <span :title="levelHints[field]">{{ field === 'strength' ? '强度' : '还原度' }}</span>
            <input
              type="range"
              :title="levelHints[field]"
              :aria-label="'参考图 ' + (index + 1) + (field === 'strength' ? '强度' : '还原度')"
              min="0"
              :max="maximum(field)"
              step="0.05"
              :value="image[field] ?? 1"
              :disabled="disabled"
              :style="{
                '--progress': Math.min((image[field] ?? 1) / maximum(field), 1) * 100 + '%',
              }"
              @input="update(index, { [field]: Number(($event.target as HTMLInputElement).value) })"
            />
            <output :title="levelHints[field]">{{ (image[field] ?? 1).toFixed(2) }}</output>
          </label>
          <label
            v-if="model === 'v5' && hasOutfitPreference(image.mode)"
            class="outfit-preference"
          >
            <input
              type="checkbox"
              :title="outfitHint"
              :checked="image.preferSameOutfit ?? image.mode === 'character&style'"
              :disabled="disabled"
              @change="
                update(index, { preferSameOutfit: ($event.target as HTMLInputElement).checked })
              "
            />
            <span :title="outfitHint">偏好相同服装</span>
          </label>
          <button
            v-if="model === 'v4.5' && !validReferences([image], model)"
            class="btn small"
            :disabled="disabled"
            @click="adaptToV45(index)"
          >
            适配 V4.5 参数{{ image.mode === 'costume' ? '（改为角色）' : '' }}
          </button>
        </div>
      </article>
    </TransitionGroup>
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
  padding: 4px 0 2px;
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

.reference-fee {
  margin-inline-start: auto;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
  font-size: 11px;
  font-weight: 400;
}

.reference-actions button {
  height: 28px;
  line-height: 18px;
  gap: 6px;
  border-radius: 8px;
  padding: 0 10px;
  font-size: 12px;
}

.reference-callout {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  margin: 0;
  padding: 8px 11px;
  border: 1px solid color-mix(in srgb, var(--alias) 22%, var(--line));
  border-radius: 10px;
  background: var(--alias-soft);
  color: var(--alias);
  font-size: 12px;
  line-height: 1.45;
  animation: fade-in var(--dur-base) var(--ease-out);
}

.reference-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 236px), 1fr));
  gap: 8px;
}

.reference-card {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  grid-template-rows: auto 1fr;
  gap: 6px 10px;
  padding: 9px;
  background: var(--panel);
  border: 1px solid var(--line2);
  border-radius: 12px;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-base) var(--ease-out);
}

.reference-card:hover {
  border-color: var(--pink-line);
  background: var(--bg);
}

.reference-preview {
  grid-row: span 2;
  width: 64px;
  height: 80px;
  align-self: center;
  object-fit: contain;
  background: var(--hover);
  border-radius: 8px;
  border: 1px solid var(--line);
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
  border-radius: 7px;
  color: var(--muted);
  flex-shrink: 0;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    transform var(--dur-slow) var(--bounce);
}

.reference-remove:hover:not(:disabled) {
  background: var(--bad-soft);
  color: var(--bad);
}

.reference-remove:active:not(:disabled) {
  transform: scale(var(--press-sm));
}

.reference-levels {
  display: grid;
  align-content: center;
  gap: 2px;
}

.reference-levels label {
  display: grid;
  grid-template-columns: 4em minmax(24px, 1fr) 2.8em;
  align-items: center;
  gap: 6px;
  color: var(--text2);
  font-size: 11px;
}

.reference-levels .outfit-preference {
  display: flex;
  gap: 5px;
  cursor: pointer;
}

.outfit-preference input {
  margin: 0;
  accent-color: var(--pink);
}

.reference-levels label > span {
  justify-self: start;
}

.reference-levels output {
  justify-self: end;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.reference-levels input[type='range'] {
  appearance: none;
  width: 100%;
  min-width: 0;
  height: 18px;
  cursor: pointer;
  background: transparent;
}

.reference-levels input[type='range']::-webkit-slider-runnable-track {
  height: 3.5px;
  border-radius: 999px;
  background: linear-gradient(to right, var(--pink) var(--progress), var(--line2) var(--progress));
}

.reference-levels input[type='range']::-webkit-slider-thumb {
  appearance: none;
  width: 11px;
  height: 11px;
  margin-top: -3.75px;
  background: var(--pink);
  border: 1.5px solid #fff;
  box-shadow: 0 1px 3px rgb(20 20 30 / 22%);
  border-radius: 50%;
  transition: transform var(--dur-fast) var(--ease-out);
}

.reference-levels input[type='range']:hover:not(:disabled)::-webkit-slider-thumb {
  transform: scale(1.18);
}

.reference-levels input[type='range']:active:not(:disabled)::-webkit-slider-thumb {
  transform: scale(0.95);
}

.reference-editor [role='status'] {
  color: var(--text2);
  font-size: 11.5px;
  animation: fade-in var(--dur-base) var(--ease-out);
}

.reference-editor [role='alert'] {
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--bad-soft);
  color: var(--bad);
  font-size: 11.5px;
  animation: alert-in var(--dur-slow) var(--ease-out);
}
</style>
