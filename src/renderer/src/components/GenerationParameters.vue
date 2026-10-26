<script setup lang="ts">
import { computed } from 'vue'
import type { NaiGenParams, NaiSampler, NaiNoiseSchedule } from '@shared/types'
import { DEFAULT_GEN, DEFAULT_PARAMS } from '../store'
import SharedParams from './SharedParams.vue'
import ThemeSelect from './ThemeSelect.vue'
import Icon from './Icon.vue'
const { gen, params, disabled = false, sizeLocked = false } = defineProps<{
  gen: Pick<NaiGenParams, 'count'|'steps'|'scale'|'seed'|'cfgRescale'|'sampler'|'noiseSchedule'>
  params: Pick<NaiGenParams, 'width'|'height'|'qualityTags'|'ucPreset'>
  disabled?: boolean; sizeLocked?: boolean
}>()
const SAMPLERS: { v: NaiSampler; label: string }[] = [
  { v: 'k_euler_ancestral', label: 'Euler Ancestral' },
  { v: 'k_euler', label: 'Euler' },
  { v: 'k_dpmpp_2s_ancestral', label: 'DPM++ 2S Ancestral' },
  { v: 'k_dpmpp_2m_sde', label: 'DPM++ 2M SDE' },
  { v: 'k_dpmpp_2m', label: 'DPM++ 2M' },
  { v: 'k_dpmpp_sde', label: 'DPM++ SDE' }
]
const SCHEDULES: NaiNoiseSchedule[] = ['native', 'karras', 'exponential', 'polyexponential']

const advancedSummary = computed(() =>
  [
    SAMPLERS.find((s) => s.v === gen.sampler)?.label ?? gen.sampler,
    gen.noiseSchedule,
    `Rescale ${gen.cfgRescale}`,
    params.qualityTags ? '质量词开' : '质量词关',
    `UC ${params.ucPreset}`
  ].join(' · ')
)
const advancedChanged = computed(
  () =>
    gen.sampler !== DEFAULT_GEN.sampler ||
    gen.noiseSchedule !== DEFAULT_GEN.noiseSchedule ||
    gen.cfgRescale !== DEFAULT_GEN.cfgRescale ||
    params.qualityTags !== DEFAULT_PARAMS.qualityTags ||
    params.ucPreset !== DEFAULT_PARAMS.ucPreset
)

</script>
<template>
        <div class="gen-params">
          <SharedParams :params="params" :disabled="disabled" :size-locked="sizeLocked" :only="['size']" />
          <div class="param">
            <span class="side-label">张数（逐张生成）</span>
            <div class="seg block">
              <button v-for="n in [1, 2, 4]" :disabled="disabled" :key="n" :class="{ on: gen.count === n }" @click="gen.count = n">{{ n }}</button>
            </div>
          </div>
          <div class="param">
            <span class="side-label">步数 · {{ gen.steps }}</span>
            <input class="range" aria-label="步数" :disabled="disabled" type="range" min="1" max="50" v-model.number="gen.steps" />
          </div>
          <div class="param">
            <span class="side-label">Prompt Guidance · {{ gen.scale }}</span>
            <input class="range" aria-label="Prompt Guidance" :disabled="disabled" type="range" min="0" max="10" step="0.1" v-model.number="gen.scale" />
          </div>
          <div class="param">
            <span class="side-label">种子（留空随机）</span>
            <div class="pair">
              <input class="input sm" aria-label="种子" type="number" min="0" :disabled="disabled" v-model.number="gen.seed" placeholder="随机" />
              <button class="icon-btn sm" title="改回随机" :disabled="disabled" @click="gen.seed=null"><Icon name="x" :size="14" /></button>
            </div>
          </div>
        </div>

        <details class="gen-advanced">
          <summary>
            <Icon name="chevron" :size="14" class="gen-advanced-arrow" />
            <span class="gen-advanced-title">高级设置</span>
            <span v-if="advancedChanged" class="gen-advanced-dot" title="有参数改过默认值"></span>
            <span class="muted gen-advanced-sum">{{ advancedSummary }}</span>
          </summary>
          <div class="gen-params">
            <div class="param">
              <span class="side-label">自定义尺寸（64 的倍数）</span>
              <div class="pair">
                <input class="input sm" type="number" min="64" step="64" :disabled="disabled || sizeLocked" v-model.number="params.width" />
                <span class="muted">×</span>
                <input class="input sm" type="number" min="64" step="64" :disabled="disabled || sizeLocked" v-model.number="params.height" />
              </div>
            </div>
            <div class="param">
              <span class="side-label">Guidance Rescale · {{ gen.cfgRescale }}</span>
              <input class="range" aria-label="Guidance Rescale" :disabled="disabled" type="range" min="0" max="1" step="0.02" v-model.number="gen.cfgRescale" />
            </div>
            <div class="param">
              <span class="side-label">采样器</span>
              <ThemeSelect class="sm" :disabled="disabled" v-model="gen.sampler" :options="SAMPLERS.map(s => ({ value: s.v, label: s.label }))" aria-label="采样器" />
            </div>
            <div class="param">
              <span class="side-label">噪声调度</span>
              <ThemeSelect class="sm" :disabled="disabled" v-model="gen.noiseSchedule" :options="SCHEDULES.map(s => ({ value: s, label: s }))" aria-label="噪声调度" />
            </div>
            <SharedParams :params="params" :disabled="disabled" :only="['quality', 'uc']" />
            <slot />
          </div>
        </details>

</template>
