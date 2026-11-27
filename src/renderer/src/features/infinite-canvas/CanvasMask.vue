<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ImageViewport from '../../shared/ui/ImageViewport.vue'
import Icon from '../../shared/ui/Icon.vue'
import type { CanvasGalleryAsset, CanvasPoint, CanvasStroke } from './session'

const props = defineProps<{ source: CanvasGalleryAsset; disabled: boolean }>()
const strokes = defineModel<CanvasStroke[]>('strokes', { required: true })
const viewport = ref<InstanceType<typeof ImageViewport>>()
const mask = ref<HTMLCanvasElement>()
const root = ref<HTMLElement>()
const naturalSize = ref<{ width: number; height: number }>()
const width = computed(() => naturalSize.value?.width || props.source.width || 1)
const height = computed(() => naturalSize.value?.height || props.source.height || 1)
const zoom = ref(100)
const brushPx = ref(48)
let drawing: { pointerId: number; stroke: CanvasStroke } | undefined

function loaded(event: Event) {
  const image = event.currentTarget as HTMLImageElement
  naturalSize.value = { width: image.naturalWidth, height: image.naturalHeight }
}

function point(event: PointerEvent): CanvasPoint {
  const rect = mask.value!.getBoundingClientRect()
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  }
}

function paint(stroke: CanvasStroke, startIndex = 0) {
  const context = mask.value?.getContext('2d')
  const first = stroke.points[startIndex]
  if (!context || !first || stroke.radius <= 0) {
    return
  }
  const radius = stroke.radius * Math.min(width.value, height.value)
  context.fillStyle = '#ec4987'
  context.strokeStyle = '#ec4987'
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.lineWidth = 2 * radius
  if (startIndex === 0) {
    context.beginPath()
    context.arc(first.x * width.value, first.y * height.value, radius, 0, Math.PI * 2)
    context.fill()
  }
  context.beginPath()
  context.moveTo(first.x * width.value, first.y * height.value)
  for (let index = startIndex + 1; index < stroke.points.length; index++) {
    const position = stroke.points[index]
    context.lineTo(position.x * width.value, position.y * height.value)
  }
  context.stroke()
}

function redraw() {
  mask.value?.getContext('2d')?.clearRect(0, 0, width.value, height.value)
  for (const stroke of strokes.value) {
    paint(stroke)
  }
}
watch([mask, width, height, strokes], redraw, { flush: 'post' })

function start(event: PointerEvent) {
  if (props.disabled || !naturalSize.value || event.button !== 0 || drawing) {
    return
  }
  mask.value?.setPointerCapture(event.pointerId)
  const radius = brushPx.value / (2 * Math.min(width.value, height.value))
  const stroke = { radius, points: [point(event)] }
  drawing = { pointerId: event.pointerId, stroke }
  paint(stroke)
}

function move(event: PointerEvent) {
  if (!drawing || drawing.pointerId !== event.pointerId) {
    return
  }
  const stroke = drawing.stroke
  const startIndex = stroke.points.length - 1
  stroke.points.push(point(event))
  paint(stroke, startIndex)
}

function finish(event?: PointerEvent) {
  if (!drawing || (event && event.pointerId !== drawing.pointerId)) {
    return
  }
  if (event?.type === 'pointerup') {
    move(event)
  }
  strokes.value = [...strokes.value, drawing.stroke]
  drawing = undefined
}

function undo() {
  if (!drawing && !props.disabled && strokes.value.length) {
    strokes.value = strokes.value.slice(0, -1)
  }
}

function shortcut(event: KeyboardEvent) {
  if (props.disabled || drawing || event.altKey || event.isComposing || event.defaultPrevented) {
    return
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
    undo()
  } else if (!event.ctrlKey && !event.metaKey && ['[', ']'].includes(event.key)) {
    brushPx.value = Math.min(256, Math.max(1, brushPx.value + (event.key === '[' ? -4 : 4)))
  } else {
    return
  }
  event.preventDefault()
  event.stopPropagation()
}

let dialog: HTMLDialogElement | null = null
onMounted(() => {
  dialog = root.value?.closest('dialog') ?? null
  dialog?.addEventListener('keydown', shortcut)
})
onBeforeUnmount(() => dialog?.removeEventListener('keydown', shortcut))
</script>

<template>
  <div
    ref="root"
    class="canvas-mask-box"
  >
    <div class="canvas-mask-tools">
      <label class="mask-brush">
        <span
          class="mask-brush-dot"
          aria-hidden="true"
        ></span
        >笔刷
        <input
          v-model.number="brushPx"
          class="range"
          aria-label="笔刷大小"
          type="range"
          min="1"
          max="256"
          :disabled="disabled"
        />
        <output>{{ brushPx }} px</output>
      </label>
      <div class="mask-zoom">
        <button
          type="button"
          class="btn small ghost"
          aria-label="缩小底图"
          :disabled="zoom <= 25"
          @click="viewport?.zoomTo(zoom / 1.25)"
        >
          −
        </button>
        <button
          type="button"
          class="btn small ghost"
          title="适应画布"
          aria-label="适应画布"
          @click="viewport?.reset()"
        >
          {{ zoom }}%
        </button>
        <button
          type="button"
          class="btn small ghost"
          aria-label="放大底图"
          :disabled="zoom >= 1600"
          @click="viewport?.zoomTo(zoom * 1.25)"
        >
          +
        </button>
      </div>
      <div class="mask-actions">
        <button
          type="button"
          class="btn small ghost"
          :disabled="disabled || !strokes.length"
          @click="undo"
        >
          <Icon
            name="undo"
            :size="13"
          />撤销
        </button>
        <button
          type="button"
          class="btn small ghost"
          :disabled="disabled || !strokes.length"
          @click="strokes = []"
        >
          清空
        </button>
      </div>
    </div>
    <ImageViewport
      ref="viewport"
      v-model:zoom="zoom"
      class="mask-viewport"
      :width="width"
      :height="height"
      :editable="!disabled"
      :brush-size="brushPx"
      label="在底图上涂抹重绘区域"
      @cancel-draw="finish()"
    >
      <img
        :src="'np-img://img/' + encodeURIComponent(source.name)"
        alt="重绘底图"
        draggable="false"
        @load="loaded"
      />
      <canvas
        ref="mask"
        :width="width"
        :height="height"
        @pointerdown="start"
        @pointermove="move"
        @pointerup="finish"
        @pointercancel="finish"
        @lostpointercapture="finish"
      />
    </ImageViewport>
  </div>
</template>

<style scoped>
.canvas-mask-box {
  display: grid;
  gap: 8px;
}

.canvas-mask-tools,
.mask-brush,
.mask-zoom,
.mask-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.canvas-mask-tools {
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 10px;
}

.mask-brush {
  gap: 7px;
  font-size: 12px;
  color: var(--text2);
}

.mask-brush-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--pink);
}

.mask-brush .range {
  width: clamp(80px, 18vw, 132px);
}

.mask-brush output {
  min-width: 48px;
  padding: 2px 6px;
  border-radius: 8px;
  background: var(--pink-soft);
  color: var(--pink-deep);
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.mask-zoom {
  gap: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
}

.mask-zoom button {
  font-variant-numeric: tabular-nums;
}

.mask-viewport {
  height: clamp(320px, 52vh, 460px);
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--side);
}

.mask-viewport canvas {
  opacity: 0.62;
}

.mask-viewport :deep(.brush-cursor) {
  box-sizing: border-box;
  background: rgb(236 73 135 / 20%);
}
</style>
