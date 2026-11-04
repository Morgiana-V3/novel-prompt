<script setup lang="ts">
import { promptState } from './state'
import { settingsState } from '../settings/state'
import { tagState } from '../tags/state'
import { shellState } from '../../shared/state/shell'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { AnalysisResult, AnalyzedToken } from '@shared/prompts/types'
import type { TagInfo } from '@shared/tags/types'
import { toast } from '../../shared/lib/notifications'
import { cleanErr } from '../../shared/lib/format'
import { readField, writeField, fieldLabel, fieldList, sameField, validField } from './actions'
import { type FieldRef } from './state'
import { findTextBlock } from '@shared/generation/presets'
import { promptSelectionRanges, removePromptTokens } from '@shared/prompts/remove-tokens'
import { revealTextareaRange } from '../../shared/lib/reveal-textarea-range'
import { highlightTextareaRanges } from '../../shared/lib/textarea-highlights'
import TagCard from '../tags/components/TagCard.vue'
import Icon from '../../shared/ui/Icon.vue'
import Mascot from '../../shared/ui/Mascot.vue'
import { usePagePresentation } from '../../shared/lib/page-presentation'
const { navigate, editor, isActive } = usePagePresentation()

const analyzed = ref<{ key: string; result: AnalysisResult } | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined
let analysisEpoch = 0

/** 当前检查的是哪一段：主提示词 / 角色 N / 角色 N 负面 / 负面 */
const target = ref<FieldRef>({ kind: 'base' })
watch(
  () => promptState.focus,
  () => {
    if (validField(promptState.focus)) {
      target.value = { ...promptState.focus }
    }
  },
  { deep: true, immediate: true },
)
function activeTextarea() {
  const field = target.value
  if (field.kind === 'char') {
    return editor()
      ?.querySelectorAll('.char-block')
      [field.index]?.querySelector<HTMLTextAreaElement>(
        `textarea[data-src="${field.neg ? 'neg' : 'pos'}"]`,
      )
  }
  return editor()?.querySelector<HTMLTextAreaElement>(
    `textarea[aria-label="${field.kind === 'base' ? '主提示词' : '负面提示词'}"]`,
  )
}
/** 角色负面只在有内容或正在检查时显示，避免切换条太长 */
const sections = computed(() =>
  fieldList().filter(
    (field) =>
      field.kind !== 'char' ||
      !field.neg ||
      readField(field).trim() ||
      sameField(field, target.value),
  ),
)
watch(
  () => promptState.characters.length,
  () => {
    if (!validField(target.value)) {
      target.value = { kind: 'base' }
    }
  },
)
const text = computed({
  get: () => readField(target.value),
  set: (text2: string) => writeField(target.value, text2),
})
// Hide stale offsets immediately, including switches between fields with identical text.
const analysisKey = computed(() =>
  JSON.stringify([
    target.value,
    text.value,
    settingsState.settings?.naiVersion,
    tagState.db?.tagCount,
  ]),
)
const result = computed(() =>
  analyzed.value?.key === analysisKey.value ? analyzed.value.result : null,
)
const selectedTokens = ref<AnalyzedToken[]>([])
const ctrlSelection = ref(false)
let clearHighlights: (() => void) | undefined
function clearSelection() {
  ctrlSelection.value = false
  selectedTokens.value = []
}
watch(
  () => [selectedTokens.value, ctrlSelection.value, isActive('compare')],
  () => {
    clearHighlights?.()
    clearHighlights = undefined
    const input = activeTextarea()
    if (input && ctrlSelection.value && selectedTokens.value.length && isActive('compare')) {
      clearHighlights = highlightTextareaRanges(
        input,
        promptSelectionRanges(input.value, selectedTokens.value),
        clearSelection,
      )
    }
  },
  { flush: 'post' },
)
onBeforeUnmount(() => clearHighlights?.())
watch(analysisKey, clearSelection, { flush: 'sync' })
const count = (field: FieldRef) =>
  readField(field)
    .split(/[,\n]/)
    .filter((text2) => text2.trim()).length

