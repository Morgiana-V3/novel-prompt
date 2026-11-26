<script setup lang="ts">
import { computed } from 'vue'
import { pageImageToolSize } from '@shared/workspace/model'
import Icon from '../../shared/ui/Icon.vue'
import CanvasThumbnail from './CanvasThumbnail.vue'
import {
  cardErrors,
  isGenerateKind,
  operationLabel,
  runningCards,
  TOOL_ICONS,
  TOOL_TONES,
} from './operations'
import type { CanvasOperation, CanvasSession } from './session'
import type { CanvasPreview } from './use-canvas-previews'

const props = defineProps<{
  node: CanvasOperation
  session: CanvasSession
  sourcePreview?: CanvasPreview
  selected: boolean
  preview?: boolean
  wireAccepting?: boolean
  wireHovered?: boolean
}>()

const emit = defineEmits<{
  drag: [event: PointerEvent]
  select: []
  openPrimary: []
}>()

const busy = computed(() => runningCards.has(props.node))
const errorMessage = computed(() => cardErrors.get(props.node) ?? '')
const sourceImage = computed(() =>
  props.session.images.find((image) => image.id === props.node.sourceId),
)
const sourceAsset = computed(() => sourceImage.value?.asset)
const resultCount = computed(
  () => props.session.images.filter((image) => image.operationId === props.node.id).length,
)

const promptExcerpt = computed(() => props.node.request.base.trim())
const preciseCount = computed(() => props.node.request.params.preciseReferences?.length ?? 0)
const vibeCount = computed(() => props.node.request.params.vibeReferences?.length ?? 0)

const summaryTag = computed(() => {
  const card = props.node
  const original = sourceAsset.value
  if (isGenerateKind(card.kind)) {
    const model = card.request.version === 'v5' ? 'V5' : 'V4.5'
    if (original) {
      return `图生图 · 强度 ${card.strength.toFixed(2)}`
    }
    const extras = [
      preciseCount.value ? `精确参考×${preciseCount.value}` : '',
      vibeCount.value ? `Vibe×${vibeCount.value}` : '',
    ].filter(Boolean)
    if (extras.length) {
      return `${model} · ${extras.join(' ')}`
    }
    return `${model} · ${card.request.params.width}×${card.request.params.height}`
  }
  if (card.kind === 'inpaint') {
    return card.strokes.length ? `遮罩 ${card.strokes.length} 笔` : '待涂抹遮罩'
  }
  if (card.kind === 'outpaint') {
    const parts = [
      card.margins.left ? `左+${card.margins.left}` : '',
      card.margins.right ? `右+${card.margins.right}` : '',
      card.margins.top ? `上+${card.margins.top}` : '',
      card.margins.bottom ? `下+${card.margins.bottom}` : '',
    ].filter(Boolean)
    return parts.length ? parts.join(' ') : '未设边距'
  }
  if (card.kind === 'enhance') {
    return `${card.scale}× · 强度 ${card.strength.toFixed(2)}`
  }
  if (original?.width && original.height) {
    return `2× → ${original.width * 2}×${original.height * 2}`
  }
  return '放大 2×'
})

const outpaintInsetStyle = computed(() => {
  const original = sourceAsset.value
  if (props.node.kind !== 'outpaint' || !original?.width || !original.height) {
    return undefined
  }
  const total = pageImageToolSize(
    { kind: 'outpaint', ...props.node.margins },
    original.width,
    original.height,
  )
  return {
    left: `${(props.node.margins.left / total.width) * 100}%`,
    top: `${(props.node.margins.top / total.height) * 100}%`,
    width: `${(original.width / total.width) * 100}%`,
    height: `${(original.height / total.height) * 100}%`,
  }
})

const emptyHint = computed(() => {
  if (isGenerateKind(props.node.kind)) {
    return '点击「提示词」编写，或拖入图片连线'
  }
  return '拖入图片连线，或点击上方「底图」'
})

function handlePointerDown(event: PointerEvent) {
  emit('drag', event)
}
</script>

