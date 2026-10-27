<script setup lang="ts">
import { promptState } from './state'
import { settingsState } from '../settings/state'
import { tagState } from '../tags/state'
import { shellState } from '../../shared/state/shell'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { AnalysisResult, AnalyzedToken } from '@shared/prompts/types'
import type { TagInfo } from '@shared/tags/types'
import { copy, toast } from '../../shared/lib/notifications'
import { cleanErr } from '../../shared/lib/format'
import {
  readField,
  writeField,
  fieldLabel,
  fieldList,
  sameField,
  validField,
  importPrompt,
} from './actions'
import { type FieldRef } from './state'
import { parsePromptText } from '@shared/prompts/import'
import { findTextBlock } from '@shared/generation/presets'
import TagCard from '../tags/components/TagCard.vue'
import Icon from '../../shared/ui/Icon.vue'
import Mascot from '../../shared/ui/Mascot.vue'
import WorkspaceBar from './components/WorkspaceBar.vue'

const analyzed = ref<{ key: string; result: AnalysisResult } | null>(null)
const textarea = ref<HTMLTextAreaElement>()
let timer: ReturnType<typeof setTimeout> | undefined
let analysisEpoch = 0

const BASE_PLACEHOLDER =
  '把 NovelAI 提示词贴到这里～整套分节文本会自动拆到主提示词、角色和负面\n\n例如：1girl, artist:wlop, {silver hair}, 1.3::red eyes::, school uniform, looking at viewer, very aesthetic, masterpiece, no text'

/** 当前检查的是哪一段：主提示词 / 角色 N / 角色 N 负面 / 负面 */
const target = ref<FieldRef>({ kind: 'base' })
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
const isNeg = computed(
  () => target.value.kind === 'negative' || (target.value.kind === 'char' && !!target.value.neg),
)
const count = (field: FieldRef) =>
  readField(field)
    .split(/[,\n]/)
    .filter((text2) => text2.trim()).length

function select(field: FieldRef) {
  target.value = field
  promptState.focus = field
}

