<script setup lang="ts">
/**
 * 全项目统一的提示词前后对比：以「生图创作 · 智能优化」的样式为准，
 * 左右（窄时上下）两栏原文，逐词高亮删除/新增，保留词条所在位置与上下文。
 * fullContext 时始终显示全文；否则把很长的未变化片段折叠，可展开查看。
 */
import { computed, ref, watch } from 'vue'
import type { TagDiff } from '../tag-diff'
import { foldContext, wordParts, type ContextPart } from '../prompt-diff'

const props = withDefaults(
  defineProps<{
    fullContext?: boolean
    /** 兼容旧调用方；展示统一基于前后原文计算 */
    diff?: TagDiff
    beforeLabel?: string
    afterLabel?: string
    beforeText?: string
    afterText?: string
  }>(),
  {
    diff: undefined,
    beforeLabel: '修改前',
    afterLabel: '修改后',
    beforeText: '',
    afterText: '',
  },
)
const expanded = ref(false)
/** 没有传原文的旧调用方，退回到句子级差异里保存的前后文本 */
const texts = computed(() => {
  if (props.beforeText || props.afterText) {
    return [{ before: props.beforeText, after: props.afterText }]
  }
  return (props.diff?.sentences ?? []).map(({ before, after }) => ({ before, after }))
})
const documents = computed<{ before: string; after: string; parts: ContextPart[] }[]>(() =>
  texts.value
    .filter(({ before, after }) => before !== after)
    .map(({ before, after }) => {
      const parts = wordParts(before, after)
      return { before, after, parts: props.fullContext ? parts : foldContext(parts) }
    }),
)
const hasContext = computed(() =>
  documents.value.some((document) => document.parts.some((part) => part.hiddenText)),
)
const contextLabel = computed(() => (expanded.value ? '收起未变化的内容' : '展开未变化的上下文'))
watch(
  () => JSON.stringify(texts.value),
  () => {
    expanded.value = false
  },
)
</script>

<template>
  <div class="prompt-diff">
    <button
      v-if="hasContext"
      type="button"
      class="diff-context"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      {{ contextLabel }}
    </button>
    <div
      v-for="(document, index) in documents"
      :key="index"
      class="diff-prose"
      :class="{ 'single-side': !document.before || !document.after }"
    >
      <div
        v-if="document.before"
        class="diff-sentence before"
      >
        <span class="diff-side">− {{ document.after ? beforeLabel : '已删除' }}</span>
        <p>
          <template
            v-for="(part, partIndex) in document.parts"
            :key="partIndex"
            ><span
              v-if="part.kind !== 'add'"
              :class="{ removed: part.kind === 'remove', context: part.hiddenText && !expanded }"
              >{{ expanded && part.hiddenText ? part.hiddenText : part.text }}</span
            ></template
          >
        </p>
      </div>
      <div
        v-if="document.after"
        class="diff-sentence after"
      >
        <span class="diff-side">＋ {{ document.before ? afterLabel : '新增内容' }}</span>
        <p>
          <template
            v-for="(part, partIndex) in document.parts"
            :key="partIndex"
            ><span
              v-if="part.kind !== 'remove'"
              :class="{ added: part.kind === 'add', context: part.hiddenText && !expanded }"
              >{{ expanded && part.hiddenText ? part.hiddenText : part.text }}</span
            ></template
          >
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.prompt-diff {
  min-width: 0;
  container-type: inline-size;
  user-select: text;
}

.diff-context {
  width: 100%;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
  color: var(--text2);
  font-size: 11px;
  transition: color var(--dur-fast) var(--ease-out);
}

.diff-context:hover {
  color: var(--pink-deep);
}

.diff-prose {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.diff-prose.single-side {
  grid-template-columns: minmax(0, 1fr);
}

.diff-sentence {
  min-width: 0;
  padding: 12px 16px;
}

.diff-sentence + .diff-sentence {
  border-left: 1px solid var(--line);
}

.diff-side {
  display: block;
  margin-bottom: 8px;
  font-size: 11px;
  color: var(--text2);
}

.diff-sentence p {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font:
    13px/1.8 'Segoe UI',
    'Microsoft YaHei UI',
    sans-serif;
  color: var(--text);
}

.removed,
.added {
  padding: 1px 0;
  border-radius: 3px;
  box-decoration-break: clone;
}

.removed {
  background: var(--bad-soft);
  color: var(--bad);
}

.added {
  background: var(--ok-soft);
  color: var(--ok);
}

.context {
  color: var(--muted);
}

.single-side .after {
  border-left: 3px solid var(--ok);
}

.single-side .before {
  border-left: 3px solid var(--bad);
}

.single-side .added,
.single-side .removed {
  padding: 0;
  background: transparent;
  color: inherit;
}

@container (width < 600px) {
  .diff-prose {
    grid-template-columns: minmax(0, 1fr);
  }

  .diff-sentence + .diff-sentence {
    border-left: 0;
    border-top: 1px solid var(--line);
  }
}
</style>
