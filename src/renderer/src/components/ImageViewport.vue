<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  width: number
  height: number
  zoom?: number
  editable?: boolean
  tool?: 'brush' | 'erase' | 'rect'
  brushSize?: number
  label?: string
}>(), { zoom: 100, editable: false, tool: 'brush', brushSize: 48, label: '图片画布' })
const emit = defineEmits<{ 'update:zoom': [value: number]; 'cancel-draw': [] }>()
const viewport = ref<HTMLElement>()
const size = reactive({ w: 1, h: 1 })
const pan = reactive({ x: 0, y: 0 })
const pointer = reactive({ x: 0, y: 0, inside: false })
const zoom = ref(props.zoom)
const space = ref(false)
const panning = ref(false)
const drawing = ref(false)
let panStart: { id: number; x: number; y: number; left: number; top: number } | null = null
let drawPointer: number | null = null
let observer: ResizeObserver | undefined
const fit = computed(() => Math.max(0.001, Math.min((size.w - 32) / (props.width || 1), (size.h - 32) / (props.height || 1), 1)))
const scale = computed(() => fit.value * zoom.value / 100)
const navigating = computed(() => panning.value || (space.value && !drawing.value))
const circle = computed(() => pointer.inside && props.editable && props.tool !== 'rect' && !navigating.value)
const stageStyle = computed(() => ({
  width: `${props.width * scale.value}px`, height: `${props.height * scale.value}px`,
  transform: `translate3d(${(size.w - props.width * scale.value) / 2 + pan.x}px, ${(size.h - props.height * scale.value) / 2 + pan.y}px, 0)`
}))
const cursorStyle = computed(() => ({
  left: `${pointer.x}px`, top: `${pointer.y}px`,
  width: `${props.brushSize * scale.value}px`, height: `${props.brushSize * scale.value}px`
}))
const cursor = computed(() => panning.value ? 'grabbing' : navigating.value || !props.editable ? 'grab' : circle.value ? 'none' : props.tool === 'rect' ? 'crosshair' : 'default')

