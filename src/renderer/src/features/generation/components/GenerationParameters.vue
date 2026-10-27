<script setup lang="ts">
import { computed } from 'vue'
import type { NaiGenParams, NaiSampler, NaiNoiseSchedule } from '@shared/generation/types'
import { DEFAULT_GEN } from '../state'
import { DEFAULT_PARAMS } from '../../prompts/state'
import SharedParams from './SharedParams.vue'
import ThemeSelect from '../../../shared/ui/ThemeSelect.vue'
import Icon from '../../../shared/ui/Icon.vue'
const props = withDefaults(
  defineProps<{
    gen: Pick<
      NaiGenParams,
      'count' | 'steps' | 'scale' | 'seed' | 'cfgRescale' | 'sampler' | 'noiseSchedule'
    >
    params: Pick<NaiGenParams, 'width' | 'height' | 'qualityTags' | 'ucPreset'>
    disabled?: boolean
    sizeLocked?: boolean
  }>(),
  { disabled: false, sizeLocked: false },
)
type GenerationOptions = typeof props.gen
type PromptParameters = typeof props.params
const emit = defineEmits<{
  changeGen: [patch: Partial<GenerationOptions>]
  changeParams: [patch: Partial<PromptParameters>]
}>()
function generationField<K extends keyof GenerationOptions>(key: K) {
  return computed({
    get: () => props.gen[key],
    set: (value: GenerationOptions[K]) => emit('changeGen', { [key]: value }),
  })
}
function parameterField<K extends keyof PromptParameters>(key: K) {
  return computed({
    get: () => props.params[key],
    set: (value: PromptParameters[K]) => emit('changeParams', { [key]: value }),
  })
}
const count = generationField('count')
const steps = generationField('steps')
const scale = generationField('scale')
const seed = generationField('seed')
const cfgRescale = generationField('cfgRescale')
const sampler = generationField('sampler')
const noiseSchedule = generationField('noiseSchedule')
const width = parameterField('width')
const height = parameterField('height')
const SAMPLERS: { v: NaiSampler; label: string }[] = [
  { v: 'k_euler_ancestral', label: 'Euler Ancestral' },
  { v: 'k_euler', label: 'Euler' },
  { v: 'k_dpmpp_2s_ancestral', label: 'DPM++ 2S Ancestral' },
  { v: 'k_dpmpp_2m_sde', label: 'DPM++ 2M SDE' },
  { v: 'k_dpmpp_2m', label: 'DPM++ 2M' },
  { v: 'k_dpmpp_sde', label: 'DPM++ SDE' },
]
const SCHEDULES: NaiNoiseSchedule[] = ['native', 'karras', 'exponential', 'polyexponential']

const advancedSummary = computed(() =>
  [
    SAMPLERS.find((samplerOption) => samplerOption.v === props.gen.sampler)?.label ??
      props.gen.sampler,
    props.gen.noiseSchedule,
    `Rescale ${props.gen.cfgRescale}`,
    props.params.qualityTags ? '质量词开' : '质量词关',
    `UC ${props.params.ucPreset}`,
  ].join(' · '),
)
const advancedChanged = computed(
  () =>
    props.gen.sampler !== DEFAULT_GEN.sampler ||
    props.gen.noiseSchedule !== DEFAULT_GEN.noiseSchedule ||
    props.gen.cfgRescale !== DEFAULT_GEN.cfgRescale ||
    props.params.qualityTags !== DEFAULT_PARAMS.qualityTags ||
    props.params.ucPreset !== DEFAULT_PARAMS.ucPreset,
)
</script>
<template>
  <div class="gen-params">
    <SharedParams
      :params="params"
      :disabled="disabled"
      :size-locked="sizeLocked"
      :only="['size']"
      @change-params="emit('changeParams', $event)"
    />
    <div class="param">
      <span class="side-label">张数（逐张生成）</span>
      <div class="seg block">
        <button
          v-for="n in [1, 2, 4]"
          :key="n"
          :disabled="disabled"
          :class="{ on: gen.count === n }"
          @click="count = n"
        >
          {{ n }}
        </button>
      </div>
    </div>
    <div class="param">
      <span class="side-label">步数 · {{ gen.steps }}</span>
      <input
        v-model.number="steps"
        class="range"
        aria-label="步数"
        :disabled="disabled"
        type="range"
        min="1"
        max="50"
      />
    </div>
    <div class="param">
      <span class="side-label">Prompt Guidance · {{ gen.scale }}</span>
      <input
        v-model.number="scale"
        class="range"
        aria-label="Prompt Guidance"
        :disabled="disabled"
        type="range"
        min="0"
        max="10"
        step="0.1"
      />
    </div>
    <div class="param">
      <span class="side-label">种子（留空随机）</span>
      <div class="pair">
        <input
          v-model.number="seed"
          class="input sm"
          aria-label="种子"
          type="number"
          min="0"
          :disabled="disabled"
          placeholder="随机"
        />
        <button
          class="icon-btn sm"
          title="改回随机"
          :disabled="disabled"
          @click="seed = null"
        >
          <Icon
            name="x"
            :size="14"
          />
        </button>
      </div>
    </div>
  </div>

  <details class="gen-advanced">
    <summary>
      <Icon
        name="chevron"
        :size="14"
        class="gen-advanced-arrow"
      />
      <span class="gen-advanced-title">高级设置</span>
      <span
        v-if="advancedChanged"
        class="gen-advanced-dot"
        title="有参数改过默认值"
      ></span>
      <span class="muted gen-advanced-sum">{{ advancedSummary }}</span>
    </summary>
    <div class="gen-params">
      <div class="param">
        <span class="side-label">自定义尺寸（64 的倍数）</span>
        <div class="pair">
          <input
            v-model.number="width"
            class="input sm"
            type="number"
            min="64"
            step="64"
            :disabled="disabled || sizeLocked"
          />
          <span class="muted">×</span>
          <input
            v-model.number="height"
            class="input sm"
            type="number"
            min="64"
            step="64"
            :disabled="disabled || sizeLocked"
          />
        </div>
      </div>
      <div class="param">
        <span class="side-label">Guidance Rescale · {{ gen.cfgRescale }}</span>
        <input
          v-model.number="cfgRescale"
          class="range"
          aria-label="Guidance Rescale"
          :disabled="disabled"
          type="range"
          min="0"
          max="1"
          step="0.02"
        />
      </div>
      <div class="param">
        <span class="side-label">采样器</span>
        <ThemeSelect
          v-model="sampler"
          class="sm"
          :disabled="disabled"
          :options="SAMPLERS.map((s) => ({ value: s.v, label: s.label }))"
          aria-label="采样器"
        />
      </div>
      <div class="param">
        <span class="side-label">噪声调度</span>
        <ThemeSelect
          v-model="noiseSchedule"
          class="sm"
          :disabled="disabled"
          :options="SCHEDULES.map((s) => ({ value: s, label: s }))"
          aria-label="噪声调度"
        />
      </div>
      <SharedParams
        :params="params"
        :disabled="disabled"
        :only="['quality', 'uc']"
        @change-params="emit('changeParams', $event)"
      />
      <slot />
    </div>
  </details>
</template>
