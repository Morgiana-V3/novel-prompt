<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from 'vue'
import {
  collections,
  generationCollection,
  refreshCollections,
  selectGenerationCollection,
} from './collections-state'
import { reportError } from '../../shared/lib/notifications'
import ThemeSelect from '../../shared/ui/ThemeSelect.vue'
const options = computed(() => collections.value.map((c) => ({ value: c.id, label: c.name })))
let unsubscribe: (() => void) | undefined
onMounted(() => {
  void refreshCollections().catch(reportError)
  unsubscribe = window.api.onGalleryChanged(() => {
    void refreshCollections().catch(reportError)
  })
})
onBeforeUnmount(() => unsubscribe?.())
</script>
<template>
  <div
    class="collection-picker"
    title="图片所属图集；是否长期保存由自动留存开关决定"
  >
    <ThemeSelect
      :model-value="generationCollection"
      :options="options"
      aria-label="生图保存图集"
      @update:model-value="selectGenerationCollection"
    />
  </div>
</template>
<style scoped>
.collection-picker {
  min-width: 100px;
  max-width: 160px;
  font-size: 11px;
}
</style>
