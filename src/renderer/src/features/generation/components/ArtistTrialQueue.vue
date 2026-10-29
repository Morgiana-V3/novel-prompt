<script setup lang="ts">
import { artistTrials } from '../artist-trials'
import { shellState } from '../../../shared/state/shell'
defineProps<{ disabled: boolean }>()
defineEmits<{ leave: [] }>()
const labels = {
  pending: '待生成',
  generating: '生成中',
  scoring: '评分中',
  done: '已完成',
  error: '失败',
}
</script>

<template>
  <section class="artist-trial-queue">
    <header>
      <strong>画师试图</strong>
      <button
        class="btn ghost small"
        :disabled="disabled"
        @click="shellState.tab = 'reverse'"
      >
        返回反推
      </button>
      <button
        class="btn ghost small"
        :disabled="disabled"
        @click="$emit('leave')"
      >
        普通生图
      </button>
    </header>
    <div class="trial-options">
      <span>每组一张 · 同轮同种子</span>
      <label title="K3 风格余弦相似度，不是还原百分比">
        <input
          v-model="artistTrials.scoreEnabled"
          type="checkbox"
          :disabled="disabled || !artistTrials.reference"
        />风格评分
      </label>
    </div>
    <details>
      <summary>{{ artistTrials.trials.length }} 个画师组合</summary>
      <article
        v-for="trial in artistTrials.trials"
        :key="trial.id"
        class="trial-card"
        :data-state="trial.state"
      >
        <header>
          <label
            ><input
              v-model="trial.selected"
              type="checkbox"
              :disabled="disabled || trial.state !== 'pending'"
            />方案 {{ trial.id }}</label
          >
          <span>{{ labels[trial.state] }}</span>
          <span
            v-if="trial.score !== undefined"
            class="trial-score"
            >{{ trial.score.toFixed(3) }}</span
          >
        </header>
        <textarea
          v-model="trial.style"
          :aria-label="`试图方案 ${trial.id} 画师串`"
          rows="2"
          placeholder="无画师对照"
          :disabled="disabled || trial.state !== 'pending'"
          spellcheck="false"
        />
        <p
          v-if="trial.error"
          class="trial-error"
        >
          {{ trial.error }}
        </p>
      </article>
    </details>
    <p
      v-if="artistTrials.progress"
      role="status"
    >
      {{ artistTrials.progress
      }}<span v-if="artistTrials.cost !== null"> · Anlas 变化 {{ artistTrials.cost }}</span>
    </p>
  </section>
</template>

<style scoped>
.artist-trial-queue {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 14px;
  font-size: 12px;
}

header,
.trial-options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

header strong {
  margin-right: auto;
}

.trial-options {
  margin: 8px 0;
  justify-content: space-between;
  color: var(--text2);
}

summary {
  cursor: pointer;
}

.trial-card {
  padding-top: 10px;
}

.trial-card header {
  justify-content: space-between;
  margin-bottom: 6px;
}

.trial-card textarea {
  width: 100%;
  resize: vertical;
  font-size: 12px;
  padding: 6px 8px;
  line-height: 1.6;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 6px;
}

p {
  margin: 8px 0 0;
  color: var(--text2);
}

.trial-error {
  color: var(--bad);
}
</style>
