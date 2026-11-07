<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

/**
 * 数字变化时从旧值滚动到新值（余额、张数、项目数等），首次显示不滚动。
 * 等宽数字避免滚动过程中宽度抖动；开启“减少动态效果”时直接跳到新值。
 */
const props = withDefaults(
  defineProps<{
    value: number | null | undefined
    placeholder?: string
    durationMs?: number
  }>(),
  {
    placeholder: '—',
    durationMs: 600,
  },
)

const displayed = ref<number | null>(props.value ?? null)
let frame = 0

function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

watch(
  () => props.value,
  (next) => {
    cancelAnimationFrame(frame)
    const from = displayed.value

    if (next === null || next === undefined || from === null || prefersReducedMotion()) {
      displayed.value = next ?? null
      return
    }

    const startedAt = performance.now()
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / props.durationMs)
      displayed.value = from + (next - from) * easeOutCubic(progress)
      if (progress < 1) {
        frame = requestAnimationFrame(step)
      }
    }
    frame = requestAnimationFrame(step)
  },
)

onBeforeUnmount(() => cancelAnimationFrame(frame))

const text = computed(() =>
  displayed.value === null ? props.placeholder : Math.round(displayed.value).toLocaleString(),
)
</script>

<template>
  <span class="animated-number">{{ text }}</span>
</template>

<style scoped>
.animated-number {
  font-variant-numeric: tabular-nums;
}
</style>
