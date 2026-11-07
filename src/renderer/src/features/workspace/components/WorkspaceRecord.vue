<script setup lang="ts">
import { computed, ref } from 'vue'
import type { NaiImage } from '@shared/images/types'
import type { NaiVersion } from '@shared/generation/types'
import type { PageEditorState } from '@shared/workspace/model'
import { copy } from '../../../shared/lib/notifications'
import Icon from '../../../shared/ui/Icon.vue'
import { recordParameters } from '../record-parameters'
import { PositionCompareDialog } from '../../prompts/public/components'

/**
 * 生成记录：只读展示这张图生成时的提示词与参数。
 * 与编辑配置刻意区分——没有输入框，内容放在白色卡片里、等宽字体排版，
 * 顶部摘要条标明“只读记录”，参数用小块平铺而不是表单控件。
 */
const props = defineProps<{
  editor: PageEditorState
  model: NaiVersion
  image: NaiImage | null
  initial?: boolean
}>()

const draft = computed(() => props.editor.draft)
const params = computed(() => props.editor.params)
const parameterTiles = computed(() => [
  ...recordParameters(params.value, props.model),
  ['重绘强度', props.editor.strength] as const,
])
const hasCharacters = computed(() => draft.value.characters.length > 0)

/* 角色位置：各角色卡片标题已写出坐标，布局图按需从摘要条打开 */
const positionsOpen = ref(false)
const positionRoles = computed(() =>
  draft.value.characters.map((character, index) => ({
    label: `角色 ${index + 1}`,
    position: character.position ?? '',
  })),
)
const positionReference = computed(() => {
  const image = props.image
  if (!image || image.missing) {
    return null
  }
  return { url: image.url, opacity: 75, width: image.width, height: image.height }
})
</script>

<template>
  <div class="workspace-record">
    <header class="record-summary">
      <span class="record-lock">
        <Icon
          name="eye"
          :size="13"
        />只读记录
      </span>
      <span class="pill">{{ model.toUpperCase() }}</span>
      <span class="pill">{{ params.width }} × {{ params.height }}</span>
      <span class="pill">种子 {{ params.seed ?? '随机' }}</span>
      <button
        v-if="hasCharacters"
        class="btn ghost small record-positions-button"
        title="在画面上查看各角色的布局位置（提示词中的布局条件）"
        @click="positionsOpen = true"
      >
        <Icon
          name="frame"
          :size="13"
        />角色位置
      </button>
      <span class="record-summary-note">{{
        initial ? '项目起始稿与设置，不代表导入图片的实际生成参数' : '生成这张图时使用的配置'
      }}</span>
    </header>

    <section class="record-block">
      <h3>
        主提示词
        <button
          class="icon-btn sm"
          title="复制主提示词"
          aria-label="复制主提示词"
          :disabled="!draft.base"
          @click="copy(draft.base)"
        >
          <Icon
            name="copy"
            :size="13"
          />
        </button>
      </h3>
      <pre :class="{ empty: !draft.base }">{{ draft.base || '未填写' }}</pre>
    </section>

    <section
      v-for="(character, index) in draft.characters"
      :key="index"
      class="record-block"
    >
      <h3>
        角色 {{ index + 1 }}
        <small>{{ character.position || '自动位置' }}</small>
        <button
          class="icon-btn sm"
          :title="`复制角色 ${index + 1} 提示词`"
          :aria-label="`复制角色 ${index + 1} 提示词`"
          :disabled="!character.prompt"
          @click="copy(character.prompt)"
        >
          <Icon
            name="copy"
            :size="13"
          />
        </button>
      </h3>
      <pre :class="{ empty: !character.prompt }">{{ character.prompt || '未填写' }}</pre>
      <template v-if="character.negative">
        <h4>角色负面词</h4>
        <pre>{{ character.negative }}</pre>
      </template>
    </section>

    <section class="record-block">
      <h3>
        负面提示词
        <button
          class="icon-btn sm"
          title="复制负面提示词"
          aria-label="复制负面提示词"
          :disabled="!draft.negative"
          @click="copy(draft.negative)"
        >
          <Icon
            name="copy"
            :size="13"
          />
        </button>
      </h3>
      <pre :class="{ empty: !draft.negative }">{{ draft.negative || '未填写' }}</pre>
    </section>

    <PositionCompareDialog
      v-if="positionsOpen"
      single
      :before="[]"
      :after="positionRoles"
      :width="params.width"
      :height="params.height"
      :after-reference="positionReference"
      title="生成记录 · 角色位置"
      @close="positionsOpen = false"
    />

    <section class="record-parameters">
      <h3>生图参数</h3>
      <dl>
        <div
          v-for="[label, value] in parameterTiles"
          :key="label"
        >
          <dt>{{ label }}</dt>
          <dd>{{ value }}</dd>
        </div>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.workspace-record {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 1080px;
  padding: 6px 0 28px;
  animation: fade-up var(--dur-slow) var(--ease-out);
}

/* ---------- 摘要条：明确这是只读记录 ---------- */
.record-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.record-lock {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text2);
  background: var(--hover);
}

.record-summary-note {
  margin-left: 4px;
  font-size: 11.5px;
  color: var(--muted);
}

/* ---------- 文本块 ---------- */
.record-block {
  padding: 12px 16px 14px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--bg);
  box-shadow: var(--shadow-sm);
}

.record-block h3,
.record-parameters h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text2);
}

.record-block h3 small {
  font-size: 11px;
  font-weight: 400;
  color: var(--muted);
}

.record-block h3 .icon-btn {
  margin-left: auto;
  opacity: 0.55;
  transition: opacity var(--dur-fast) var(--ease-out);
}

.record-block:hover h3 .icon-btn,
.record-block h3 .icon-btn:focus-visible {
  opacity: 1;
}

.record-block h4 {
  margin: 12px 0 4px;
  font-size: 11px;
  font-weight: 500;
  color: var(--muted);
}

.record-block pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: 12.5px/1.75 var(--mono);
  color: var(--text);
  user-select: text;
}

.record-block pre.empty {
  font-family: inherit;
  color: var(--muted);
}

.record-positions-button {
  height: 24px;
  padding: 0 10px;
  font-size: 11.5px;
}

/* ---------- 参数平铺 ---------- */
.record-parameters {
  padding: 4px 2px 0;
}

.record-parameters dl {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
  margin: 2px 0 0;
}

.record-parameters dl > div {
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg);
}

.record-parameters dt {
  font-size: 10.5px;
  color: var(--muted);
}

.record-parameters dd {
  margin: 3px 0 0;
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
</style>