<template>
  <article
    class="operation-card"
    :class="{
      selected,
      busy,
      'wire-accepting': wireAccepting,
      'wire-hovered': wireHovered,
    }"
    :data-canvas-operation-id="node.id"
    tabindex="0"
    :aria-label="`${operationLabel(node.kind)} #${node.id}`"
    :aria-pressed="selected"
    @pointerdown.stop="handlePointerDown"
    @focus="emit('select')"
    @click.stop="emit('select')"
    @dblclick.stop="emit('openPrimary')"
  >
    <header class="op-box-caption">
      <span
        class="op-box-icon"
        :class="'tone-' + TOOL_TONES[node.kind]"
        aria-hidden="true"
      >
        <Icon
          :name="TOOL_ICONS[node.kind]"
          :size="12"
        />
      </span>
      <span class="op-box-name">{{ operationLabel(node.kind) }}</span>
      <span
        v-if="!preview"
        class="op-box-id"
      >
        #{{ node.id }}
      </span>
      <span
        v-if="busy"
        class="op-box-busy-dot"
        aria-label="执行中"
      />
    </header>

    <span
      class="op-input-port"
      aria-hidden="true"
    />

    <div class="op-box-surface">
      <div
        v-if="busy"
        class="op-box-progress"
        aria-hidden="true"
      >
        <span class="op-box-progress-bar" />
      </div>

      <template v-if="sourceAsset">
        <div
          v-if="node.kind === 'outpaint' && outpaintInsetStyle"
          class="op-box-outpaint-stage"
        >
          <div class="op-box-outpaint-frame">
            <div
              class="op-box-outpaint-inner"
              :style="outpaintInsetStyle"
            >
              <CanvasThumbnail :preview="sourcePreview" />
            </div>
          </div>
        </div>

        <div
          v-else
          class="op-box-media"
        >
          <CanvasThumbnail :preview="sourcePreview" />
          <svg
            v-if="node.kind === 'inpaint' && sourceAsset.width && sourceAsset.height"
            class="op-box-mask-overlay"
            :viewBox="`0 0 ${sourceAsset.width} ${sourceAsset.height}`"
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
          >
            <g
              opacity=".62"
              fill="#ec4987"
              stroke="#ec4987"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <g
                v-for="(stroke, index) in node.strokes"
                :key="index"
              >
                <circle
                  v-if="stroke.points[0]"
                  :cx="stroke.points[0].x * sourceAsset.width"
                  :cy="stroke.points[0].y * sourceAsset.height"
                  :r="stroke.radius * Math.min(sourceAsset.width, sourceAsset.height)"
                />
                <polyline
                  fill="none"
                  :points="
                    stroke.points
                      .map(
                        (point) =>
                          point.x * (sourceAsset?.width ?? 1) +
                          ',' +
                          point.y * (sourceAsset?.height ?? 1),
                      )
                      .join(' ')
                  "
                  :stroke-width="
                    2 * stroke.radius * Math.min(sourceAsset.width, sourceAsset.height)
                  "
                />
              </g>
            </g>
          </svg>
        </div>
      </template>

      <div
        v-else-if="isGenerateKind(node.kind) && promptExcerpt"
        class="op-box-prompt-card"
      >
        <p class="op-box-prompt-text">{{ promptExcerpt }}</p>
        <div
          v-if="node.request.characters.length"
          class="op-box-sub-pill"
        >
          <Icon
            name="user"
            :size="11"
          />
          <span>{{ node.request.characters.length }} 个角色</span>
        </div>
      </div>

      <div
        v-else
        class="op-box-placeholder"
      >
        <span
          class="op-box-placeholder-icon"
          :class="'tone-' + TOOL_TONES[node.kind]"
          aria-hidden="true"
        >
          <Icon
            :name="TOOL_ICONS[node.kind]"
            :size="20"
          />
        </span>
        <span class="op-box-placeholder-hint">{{ emptyHint }}</span>
      </div>

      <span
        v-if="resultCount > 0 && !busy"
        class="op-box-result-badge"
      >
        已出 {{ resultCount }} 张
      </span>

      <footer class="op-box-meta-bar">
        <span
          v-if="errorMessage"
          class="op-box-chip is-error"
          :title="errorMessage"
        >
          {{ errorMessage }}
        </span>
        <span
          v-else-if="busy"
          class="op-box-chip is-busy"
        >
          正在执行…
        </span>
        <span
          v-else
          class="op-box-chip"
        >
          {{ summaryTag }}
        </span>
      </footer>
    </div>
  </article>
</template>

<style scoped>
.operation-card {
  position: relative;
  display: block;
  transform-origin: top left;
  cursor: grab;
  user-select: none;
}

.operation-card:active {
  cursor: grabbing;
}

.op-input-port {
  position: absolute;
  z-index: 4;
  top: 50%;
  left: -6px;
  width: 12px;
  height: 12px;
  border: 2px solid var(--bg);
  border-radius: 50%;
  background: var(--line2);
  box-shadow: var(--shadow-sm);
  opacity: 0;
  transform: translateY(-50%) scale(0.8);
  pointer-events: none;
  transition:
    opacity var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out);
}

.operation-card:hover .op-input-port,
.operation-card.selected .op-input-port,
.operation-card.wire-accepting .op-input-port {
  opacity: 1;
  transform: translateY(-50%) scale(1);
}

.operation-card.wire-accepting .op-input-port {
  background: var(--pink);
}

.operation-card.wire-hovered .op-input-port {
  background: var(--pink-deep);
  transform: translateY(-50%) scale(1.3);
}

