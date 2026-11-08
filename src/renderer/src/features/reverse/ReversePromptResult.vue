<script setup lang="ts">
import type { InpaintDraft } from '@shared/prompts/types'

defineProps<{ draft: InpaintDraft }>()
</script>

<template>
  <div
    class="prompt-result"
    aria-label="反推提示词结果"
  >
    <section class="result-section">
      <h4>主提示词</h4>
      <p class="result-text">{{ draft.base || '无' }}</p>
    </section>
    <section class="result-section">
      <h4>负面提示词</h4>
      <p class="result-text">{{ draft.negative || '无' }}</p>
    </section>
    <section
      v-if="draft.characters.length"
      class="result-section"
    >
      <h4>
        角色提示词 <span>{{ draft.characters.length }}</span>
      </h4>
      <article
        v-for="(role, index) in draft.characters"
        :key="index"
        class="result-role"
      >
        <div class="role-heading">
          <span>角色 {{ index + 1 }}</span>
          <span class="role-position">位置 {{ role.position || '自动' }}</span>
        </div>
        <p class="result-text">{{ role.prompt }}</p>
        <template v-if="role.negative">
          <h5>角色负面词</h5>
          <p class="result-text">{{ role.negative }}</p>
        </template>
      </article>
    </section>
    <p class="result-hint">需要调整提示词或角色位置，可带入生图后编辑。</p>
  </div>
</template>

<style scoped>
.prompt-result {
  min-width: 0;
}

.result-section + .result-section {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}

h4,
h5 {
  margin: 0 0 8px;
  color: var(--text2);
  font-size: 12px;
  font-weight: 500;
}

h4 span {
  margin-left: 5px;
  color: var(--muted);
}

.result-text {
  margin: 0;
  color: var(--text);
  font: 12px/1.85 var(--mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}

.result-role + .result-role {
  border-top: 1px solid var(--line);
}

.role-heading {
  padding: 10px 0;
  font-size: 12px;
}

.role-position {
  user-select: text;
  margin-left: 12px;
  color: var(--muted);
  font: 11px var(--mono);
}

.result-role > .result-text {
  padding-bottom: 12px;
}

.result-hint {
  margin: 14px 0 0;
  color: var(--muted);
  font-size: 12px;
}
</style>
