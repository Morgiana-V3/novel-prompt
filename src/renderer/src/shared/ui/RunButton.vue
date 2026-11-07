<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Icon from './Icon.vue'
import type { IconName } from './icons'

/**
 * 生成 / 执行按钮：参照右上角任务按钮的“原地变形”。
 * - 同一个按钮在 空闲 ⇄ 进行中 之间过渡，外框宽度取各状态文字的最大值，周围布局不跳；
 * - 结束时直接平滑回到空闲，不额外插入“已完成”状态（结果本身就是完成反馈）；
 * - 图标与文字在同一位置交叉淡入淡出（缩小退场、放大入场），进度信息延后跟进；
 * - 进行中按钮本身就是停止键：悬停显示“停止”，点一次请求停止，停止键永远在原来生成键的位置；
 * - 有确定进度时底层填充按比例推进，否则一道柔光往返，表示仍在工作。
 */
const props = withDefaults(
  defineProps<{
    label: string
    icon?: IconName
    running: boolean
    disabled?: boolean
    canStop?: boolean
    stopping?: boolean
    current?: number
    total?: number
    count?: number
    runningLabel?: string
    stopLabel?: string
    stoppingLabel?: string
    title?: string
    stopTitle?: string
  }>(),
  {
    icon: 'generate',
    disabled: false,
    canStop: true,
    stopping: false,
    current: undefined,
    total: undefined,
    count: undefined,
    runningLabel: '生成中',
    stopLabel: '停止',
    stoppingLabel: '即将停止',
    title: undefined,
    stopTitle: '当前这张完成后停止',
  },
)
const emit = defineEmits<{ run: []; stop: [] }>()

/* 刚点下生成时指针还停在按钮上：先不显示“停止”，移开或稍等片刻后才可停止，避免连点误停 */
const STOP_ARM_MS = 1200

/* ---------- 状态 ---------- */
const stopArmed = ref(false)
let armTimer: ReturnType<typeof setTimeout> | undefined

function armStop() {
  clearTimeout(armTimer)
  stopArmed.value = true
}

watch(
  () => props.running,
  (running) => {
    clearTimeout(armTimer)
    stopArmed.value = false

    if (running) {
      armTimer = setTimeout(armStop, STOP_ARM_MS)
    }
  },
)

onBeforeUnmount(() => clearTimeout(armTimer))

/* ---------- 派生展示 ---------- */
const hasProgress = computed(
  () => props.total !== undefined && props.total > 0 && props.current !== undefined,
)
const progressRatio = computed(() => {
  if (!hasProgress.value) {
    return 0
  }
  return Math.max(0, Math.min(1, props.current! / props.total!))
})
const runningText = computed(() => {
  if (hasProgress.value && props.total! > 1) {
    return `${props.runningLabel} ${Math.min(props.current! + 1, props.total!)}/${props.total}`
  }
  return props.runningLabel
})
const stopText = computed(() => (props.stopping ? props.stoppingLabel : props.stopLabel))
const isStoppable = computed(
  () => props.running && props.canStop && !props.stopping && stopArmed.value,
)
const buttonTitle = computed(() => (props.running ? props.stopTitle : props.title))
const accessibleLabel = computed(() => {
  if (!props.running) {
    return props.label
  }
  return isStoppable.value ? `${runningText.value}，点击停止` : runningText.value
})
const showCount = computed(() => (props.count ?? 0) > 1)

/* ---------- 动作 ---------- */
function armStopAfterLeave() {
  if (props.running) {
    armStop()
  }
}

function activate() {
  if (props.running) {
    if (isStoppable.value) {
      emit('stop')
    }
    return
  }
  emit('run')
}
</script>

<template>
  <button
    type="button"
    class="btn accent run-button"
    :class="{
      'is-running': running,
      'is-stoppable': isStoppable,
      'is-stopping': running && stopping,
      'has-progress': hasProgress,
    }"
    :style="{ '--run-progress': progressRatio }"
    :disabled="!running && disabled"
    :aria-disabled="running && !isStoppable"
    :aria-busy="running"
    :aria-label="accessibleLabel"
    :title="buttonTitle"
    @click="activate"
    @pointerleave="armStopAfterLeave"
  >
    <span
      class="run-fill"
      aria-hidden="true"
    ></span>
    <span
      class="run-glyph"
      aria-hidden="true"
    >
      <Icon
        :name="icon"
        :size="16"
        class="run-icon run-icon-idle"
      />
      <span class="run-icon run-spinner"><i></i></span>
      <Icon
        name="stop"
        :size="14"
        class="run-icon run-icon-stop"
      />
    </span>
    <span
      class="run-labels"
      aria-hidden="true"
    >
      <span class="run-label run-label-idle">{{ label }}</span>
      <span class="run-label run-label-running">{{ runningText }}</span>
      <span class="run-label run-label-stop">{{ stopText }}</span>
    </span>
    <span
      v-if="showCount"
      class="run-count"
      aria-hidden="true"
      >{{ count }}</span
    >
  </button>
</template>

