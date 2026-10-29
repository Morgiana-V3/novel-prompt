<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ReverseResult } from '@shared/reverse/types'
import type { NaiGenRequest } from '@shared/generation/types'
import { proposeArtistStrings } from '@shared/reverse/candidates'
import { generationParams, imageState } from '../generation/state'
import { artistTrials, stageArtistTrials } from '../generation/artist-trials'
import { promptState, type CharDraft } from '../prompts/state'
import { importGenerationRequest } from '../prompts/actions'
import { settingsState } from '../settings/state'
import { shellState } from '../../shared/state/shell'
import { activeTask } from '../../shared/state/tasks'
import { cleanErr } from '../../shared/lib/format'

const props = defineProps<{
  result: ReverseResult
  content: string
  characters: CharDraft[]
  stylePrompt: string
  image?: File
  disabled: boolean
}>()
const trials = ref<{ id: number; style: string; selected: boolean }[]>([])
const sending = ref(false)
const error = ref('')
const locked = computed(
  () => props.disabled || sending.value || imageState.generating || artistTrials.running,
)
const selected = computed(() => trials.value.filter((trial) => trial.selected))
let nextId = 1
function add(style: string) {
  if (
    locked.value ||
    trials.value.length >= 12 ||
    trials.value.some((trial) => trial.style.trim() === style.trim())
  ) {
    return
  }
  trials.value.push({ id: nextId++, style: style.trim(), selected: true })
}
function propose() {
  for (const style of proposeArtistStrings(props.result)) {
    add(style)
  }
}
watch(
  () => props.result,
  () => {
    trials.value = []
    nextId = 1
    error.value = ''
    propose()
  },
  { immediate: true },
)

async function send() {
  if (locked.value) {
    return
  }
  error.value = ''
  const styles = selected.value.map((trial) => trial.style.trim())
  if (!styles.length || styles.length > 6) {
    error.value = '请选择 1 到 6 个方案'
    return
  }
  if (new Set(styles).size !== styles.length) {
    error.value = '选中的画师串有重复，请修改或取消勾选'
    return
  }
  if (activeTask('generate') || activeTask('inpaint') || activeTask('page-generate')) {
    error.value = '请等待当前生图任务完成'
    return
  }
  sending.value = true
  try {
    const request: NaiGenRequest = {
      base: props.content,
      negative: promptState.negative,
      characters: props.characters.map((role) => ({ ...role })),
      version: settingsState.settings?.naiVersion ?? 'v5',
      params: { ...generationParams, ...promptState.params, count: 1 },
    }
    await importGenerationRequest(request, '已载入试图内容')
    stageArtistTrials(styles, request, props.result.style, props.image)
    shellState.tab = 'generate'
  } catch (e) {
    error.value = cleanErr(e)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <section
    class="reverse-trials"
    aria-label="画师组合"
  >
    <header>
      <strong>画师组合</strong>
      <span>已选 {{ selected.length }} / 6</span>
    </header>
    <div class="trial-tools">
      <button
        class="btn small"
        :disabled="locked || trials.length >= 12"
        @click="propose"
      >
        添加推荐组合
      </button>
      <button
        class="btn small"
        :disabled="locked || !stylePrompt.trim() || trials.length >= 12"
        @click="add(stylePrompt)"
      >
        添加当前画师串
      </button>
      <button
        class="btn small"
        :disabled="locked || trials.length >= 12"
        @click="add('')"
      >
        添加无画师对照
      </button>
    </div>
    <div class="trial-list">
      <article
        v-for="trial in trials"
        :key="trial.id"
        class="trial-candidate"
      >
        <label
          ><input
            v-model="trial.selected"
            type="checkbox"
            :disabled="locked"
          />{{ trial.id }}</label
        >
        <textarea
          v-model="trial.style"
          :aria-label="'方案 ' + trial.id + ' 画师串'"
          rows="2"
          placeholder="无画师对照"
          :disabled="locked"
          spellcheck="false"
        />
        <button
          class="icon-btn sm"
          :disabled="locked"
          :aria-label="'移除方案 ' + trial.id"
          @click="trials = trials.filter((item) => item.id !== trial.id)"
        >
          ×
        </button>
      </article>
    </div>
    <footer>
      <span>每组一张，使用相同内容和种子</span>
      <button
        class="btn small primary"
        :disabled="locked || !selected.length || selected.length > 6"
        @click="send"
      >
        去生图预览 · {{ selected.length }} 组
      </button>
    </footer>
    <p
      v-if="error"
      class="trial-error"
      role="alert"
    >
      {{ error }}
    </p>
  </section>
</template>

<style scoped>
.reverse-trials {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  overflow: auto;
  padding: 16px;
}

header,
footer,
.trial-tools,
.trial-candidate {
  display: flex;
  align-items: center;
  gap: 8px;
}

header,
footer {
  justify-content: space-between;
}

header span,
footer span {
  color: var(--text2);
  font-size: 12px;
}

.trial-tools,
footer {
  flex-wrap: wrap;
}

.trial-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.trial-candidate {
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
}

.trial-candidate label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.trial-candidate textarea {
  flex: 1;
  min-width: 0;
  resize: vertical;
  font-size: 12px;
  line-height: 1.6;
  padding: 6px 8px;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 6px;
}

.trial-error {
  color: var(--bad);
  font-size: 12px;
}
</style>