function select(field: FieldRef) {
  target.value = field
  promptState.focus = field
}

async function analyze() {
  const key = analysisKey.value
  const epoch = ++analysisEpoch
  try {
    const next = await window.api.analyze(text.value)
    if (epoch === analysisEpoch && key === analysisKey.value) {
      analyzed.value = { key, result: next }
    }
  } catch (error) {
    if (epoch === analysisEpoch && key === analysisKey.value) {
      toast(`检查失败：${cleanErr(error)}`)
    }
  }
}
watch(
  analysisKey,
  () => {
    analysisEpoch++
    clearTimeout(timer)
    timer = setTimeout(analyze, 200)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  clearTimeout(timer)
  analysisEpoch++
})

const currentTokens = (tokens: AnalyzedToken[]) =>
  tokens.length > 0 && tokens.every((analyzedToken) => result.value?.tokens.includes(analyzedToken))

const groups = computed(() => {
  const analyzedToken = result.value?.tokens ?? []
  return {
    valid: analyzedToken.filter((analyzedToken2) => analyzedToken2.status === 'valid'),
    alias: analyzedToken.filter((analyzedToken2) => analyzedToken2.status === 'alias'),
    unknown: analyzedToken.filter((analyzedToken2) => analyzedToken2.status === 'unknown'),
    other: analyzedToken.filter(
      (analyzedToken2) => analyzedToken2.status === 'natural' || analyzedToken2.status === 'text',
    ),
  }
})