<style scoped>
/* ---------- 外形：空闲沿用 .btn.accent，进行中原地变成浅粉描边胶囊 ---------- */
.btn.accent.run-button {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  transition:
    background-color var(--dur-emph) var(--ease-morph),
    border-color var(--dur-emph) var(--ease-morph),
    color var(--dur-emph) var(--ease-morph),
    box-shadow var(--dur-emph) var(--ease-morph),
    opacity var(--dur-base) var(--ease-out),
    transform var(--dur-slow) var(--bounce);
}

.btn.accent.run-button.is-running,
.btn.accent.run-button.is-running:hover {
  border-color: var(--pink-line);
  color: var(--pink-deep);
  background: var(--pink-soft);
  box-shadow: none;
}

.btn.accent.run-button.is-stoppable:hover {
  background: color-mix(in srgb, var(--pink) 14%, var(--bg));
}

.btn.accent.run-button.is-running:not(.is-stoppable) {
  cursor: default;
}

.btn.accent.run-button.is-running:active {
  transform: none;
}

.btn.accent.run-button.is-stoppable:active {
  transform: scale(var(--press));
}

/* ---------- 进度填充：确定进度按比例推进，不确定时柔光往返 ---------- */
.run-fill {
  position: absolute;
  inset: 0;
  z-index: -1;
  background: color-mix(in srgb, var(--pink) 16%, transparent);
  opacity: 0;
  transform-origin: left center;
  transform: scaleX(0);
  transition:
    opacity var(--dur-base) ease,
    transform var(--dur-emph) var(--ease-glide);
}

.is-running.has-progress .run-fill {
  opacity: 1;
  transform: scaleX(var(--run-progress));
}

.is-running:not(.has-progress) .run-fill {
  width: 35%;
  opacity: 1;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--pink) 18%, transparent),
    transparent
  );
  transform: none;
  animation: indeterminate 1.6s var(--ease-loop) infinite;
}

/* ---------- 图标：同一位置交叉缩放 ---------- */
.run-glyph {
  position: relative;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
}

/* 退场与入场共用同一个“缩小 + 轻微模糊”的隐藏态，两者在中间相遇、交叉溶解，不会上下错位 */
.run-button .run-glyph .run-icon {
  position: absolute;
  inset: 0;
  margin: auto;
  opacity: 0;
  filter: blur(2px);
  transform: scale(0.6);
  transition:
    opacity var(--dur-slow) var(--ease-morph),
    filter var(--dur-slow) var(--ease-morph),
    transform var(--dur-emph) var(--ease-glide);
}

/* 前缀 .btn.run-button 抬高权重，压过全局 .btn.accent:hover .icon 的悬停倾斜 */
.btn.run-button:not(.is-running) .run-icon.run-icon-idle,
.btn.run-button.is-running:not(.is-stoppable:hover) .run-icon.run-spinner,
.btn.run-button.is-stoppable:hover .run-icon.run-icon-stop {
  opacity: 1;
  filter: none;
  transform: none;
}

/* 主按钮悬停时图标轻扬，只在空闲态生效 */
.btn.run-button:not(.is-running):hover:not(:disabled) .run-icon.run-icon-idle {
  transform: translateY(-1px) rotate(-8deg) scale(1.06);
}

.run-spinner i {
  display: block;
  width: 14px;
  height: 14px;
  margin: 1px;
  border: 1.6px solid color-mix(in srgb, var(--pink) 25%, transparent);
  border-top-color: var(--pink-deep);
  border-right-color: var(--pink-deep);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
  animation-play-state: paused;
}

.is-running .run-spinner i {
  animation-play-state: running;
}

/* ---------- 文字：全部叠在同一格里，按钮宽度取最大值，不随状态跳动 ---------- */
.run-labels {
  display: grid;
  justify-items: center;
}

.run-label {
  grid-area: 1 / 1;
  white-space: nowrap;
  opacity: 0;
  filter: blur(3px);
  transform: scale(0.92);
  transition:
    opacity var(--dur-slow) var(--ease-morph),
    filter var(--dur-slow) var(--ease-morph),
    transform var(--dur-emph) var(--ease-glide);
}

/* 进度文字比外形晚一点到，层次与任务按钮一致 */
.is-running .run-label-running {
  transition-delay: 80ms;
}

.run-button:not(.is-running) .run-label-idle,
.is-running:not(.is-stopping, .is-stoppable:hover) .run-label-running,
.is-stoppable:hover .run-label-stop,
.is-stopping .run-label-stop {
  opacity: 1;
  filter: none;
  transform: none;
}

.run-label-running {
  font-variant-numeric: tabular-nums;
}

/*
 * ---------- 张数徽标 ----------
 * 进行中只淡出、不收起：按钮宽度保持不变，旁边的费用标签、图集选择等不会被带着左右移动。
 */
.run-count {
  padding-left: 7px;
  border-left: 1px solid rgb(255 255 255 / 38%);
  font-size: 11px;
  transition:
    opacity var(--dur-base) var(--ease-morph),
    border-color var(--dur-emph) var(--ease-morph);
}

.is-running .run-count {
  border-left-color: transparent;
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .run-spinner i,
  .is-running:not(.has-progress) .run-fill {
    animation: none;
  }
}
</style>
