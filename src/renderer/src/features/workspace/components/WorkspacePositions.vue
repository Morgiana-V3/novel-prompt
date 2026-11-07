<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '../../../shared/ui/Icon.vue'
import type { InpaintDraft } from '@shared/prompts/types'
import type { NaiImage } from '@shared/images/types'
import { PositionCompareDialog } from '../../prompts/public/components'

const props = defineProps<{
  before?: InpaintDraft
  after: InpaintDraft
  width: number
  height: number
  beforeWidth?: number
  beforeHeight?: number
  beforeImage?: NaiImage | null
  afterImage?: NaiImage | null
}>()
function reference(image?: NaiImage | null) {
  if (!image || image.missing) {
    return null
  }
  return { url: image.url, opacity: 75, width: image.width, height: image.height }
}
const opened = ref(false)
const roles = (draft?: InpaintDraft) =>
  (draft?.characters ?? []).map((character, index) => ({
    label: `角色 ${index + 1}`,
    position: character.position ?? '',
  }))
const previous = computed(() => roles(props.before))
const current = computed(() => roles(props.after))
const changes = computed(() =>
  Array.from({ length: Math.max(previous.value.length, current.value.length) }, (_, index) => ({
    index,
    before: previous.value[index],
    after: current.value[index],
  })).filter((row) => !row.before || !row.after || row.before.position !== row.after.position),
)

type PositionChangeKind = 'moved' | 'added' | 'removed'
const POSITION_NOTE = '提示词中的布局条件，不代表从成图识别出的人物位置；角色按条目顺序对应'

/* 每行变更归一为“类型 + 前后坐标”，模板只负责排版 */
const changeChips = computed(() =>
  changes.value.map((row) => {
    let kind: PositionChangeKind = 'moved'
    if (!row.before) {
      kind = 'added'
    } else if (!row.after) {
      kind = 'removed'
    }
    return {
      index: row.index,
      kind,
      before: row.before ? row.before.position || '自动' : '',
      after: row.after ? row.after.position || '自动' : '',
    }
  }),
)
const changeSummary = computed(() => {
  if (!props.before) {
    return `${current.value.length} 个角色`
  }
  const counts = { moved: 0, added: 0, removed: 0 }
  for (const chip of changeChips.value) {
    counts[chip.kind] += 1
  }
  const parts = [
    counts.moved ? `移动 ${counts.moved}` : '',
    counts.added ? `新增 ${counts.added}` : '',
    counts.removed ? `移除 ${counts.removed}` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : '无变化'
})
const KIND_LABELS: Record<PositionChangeKind, string> = {
  moved: '移动',
  added: '新增',
  removed: '移除',
}
</script>

<template>
  <section
    v-if="current.length || previous.length"
    class="workspace-positions"
  >
    <header class="positions-head">
      <Icon
        name="frame"
        :size="14"
      />
      <b :title="POSITION_NOTE">角色位置</b>
      <span
        class="positions-summary"
        :class="{ changed: before && changeChips.length }"
        >{{ changeSummary }}</span
      >
      <button
        class="btn ghost small positions-open"
        :title="POSITION_NOTE"
        @click="opened = true"
      >
        {{ before ? '查看对比' : '查看布局' }}
      </button>
    </header>
    <ul
      v-if="before && changeChips.length"
      class="positions-chips"
    >
      <li
        v-for="chip in changeChips"
        :key="chip.index"
        :data-kind="chip.kind"
      >
        <span class="positions-role">角色 {{ chip.index + 1 }}</span>
        <span class="positions-kind">{{ KIND_LABELS[chip.kind] }}</span>
        <code v-if="chip.kind === 'moved'">{{ chip.before }}</code>
        <Icon
          v-if="chip.kind === 'moved'"
          name="arrow"
          :size="11"
        />
        <code v-if="chip.kind !== 'removed'">{{ chip.after }}</code>
        <code v-else>{{ chip.before }}</code>
      </li>
    </ul>
    <ul
      v-else-if="!before"
      class="positions-chips"
    >
      <li
        v-for="role in current"
        :key="role.label"
      >
        <span class="positions-role">{{ role.label }}</span>
        <code>{{ role.position || '自动' }}</code>
      </li>
    </ul>
    <PositionCompareDialog
      v-if="opened"
      :before="previous"
      :after="current"
      :width="width"
      :height="height"
      :before-width="beforeWidth"
      :before-height="beforeHeight"
      :before-reference="reference(beforeImage)"
      :after-reference="reference(afterImage)"
      :single="!before"
      :title="before ? '角色位置 · 对比对象 → 正在查看' : '生成记录 · 角色位置'"
      @close="opened = false"
    />
  </section>
</template>

<style scoped>
.workspace-positions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 12px 0;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg);
  user-select: text;
}

.positions-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  color: var(--text2);
}

.positions-head b {
  font-size: 12.5px;
  color: var(--text);
  cursor: help;
}

.positions-summary {
  font-size: 11.5px;
  color: var(--muted);
}

.positions-summary.changed {
  color: var(--pink-deep);
}

.positions-open {
  margin-left: auto;
}

.positions-chips {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.positions-chips li {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  background: var(--panel);
  font-size: 11.5px;
  color: var(--text2);
  white-space: nowrap;
}

.positions-role {
  font-weight: 600;
  color: var(--text);
}

.positions-kind {
  padding: 0 6px;
  border-radius: 999px;
  font-size: 10.5px;
  line-height: 17px;
  color: var(--text2);
  background: var(--hover);
}

.positions-chips li[data-kind='added'] .positions-kind {
  color: var(--ok);
  background: var(--ok-soft);
}

.positions-chips li[data-kind='removed'] .positions-kind {
  color: var(--bad);
  background: var(--bad-soft);
}

.positions-chips li[data-kind='removed'] code {
  text-decoration: line-through;
  color: var(--muted);
}

.positions-chips li[data-kind='moved'] .positions-kind {
  color: var(--pink-deep);
  background: var(--pink-soft);
}

.positions-chips code {
  overflow: hidden;
  font: 11.5px/1 var(--mono);
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
}

.positions-chips .icon {
  flex-shrink: 0;
  color: var(--muted);
}
</style>
