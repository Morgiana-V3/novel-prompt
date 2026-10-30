<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '../../shared/ui/Icon.vue'

const props = defineProps<{ url: string; file?: File; disabled: boolean; cropEnabled: boolean }>()
const emit = defineEmits<{ choose: []; selected: [value: boolean]; file: [file: File] }>()
const host = ref<HTMLElement>()
const dragDepth = ref(0)
const dragging = computed(() => dragDepth.value > 0 && !props.disabled)
function resetDrag() {
  dragDepth.value = 0
}
function dragEnter(event: DragEvent) {
  if (!props.disabled && event.dataTransfer?.types.includes('Files')) {
    dragDepth.value++
  }
}
function dragOver(event: DragEvent) {
  if (event.dataTransfer?.types.includes('Files')) {
    event.dataTransfer.dropEffect = props.disabled ? 'none' : 'copy'
  }
}
function dragLeave() {
  dragDepth.value = Math.max(0, dragDepth.value - 1)
}
function drop(event: DragEvent) {
  resetDrag()
  const file = event.dataTransfer?.files[0]
  if (file && !props.disabled) {
    emit('file', file)
  }
}
watch(() => props.disabled, resetDrag)
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
  window.addEventListener('dragend', resetDrag)
  window.addEventListener('blur', resetDrag)
  observer = new ResizeObserver(measure)
  if (host.value) {
    observer.observe(host.value)
  }
})
onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('dragend', resetDrag)
  window.removeEventListener('blur', resetDrag)
})
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
    :class="{ 'has-image': url, cropping: cropEnabled, dragging }"
    role="button"
    :tabindex="disabled ? -1 : 0"
    :aria-disabled="disabled"
    aria-label="选择或更换参考图片"
    title="PNG / JPEG / WebP · ≤ 25 MB"
    @dragenter.stop.prevent="dragEnter"
    @dragover.stop.prevent="dragOver"
    @dragleave.stop.prevent="dragLeave"
    @drop.stop.prevent="drop"
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
      /><span>选择参考图</span></span
    >
    <div
      v-if="dragging"
      class="reverse-drop-feedback"
      role="status"
    >
      <Icon
        name="upload"
        :size="30"
      />
      <strong>{{ url ? '松开替换参考图' : '松开导入参考图' }}</strong>
    </div>
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
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: var(--reverse-image-height, 292px);
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

.reverse-drop-feedback {
  position: absolute;
  inset: 8px;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  border: 2px dashed var(--pink-deep);
  border-radius: 8px;
  color: var(--pink-deep);
  background: color-mix(in srgb, var(--pink-soft) 90%, transparent);
  backdrop-filter: blur(3px);
  pointer-events: none;
  font-size: 13px;
}

.reverse-drop.dragging::after {
  display: none;
}
</style>
