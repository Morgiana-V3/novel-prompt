<script setup lang="ts">
import { computed } from 'vue'
import { NAI_NOISE_SCHEDULES, NAI_SAMPLERS, type NaiSampler } from '@shared/generation/types'
import Icon from '../../shared/ui/Icon.vue'
import ThemeSelect from '../../shared/ui/ThemeSelect.vue'
import { vSegIndicator } from '../../shared/lib/seg-indicator'
import SharedParams from '../generation/components/SharedParams.vue'
import { isGenerateKind, operationLabel, operationSize } from './operations'
import type { CanvasAsset, CanvasOperation } from './session'

const card = defineModel<CanvasOperation>('card', { required: true })
const props = defineProps<{
  source?: CanvasAsset
  disabled: boolean
}>()
const emit = defineEmits<{ references: [] }>()
const params = computed(() => card.value.request.params)
const targetSize = computed(() => operationSize(card.value, props.source))
const samplerLabels: Record<NaiSampler, string> = {
  k_euler_ancestral: 'Euler Ancestral',
  k_euler: 'Euler',
  k_dpmpp_2s_ancestral: 'DPM++ 2S Ancestral',
  k_dpmpp_2m_sde: 'DPM++ 2M SDE',
  k_dpmpp_2m: 'DPM++ 2M',
  k_dpmpp_sde: 'DPM++ SDE',
}
const samplers = NAI_SAMPLERS.map((value) => ({ value, label: samplerLabels[value] }))
const schedules = NAI_NOISE_SCHEDULES.map((value) => ({ value, label: value }))
const rescaleOptions = computed(() => {
  const values = Array.from({ length: 51 }, (_, index) => index / 50)
  if (!values.includes(params.value.cfgRescale)) {
    values.push(params.value.cfgRescale)
    values.sort((first, second) => first - second)
  }
  return values.map((value) => ({ value, label: String(value) }))
})
const margins = { top: '上', bottom: '下', left: '左', right: '右' } as const
const samplingControls = [
  { key: 'steps', label: '步数', min: 1, max: 50, step: 1 },
  { key: 'scale', label: 'Prompt Guidance', min: 0, max: 10, step: 0.1 },
] as const

function rollSeed() {
  params.value.seed = crypto.getRandomValues(new Uint32Array(1))[0]
}

function setSeed(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.validity.valid) {
    params.value.seed = input.value === '' ? null : input.valueAsNumber
  } else {
    input.value = String(params.value.seed ?? '')
  }
}
function setMargin(side: keyof typeof margins, event: Event) {
  const input = event.target as HTMLInputElement
  const value = Math.min(2048, Math.max(0, Math.round((input.valueAsNumber || 0) / 64) * 64))
  card.value.margins[side] = value
  input.value = String(value)
}
</script>

