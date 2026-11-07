<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PageInputContext } from '@shared/workspace/context'
import type { PageSkillSnapshot } from '@shared/workspace/model'

const props = defineProps<{
  rules: PageInputContext['rules']
  snapshot?: PageSkillSnapshot
}>()
const openRules = ref(new Set<string>())
const initialCount = computed(
  () => props.rules.entries.filter((entry) => entry.delivery === 'initial').length,
)
const scopeNames = {
  core: '总则',
  all: '通用',
  optimize: '提示词优化',
  preview: '画面预览',
  inpaint: '局部重绘',
}

function toggleRule(event: Event, id: string) {
  if ((event.currentTarget as HTMLDetailsElement).open) {
    openRules.value.add(id)
  } else {
    openRules.value.delete(id)
  }
}

function ruleBody(entry: PageInputContext['rules']['entries'][number]): string | null {
  const snapshot = props.snapshot
  const section = snapshot?.sections?.find((candidate) => candidate.id === entry.id)
  if (
    !snapshot ||
    snapshot.digest !== props.rules.digest ||
    !section ||
    section.digest !== entry.digest ||
    !Number.isInteger(section.start) ||
    !Number.isInteger(section.end) ||
    section.start < 0 ||
    section.end < section.start ||
    section.end > snapshot.text.length ||
    section.end - section.start !== entry.characters
  ) {
    return null
  }
  return snapshot.text.slice(section.start, section.end)
}
</script>

<template>
  <section class="pw-input-rules">
    <b>规则篇目 · {{ rules.entries.length }}</b>
    <p>
      冻结正文共 {{ rules.characters }} 字符；入口正文 {{ initialCount }} 篇，按需参考
      {{ rules.entries.length - initialCount }}
      篇。这是冻结材料目录，不代表已被读取；外部 Agent 实际保留与读取的内容须按客户端调用核对。
    </p>
    <p v-if="!rules.entries.length">当时未记录规则篇目。</p>
    <details
      v-for="entry in rules.entries"
      :key="entry.id"
      @toggle="toggleRule($event, entry.id)"
    >
      <summary class="disclosure">
        {{ entry.name }} · {{ entry.characters }} 字符 ·
        {{ entry.delivery === 'initial' ? '入口正文' : '按需参考' }}
      </summary>
      <div v-if="openRules.has(entry.id)">
        <p>{{ entry.description }}</p>
        <p><b>选择原因：</b>{{ entry.reason }}</p>
        <p>
          范围 {{ scopeNames[entry.scope] }} · 模型 {{ entry.model }} · 优先级
          {{ entry.priority }}
        </p>
        <pre v-if="ruleBody(entry) !== null">{{ ruleBody(entry) || '（空）' }}</pre>
        <p v-else>当时的规则正文缺失或与篇目记录不一致，无法查看。</p>
      </div>
    </details>
  </section>
</template>

<style scoped>
.pw-input-rules {
  margin-top: 12px;
  font-size: 11px;
  color: var(--text2);
  overflow-wrap: anywhere;
}

.pw-input-rules p {
  margin: 5px 0;
  color: var(--muted);
}

.pw-input-rules details {
  margin-top: 8px;
}

.pw-input-rules summary {
  cursor: pointer;
}

.pw-input-rules pre {
  max-height: 320px;
  margin: 7px 0 0;
  padding: 8px;
  overflow: auto;
  font: inherit;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--bg);
  border: 1px solid var(--line2);
  border-radius: 6px;
}
</style>
