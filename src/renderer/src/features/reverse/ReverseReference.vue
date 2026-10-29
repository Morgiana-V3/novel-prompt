<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '../../shared/ui/Icon.vue'

const props = defineProps<{ url: string; file?: File; disabled: boolean; cropEnabled: boolean }>()
const emit = defineEmits<{ choose: []; selected: [value: boolean] }>()
const host = ref<HTMLElement>()
const img = ref<HTMLImageElement>()
const bounds = ref({ left: 0, top: 0, width: 0, height: 0 })
const region = ref<{ x: number; y: number; width: number; height: number }>()
let start: { x: number; y: number } | undefined
let observer: ResizeObserver | undefined
function measure() {
  if (!host.value || !img.value?.naturalWidth) {
    return
  }
  const width = host.value.clientWidth - 32
  const height = host.value.clientHeight - 32
  const scale = Math.min(width / img.value.naturalWidth, height / img.value.naturalHeight)
  const w = img.value.naturalWidth * scale
  const h = img.value.naturalHeight * scale
  bounds.value = { left: (width - w) / 2 + 16, top: (height - h) / 2 + 16, width: w, height: h }
}
onMounted(() => {
  observer = new ResizeObserver(measure)
  if (host.value) {
    observer.observe(host.value)
  }
})
onBeforeUnmount(() => observer?.disconnect())
function clear() {
  region.value = undefined
  start = undefined
  emit('selected', false)
}
watch(() => props.url, clear)
function point(event: PointerEvent) {
  const box = host.value!.getBoundingClientRect()
  const b = bounds.value
  return {
    x: Math.max(0, Math.min(1, (event.clientX - box.left - b.left) / b.width)),
    y: Math.max(0, Math.min(1, (event.clientY - box.top - b.top) / b.height)),
  }
}
function down(event: PointerEvent) {
  if (!props.cropEnabled || props.disabled || !props.url || event.button !== 0) {
    return
  }
  measure()
  if (bounds.value.width <= 0 || bounds.value.height <= 0) {
    return
  }
  event.preventDefault()
  clear()
  start = point(event)
  host.value?.setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (!start || props.disabled) {
    return
  }
  const end = point(event)
  region.value = {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}
function up(event: PointerEvent) {
  if (!start) {
    return
  }
  move(event)
  start = undefined
  if (
    !region.value ||
    region.value.width * img.value!.naturalWidth < 4 ||
    region.value.height * img.value!.naturalHeight < 4
  ) {
    clear()
  } else {
    emit('selected', true)
  }
  if (host.value?.hasPointerCapture(event.pointerId)) {
    host.value.releasePointerCapture(event.pointerId)
  }
}
const selectionStyle = computed(() => {
  const r = region.value
  const b = bounds.value
  return r
    ? {
        left: `${b.left + r.x * b.width}px`,
        top: `${b.top + r.y * b.height}px`,
        width: `${r.width * b.width}px`,
        height: `${r.height * b.height}px`,
      }
    : {}
})
async function bytes(): Promise<Uint8Array> {
  const r = region.value
  if (!r || !props.file) {
    throw new Error('请先在图上拖动框选人物')
  }
  const bitmap = await createImageBitmap(props.file)
  try {
    const canvas = document.createElement('canvas')
    const left = Math.floor(r.x * bitmap.width)
    const top = Math.floor(r.y * bitmap.height)
    canvas.width = Math.min(bitmap.width - left, Math.max(1, Math.round(r.width * bitmap.width)))
    canvas.height = Math.min(bitmap.height - top, Math.max(1, Math.round(r.height * bitmap.height)))
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('无法读取选区')
    }
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('无法读取选区'))),
        'image/png',
      ),
    )
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    bitmap.close()
  }
}
defineExpose({ bytes, clear })
</script>

<template>
  <div
    ref="host"
    class="reverse-drop"
    :class="{ 'has-image': url, cropping: cropEnabled }"
    role="button"
    :tabindex="disabled ? -1 : 0"
    :aria-disabled="disabled"
    aria-label="选择或更换参考图片"
    @click="!disabled && !cropEnabled && emit('choose')"
    @keydown.enter.prevent="!disabled && !cropEnabled && emit('choose')"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="clear"
  >
    <img
      v-if="url"
      ref="img"
      :src="url"
      alt="参考图片"
      draggable="false"
      @load="measure"
    />
    <span
      v-else
      class="reverse-upload"
      ><Icon
        name="upload"
        :size="28"
      /><span>拖入图片或点击选择</span><small>PNG / JPEG / WebP · ≤ 25 MB</small></span
    >
    <div
      v-if="region && cropEnabled"
      class="reverse-crop-box"
      :style="selectionStyle"
    />
  </div>
</template>

<style scoped>
.reverse-drop {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 220px;
  border: 0;
  background: var(--panel);
  color: var(--text2);
  cursor: pointer;
  padding: 16px;
  overflow: hidden;
}

.reverse-drop:not(.has-image)::after {
  position: absolute;
  content: '';
  inset: 14px;
  border: 1px dashed var(--line2);
  border-radius: 6px;
  pointer-events: none;
}

img {
  position: absolute;
  inset: 16px;
  width: calc(100% - 32px);
  height: calc(100% - 32px);
  object-fit: contain;
  pointer-events: none;
}

.cropping {
  cursor: crosshair;
  touch-action: none;
  user-select: none;
}

.reverse-crop-box {
  position: absolute;
  border: 2px solid var(--pink-deep);
  background: rgb(255 128 160 / 12%);
  box-shadow: 0 0 0 9999px rgb(0 0 0 / 35%);
  pointer-events: none;
}

.reverse-upload {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 14px;
  font-size: 13px;
}

small {
  font-size: 11px;
  color: var(--muted);
}
</style>
