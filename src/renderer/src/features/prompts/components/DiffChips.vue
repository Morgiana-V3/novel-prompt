<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TagDiff } from '../tag-diff'
import { foldContext, wordParts } from '../prompt-diff'

const props = withDefaults(
  defineProps<{
    diff: TagDiff
    beforeLabel?: string
    afterLabel?: string
    beforeText?: string
    afterText?: string
  }>(),
  { beforeLabel: '修改前', afterLabel: '修改后', beforeText: '', afterText: '' },
)
const expanded = ref(false)
const fullTags = computed(
  () =>
    !props.diff.sentences?.length &&
    !!props.beforeText &&
    !!props.afterText &&
    props.beforeText !== props.afterText,
)
const documents = computed(() =>
  (fullTags.value && expanded.value
    ? [
        {
          before: props.beforeText,
          after: props.afterText,
          parts: wordParts(props.beforeText, props.afterText),
        },
      ]
    : (props.diff.sentences ?? [])
  ).map((sentence) => ({
    ...sentence,
    parts: foldContext(sentence.parts),
  })),
)
const hasContext = computed(
  () =>
    fullTags.value ||
    documents.value.some((document) => document.parts.some((part) => part.hiddenText)),
)
const contextLabel = computed(() => {
  if (expanded.value) {
    return '仅看变化'
  }
  return fullTags.value ? '查看完整提示词' : '展开未变化的上下文'
})
watch(
  () =>
    JSON.stringify([
      props.beforeText,
      props.afterText,
      props.diff.sentences?.map(({ before, after }) => [before, after]),
    ]),
  () => {
    expanded.value = false
  },
)
</script>

<template>
  <div class="prompt-diff">
    <div
      v-if="
        !(fullTags && expanded) && (diff.added.length || diff.removed.length || diff.changed.length)
      "
      class="diff-row"
    >
      <span
        v-for="tag in diff.removed"
        :key="'removed-' + tag.key"
        class="diff-chip del"
        >− {{ tag.text }}</span
      >
      <span
        v-for="change in diff.changed"
        :key="'changed-' + change.to.key"
        class="diff-chip mod"
        >{{ change.from.text }} → {{ change.to.text }}</span
      >
      <span
        v-for="tag in diff.added"
        :key="'added-' + tag.key"
        class="diff-chip add"
        >＋ {{ tag.text }}</span
      >
    </div>
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

.diff-row {
  margin: 0;
  padding: 12px 16px;
}

.diff-chip {
  max-width: 100%;
  height: auto;
  min-height: 22px;
  white-space: pre-wrap;
  overflow: visible;
  overflow-wrap: anywhere;
}

.diff-chip.del {
  text-decoration: none;
}

.diff-context {
  width: 100%;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
  color: var(--text2);
  font-size: 11px;
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
