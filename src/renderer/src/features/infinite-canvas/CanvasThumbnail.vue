<script setup lang="ts">
import Icon from '../../shared/ui/Icon.vue'
import type { CanvasPreview } from './use-canvas-previews'

defineProps<{ preview?: CanvasPreview; showError?: boolean }>()
</script>

<template>
  <img
    v-if="preview?.state === 'ready'"
    class="canvas-thumbnail"
    :src="preview.url"
    alt=""
    draggable="false"
    decoding="async"
  />
  <span
    v-else
    class="canvas-thumbnail-placeholder"
  >
    <Icon
      :name="preview?.state === 'failed' ? 'warn' : 'image'"
      :size="22"
    />
    <span v-if="showError && preview?.state === 'failed'">无法读取图片</span>
  </span>
</template>

<style scoped>
.canvas-thumbnail {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}

.canvas-thumbnail-placeholder {
  display: grid;
  width: 100%;
  height: 100%;
  place-content: center;
  justify-items: center;
  gap: 4px;
  overflow: hidden;
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
}
</style>
