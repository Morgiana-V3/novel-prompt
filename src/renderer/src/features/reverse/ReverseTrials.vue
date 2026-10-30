<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ReverseResult } from '@shared/reverse/types'
import ArtistWeights from './ArtistWeights.vue'
import { proposeArtistStrings } from '@shared/reverse/candidates'

const props = defineProps<{
  result: ReverseResult
  stylePrompt: string
  disabled: boolean
}>()
const emit = defineEmits<{
  selectionChange: [styles: string[]]
}>()
const trials = ref<{ id: number; style: string; selected: boolean }[]>([])
const locked = computed(() => props.disabled)
const selected = computed(() => trials.value.filter((trial) => trial.selected))
watch(
  selected,
  (items) =>
    emit(
      'selectionChange',
      items.map((trial) => trial.style.trim()),
    ),
  {
    deep: true,
    immediate: true,
  },
)
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
    nextId = 1
    const recommendations = proposeArtistStrings(props.result).slice(0, 3)
    trials.value = (recommendations.length ? recommendations : ['']).map((style) => ({
      id: nextId++,
      style,
      selected: true,
    }))
  },
  { immediate: true },
)
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
        <div class="trial-style-editor">
          <ArtistWeights
            v-model="trial.style"
            :disabled="locked"
          />
          <textarea
            v-model="trial.style"
            :aria-label="'方案 ' + trial.id + ' 画师串'"
            rows="2"
            placeholder="无画师对照"
            :disabled="locked"
            spellcheck="false"
          />
        </div>
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
      <span>勾选 1 到 6 个组合，每组一张；同一轮使用相同内容和种子。</span>
    </footer>
  </section>
</template>

<style scoped>
.reverse-trials {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
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

.trial-style-editor {
  flex: 1;
  min-width: 0;
}

.trial-candidate textarea {
  flex: 1;
  min-width: 0;
  resize: none;
  field-sizing: content;
  overflow: hidden;
  width: 100%;
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
