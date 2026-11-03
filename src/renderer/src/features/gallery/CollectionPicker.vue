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

/**
 * 不传 modelValue 时选择的是生图页的全局图集；
 * 工作台等有独立归属的地方传入自己的值并处理 update 事件。
 */
const props = withDefaults(
  defineProps<{ modelValue?: string; disabled?: boolean; title?: string }>(),
  { modelValue: undefined, disabled: false, title: '图片所属图集；是否长期保存由自动留存开关决定' },
)
const emit = defineEmits<{ 'update:modelValue': [id: string] }>()
const options = computed(() => collections.value.map((c) => ({ value: c.id, label: c.name })))
const selected = computed(() => props.modelValue ?? generationCollection.value)
function select(id: string | null) {
  if (!id) {
    return
  }
  if (props.modelValue === undefined) {
    selectGenerationCollection(id)
    return
  }
  emit('update:modelValue', id)
}
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
    :title="title"
  >
    <ThemeSelect
      :model-value="selected"
      :options="options"
      :disabled="disabled"
      aria-label="生图保存图集"
      @update:model-value="select"
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
