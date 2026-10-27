<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PageVersion, PageRegion } from '@shared/workspace/model'
import Icon from '../../../shared/ui/Icon.vue'
import ImageViewport from '../../../shared/ui/ImageViewport.vue'
const props = defineProps<{
  viewed: PageVersion
  current: PageVersion
  overlay: string
  historical: boolean
  busy: boolean
  displayRegions: PageRegion[]
  overlayMode: 'annotation' | 'execution'
}>()
const zoom = defineModel<number>('zoom', { required: true })
const showMask = defineModel<boolean>('showMask', { required: true })
const emit = defineEmits<{ missing: [version: PageVersion]; recover: []; edit: [] }>()
const viewport = ref<InstanceType<typeof ImageViewport>>()
const emptyLabel = computed(() => {
  if (props.viewed.imageCleared) {
    return '图片已清理，提示词和生成参数仍保留'
  }
  if (props.viewed.image?.missing) {
    return '图片文件缺失，生成记录仍保留'
  }
  return '暂无图片'
})
defineExpose({ reset: () => viewport.value?.reset() })
</script>

<template>
  <ImageViewport
    v-if="viewed.image && !viewed.image.missing"
    ref="viewport"
    v-model:zoom="zoom"
    class="pw-viewport"
    :width="viewed.image.width || 1"
    :height="viewed.image.height || 1"
    label="创作画布"
    ><img
      :src="viewed.image.url"
      :alt="viewed.label"
      draggable="false"
      @error="emit('missing', viewed)" /><img
      v-if="overlay && showMask && !historical"
      class="pw-overlay"
      :src="overlay"
      alt="区域标记"
      draggable="false"
  /></ImageViewport>
  <div
    v-else
    class="pw-blank"
  >
    <Icon
      name="image"
      :size="40"
    /><span>{{ emptyLabel }}</span
    ><button
      v-if="viewed.image?.missing"
      class="btn small"
      :disabled="busy"
      @click="emit('recover')"
    >
      恢复原图
    </button>
  </div>
  <div class="pw-canvas-actions">
    <button
      class="btn accent small"
      :disabled="busy || historical || !current.image || current.image.missing"
      @click="emit('edit')"
    >
      <Icon
        name="edit"
        :size="14"
      />区域批注 / 遮罩</button
    ><button
      v-if="overlay && !historical"
      class="btn ghost small"
      @click="showMask = !showMask"
    >
      {{ showMask ? '隐藏标记' : '显示标记' }}</button
    ><span
      v-if="displayRegions.length && !historical"
      class="muted small"
      >{{ overlayMode === 'execution' ? '执行遮罩' : '说明区域' }}
      {{ displayRegions.map((region) => region.label).join('、') }}</span
    >
  </div>
</template>

<style scoped>
.pw-viewport {
  flex: 1;
  min-height: 120px;
  border: 1px solid var(--line2);
  border-radius: 12px;
  background: var(--side);
}

.pw-overlay {
  pointer-events: none;
}

@media (width <= 1050px) {
  .pw-canvas-actions > .muted {
    display: none;
  }
}

.pw-canvas-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-shrink: 0;
  height: 48px;
  padding: 8px 0;
}
</style>