function zoomTo(value: number, anchor = { x: size.w / 2, y: size.h / 2 }) {
  const next = Math.min(1600, Math.max(25, Math.round(value)))
  const ratio = next / zoom.value
  // Keep the same source pixel under the pointer, independent of image fit or panning.
  pan.x = anchor.x - size.w / 2 - (anchor.x - size.w / 2 - pan.x) * ratio
  pan.y = anchor.y - size.h / 2 - (anchor.y - size.h / 2 - pan.y) * ratio
  zoom.value = next
  emit('update:zoom', next)
}
function reset() {
  pan.x = pan.y = 0
  zoom.value = 100
  emit('update:zoom', 100)
}
watch(() => props.zoom, value => { if (value !== zoom.value) zoomTo(value) })
watch(() => [props.width, props.height], reset)
function coordinates(e: MouseEvent) {
  const bounds = viewport.value!.getBoundingClientRect()
  const css = getComputedStyle(viewport.value!)
  const left = parseFloat(css.borderLeftWidth) || 0, top = parseFloat(css.borderTopWidth) || 0
  const localWidth = size.w + left + (parseFloat(css.borderRightWidth) || 0)
  const localHeight = size.h + top + (parseFloat(css.borderBottomWidth) || 0)
  // Modal transitions can temporarily scale the viewport; pointer coordinates must
  // still refer to its untransformed content box.
  return { x: (e.clientX - bounds.left) * localWidth / bounds.width - left,
    y: (e.clientY - bounds.top) * localHeight / bounds.height - top }
}
function track(e: MouseEvent) {
  const local = coordinates(e)
  pointer.x = local.x
  pointer.y = local.y
  pointer.inside = pointer.x >= 0 && pointer.x <= size.w && pointer.y >= 0 && pointer.y <= size.h
}
function wheel(e: WheelEvent) {
  if (drawing.value || panning.value || !props.width) return
  track(e)
  const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? size.h : 1)
  zoomTo(zoom.value * Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.0015), pointer)
}
function down(e: PointerEvent) {
  track(e)
  if (drawPointer !== null || panStart) return
  viewport.value?.focus({ preventScroll: true })
  if (e.button === 1 || (e.button === 0 && (space.value || !props.editable))) {
    e.preventDefault()
    e.stopPropagation()
    panStart = { id: e.pointerId, x: pointer.x, y: pointer.y, left: pan.x, top: pan.y }
    panning.value = true
    viewport.value!.setPointerCapture(e.pointerId)
  } else if (e.button === 0 && (e.target as HTMLElement).tagName === 'CANVAS') {
    drawPointer = e.pointerId
    drawing.value = true
  }
}
function move(e: PointerEvent) {
  track(e)
  if (!panStart || panStart.id !== e.pointerId) return
  e.preventDefault()
  e.stopPropagation()
  // Leave a small part of the image reachable even after a long drag.
  const maxX = Math.max(0, (size.w + props.width * scale.value) / 2 - 32)
  const maxY = Math.max(0, (size.h + props.height * scale.value) / 2 - 32)
  pan.x = Math.max(-maxX, Math.min(maxX, panStart.left + pointer.x - panStart.x))
  pan.y = Math.max(-maxY, Math.min(maxY, panStart.top + pointer.y - panStart.y))
}
function up(e: PointerEvent) {
  if (panStart?.id === e.pointerId) {
    e.preventDefault()
    e.stopPropagation()
    panStart = null
    panning.value = false
    if (viewport.value?.hasPointerCapture(e.pointerId)) viewport.value.releasePointerCapture(e.pointerId)
  }
  if (drawPointer === e.pointerId) { drawPointer = null; drawing.value = false }
}
function blur() {
  if (panStart && viewport.value?.hasPointerCapture(panStart.id)) viewport.value.releasePointerCapture(panStart.id)
  panStart = null
  drawPointer = null
  space.value = panning.value = drawing.value = pointer.inside = false
  emit('cancel-draw')
}
function keyDown(e: KeyboardEvent) {
  if (e.code !== 'Space' || !pointer.inside && document.activeElement !== viewport.value) return
  const target = e.target instanceof HTMLElement ? e.target : null
  if (target?.closest('button, textarea, select, input:not([type="range"]), [contenteditable="true"]')) return
  e.preventDefault()
  space.value = true
}
function keyUp(e: KeyboardEvent) { if (e.code === 'Space') space.value = false }
onMounted(() => {
  observer = new ResizeObserver(([entry]) => { size.w = entry.contentRect.width; size.h = entry.contentRect.height })
  if (viewport.value) observer.observe(viewport.value)
  window.addEventListener('keydown', keyDown)
  window.addEventListener('keyup', keyUp)
  window.addEventListener('blur', blur)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('keydown', keyDown)
  window.removeEventListener('keyup', keyUp)
  window.removeEventListener('blur', blur)
})
defineExpose({ reset, zoomTo })
</script>

<template>
  <div ref="viewport" class="image-viewport" tabindex="0" role="region" :aria-label="label" :style="{ cursor }"
    @wheel.prevent="wheel" @pointerdown.capture="down" @pointermove.capture="move"
    @pointerup.capture="up" @pointercancel.capture="up" @lostpointercapture.capture="up"
    @pointerleave="pointer.inside = false" @contextmenu.prevent @auxclick.prevent>
    <div class="image-stage" :style="stageStyle"><slot :scale="scale" /></div>
    <div v-if="circle" :class="['brush-cursor', { erase: tool === 'erase' }]" :style="cursorStyle" aria-hidden="true"></div>
  </div>
</template>

<style scoped>
.image-viewport { position: relative; overflow: hidden; min-width: 0; min-height: 0; touch-action: none; user-select: none; outline: none; }
.image-viewport:focus-visible { box-shadow: inset 0 0 0 2px var(--pink-line); }
.image-stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.image-stage :deep(img), .image-stage :deep(canvas) { position: absolute; inset: 0; width: 100%; height: 100%; cursor: inherit; }
.image-stage :deep(img) { pointer-events: none; user-select: none; -webkit-user-drag: none; }
.brush-cursor { position: absolute; transform: translate(-50%, -50%); border: 1px solid #fff; border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,.85); pointer-events: none; }
.brush-cursor.erase { border-style: dashed; }
</style>
