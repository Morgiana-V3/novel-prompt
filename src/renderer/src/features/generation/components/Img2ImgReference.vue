<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Img2ImgBase } from '@shared/generation/types'
import type { NaiImage } from '@shared/images/types'
import { cleanErr } from '../../../shared/lib/format'
import { vFadeImg } from '../../../shared/lib/fade-image'
import Icon from '../../../shared/ui/Icon.vue'
import ReferenceGalleryDialog from './ReferenceGalleryDialog.vue'

const props = defineProps<{
  entry: Img2ImgBase | null
  width: number
  height: number
  current?: NaiImage | null
  disabled?: boolean
}>()
const emit = defineEmits<{
  change: [entry: Img2ImgBase | null]
  matchSize: [size: { width: number; height: number }]
}>()

const strengthHint = '调低更接近底图，调高让提示词更容易改变画面。'
const noiseHint = '调高会增加随机细节，过高易出现杂纹。调至 0 仍可重绘。'

const fileInput = ref<HTMLInputElement>()
const galleryOpen = ref(false)
const busy = ref(false)
const error = ref('')
const naturalSize = ref<{ width: number; height: number } | null>(null)
let mounted = true
onBeforeUnmount(() => {
  mounted = false
})

watch(
  () => props.entry?.imageName,
  () => {
    naturalSize.value = null
  },
)

/** 按底图比例计算最接近的 64 像素倍数画幅（总像素不超过 1024×1024 免费上限） */
const suggestedSize = computed(() => {
  const size = naturalSize.value
  if (!size || !size.width || !size.height) {
    return null
  }
  const maxPixels = 1024 * 1024
  const scale = Math.min(1, Math.sqrt(maxPixels / (size.width * size.height)))
  const round64 = (value: number) => Math.max(64, Math.round((value * scale) / 64) * 64)
  let width = round64(size.width)
  let height = round64(size.height)
  while (width * height > maxPixels && (width > 64 || height > 64)) {
    if (width >= height && width > 64) {
      width -= 64
    } else if (height > 64) {
      height -= 64
    }
  }
  return { width, height }
})

const canMatchSize = computed(
  () =>
    !!suggestedSize.value &&
    (suggestedSize.value.width !== props.width || suggestedSize.value.height !== props.height),
)

const highNoise = computed(() => !!props.entry && props.entry.noise > props.entry.strength)

async function setBase(source: File | string) {
  if (props.disabled || busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    if (source instanceof File && source.size > 40 * 1024 * 1024) {
      throw new Error('底图不能超过 40 MB')
    }
    const imageName = await window.api.naiImportReference(
      typeof source === 'string' ? source : new Uint8Array(await source.arrayBuffer()),
    )
    if (!mounted || props.disabled) {
      return
    }
    emit('change', {
      imageName,
      strength: props.entry?.strength ?? 0.7,
      noise: props.entry?.noise ?? 0.2,
    })
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
    await setBase(file)
  }
}

function update(patch: Partial<Img2ImgBase>) {
  if (!props.entry) {
    return
  }
  emit('change', { ...props.entry, ...patch })
}

function onPreviewLoad(event: Event) {
  const img = event.target as HTMLImageElement
  if (img.naturalWidth && img.naturalHeight) {
    naturalSize.value = { width: img.naturalWidth, height: img.naturalHeight }
  }
}
</script>