/** 检查摘要：只列有数量的项，问题排在前面；点一下滚动到对应分组 */
const summary = computed(() => {
  const stats = result.value?.stats
  if (!stats) {
    return []
  }
  return [
    {
      kind: 'unknown',
      label: '未收录',
      count: stats.unknown,
      title: '词库未收录，不代表模型一定不认识',
    },
    {
      kind: 'alias',
      label: '可改写',
      count: stats.alias,
      title: '别名或非标准写法，可一键改成标准 tag',
    },
    {
      kind: 'other',
      label: '自然语言',
      count: stats.natural + stats.text,
      title: '句子或文字内容',
    },
    { kind: 'valid', label: '有效', count: stats.valid, title: '词库中的标准 tag' },
  ].filter((item) => item.count > 0)
})
const rightPane = ref<HTMLElement>()
function jump(kind: string) {
  rightPane.value
    ?.querySelector(`[data-group="${kind}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function locate(analyzedToken: AnalyzedToken, event?: MouseEvent | KeyboardEvent) {
  if (!currentTokens([analyzedToken])) {
    return
  }
  if (event?.ctrlKey || event?.metaKey) {
    event.preventDefault()
    ctrlSelection.value = true
    selectedTokens.value = selectedTokens.value.includes(analyzedToken)
      ? selectedTokens.value.filter((token) => token !== analyzedToken)
      : [...selectedTokens.value, analyzedToken]
    ;(event.target as HTMLElement)
      ?.closest<HTMLElement>('.token-selectable')
      ?.focus({ preventScroll: true })
    const input = activeTextarea()
    input?.setSelectionRange(input.selectionEnd, input.selectionEnd)
    return
  }
  clearHighlights?.()
  clearHighlights = undefined
  ctrlSelection.value = false
  selectedTokens.value = []
  const el = activeTextarea()
  if (!el) {
    return
  }
  el.focus({ preventScroll: true })
  const ranges = promptSelectionRanges(el.value, [analyzedToken])
  const range = ranges.length === 1 ? ranges[0] : analyzedToken
  el.setSelectionRange(range.start, range.end)
  revealTextareaRange(el, range.start, range.end)
}

function removeSelected() {
  if (!currentTokens(selectedTokens.value)) {
    clearSelection()
    return
  }
  setPrompt(removePromptTokens(text.value, selectedTokens.value))
  clearSelection()
}
function selectionKey(event: KeyboardEvent) {
  if (
    (event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]') ||
    event.isComposing
  ) {
    return
  }
  if (event.key === 'Escape') {
    clearSelection()
  } else if (
    ['Delete', 'Backspace'].includes(event.key) &&
    selectedTokens.value.length &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    event.preventDefault()
    event.stopPropagation()
    removeSelected()
  }
}

/** 通过 execCommand 写入文本框，保留原生撤销栈，误清空/误替换后可以 Ctrl+Z 恢复 */
function setPrompt(text: string) {
  const el = activeTextarea()
  if (el && el.offsetParent !== null && text !== el.value) {
    el.focus()
    el.select()
    const ok = text
      ? document.execCommand('insertText', false, text)
      : document.execCommand('delete')
    if (ok && el.value === text) {
      return
    }
  }
  writeField(target.value, text)
}

function replacement(analyzedToken: AnalyzedToken, tag: TagInfo): string {
  const resolvePrefix = () => {
    if (analyzedToken.prefix && analyzedToken.kind === 'action') {
      return analyzedToken.prefix
    }
    if (tag.category === 1) {
      return 'artist:' as const
    }
    return '' as const
  }
  const prefix = resolvePrefix()
  return prefix + tag.display
}

function applyReplacements(items: { t: AnalyzedToken; text: string }[]) {
  if (!currentTokens(items.map((item) => item.t))) {
    return false
  }
  let path = text.value
  for (const { t, text } of [...items].sort(
    (leftReplacement, rightReplacement) => rightReplacement.t.start - leftReplacement.t.start,
  )) {
    path = path.slice(0, t.start) + text + path.slice(t.end)
  }
  setPrompt(path)
  return true
}

function replaceWith(analyzedToken: AnalyzedToken, tag: TagInfo) {
  if (applyReplacements([{ t: analyzedToken, text: replacement(analyzedToken, tag) }])) {
    toast(`已替换为 ${tag.display}`)
  }
}

function fixAllAliases() {
  if (
    applyReplacements(
      groups.value.alias.map((analyzedToken) => ({
        t: analyzedToken,
        text: replacement(analyzedToken, analyzedToken.aliasOf!),
      })),
    )
  ) {
    toast('已全部修正为标准写法')
  }
}

function removeToken(analyzedToken: AnalyzedToken) {
  if (!currentTokens([analyzedToken])) {
    return
  }
  setPrompt(removePromptTokens(text.value, [analyzedToken]))
}

function removeAllUnknown() {
  if (!currentTokens(groups.value.unknown)) {
    return
  }
  setPrompt(removePromptTokens(text.value, groups.value.unknown))
  toast('已移除不存在的 tag，可 Ctrl+Z 撤销')
}

/**
 * 整理格式：逗号/换行统一为「, 」分隔，压缩多余空白。
 * 与解析器保持一致：换行也是分隔符（避免把两个 tag 合并成一个），
 * 引号内文字与 Text: 块原样保留。
 */
function formatPrompt() {
  const src = text.value
  const textAt = findTextBlock(src)
  const parts: string[] = []
  let buf = ''
  let inQuote = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (i === textAt) {
      buf += src.slice(i)
      break
    }
    if (ch === '"') {
      inQuote = !inQuote
    }
    if (!inQuote && (ch === ',' || ch === '\n' || ch === '\r')) {
      parts.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  parts.push(buf)
  const out = parts
    .map((text2) =>
      text2.includes('"') || /text:/i.test(text2)
        ? text2.trim()
        : text2.replace(/\s+/g, ' ').trim(),
    )
    .filter(Boolean)
    .join(', ')
  setPrompt(out)
  toast('已整理格式')
}
</script>

<template>
  <div
    id="creation-panel-compare"
    role="tabpanel"
    aria-labelledby="creation-tab-compare"
    class="view compare"
  >
    <section
      ref="rightPane"
      class="pane right scroll"
      @keydown="selectionKey"
    >
      <div class="section-tabs">
        <button
          v-for="field in sections"
          :key="fieldLabel(field)"
          :class="['section-tab', { on: sameField(field, target) }]"
          @click="select(field)"
        >
          {{ fieldLabel(field) }} <span class="section-count">{{ count(field) }}</span>
        </button>
      </div>
      <div
        v-if="result"
        class="check-toolbar"
      >
        <div
          class="stats check-summary"
          aria-label="检查结果"
        >
          <button
            v-for="item in summary"
            :key="item.kind"
            class="summary-item"
            :class="item.kind"
            :title="item.title"
            @click="jump(item.kind)"
          >
            <i></i>{{ item.label }}<b>{{ item.count }}</b>
          </button>
          <span
            v-if="!summary.length"
            class="muted small"
            >这一段还没有内容</span
          >
        </div>
        <div class="check-actions">
          <button
            v-if="selectedTokens.length > 1"
            class="btn ghost small"
            @click="removeSelected"
          >
            <Icon
              name="trash"
              :size="13"
            />删除所选
          </button>
          <button
            class="btn ghost small"
            @click="formatPrompt"
          >
            整理格式</button
          ><button
            class="btn ghost small"
            @click="navigate('ai')"
          >
            <Icon
              name="sparkle"
              :size="13"
            />交给 AI 调整
          </button>
        </div>
      </div>
      <div
        v-if="!tagState.db?.loaded"
        class="empty"
      >
        <Mascot
          mood="sleep"
          motion="loop"
          :size="280"
        />
        <p>还没有 tag 数据哦，先去下载 Danbooru 的 tag 库吧</p>
        <button
          class="btn primary"
          @click="shellState.tab = 'settings'"
        >
          <Icon
            name="download"
            :size="16"
          />去下载
        </button>
      </div>
      <div
        v-else-if="!result?.tokens.length"
        class="empty"
      >
        <Mascot
          mood="reading"
          motion="loop"
          :size="280"
        />
        <p>在左边输入提示词，我会帮你一个个检查～</p>
      </div>

      <div
        v-if="groups.unknown.length"
        class="group"
        data-group="unknown"
      >
        <div class="group-head">
          <span class="group-badge bad"
            ><Icon
              name="x"
              :size="14"
              :stroke="2.2"
          /></span>
          <h3>词库未收录</h3>
          <span class="group-count">{{ groups.unknown.length }}</span>
          <button
            class="btn ghost small ml-auto"
            @click="removeAllUnknown"
          >
            <Icon
              name="trash"
              :size="14"
            />全部移除
          </button>
        </div>
        <div
          v-for="(group, index) in groups.unknown"
          :key="'u' + index"
          class="unknown-item token-selectable"
          :class="{ 'token-selected': ctrlSelection && selectedTokens.includes(group) }"
          tabindex="0"
          role="button"
          :aria-pressed="ctrlSelection && selectedTokens.includes(group)"
          :style="{ '--i': index }"
          @keydown.enter.self.prevent="locate(group, $event)"
          @keydown.space.self.prevent="locate(group, $event)"
        >
          <div
            class="unknown-head"
            @click="locate(group, $event)"
          >
            <span class="tag-raw wavy">{{ group.prefix ?? '' }}{{ group.core }}</span>
            <span
              v-if="group.section"
              class="muted small"
              >第 {{ group.section + 1 }} 段</span
            >
            <button
              class="icon-btn sm ml-auto"
              title="移除"
              @click.stop="removeToken(group)"
            >
              <Icon
                name="x"
                :size="14"
              />
            </button>
          </div>
          <div
            v-if="group.suggestions?.length"
            class="suggest"
          >
            <span class="muted small">是不是想找：</span>
            <button
              v-for="tag in group.suggestions"
              :key="tag.name"
              class="chip"
              @click="replaceWith(group, tag)"
            >
              {{ tag.display
              }}<span
                v-if="tag.zh"
                class="chip-zh"
                >{{ tag.zh }}</span
              >
            </button>
          </div>
          <div
            v-else
            class="muted small"
          >
            没有相近的 tag，可以试试 AI 优化
          </div>
        </div>
      </div>

      <div
        v-if="groups.alias.length"
        class="group"
        data-group="alias"
      >
        <div class="group-head">
          <span class="group-badge alias"
            ><Icon
              name="swap"
              :size="14"
              :stroke="2"
          /></span>
          <h3>别名 / 非标准写法</h3>
          <span class="group-count">{{ groups.alias.length }}</span>
          <button
            class="btn ghost small ml-auto"
            @click="fixAllAliases"
          >
            <Icon
              name="check"
              :size="14"
            />全部修正
          </button>
        </div>
        <div
          v-for="(group, index) in groups.alias"
          :key="'a' + index"
          class="alias-item token-selectable"
          :class="{ 'token-selected': ctrlSelection && selectedTokens.includes(group) }"
          tabindex="0"
          role="button"
          :aria-pressed="ctrlSelection && selectedTokens.includes(group)"
          :style="{ '--i': index }"
          @keydown.enter.self.prevent="locate(group, $event)"
          @keydown.space.self.prevent="locate(group, $event)"
          @click="locate(group, $event)"
        >
          <span class="tag-raw">{{ group.core }}</span>
          <span class="arrow"
            ><Icon
              name="arrow"
              :size="16"
          /></span>
          <TagCard :tag="group.aliasOf!" />
          <button
            class="btn small"
            @click.stop="replaceWith(group, group.aliasOf!)"
          >
            修正
          </button>
        </div>
      </div>

      <div
        v-if="groups.valid.length"
        class="group"
        data-group="valid"
      >
        <div class="group-head">
          <span class="group-badge ok"
            ><Icon
              name="check"
              :size="14"
              :stroke="2.2"
          /></span>
          <h3>有效 tag</h3>
          <span class="group-count">{{ groups.valid.length }}</span>
          <button
            class="btn ghost small ml-auto"
            title="前往词库检索管理翻译"
            @click="shellState.tab = 'search'"
          >
            词库翻译
          </button>
        </div>
        <div class="tag-grid">
          <div
            v-for="(group, indexItem) in groups.valid"
            :key="'v' + indexItem"
            class="valid-wrap token-selectable"
            :class="{ 'token-selected': ctrlSelection && selectedTokens.includes(group) }"
            tabindex="0"
            role="button"
            :aria-pressed="ctrlSelection && selectedTokens.includes(group)"
            @keydown.enter.self.prevent="locate(group, $event)"
            @keydown.space.self.prevent="locate(group, $event)"
          >
            <TagCard
              :tag="group.tag!"
              :weight="group.weight"
              :prefix="group.prefix"
              :index="indexItem"
              @click="locate(group, $event)"
            />
            <div
              v-if="group.warning"
              class="warn-line"
            >
              <Icon
                name="warn"
                :size="13"
              />{{ group.warning }}
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="groups.other.length"
        class="group"
        data-group="other"
      >
        <div class="group-head">
          <span class="group-badge nl"
            ><Icon
              name="chat"
              :size="14"
              :stroke="2"
          /></span>
          <h3>自然语言 / 文字</h3>
          <span class="group-count">{{ groups.other.length }}</span>
        </div>
        <div
          v-for="(group, index) in groups.other"
          :key="'n' + index"
          class="nl-item token-selectable"
          :class="{ 'token-selected': ctrlSelection && selectedTokens.includes(group) }"
          tabindex="0"
          role="button"
          :aria-pressed="ctrlSelection && selectedTokens.includes(group)"
          :style="{ '--i': index }"
          @keydown.enter.self.prevent="locate(group, $event)"
          @keydown.space.self.prevent="locate(group, $event)"
          @click="locate(group, $event)"
        >
          <span :class="['badge', group.status]">{{
            group.status === 'text' ? '文字' : '句子'
          }}</span>
          <span>{{ group.prefix ?? '' }}{{ group.core }}</span>
          <div
            v-if="group.warning"
            class="warn-line"
          >
            <Icon
              name="warn"
              :size="13"
            />{{ group.warning }}
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.token-selectable {
  border-radius: 12px;
}

.token-selected:not(.valid-wrap),
.token-selected :deep(.tag-card) {
  border-color: var(--pink-line);
  background: var(--pink-soft);
  box-shadow: none;
}

.token-selected :deep(.tag-card:hover) {
  transform: none;
}

.token-selected:focus-visible {
  box-shadow: none;
}
</style>
