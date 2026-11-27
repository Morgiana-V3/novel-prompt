<script setup lang="ts">
import Icon from '../../shared/ui/Icon.vue'
import type { CanvasImage, CanvasGalleryAsset } from './session'

export type GalleryCanvasImage = CanvasImage & { asset: CanvasGalleryAsset }
defineProps<{
  images: GalleryCanvasImage[]
  label: string
  selected: number[]
  disabled: boolean
  hideActions?: boolean
  expanded: boolean
}>()
const emit = defineEmits<{ select: [image: GalleryCanvasImage]; toggle: [] }>()
</script>
<template>
  <div
    v-if="!hideActions"
    class="strip-actions"
  >
    <slot />
    <button
      v-if="images.length"
      type="button"
      class="btn small"
      :aria-expanded="expanded"
      :aria-label="expanded ? '收起 · ' + label : label"
      :disabled="disabled"
      @click="emit('toggle')"
    >
      <Icon
        name="image"
        :size="14"
      />
      {{ expanded ? '收起' : '从画布选择' }}
    </button>
  </div>
  <div
    v-if="expanded && images.length"
    class="canvas-reference-strip"
    role="group"
    :aria-label="label"
  >
    <span>{{ label }}</span>
    <div class="strip-images">
      <button
        v-for="image in images"
        :key="image.id"
        type="button"
        :disabled="disabled || selected.includes(image.id)"
        :class="{ bound: selected.includes(image.id) }"
        :title="label + ' · 画布图片 #' + image.id"
        :aria-label="label + ' · 画布图片 #' + image.id"
        :aria-pressed="selected.includes(image.id)"
        @click="emit('select', image)"
      >
        <img
          :src="'np-img://img/' + encodeURIComponent(image.asset.name)"
          alt=""
          loading="lazy"
          decoding="async"
        /><span>#{{ image.id }}</span>
      </button>
    </div>
  </div>
</template>
<style scoped>
.strip-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.canvas-reference-strip {
  display: grid;
  gap: 5px;
  color: var(--text2);
  font-size: 11px;
  min-width: 0;
}

.strip-images {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 2px;
}

.strip-images button {
  position: relative;
  flex: none;
  width: 56px;
  height: 45px;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--line2);
  border-radius: 7px;
  background: var(--hover);
}

.strip-images button:hover:enabled,
.strip-images button.bound {
  border-color: var(--pink);
  box-shadow: 0 0 0 1px var(--pink);
}

.strip-images img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.strip-images button span {
  position: absolute;
  right: 2px;
  bottom: 2px;
  padding: 0 3px;
  border-radius: 3px;
  background: rgb(20 20 30 / 75%);
  color: white;
  font: 10px var(--mono);
}
</style>
