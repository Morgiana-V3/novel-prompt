<script setup lang="ts">
import { ref } from 'vue'
import Icon from '../../shared/ui/Icon.vue'
import type { CanvasGalleryAsset, CanvasStroke } from './session'

defineProps<{ source: CanvasGalleryAsset }>()
const strokes = defineModel<CanvasStroke[]>('strokes', { required: true })
const brush = ref(6)
let pointer: number | null = null

function point(event: PointerEvent) {
  const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect()
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  }
}

function start(event: PointerEvent) {
  if (event.button !== 0 || pointer !== null) {
    return
  }
  pointer = event.pointerId
  ;(event.currentTarget as Element).setPointerCapture(pointer)
  strokes.value.push({ radius: brush.value / 200, points: [point(event)] })
}

function move(event: PointerEvent) {
  if (event.pointerId === pointer) {
    strokes.value.at(-1)?.points.push(point(event))
  }
}

function end(event: PointerEvent) {
  if (event.pointerId === pointer) {
    pointer = null
  }
}

function undoStroke() {
  strokes.value.pop()
}

function clearStrokes() {
  strokes.value = []
}
</script>

<template>
  <div class="canvas-mask-box">
    <div class="canvas-mask-head">
      <span class="canvas-mask-label">
        遮罩画笔
        <span class="canvas-mask-value">{{ brush }}%</span>
      </span>
      <div class="canvas-mask-actions">
        <button
          type="button"
          class="btn small ghost canvas-mask-undo"
          :disabled="!strokes.length"
          @click="undoStroke"
        >
          <Icon
            name="undo"
            :size="13"
          />
          撤销
        </button>
        <button
          type="button"
          class="btn small ghost canvas-mask-undo"
          :disabled="!strokes.length"
          @click="clearStrokes"
        >
          清空
        </button>
      </div>
    </div>
    <input
      v-model.number="brush"
      class="range"
      aria-label="遮罩画笔大小"
      type="range"
      min="1"
      max="30"
    />
    <div class="canvas-mask-stage">
      <svg
        class="canvas-mask"
        :style="{
          width: 'min(100%, ' + (220 * (source.width ?? 1)) / (source.height ?? 1) + 'px)',
          aspectRatio: source.width + ' / ' + source.height,
        }"
        :viewBox="'0 0 ' + source.width + ' ' + source.height"
        aria-label="在底图上涂抹重绘区域"
        @pointerdown.prevent="start"
        @pointermove="move"
        @pointerup="end"
        @pointercancel="end"
        @lostpointercapture="end"
      >
        <image
          :href="'np-img://image/' + encodeURIComponent(source.name)"
          :width="source.width"
          :height="source.height"
        />
        <g
          v-if="source.width && source.height"
          opacity=".65"
          fill="#ec4987"
          stroke="#ec4987"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <g
            v-for="(stroke, index) in strokes"
            :key="index"
          >
            <circle
              v-if="stroke.points[0]"
              :cx="stroke.points[0].x * source.width"
              :cy="stroke.points[0].y * source.height"
              :r="stroke.radius * Math.min(source.width, source.height)"
            />
            <polyline
              fill="none"
              :points="
                stroke.points
                  .map((p) => p.x * (source.width ?? 1) + ',' + p.y * (source.height ?? 1))
                  .join(' ')
              "
              :stroke-width="2 * stroke.radius * Math.min(source.width, source.height)"
            />
          </g>
        </g>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.canvas-mask-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
}

.canvas-mask-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.canvas-mask-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.canvas-mask-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text2);
  font-size: 11.5px;
  font-weight: 550;
}

.canvas-mask-value {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bg);
  color: var(--text);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.canvas-mask-undo {
  height: 22px;
  padding: 0 7px;
  font-size: 11.5px;
}

.canvas-mask-stage {
  overflow: hidden;
  padding: 6px;
  border: 1px solid var(--line2);
  border-radius: 8px;
  background: var(--bg);
}

.canvas-mask {
  display: block;
  flex: none;
  height: auto;
  max-width: 100%;
  max-height: 220px;
  margin: 0 auto;
  border-radius: 5px;
  touch-action: none;
  cursor: crosshair;
}
</style>
