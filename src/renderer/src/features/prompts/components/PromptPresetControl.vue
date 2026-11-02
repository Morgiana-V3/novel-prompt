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
.prompt-preset-control {
  position: absolute;
  bottom: 7px;
  left: 12px;
  z-index: 2;
}

.uc-select {
  width: 135px;
  min-height: 25px;
  padding: 3px 8px;
  font-size: 11px;
  border: 0;
  box-shadow: none;
}

.quality-select {
  width: 170px;
}
</style>
