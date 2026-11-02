<script setup lang="ts">
import { computed } from 'vue'
import type { NaiVersion, UcPreset } from '@shared/generation/types'
import {
  qualityTagsFor,
  effectiveQualityMode,
  UC_PRESETS,
  UC_LABEL,
} from '@shared/generation/presets'
import { promptState } from '../state'
import { settingsState } from '../../settings/state'
import ThemeSelect from '../../../shared/ui/ThemeSelect.vue'
const props = defineProps<{ kind: 'quality' | 'uc'; disabled?: boolean }>()
const version = computed<NaiVersion>(() => settingsState.settings?.naiVersion ?? 'v4.5')
const options = Object.entries(UC_LABEL).map(([value, label]) => ({
  value,
  label: `UC · ${label}`,
}))
const uc = computed({
  get: () => promptState.params.ucPreset,
  set: (value: string) => {
    promptState.params.ucPreset = value as UcPreset
  },
})
const qualityOptions = computed(() => [
  { value: 'standard', label: '质量词 · Standard' },
  ...(version.value === 'v5' ? [{ value: 'light', label: '质量词 · Light' }] : []),
  { value: 'none', label: '质量词 · None' },
])
const quality = computed({
  get: () => effectiveQualityMode(version.value, promptState.params),
  set: (value: string) => {
    promptState.params.qualityTags = value !== 'none'
    promptState.params.qualityMode = value === 'light' ? 'light' : 'standard'
  },
})
const hint = computed(() =>
  props.kind === 'quality'
    ? qualityTagsFor(version.value, quality.value) || '仅使用你填写的主提示词'
    : UC_PRESETS[version.value][promptState.params.ucPreset] || '仅使用你填写的负面提示词',
)
</script>
<template>
  <div
    class="prompt-preset-control"
    :title="hint"
  >
    <ThemeSelect
      v-if="kind === 'quality'"
      v-model="quality"
      class="sm uc-select quality-select"
      :options="qualityOptions"
      :disabled="disabled"
      aria-label="内置质量词"
    />
    <ThemeSelect
      v-else
      v-model="uc"
      class="sm uc-select"
      :options="options"
      :disabled="disabled"
      aria-label="内置负面预设"
    />
  </div>
</template>
<style scoped>
/* 与右下角的复制 / 片段按钮同一基线：左侧是设置，右侧是操作 */
.prompt-preset-control {
  position: absolute;
  bottom: 3px;
  left: 8px;
  z-index: 2;
}

/* ThemeSelect 是多根组件，作用域样式要经由 :deep 才能落到按钮上 */
.prompt-preset-control :deep(.uc-select) {
  width: auto;
  height: 24px;
  min-height: 24px;
  gap: 6px;
  padding: 0 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  box-shadow: none;
  color: var(--text2);
  font-size: 11.5px;
}

.prompt-preset-control :deep(.uc-select:hover:not(:disabled)),
.prompt-preset-control :deep(.uc-select.expanded) {
  background: var(--hover);
  color: var(--text);
}
</style>
