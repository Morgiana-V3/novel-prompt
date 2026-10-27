<script setup lang="ts">
import type { TagDiff } from '../tag-diff'

defineProps<{ diff: TagDiff }>()
</script>

<template>
  <div
    v-if="diff.added.length || diff.removed.length || diff.changed.length"
    class="diff-row"
  >
    <span
      v-for="t in diff.added"
      :key="'a' + t.key"
      class="diff-chip add"
      >+ {{ t.text }}</span
    >
    <span
      v-for="c in diff.changed"
      :key="'c' + c.to.key"
      class="diff-chip mod"
      >{{ c.from.text }} → {{ c.to.text }}</span
    >
    <span
      v-for="t in diff.removed"
      :key="'d' + t.key"
      class="diff-chip del"
      >{{ t.text }}</span
    >
  </div>
  <div
    v-for="(s, index) in diff.sentences"
    :key="index"
    class="diff-prose"
  >
    <div
      v-if="s.before"
      class="diff-sentence"
    >
      <span class="diff-side">原文</span>
      <p>
        <template
          v-for="(part, indexItem) in s.parts"
          :key="indexItem"
          ><span
            v-if="part.kind !== 'add'"
            :class="{ removed: part.kind === 'remove' }"
            >{{ part.text }}</span
          ></template
        >
      </p>
    </div>
    <div
      v-if="s.after"
      class="diff-sentence"
    >
      <span class="diff-side">修改后</span>
      <p>
        <template
          v-for="(part, indexItem) in s.parts"
          :key="indexItem"
          ><span
            v-if="part.kind !== 'remove'"
            :class="{ added: part.kind === 'add' }"
            >{{ part.text }}</span
          ></template
        >
      </p>
    </div>
  </div>
</template>
<style scoped>
.diff-prose {
  margin: 0 16px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  user-select: text;
}

.diff-sentence {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  align-items: baseline;
  background: var(--panel);
}

.diff-sentence + .diff-sentence {
  border-top: 1px solid var(--line);
}

.diff-side {
  flex-shrink: 0;
  width: 36px;
  font-size: 10px;
  color: var(--muted);
}

.diff-sentence p {
  margin: 0;
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: 12px/1.8 var(--mono);
  color: var(--text2);
  max-height: 220px;
  overflow: auto;
}

.removed {
  background: var(--bad-soft);
  color: var(--bad);
  text-decoration: line-through;
}

.added {
  background: var(--ok-soft);
  color: var(--ok);
}

.diff-chip {
  max-width: 100%;
  overflow-wrap: anywhere;
}
</style>