<template>
  <section
    class="img2img-editor"
    aria-label="图生图底图"
  >
    <input
      ref="fileInput"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      hidden
      @change="pickFile"
    />
    <div class="img2img-actions">
      <button
        class="btn small"
        :title="entry ? '替换底图，沿用当前强度和噪声。' : '选择一张本地图片作为重绘底图。'"
        :disabled="disabled || busy"
        @click="fileInput?.click()"
      >
        <Icon
          name="upload"
          :size="14"
        />
        {{ entry ? '更换底图' : '上传底图' }}
      </button>
      <button
        class="btn small"
        :title="entry ? '用图库中的图片替换底图。' : '从图库选择一张重绘底图。'"
        :disabled="disabled || busy"
        aria-haspopup="dialog"
        :aria-expanded="galleryOpen"
        @click="galleryOpen = true"
      >
        <Icon
          name="folder"
          :size="14"
        />
        从图库选
      </button>
      <button
        v-if="current && !current.missing"
        class="btn small"
        title="将当前预览图用作下一次重绘的底图。"
        :disabled="disabled || busy"
        @click="setBase(current.name)"
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
      :disabled="!!disabled || busy"
      :error="error"
      base-image
      @select="setBase($event.name)"
      @close="galleryOpen = false"
    />

    <Transition name="fade">
      <article
        v-if="entry"
        class="img2img-card"
      >
        <img
          v-fade-img
          class="img2img-preview"
          :src="'np-img://img/' + encodeURIComponent(entry.imageName)"
          alt="图生图底图"
          @load="onPreviewLoad"
        />
        <div class="img2img-card-head">
          <span
            v-if="naturalSize"
            class="pill"
            title="底图的原始宽度和高度，单位为像素。"
            >{{ naturalSize.width }} × {{ naturalSize.height }}</span
          >
          <button
            v-if="canMatchSize && suggestedSize"
            class="btn ghost small img2img-match"
            :disabled="disabled"
            title="按底图比例调整输出尺寸，减少拉伸。"
            @click="emit('matchSize', suggestedSize)"
          >
            匹配画幅 {{ suggestedSize.width }}×{{ suggestedSize.height }}
          </button>
          <button
            class="img2img-remove"
            title="清除底图，恢复文生图。"
            aria-label="移除图生图底图"
            :disabled="disabled || busy"
            @click="emit('change', null)"
          >
            <Icon
              name="x"
              :size="14"
            />
          </button>
        </div>
        <div class="img2img-levels">
          <label>
            <span :title="strengthHint">重绘强度</span>
            <input
              type="range"
              aria-label="图生图重绘强度"
              :title="strengthHint"
              min="0.01"
              max="0.99"
              step="0.01"
              :value="entry.strength"
              :disabled="disabled || busy"
              :style="{ '--progress': ((entry.strength - 0.01) / 0.98) * 100 + '%' }"
              @input="update({ strength: Number(($event.target as HTMLInputElement).value) })"
            />
            <output :title="strengthHint">{{ entry.strength.toFixed(2) }}</output>
          </label>
          <label>
            <span :title="noiseHint">额外噪声</span>
            <input
              type="range"
              aria-label="图生图额外噪声"
              :title="noiseHint"
              min="0"
              max="0.99"
              step="0.01"
              :value="entry.noise"
              :disabled="disabled || busy"
              :style="{ '--progress': (entry.noise / 0.99) * 100 + '%' }"
              @input="update({ noise: Number(($event.target as HTMLInputElement).value) })"
            />
            <output :title="noiseHint">{{ entry.noise.toFixed(2) }}</output>
          </label>
        </div>
      </article>
    </Transition>

    <p
      v-if="highNoise"
      class="img2img-callout"
    >
      <Icon
        name="warn"
        :size="14"
      />
      <span>当前噪声高于重绘强度。若出现杂纹，可降低噪声。</span>
    </p>
    <span
      v-if="busy"
      role="status"
      >正在载入底图…</span
    >
    <p
      v-if="error && !galleryOpen"
      class="img2img-error"
      role="alert"
    >
      {{ error }}
    </p>
  </section>
</template>

<style scoped>
.img2img-editor {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 4px 0 2px;
}

.img2img-actions,
.img2img-card-head {
  display: flex;
  align-items: center;
  gap: 7px;
}

.img2img-actions {
  flex-wrap: wrap;
}

.img2img-actions button {
  height: 28px;
  line-height: 18px;
  gap: 6px;
  border-radius: 8px;
  padding: 0 10px;
  font-size: 12px;
}

.img2img-card {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  grid-template-rows: auto 1fr;
  gap: 8px 12px;
  padding: 10px;
  border: 1px solid var(--line2);
  border-radius: 12px;
  background: var(--panel);
  transition:
    border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-base) var(--ease-out);
}

.img2img-card:hover {
  border-color: var(--pink-line);
  background: var(--bg);
}

.img2img-preview {
  grid-row: span 2;
  width: 72px;
  height: 90px;
  align-self: center;
  object-fit: contain;
  border-radius: 8px;
  background: var(--hover);
  border: 1px solid var(--line);
}

.img2img-card-head {
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.img2img-match {
  height: 22px;
  padding: 0 8px;
  font-size: 11px;
  color: var(--pink-deep);
}

.img2img-match:hover:not(:disabled) {
  background: var(--pink-soft);
  color: var(--pink-deep);
}

.img2img-remove {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  color: var(--muted);
  flex-shrink: 0;
  margin-left: auto;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    transform var(--dur-slow) var(--bounce);
}

.img2img-remove:hover:not(:disabled) {
  background: var(--bad-soft);
  color: var(--bad);
}

.img2img-remove:active:not(:disabled) {
  transform: scale(var(--press-sm));
}

.img2img-levels {
  display: grid;
  align-content: center;
  gap: 4px;
}

.img2img-levels label {
  display: grid;
  grid-template-columns: 4em minmax(24px, 1fr) 2.8em;
  align-items: center;
  gap: 6px;
  color: var(--text2);
  font-size: 11px;
}

.img2img-levels label > span {
  justify-self: start;
}

.img2img-levels output {
  justify-self: end;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.img2img-levels input {
  appearance: none;
  width: 100%;
  min-width: 0;
  height: 18px;
  cursor: pointer;
  background: transparent;
}

.img2img-levels input::-webkit-slider-runnable-track {
  height: 3.5px;
  border-radius: 999px;
  background: linear-gradient(to right, var(--pink) var(--progress), var(--line2) var(--progress));
}

.img2img-levels input::-webkit-slider-thumb {
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

.img2img-levels input:hover:not(:disabled)::-webkit-slider-thumb {
  transform: scale(1.18);
}

.img2img-levels input:active:not(:disabled)::-webkit-slider-thumb {
  transform: scale(0.95);
}

.img2img-callout {
  display: flex;
  align-items: center;
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

.img2img-editor [role='status'] {
  color: var(--text2);
  font-size: 11.5px;
  animation: fade-in var(--dur-base) var(--ease-out);
}

.img2img-error {
  margin: 0;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--bad-soft);
  color: var(--bad);
  font-size: 11.5px;
  animation: alert-in var(--dur-slow) var(--ease-out);
}
</style>