.op-box-caption {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  left: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  overflow: hidden;
  color: var(--text2);
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  white-space: nowrap;
  transition: color var(--dur-fast) var(--ease-out);
}

.operation-card:hover .op-box-caption,
.operation-card.selected .op-box-caption {
  color: var(--text);
}

.op-box-icon {
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
}

.op-box-icon.tone-pink,
.op-box-placeholder-icon.tone-pink {
  background: var(--pink-soft);
  color: var(--pink-deep);
}

.op-box-icon.tone-blue,
.op-box-placeholder-icon.tone-blue {
  background: var(--nl-soft);
  color: var(--nl);
}

.op-box-icon.tone-amber,
.op-box-placeholder-icon.tone-amber {
  background: var(--alias-soft);
  color: var(--alias);
}

.op-box-icon.tone-green,
.op-box-placeholder-icon.tone-green {
  background: var(--ok-soft);
  color: var(--ok);
}

.op-box-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.op-box-id {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: 10px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.op-box-busy-dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  margin-left: auto;
  border-radius: 50%;
  background: var(--pink);
  animation: pulse-pink 1.4s infinite;
}

.op-box-surface {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border: 1px solid var(--line2);
  border-radius: 12px;
  background: var(--bg);
  box-shadow:
    0 3px 12px rgb(20 20 30 / 6%),
    0 1px 2px rgb(20 20 30 / 4%);
  transition:
    border-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

.operation-card:hover .op-box-surface {
  border-color: var(--pink-line);
  box-shadow:
    0 6px 20px rgb(20 20 30 / 9%),
    0 0 0 1px var(--pink-line);
}

.operation-card.selected .op-box-surface,
.operation-card.wire-hovered .op-box-surface {
  border-color: var(--pink);
  outline: 1.5px solid var(--pink);
  outline-offset: 2px;
  box-shadow: 0 8px 24px rgb(20 20 30 / 11%);
}

.op-box-progress {
  position: absolute;
  z-index: 3;
  top: 0;
  right: 0;
  left: 0;
  height: 3px;
  overflow: hidden;
  background: var(--pink-soft);
}

.op-box-progress-bar {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 38%;
  border-radius: 999px;
  background: var(--pink);
  animation: indeterminate 1.4s var(--ease-loop) infinite;
}

.op-box-media {
  position: relative;
  flex: 1;
  min-height: 0;
  background: var(--panel);
}

.op-box-mask-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.op-box-outpaint-stage {
  display: grid;
  flex: 1;
  min-height: 0;
  place-items: center;
  padding: 14px 14px 36px;
  background: var(--panel);
}

.op-box-outpaint-frame {
  position: relative;
  width: 100%;
  height: 100%;
  border: 1.5px dashed var(--pink-line);
  border-radius: 8px;
  background: color-mix(in srgb, var(--pink-soft) 35%, var(--bg));
}

.op-box-outpaint-inner {
  position: absolute;
  overflow: hidden;
  border-radius: 4px;
  box-shadow: var(--shadow-sm);
}

.op-box-prompt-card {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  min-height: 0;
  padding: 16px 16px 38px;
  background: linear-gradient(180deg, var(--bg), color-mix(in srgb, var(--panel) 80%, var(--bg)));
}

.op-box-prompt-text {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 12.5px;
  line-height: 1.55;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 5;
}

.op-box-sub-pill {
  display: inline-flex;
  align-self: flex-start;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--hover);
  color: var(--text2);
  font-size: 11px;
}

.op-box-placeholder {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  padding: 16px 16px 36px;
  text-align: center;
}

.op-box-placeholder-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
}

.op-box-placeholder-hint {
  max-width: 176px;
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.45;
}

.op-box-result-badge {
  position: absolute;
  z-index: 2;
  top: 8px;
  right: 8px;
  padding: 2px 7px;
  border: 1px solid color-mix(in srgb, var(--ok) 25%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--ok-soft) 92%, transparent);
  color: var(--ok);
  font-size: 10.5px;
  font-weight: 600;
  backdrop-filter: blur(8px);
}

.op-box-meta-bar {
  position: absolute;
  z-index: 2;
  right: 8px;
  bottom: 8px;
  left: 8px;
  display: flex;
  justify-content: center;
  pointer-events: none;
}

.op-box-chip {
  max-width: 100%;
  padding: 2px 9px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--line2) 85%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg) 90%, transparent);
  color: var(--text2);
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(10px);
}

.op-box-chip.is-busy {
  border-color: var(--pink-line);
  background: var(--pink-soft);
  color: var(--pink-deep);
}

.op-box-chip.is-error {
  border-color: color-mix(in srgb, var(--bad) 30%, transparent);
  background: var(--bad-soft);
  color: var(--bad);
}
</style>
