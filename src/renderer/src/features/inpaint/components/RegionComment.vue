<script setup lang="ts">
import { computed } from 'vue'
import type { Point, Region } from '../model'
import Icon from '../../../shared/ui/Icon.vue'
import ThemeSelect from '../../../shared/ui/ThemeSelect.vue'
import { vAutosize } from '../../../shared/lib/autosize'
const props = defineProps<{
  region: Region
  position: Point
  characterOptions: { value: number | null; label: string }[]
}>()
const emit = defineEmits<{
  update: [patch: Pick<Region, 'instruction'> | Pick<Region, 'target'>]
  finish: []
}>()
const instruction = computed({
  get: () => props.region.instruction,
  set: (instruction: string) => emit('update', { instruction }),
})
const target = computed({
  get: () => props.region.target,
  set: (target: number | null) => emit('update', { target }),
})
</script>

<template>
  <div
    class="ip-comment"
    :style="{ left: position.x + 'px', top: position.y + 'px' }"
    role="group"
    :aria-label="`区域 ${region.label} 批注`"
  >
    <div class="row">
      <b>区域 {{ region.label }}</b
      ><button
        class="icon-btn sm ml-auto"
        title="收起批注"
        @click="emit('finish')"
      >
        <Icon
          name="x"
          :size="14"
        />
      </button>
    </div>
    <textarea
      v-model="instruction"
      v-autosize
      class="input ip-annotation"
      placeholder="描述想修改的内容，支持自然语言、tag、权重…"
      aria-label="浮动区域批注"
    ></textarea>
    <label class="field-label"
      >对应角色<ThemeSelect
        v-model="target"
        class="sm"
        :options="characterOptions"
        aria-label="浮动批注对应角色"
    /></label>
    <button
      class="btn primary small"
      @click="emit('finish')"
    >
      完成批注
    </button>
  </div>
</template>

<style scoped>
.ip-comment .field-label {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ip-comment.fade-leave-active {
  pointer-events: none;
}

.ip-comment .input.sm {
  width: 100%;
  max-width: none;
}

.ip-comment :deep(.theme-select) {
  width: 100%;
  max-width: none;
}

.ip-comment {
  max-height: calc(100% - 24px);
  overflow-y: auto;
  position: absolute;
  z-index: 5;
  width: 280px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: var(--bg);
  border: 1px solid var(--pink-line);
  border-radius: 14px;
  box-shadow: 0 12px 40px #0003;
}
</style>
