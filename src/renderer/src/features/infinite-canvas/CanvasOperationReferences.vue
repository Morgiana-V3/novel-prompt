<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { MAX_REFERENCES, REFERENCE_FEE } from '@shared/generation/references'
import { MAX_VIBES } from '@shared/generation/vibes'
import { DEFAULT_COLLECTION } from '@shared/images/collections'
import type { NaiImage, SavedRecipe } from '@shared/images/types'
import { cleanErr } from '../../shared/lib/format'
import Icon from '../../shared/ui/Icon.vue'
import PreciseReferences from '../generation/components/PreciseReferences.vue'
import ReferenceGalleryDialog from '../generation/components/ReferenceGalleryDialog.vue'
import VibeReferences from '../generation/components/VibeReferences.vue'
import CanvasFavoritePickerDialog from './CanvasFavoritePickerDialog.vue'
import { canvasImageUrl } from './use-canvas-previews'
import CanvasReferenceStrip, { type GalleryCanvasImage } from './CanvasReferenceStrip.vue'
import {
  cardErrors,
  connectImageToOperation,
  isGenerateKind,
  referenceAliases,
  resolvedReferenceName,
} from './operations'
import type { CanvasImage, CanvasOperation } from './session'

const card = defineModel<CanvasOperation>('card', { required: true })
const props = defineProps<{
  images: CanvasImage[]
  source: NaiImage | null
  disabled: boolean
}>()
const emit = defineEmits<{ bindGallery: [image: NaiImage]; pending: [value: boolean] }>()
const galleryImages = computed(() =>
  props.images.filter((image): image is GalleryCanvasImage => image.asset.kind === 'gallery'),
)
const generate = computed(() => isGenerateKind(card.value.kind))
const precise = computed(() => card.value.request.params.preciseReferences ?? [])
const vibes = computed(() => card.value.request.params.vibeReferences ?? [])
const fileInput = ref<HTMLInputElement>()
const galleryOpen = ref(false)
const replacing = ref(false)
type CanvasPicker = 'source' | 'precise' | 'vibe'
const picker = ref<CanvasPicker | null>(null)
const favoriteTarget = ref<CanvasPicker | null>(null)
function openFavorites(target: CanvasPicker) {
  picker.value = null
  error.value = ''
  favoriteTarget.value = target
}
function togglePicker(target: CanvasPicker) {
  picker.value = picker.value === target ? null : target
}
function toggleReplacement() {
  picker.value = null
  replacing.value = !replacing.value
}
function openGallery() {
  picker.value = null
  galleryOpen.value = true
}
function openFile() {
  picker.value = null
  fileInput.value?.click()
}
const loading = ref(false)
const error = ref('')
let mounted = true
onBeforeUnmount(() => {
  mounted = false
  emit('pending', false)
})
watch(loading, (value) => emit('pending', value), { flush: 'sync' })
const locked = computed(() => props.disabled || loading.value)
const canAddPrecise = computed(
  () => !locked.value && !vibes.value.length && precise.value.length < MAX_REFERENCES,
)
const canAddVibe = computed(
  () =>
    !locked.value &&
    card.value.request.version === 'v4.5' &&
    !precise.value.length &&
    vibes.value.length < MAX_VIBES,
)

function boundImages(entries: { imageName: string }[]) {
  const names = new Set(entries.map((entry) => entry.imageName))
  return galleryImages.value
    .filter(({ asset }) => names.has(asset.name) || names.has(resolvedReferenceName(asset.name)))
    .map((image) => image.id)
}
const boundPrecise = computed(() => boundImages(precise.value))
const boundVibes = computed(() => boundImages(vibes.value))