<template>
  <fieldset
    class="param-cards"
    :disabled="disabled"
  >
    <button
      v-if="isGenerateKind(card.kind) && card.sourceId !== null"
      class="base-summary"
      @click="emit('references')"
    >
      <Icon
        name="image"
        :size="15"
      />
      图生图 · 底图 #{{ card.sourceId }}
      <span>强度 {{ card.strength }} · 噪声 {{ card.noise }}</span
      ><b>调整底图 ›</b>
    </button>
    <section class="op-card">
      <div class="model-row">
        <div class="param-field">
          <h3>生成模型</h3>
          <div
            v-seg-indicator
            class="seg model-options"
          >
            <button
              v-for="version in ['v4.5', 'v5'] as const"
              :key="version"
              :class="{ on: card.request.version === version }"
              :title="version === 'v5' ? 'NovelAI V5' : 'NovelAI V4.5 Full'"
              :aria-pressed="card.request.version === version"
              @click="card.request.version = version"
            >
              {{ version.toUpperCase() }}
            </button>
          </div>
        </div>
        <div class="param-field">
          <h3>生成张数</h3>
          <div
            v-seg-indicator
            class="seg count-options"
          >
            <button
              v-for="count in [1, 2, 4]"
              :key="count"
              :class="{ on: params.count === count }"
              :aria-pressed="params.count === count"
              @click="params.count = count"
            >
              {{ count }} 张
            </button>
          </div>
        </div>
      </div>
      <button
        v-if="card.request.version === 'v5' && params.vibeReferences?.length"
        class="base-summary"
        @click="emit('references')"
      >
        Vibe 仅支持 V4.5。请切回 V4.5，或前往底图与参考移除 Vibe。
      </button>
    </section>
    <section class="op-card">
      <h3>画幅与种子</h3>
      <div class="size-row">
        <SharedParams
          v-if="isGenerateKind(card.kind)"
          expanded-sizes
          :disabled="disabled"
          :params="params"
          :only="['size']"
          @change-params="Object.assign(params, $event)"
        />

        <div
          v-else
          class="param-field"
        >
          <h3>输出尺寸</h3>
          <span v-if="source?.width && source.height && targetSize">
            原图 {{ source.width }}×{{ source.height }} → {{ operationLabel(card.kind) }}后
            {{ targetSize.width }}×{{ targetSize.height }}
          </span>
          <span v-else>选择底图后计算尺寸</span>
        </div>
        <div class="seed-field">
          <span>随机种子</span
          ><span class="seed-input">
            <input
              class="input sm"
              aria-label="随机种子"
              :value="params.seed"
              type="number"
              min="0"
              max="4294967295"
              placeholder="留空随机"
              @change="setSeed"
            />
            <button
              class="icon-btn sm"
              title="生成一个可复用的随机种子，清空输入可恢复逐张随机。"
              aria-label="随机生成种子"
              @click="rollSeed"
            >
              <Icon
                name="dice"
                :size="14"
              />
            </button>
          </span>
        </div>
      </div>
    </section>
    <section class="op-card">
      <h3>采样与引导</h3>
      <div class="range-list">
        <label
          v-for="control in samplingControls"
          :key="control.key"
          class="op-range"
        >
          <span>{{ control.label }}</span>
          <input
            v-model.number="params[control.key]"
            type="range"
            class="range"
            :aria-label="control.label"
            :min="control.min"
            :max="control.max"
            :step="control.step"
          />
          <output>{{ params[control.key] }}</output>
        </label>
        <label
          v-if="card.kind === 'inpaint' || card.kind === 'enhance'"
          class="op-range"
        >
          <span>{{ card.kind === 'inpaint' ? '重绘强度' : '增强强度' }}</span>
          <input
            v-model.number="card.strength"
            class="range"
            type="range"
            :min="card.kind === 'inpaint' ? 0.01 : 0.2"
            :max="card.kind === 'inpaint' ? 1 : 0.8"
            :step="card.kind === 'inpaint' ? 0.01 : 0.05"
          />
          <output>{{ card.strength.toFixed(2) }}</output>
        </label>
        <template v-if="card.kind === 'enhance'">
          <label class="op-range"
            ><span>噪声</span>
            <input
              v-model.number="card.noise"
              class="range"
              type="range"
              min="0"
              max="0.5"
              step="0.05"
            />
            <output>{{ card.noise.toFixed(2) }}</output>
          </label>
          <div class="op-range">
            <span>增强倍率</span>
            <div
              v-seg-indicator
              class="seg scale-options"
            >
              <button
                v-for="scale in [1, 1.5] as const"
                :key="scale"
                :aria-pressed="card.scale === scale"
                :class="{ on: card.scale === scale }"
                @click="card.scale = scale"
              >
                {{ scale }}×
              </button>
            </div>
          </div>
        </template>
      </div>
      <details class="advanced-settings">
        <summary>
          高级设置
          <span
            >{{ samplerLabels[params.sampler] }} · {{ params.noiseSchedule }} · Rescale
            {{ params.cfgRescale }}</span
          >
        </summary>
        <div class="advanced-grid">
          <div class="param-field">
            <span>Guidance Rescale</span
            ><ThemeSelect
              v-model="params.cfgRescale"
              class="sm"
              aria-label="Guidance Rescale"
              :options="rescaleOptions"
              :disabled="disabled"
            />
          </div>
          <div class="param-field">
            <span>采样器</span
            ><ThemeSelect
              v-model="params.sampler"
              class="sm"
              aria-label="采样器"
              :options="samplers"
              :disabled="disabled"
            />
          </div>
          <div class="param-field">
            <span>噪声调度</span
            ><ThemeSelect
              v-model="params.noiseSchedule"
              class="sm"
              aria-label="噪声调度"
              :options="schedules"
              :disabled="disabled"
            />
          </div>
        </div>
      </details>
    </section>
    <section
      v-if="card.kind === 'outpaint'"
      class="op-card"
    >
      <h3>四边扩展</h3>
      <div class="margin-grid">
        <label
          v-for="(label, side) in margins"
          :key="side"
          class="param-field"
          ><span>{{ label }}侧扩展（px）</span
          ><input
            class="input sm"
            :value="card.margins[side]"
            type="number"
            min="0"
            max="2048"
            step="64"
            @change="setMargin(side, $event)"
        /></label>
      </div>
    </section>
  </fieldset>
</template>

<style scoped>
.param-cards {
  display: grid;
  gap: 12px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.advanced-grid,
.margin-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 22px;
}

.advanced-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 12px;
}

.margin-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.param-field,
.size-row :deep(.param) {
  display: grid;
  align-content: start;
  gap: 6px;
  min-width: 0;
}

.model-row,
.size-row {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 12px 20px;
}

.model-options {
  width: min(132px, 100%);
}

.count-options {
  width: 168px;
}

.model-row .seg button {
  flex: 1 0 auto;
}

.size-row :deep(.param) {
  flex: 1 1 320px;
  max-width: 420px;
}

.size-row :deep(.resolution-picker) {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: center;
}

.size-row :deep(.resolution-picker .seg button) {
  padding-inline: 6px;
  gap: 4px;
}

.range-list {
  display: grid;
  gap: 8px;
}

.scale-options {
  justify-self: start;
}

.param-field,
.seed-field,
.size-row :deep(.side-label) {
  font-size: 12px;
  color: var(--text2);
}

.param-field > span {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.seed-field {
  display: grid;
  gap: 6px;
  width: min(190px, 100%);
}

.seed-field > span:first-child {
  white-space: nowrap;
}

.seed-input {
  position: relative;
  min-width: 0;
  flex: 1;
}

.seed-input input {
  width: 100%;
  padding-right: 32px;
}

.seed-input button {
  position: absolute;
  right: 3px;
  top: 50%;
  transform: translateY(-50%);
}

.base-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  text-align: left;
  padding: 9px 12px;
  border-radius: 9px;
  background: var(--pink-soft);
  color: var(--pink-deep);
  font-size: 12px;
}

.base-summary b {
  margin-left: auto;
}

.advanced-settings {
  border-top: 1px solid var(--line);
  padding-top: 10px;
}

.advanced-settings summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--text2);
}

.advanced-settings summary span {
  color: var(--muted);
  margin-left: 8px;
}

@media (width <= 600px) {
  .size-row :deep(.resolution-picker) {
    grid-template-columns: repeat(auto-fit, minmax(min(148px, 100%), 1fr));
  }

  .advanced-grid {
    grid-template-columns: 1fr;
  }

  .margin-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
