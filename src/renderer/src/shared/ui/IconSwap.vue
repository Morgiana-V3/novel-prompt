<script setup lang="ts">
import Icon from './Icon.vue'
import type { IconName } from './icons'

/**
 * 原地切换的状态图标（复制 → 已复制、加入 → 已加入、编辑 → 保存）：
 * 旧图标缩小、轻微模糊着退场，新图标在同一格里放大入场，交叉溶解而不是瞬间换图。
 * 首次渲染不播放动画；只有 name 变化时才过渡。
 */
withDefaults(defineProps<{ name: IconName; size?: number; stroke?: number }>(), {
  size: 18,
  stroke: 1.8,
})
</script>

<template>
  <span
    class="icon-swap"
    aria-hidden="true"
  >
    <Transition name="icon-swap">
      <Icon
        :key="name"
        :name="name"
        :size="size"
        :stroke="stroke"
      />
    </Transition>
  </span>
</template>

<style scoped>
.icon-swap {
  display: inline-grid;
  flex-shrink: 0;
  place-items: center;
  vertical-align: middle;
}

.icon-swap > .icon {
  grid-area: 1 / 1;
}

.icon-swap-enter-active,
.icon-swap-leave-active {
  transition:
    opacity var(--dur-slow) var(--ease-morph),
    filter var(--dur-slow) var(--ease-morph),
    transform var(--dur-emph) var(--ease-glide);
}

.icon-swap-enter-from {
  opacity: 0;
  filter: blur(2px);
  transform: scale(0.5) rotate(-24deg);
}

.icon-swap-leave-to {
  opacity: 0;
  filter: blur(2px);
  transform: scale(0.5) rotate(24deg);
}
</style>