const measured = ref<{ width: number; height: number } | null>(null)
watch(
  () => props.source?.name,
  () => {
    measured.value = null
  },
)
const originalSize = computed(() => {
  if (measured.value) {
    return measured.value
  }
  const source = props.source
  return source?.width && source.height ? { width: source.width, height: source.height } : null
})
function measure(event: Event) {
  const image = event.target as HTMLImageElement
  measured.value = { width: image.naturalWidth, height: image.naturalHeight }
}
// 与经典图生图页面一致，按比例缩放后在 64px 网格上收敛到免费像素上限。
const suggestedSize = computed(() => {
  const size = originalSize.value
  if (!size) {
    return null
  }
  const maxPixels = 1024 * 1024
  const scale = Math.min(1, Math.sqrt(maxPixels / (size.width * size.height)))
  const round64 = (value: number) => Math.max(64, Math.round((value * scale) / 64) * 64)
  let width = round64(size.width)
  let height = round64(size.height)
  while (width * height > maxPixels) {
    if (width >= height) {
      width -= 64
    } else {
      height -= 64
    }
  }
  return { width, height }
})
function bindCanvas(image: GalleryCanvasImage) {
  connectImageToOperation(card.value, image, 'img2img')
  picker.value = null
  replacing.value = false
  error.value = ''
  cardErrors.delete(card.value)
}
function removeSource() {
  picker.value = null
  card.value.sourceId = null
  card.value.strokes = []
  if (card.value.kind === 'img2img') {
    card.value.kind = 'generate'
  }
  replacing.value = false
  cardErrors.delete(card.value)
}
function bindGallery(image: NaiImage) {
  emit('bindGallery', image)
  picker.value = null
  replacing.value = false
  galleryOpen.value = false
  error.value = ''
}
async function selectFavorite(recipe: SavedRecipe) {
  const target = favoriteTarget.value
  if (!target || locked.value) {
    return
  }
  const version = card.value.request.version
  loading.value = true
  error.value = ''
  try {
    const asset = await window.canvasApi.favoriteImage(recipe.id)
    if (!mounted || props.disabled) {
      return
    }
    if (target === 'source') {
      bindGallery({ ...asset, url: canvasImageUrl(asset), createdAt: asset.modifiedAt ?? 0 })
    } else {
      const name = await window.canvasApi.naiImportReference(asset.name)
      if (!mounted || props.disabled || version !== card.value.request.version) {
        return
      }
      const entries = target === 'precise' ? precise.value : vibes.value
      if (
        entries.some(
          (entry) =>
            resolvedReferenceName(entry.imageName) === name || entry.imageName === asset.name,
        )
      ) {
        throw new Error('这张参考图已添加')
      }
      if (target === 'precise') {
        if (vibes.value.length || precise.value.length >= MAX_REFERENCES) {
          throw new Error('请先移除冲突或超出上限的参考图')
        }
        const mode = precise.value.some((entry) => entry.mode === 'character')
          ? 'style'
          : 'character'
        card.value.request.params.preciseReferences = [
          ...precise.value,
          { imageName: name, mode, strength: 1, fidelity: 1 },
        ]
      } else {
        if (version !== 'v4.5' || precise.value.length || vibes.value.length >= MAX_VIBES) {
          throw new Error('Vibe 仅支持 V4.5，请检查参考冲突与数量上限')
        }
        card.value.request.params.vibeReferences = [
          ...vibes.value,
          { imageName: name, strength: 0.6, information: 1 },
        ]
      }
    }
    favoriteTarget.value = null
  } catch (reason) {
    error.value = cleanErr(reason)
  } finally {
    loading.value = false
  }
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || locked.value) {
    return
  }
  loading.value = true
  error.value = ''
  try {
    if (file.size > 40 * 1024 * 1024) {
      throw new Error('请选择 40 MB 以内的图片')
    }
    const image = await window.canvasApi.imagesImport(
      new Uint8Array(await file.arrayBuffer()),
      DEFAULT_COLLECTION,
    )
    if (mounted && !props.disabled) {
      bindGallery(image)
    }
  } catch (reason) {
    error.value = cleanErr(reason)
  } finally {
    loading.value = false
  }
}
function addPrecise(image: GalleryCanvasImage) {
  if (canAddPrecise.value) {
    connectImageToOperation(card.value, image, 'precise')
    picker.value = null
  }
}
async function addVibe(image: GalleryCanvasImage) {
  if (!canAddVibe.value) {
    return
  }
  picker.value = null
  loading.value = true
  error.value = ''
  try {
    const name = await window.canvasApi.naiImportReference(image.asset.name)
    if (
      mounted &&
      !props.disabled &&
      card.value.request.version === 'v4.5' &&
      !precise.value.length &&
      vibes.value.length < MAX_VIBES
    ) {
      referenceAliases.set(image.asset.name, name)
      connectImageToOperation(card.value, image, 'vibe', name)
    }
  } catch (reason) {
    error.value = cleanErr(reason)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="reference-cards">
    <section class="op-card source-card">
      <h3>
        <Icon
          name="image"
          :size="16"
        />{{ generate ? '图生图底图' : '操作底图' }} <small v-if="generate">Img2Img</small>
      </h3>
      <div
        v-if="source"
        class="source-details"
      >
        <img
          :key="source.name"
          :src="source.url"
          alt="当前底图"
          @load="measure"
        />
        <div>
          <strong>画布图片 #{{ card.sourceId }}</strong>
          <p v-if="originalSize">原图 {{ originalSize.width }} × {{ originalSize.height }} px</p>
          <button
            v-if="generate && suggestedSize"
            class="btn small"
            :disabled="
              locked ||
              (suggestedSize.width === card.request.params.width &&
                suggestedSize.height === card.request.params.height)
            "
            @click="Object.assign(card.request.params, suggestedSize)"
          >
            按底图比例匹配画幅 · {{ suggestedSize.width }}×{{ suggestedSize.height }}
          </button>
        </div>
      </div>
      <div
        v-else
        class="reference-empty"
      >
        <Icon
          name="image"
          :size="18"
        />
        <div>
          <strong>暂未绑定底图</strong>
          <p class="source-note">
            {{
              generate
                ? '当前为文生图模式，可拖线连入图片，或在下方选择。'
                : '可拖线连入图片，或在下方选择底图。'
            }}
          </p>
        </div>
      </div>
      <div
        v-if="source"
        class="source-actions"
      >
        <button
          class="btn small"
          :disabled="locked"
          :aria-expanded="replacing"
          @click="toggleReplacement"
        >
          {{ replacing ? '收起选择' : '更换底图' }}
        </button>
        <button
          class="btn ghost small"
          :disabled="locked"
          @click="removeSource"
        >
          移除底图
        </button>
      </div>
      <CanvasReferenceStrip
        v-if="!source || replacing"
        :images="galleryImages"
        label="从画布选择底图"
        :selected="card.sourceId === null ? [] : [card.sourceId]"
        :disabled="locked"
        :expanded="picker === 'source'"
        @toggle="togglePicker('source')"
        @select="bindCanvas"
      >
        <button
          class="btn small"
          :disabled="locked"
          @click="openGallery"
        >
          <Icon
            name="folder"
            :size="14"
          />图库
        </button>
        <button
          type="button"
          class="btn small"
          aria-haspopup="dialog"
          :disabled="locked"
          @click.stop="openFavorites('source')"
        >
          <Icon
            name="star"
            :size="14"
          />收藏
        </button>
        <button
          class="btn small"
          :disabled="locked"
          @click="openFile"
        >
          <Icon
            name="upload"
            :size="14"
          />本地
        </button>
        <input
          ref="fileInput"
          hidden
          type="file"
          accept="image/png,image/webp,image/jpeg"
          @change="upload"
        />
      </CanvasReferenceStrip>
      <div
        v-if="generate && source"
        class="source-levels"
      >
        <label class="op-range"
          ><span>修改强度</span
          ><input
            v-model.number="card.strength"
            type="range"
            class="range"
            aria-label="修改强度"
            min="0.01"
            max="0.99"
            step="0.01"
            :disabled="locked"
          /><output>{{ card.strength.toFixed(2) }}</output></label
        >
        <label class="op-range"
          ><span>噪声</span
          ><input
            v-model.number="card.noise"
            type="range"
            class="range"
            aria-label="噪声"
            min="0"
            max="0.99"
            step="0.01"
            :disabled="locked"
          /><output>{{ card.noise.toFixed(2) }}</output></label
        >
      </div>
      <p
        v-if="generate && source && card.noise > card.strength"
        class="source-note"
      >
        当前噪声高于修改强度。若出现杂纹，可降低噪声。
      </p>
      <ReferenceGalleryDialog
        v-if="galleryOpen"
        base-image
        :busy="loading"
        :disabled="locked"
        :error="error"
        @select="bindGallery"
        @close="galleryOpen = false"
      />
    </section>
    <section class="op-card">
      <h3>
        <Icon
          name="layers"
          :size="16"
        />精确参考
        <small v-if="precise.length">{{ precise.length }} 张</small>
        <small v-else-if="!vibes.length">每张参考、每张输出 +{{ REFERENCE_FEE }} Anlas</small>
      </h3>
      <p
        v-if="!precise.length && !vibes.length"
        class="reference-empty"
      >
        暂未添加精确参考
      </p>
      <PreciseReferences
        :images="precise"
        :model="card.request.version"
        :count="card.request.params.count"
        :current="source"
        :conflict="!!vibes.length"
        :disabled="locked"
        @click="picker = null"
        @change="card.request.params.preciseReferences = $event"
      >
        <template #after-gallery="{ disabled: actionDisabled }">
          <button
            type="button"
            class="btn small"
            aria-haspopup="dialog"
            :disabled="actionDisabled"
            @click.stop="openFavorites('precise')"
          >
            <Icon
              name="star"
              :size="14"
            />收藏
          </button>
        </template>
        <template #extra-actions="{ disabled: actionDisabled }">
          <button
            v-if="galleryImages.length"
            class="btn small canvas-picker-toggle"
            type="button"
            :disabled="actionDisabled"
            :aria-expanded="picker === 'precise'"
            @click.stop="togglePicker('precise')"
          >
            <Icon
              name="image"
              :size="14"
            />{{ picker === 'precise' ? '收起' : '从画布选择' }}
          </button>
        </template>
      </PreciseReferences>
      <CanvasReferenceStrip
        v-if="canAddPrecise && galleryImages.length"
        hide-actions
        :images="galleryImages"
        label="从画布添加精确参考"
        :selected="boundPrecise"
        :disabled="!canAddPrecise"
        :expanded="picker === 'precise'"
        @toggle="togglePicker('precise')"
        @select="addPrecise"
      />
    </section>
    <section class="op-card">
      <h3>
        <Icon
          name="layers"
          :size="16"
        />Vibe Transfer
        <small v-if="vibes.length">{{ vibes.length }} 张</small>
      </h3>
      <p
        v-if="card.request.version === 'v4.5' && !vibes.length && !precise.length"
        class="reference-empty"
      >
        暂未添加 Vibe 参考
      </p>
      <VibeReferences
        :entries="vibes"
        :version="card.request.version"
        :current="source"
        :conflict="!!precise.length"
        :disabled="locked"
        @click="picker = null"
        @change="card.request.params.vibeReferences = $event"
      >
        <template #after-gallery="{ disabled: actionDisabled }">
          <button
            type="button"
            class="btn small"
            aria-haspopup="dialog"
            :disabled="actionDisabled"
            @click.stop="openFavorites('vibe')"
          >
            <Icon
              name="star"
              :size="14"
            />收藏
          </button>
        </template>
        <template #extra-actions="{ disabled: actionDisabled }">
          <button
            v-if="galleryImages.length"
            class="btn small canvas-picker-toggle"
            type="button"
            :disabled="actionDisabled"
            :aria-expanded="picker === 'vibe'"
            @click.stop="togglePicker('vibe')"
          >
            <Icon
              name="image"
              :size="14"
            />{{ picker === 'vibe' ? '收起' : '从画布选择' }}
          </button>
        </template>
      </VibeReferences>
      <CanvasReferenceStrip
        v-if="canAddVibe && galleryImages.length"
        hide-actions
        :images="galleryImages"
        label="从画布添加 Vibe"
        :selected="boundVibes"
        :disabled="!canAddVibe"
        :expanded="picker === 'vibe'"
        @toggle="togglePicker('vibe')"
        @select="addVibe"
      />
    </section>
    <CanvasFavoritePickerDialog
      v-if="favoriteTarget"
      :base-image="favoriteTarget === 'source'"
      :busy="loading"
      :error="error"
      @close="favoriteTarget = null"
      @select="selectFavorite"
    />
    <p
      v-if="error && !favoriteTarget"
      class="reference-error"
      role="alert"
    >
      {{ error }}
    </p>
  </div>
</template>
<style scoped>
.canvas-picker-toggle {
  order: 1;
}

.reference-cards {
  display: grid;
  gap: 12px;
}

.source-details,
.source-actions {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
}

.source-details img {
  width: 72px;
  height: 72px;
  border-radius: 8px;
  object-fit: contain;
  background: var(--hover);
}

.source-details strong {
  font-size: 13px;
}

.reference-empty {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  padding: 12px;
  border: 1px dashed var(--line2);
  border-radius: 8px;
  color: var(--text2);
  font-size: 12px;
}

.source-details p,
.source-note {
  margin: 3px 0;
  color: var(--text2);
  font-size: 12px;
}

.source-details p {
  margin-bottom: 6px;
}

.source-levels {
  display: grid;
  gap: 8px;
  border-top: 1px solid var(--line);
  padding-top: 10px;
}

.reference-error {
  margin: 0;
  color: var(--bad);
  font-size: 12px;
}
</style>
