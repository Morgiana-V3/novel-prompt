<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from '../../shared/ui/Icon.vue'
import type { CanvasPreview } from './use-canvas-previews'

const props = defineProps<{ preview?: CanvasPreview; showError?: boolean }>()
const url = computed(() => (props.preview?.state === 'ready' ? props.preview.url : undefined))
const loadFailed = ref(false)
watch(url, () => {
  loadFailed.value = false
})
const failed = computed(() => loadFailed.value || props.preview?.state === 'failed')
</script>

<template>
  <img
    v-if="url && !loadFailed"
    :key="url"
    class="canvas-thumbnail"
    :src="url"
    alt=""
    draggable="false"
    decoding="async"
    @error="loadFailed = true"
  />
  <span
    v-else
    class="canvas-thumbnail-placeholder"
  >
    <Icon
      :name="failed ? 'warn' : 'image'"
      :size="22"
    />
    <span v-if="showError && failed">无法读取图片</span>
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
