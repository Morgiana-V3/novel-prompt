<script setup lang="ts">
import type { NaiGenParams, NaiVersion } from '@shared/generation/types'
import GenerationParameters from '../generation/components/GenerationParameters.vue'
import { settingsState } from '../settings/state'

defineProps<{ disabled: boolean }>()
const draft = defineModel<{ version: NaiVersion; negative: string; params: NaiGenParams }>({
  required: true,
})
function updateParams(patch: Partial<NaiGenParams>) {
  Object.assign(draft.value.params, patch)
}
</script>

<template>
  <section
    class="reverse-generation-settings"
    aria-label="反推生图设置"
  >
    <div class="reverse-generation-options">
      <label
        >生图模型
        <select
          v-model="draft.version"
          :disabled="disabled"
          aria-label="反推生图模型"
        >
          <option value="v5">NovelAI V5</option>
          <option value="v4.5">NovelAI V4.5</option>
        </select>
      </label>
      <span
        >{{ settingsState.settings?.naiFreeOnly !== false ? '仅使用免费额度' : '允许消耗 Anlas' }} ·
        沿用账户设置</span
      >
      <span>每个组合生成一张</span>
    </div>
    <details>
      <summary>
        负面提示词与生成参数 · {{ draft.params.width }}×{{ draft.params.height }} ·
        {{ draft.params.steps }} 步
      </summary>
      <label
        class="reverse-negative-label"
        for="reverse-negative"
        >负面提示词</label
      >
      <textarea
        id="reverse-negative"
        v-model="draft.negative"
        :disabled="disabled"
        rows="3"
        placeholder="本次反推独立使用的负面提示词"
      />
      <GenerationParameters
        :gen="draft.params"
        :params="draft.params"
        :disabled="disabled"
        hide-count
        @change-gen="updateParams"
        @change-params="updateParams"
      />
    </details>
  </section>
</template>

<style scoped>
.reverse-generation-settings {
  flex-shrink: 0;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  font-size: 12px;
}

.reverse-generation-options,
.reverse-generation-options label {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.reverse-generation-options span {
  color: var(--text2);
}

select,
textarea {
  padding: 7px 10px;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--line2);
  border-radius: 6px;
}

details {
  margin-top: 12px;
}

summary {
  cursor: pointer;
  color: var(--text2);
}

.reverse-negative-label {
  display: block;
  margin: 14px 0 6px;
}

textarea {
  width: 100%;
  resize: vertical;
  font: 12px/1.7 var(--mono);
}
</style>
