<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ReverseTrial } from './use-reverse-trials'
import { importGenerationRequest } from '../prompts/actions'
import { imageState } from '../generation/state'
import { cleanErr } from '../../shared/lib/format'
import { shellState } from '../../shared/state/shell'

const props = defineProps<{
  index: number
  stylePrompt?: string
  trial?: ReverseTrial
  disabled?: boolean
  status: string
}>()
const emit = defineEmits<{ retry: [] }>()
const actionBusy = ref(false)
const actionError = ref('')
const retained = ref(false)
const favorited = ref(false)
async function act(action: 'retain' | 'favorite' | 'adopt') {
  const trial = props.trial
  if (!trial?.image || props.disabled || actionBusy.value) {
    return
  }
  actionBusy.value = true
  actionError.value = ''
  try {
    if (action === 'adopt') {
      await importGenerationRequest(JSON.parse(JSON.stringify(trial.request)), '已采用反推方案')
      imageState.currentImage = { ...trial.image }
      shellState.tab = 'generate'
    } else {
      if (
        !retained.value &&
        trial.image.storage !== 'saved' &&
        trial.image.storage !== 'workspace'
      ) {
        await window.api.naiRetain(trial.image.name)
      }
      retained.value = true
      if (action === 'favorite') {
        await window.api.recipesCreate(trial.image.name)
        favorited.value = true
      }
    }
  } catch (error) {
    actionError.value = cleanErr(error)
  } finally {
    actionBusy.value = false
  }
}
watch(
  () => [props.trial?.image?.name, props.trial?.image?.url],
  () => {
    retained.value = props.trial?.image?.storage === 'saved'
    favorited.value = false
    actionError.value = ''
  },
  { immediate: true },
)
const styleLabel = computed(() => {
  const style = props.trial?.style ?? props.stylePrompt
  return style === undefined ? '识别后推荐画师组合' : style || '无画师对照'
})
</script>

<template>
  <article
    class="reverse-trial-inspector"
    :aria-label="`方案 ${index + 1} 信息`"
  >
    <header>
      <div>
        <h3>方案 {{ index + 1 }}</h3>
        <span>{{ status }}</span>
      </div>
    </header>
    <div class="inspector-body">
      <span class="inspector-eyebrow">画师组合</span>
      <span
        class="preview-style"
        :title="styleLabel"
        >{{ styleLabel }}</span
      >
      <span
        v-if="trial?.score !== undefined"
        title="仅辅助比较，不代表还原百分比"
        >风格相似度 {{ trial.score.toFixed(3) }}</span
      >
      <span
        v-if="trial?.error"
        class="preview-error"
        >{{ trial.error }}</span
      >
      <div
        v-if="trial?.image"
        class="preview-actions"
      >
        <button
          class="btn small"
          :disabled="disabled || actionBusy || retained"
          @click="act('retain')"
        >
          {{ retained ? '已留存' : '留存' }}
        </button>
        <button
          class="btn small"
          :disabled="disabled || actionBusy || favorited"
          @click="act('favorite')"
        >
          {{ favorited ? '已收藏' : '收藏配置' }}
        </button>
        <button
          class="btn small"
          :disabled="disabled || actionBusy"
          @click="emit('retry')"
        >
          换种子再试
        </button>
        <button
          class="btn small primary"
          :disabled="disabled || actionBusy"
          @click="act('adopt')"
        >
          采用配置
        </button>
      </div>
      <span
        v-if="actionError"
        class="preview-error"
        role="alert"
        >{{ actionError }}</span
      >
      <details
        v-if="trial?.request"
        class="preview-details"
      >
        <summary>查看完整提示词与参数</summary>
        <p>
          {{ trial.request.version.toUpperCase() }} · {{ trial.request.params.width }}×{{
            trial.request.params.height
          }}
          · {{ trial.request.params.steps }} 步 · 种子 {{ trial.request.params.seed }}
        </p>
        <p>
          Guidance {{ trial.request.params.scale }} · Rescale
          {{ trial.request.params.cfgRescale }} · {{ trial.request.params.sampler }} ·
          {{ trial.request.params.noiseSchedule }}
        </p>
        <p>
          质量词{{ trial.request.params.qualityTags ? '开启' : '关闭' }} · UC
          {{ trial.request.params.ucPreset }}
        </p>
        <section
          class="prompt-card"
          aria-label="主提示词"
        >
          <h4>主提示词</h4>
          <p class="prompt-text">{{ trial.request.base || '无' }}</p>
        </section>
        <section
          class="prompt-card"
          aria-label="负面提示词"
        >
          <h4>负面提示词</h4>
          <p class="prompt-text">{{ trial.request.negative || '无' }}</p>
        </section>
        <div
          v-for="(character, roleIndex) in trial.request.characters"
          :key="roleIndex"
          class="prompt-card"
        >
          <h4>角色 {{ roleIndex + 1 }} · 位置 {{ character.position || '自动' }}</h4>
          <p class="prompt-text">{{ character.prompt }}</p>
          <h4>负面提示词</h4>
          <p class="prompt-text">{{ character.negative || '无' }}</p>
        </div>
      </details>
    </div>
  </article>
</template>

<style scoped>
.reverse-trial-inspector {
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  background: var(--bg);
  font-size: 12px;
}

header {
  margin-bottom: 22px;
}

header > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
}

h3 {
  margin: 0;
  font-size: 18px;
}

header > div > span {
  color: var(--text2);
  font-size: 11px;
}

.inspector-eyebrow {
  color: var(--muted);
  font-size: 11px;
}

.inspector-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-wrap: anywhere;
  line-height: 1.7;
}

.inspector-body small {
  color: var(--muted);
  font-size: 10px;
}

.preview-style {
  color: var(--text);
  font-family: var(--mono);
}

.preview-error {
  color: var(--bad);
}

.preview-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 12px 0;
}

.preview-actions .btn {
  justify-content: center;
}

.preview-actions .primary {
  grid-column: 1 / -1;
  grid-row: 1;
}

.preview-details {
  padding-top: 16px;
  border-top: 1px solid var(--line);
}

.preview-details summary {
  cursor: pointer;
  color: var(--text2);
}

.preview-details p {
  color: var(--text2);
}

.prompt-card {
  padding: 12px 0;
  border-top: 1px solid var(--line);
}

.prompt-card h4 {
  margin: 0 0 8px;
  color: var(--text2);
  font-size: 11px;
  font-weight: 500;
}

.prompt-card .prompt-text {
  margin: 0 0 10px;
  color: var(--text);
  font: 11px/1.8 var(--mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}
</style>