/** 在主提示词里粘贴整套分节文本时，自动拆到各段 */
function onPaste(event2: ClipboardEvent) {
  if (target.value.kind !== 'base') {
    return
  }
  const importedPrompt = parsePromptText(event2.clipboardData?.getData('text/plain') ?? '')
  if (!importedPrompt.structured) {
    return
  }
  event2.preventDefault()
  importPrompt(importedPrompt, '已自动拆分')
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

const allGood = computed(
  () =>
    !!result.value &&
    result.value.stats.valid > 0 &&
    !result.value.stats.unknown &&
    !result.value.stats.alias,
)

function locate(analyzedToken: AnalyzedToken) {
  if (!currentTokens([analyzedToken])) {
    return
  }
  const el = textarea.value
  if (!el) {
    return
  }
  // 先失焦再设选区后聚焦，Chromium 才会把滚动条滚到选区位置
  el.blur()
  el.setSelectionRange(analyzedToken.start, analyzedToken.end)
  el.focus()
}

/** 通过 execCommand 写入文本框，保留原生撤销栈，误清空/误替换后可以 Ctrl+Z 恢复 */
function setPrompt(text: string) {
  const el = textarea.value
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

function cut(path: string, analyzedToken: AnalyzedToken): string {
  let end = analyzedToken.end
  while (end < path.length && /[\s,]/.test(path[end])) {
    end++
  }
  return path.slice(0, analyzedToken.start) + path.slice(end)
}

function removeToken(analyzedToken: AnalyzedToken) {
  if (!currentTokens([analyzedToken])) {
    return
  }
  setPrompt(cut(text.value, analyzedToken))
}

function removeAllUnknown() {
  if (!currentTokens(groups.value.unknown)) {
    return
  }
  let path = text.value
  for (const analyzedToken of [...groups.value.unknown].sort(
    (analyzedToken2, analyzedToken3) => analyzedToken3.start - analyzedToken2.start,
  )) {
    path = cut(path, analyzedToken)
  }
  setPrompt(path)
  toast('已移除不存在的 tag，可 Ctrl+Z 撤销')
}

function clearPrompt() {
  if (!text.value) {
    return
  }
  setPrompt('')
  toast('已清空，可 Ctrl+Z 撤销')
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
  <div class="view compare">
    <section class="pane left">
      <WorkspaceBar />
      <div class="section-tabs">
        <button
          v-for="sectionItem in sections"
          :key="fieldLabel(sectionItem)"
          :class="[
            'section-tab',
            {
              on: sameField(sectionItem, target),
              neg:
                sectionItem.kind === 'negative' || (sectionItem.kind === 'char' && sectionItem.neg),
            },
          ]"
          @click="select(sectionItem)"
        >
          {{ fieldLabel(sectionItem) }}<span class="section-count">{{ count(sectionItem) }}</span>
        </button>
      </div>
      <div :class="['composer', { neg: isNeg }]">
        <textarea
          ref="textarea"
          v-model="text"
          spellcheck="false"
          :placeholder="target.kind === 'base' ? BASE_PLACEHOLDER : `${fieldLabel(target)}（可空）`"
          @focus="promptState.focus = target"
          @paste="onPaste"
        ></textarea>
        <div class="composer-bar">
          <div
            v-if="result && result.stats.total"
            class="stats"
          >
            <span class="pill"><i></i>共 {{ result.stats.total }}</span>
            <span class="pill ok"><i></i>有效 {{ result.stats.valid }}</span>
            <span
              v-if="result.stats.alias"
              class="pill alias"
              ><i></i>别名 {{ result.stats.alias }}</span
            >
            <span
              v-if="result.stats.unknown"
              class="pill bad"
              ><i></i>不存在 {{ result.stats.unknown }}</span
            >
            <span
              v-if="result.stats.natural + result.stats.text"
              class="pill nl"
              ><i></i>句子 {{ result.stats.natural + result.stats.text }}</span
            >
          </div>
          <span
            v-else
            class="muted small"
            >支持 {} [] 1.3:: artist: | source# Text: 等语法</span
          >
          <div class="actions">
            <button
              class="icon-btn"
              title="整理格式"
              @click="formatPrompt"
            >
              <Icon name="align" />
            </button>
            <button
              class="icon-btn"
              title="复制"
              @click="copy(text)"
            >
              <Icon name="copy" />
            </button>
            <button
              class="icon-btn"
              title="清空"
              @click="clearPrompt"
            >
              <Icon name="trash" />
            </button>
            <button
              class="btn accent"
              @click="shellState.tab = 'ai'"
            >
              <Icon
                name="sparkle"
                :size="16"
              />AI 优化
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="pane right scroll">
      <div
        v-if="!tagState.db?.loaded"
        class="empty"
      >
        <Mascot
          mood="sleep"
          :size="220"
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
          mood="check"
          :size="220"
        />
        <p>在左边输入提示词，我会帮你一个个检查～</p>
      </div>
      <div
        v-else-if="allGood"
        class="cheer"
      >
        <Mascot
          mood="happy"
          :size="76"
        />
        <div>
          <b>全部 tag 都存在！</b>
          <div class="muted small">没有拼写错误和别名，可以直接用啦</div>
        </div>
      </div>
      <div
        v-else-if="result.stats.unknown >= 3"
        class="cheer warn"
      >
        <Mascot
          mood="confused"
          :size="76"
        />
        <div>
          <b>有 {{ result.stats.unknown }} 个 tag 认不出来</b>
          <div class="muted small">点候选可以一键替换，或者交给 AI 优化</div>
        </div>
        <button
          class="btn accent small ml-auto"
          @click="shellState.tab = 'ai'"
        >
          <Icon
            name="sparkle"
            :size="14"
          />AI 优化
        </button>
      </div>

      <div
        v-if="groups.unknown.length"
        class="group"
      >
        <div class="group-head">
          <span class="group-badge bad"
            ><Icon
              name="x"
              :size="14"
              :stroke="2.2"
          /></span>
          <h3>不存在的 tag</h3>
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
          class="unknown-item"
          :style="{ '--i': index }"
        >
          <div
            class="unknown-head"
            @click="locate(group)"
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
          class="alias-item"
          :style="{ '--i': index }"
          @click="locate(group)"
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
          <span class="muted small ml-auto">双击中文可编辑</span>
        </div>
        <div class="tag-grid">
          <div
            v-for="(group, indexItem) in groups.valid"
            :key="'v' + indexItem"
            class="valid-wrap"
          >
            <TagCard
              :tag="group.tag!"
              :weight="group.weight"
              :prefix="group.prefix"
              :index="indexItem"
              editable
              @click="locate(group)"
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
          class="nl-item"
          :style="{ '--i': index }"
          @click="locate(group)"
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
