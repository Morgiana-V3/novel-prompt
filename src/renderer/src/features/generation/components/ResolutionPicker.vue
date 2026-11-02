<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  RESOLUTION_PRESETS,
  resolutionPreset,
  type Orientation,
} from '@shared/generation/resolutions'
import ThemeSelect from '../../../shared/ui/ThemeSelect.vue'
const props = defineProps<{ width: number; height: number; disabled?: boolean }>()
const emit = defineEmits<{ change: [size: { width: number; height: number }] }>()
const custom = ref(false)
watch(
  () => [props.width, props.height],
  () => {
    custom.value = false
  },
)
const match = computed(() => resolutionPreset(props.width, props.height))
const tier = computed({
  get: () => (custom.value ? 'custom' : (match.value?.tier ?? 'custom')),
  set: (key: string) => {
    custom.value = key === 'custom'
    if (custom.value) {
      return
    }
    const preset = RESOLUTION_PRESETS.find((p) => p.key === key)!
    let orientation: Orientation = 'square'
    if (props.width !== props.height) {
      orientation = props.width > props.height ? 'landscape' : 'portrait'
    }
    const [width, height] = preset[orientation] ?? preset.landscape
    emit('change', { width, height })
  },
})
const orientations: { key: Orientation; label: string }[] = [
  { key: 'landscape', label: '横图' },
  { key: 'portrait', label: '竖图' },
  { key: 'square', label: '方图' },
]
function orient(key: Orientation) {
  const preset = RESOLUTION_PRESETS.find((p) => p.key === tier.value)
  const size = preset?.[key]
  if (size) {
    emit('change', { width: size[0], height: size[1] })
  }
}
</script>
<template>
  <div class="resolution-picker">
    <ThemeSelect
      v-model="tier"
      class="sm"
      aria-label="尺寸档位"
      :disabled="disabled"
      :options="[
        ...RESOLUTION_PRESETS.map((p) => ({ value: p.key, label: p.label })),
        { value: 'custom', label: '自定义 · Custom' },
      ]"
    />
    <div
      v-if="tier !== 'custom'"
      class="seg block"
    >
      <button
        v-for="option in orientations"
        :key="option.key"
        :disabled="disabled || (tier === 'wallpaper' && option.key === 'square')"
        :class="{ on: match?.orientation === option.key }"
        :aria-pressed="match?.orientation === option.key"
        @click="orient(option.key)"
      >
        <span :class="['ratio-symbol', option.key]"></span>{{ option.label }}
      </button>
    </div>
    <div
      v-else
      class="pair"
    >
      <input
        class="input sm"
        aria-label="自定义宽度"
        type="number"
        min="64"
        max="4096"
        step="64"
        :value="width"
        :disabled="disabled"
        @change="
          emit('change', { width: Number(($event.target as HTMLInputElement).value), height })
        "
      />
      <span class="muted">×</span>
      <input
        class="input sm"
        aria-label="自定义高度"
        type="number"
        min="64"
        max="4096"
        step="64"
        :value="height"
        :disabled="disabled"
        @change="
          emit('change', { width, height: Number(($event.target as HTMLInputElement).value) })
        "
      />
    </div>
  </div>
</template>
<style scoped>
.resolution-picker {
  display: grid;
  gap: 8px;
}

.resolution-picker button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.ratio-symbol {
  display: inline-block;
  width: 14px;
  height: 10px;
  border: 1.5px solid currentcolor;
  border-radius: 2px;
}

.ratio-symbol.portrait {
  width: 10px;
  height: 14px;
}

.ratio-symbol.square {
  width: 12px;
  height: 12px;
}
</style>
