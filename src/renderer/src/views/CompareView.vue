<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AnalysisResult, AnalyzedToken, TagInfo } from '@shared/types'
import { state, copy, toast, readField, writeField, fieldLabel, fieldList, sameField, validField, importPrompt, type FieldRef } from '../store'
import { parsePromptText } from '@shared/prompt-import'
import { findTextBlock } from '@shared/nai-presets'
import TagCard from '../components/TagCard.vue'
import Icon from '../components/Icon.vue'
import Mascot from '../components/Mascot.vue'
import WorkspaceBar from '../components/WorkspaceBar.vue'

const result = ref<AnalysisResult | null>(null)
const textarea = ref<HTMLTextAreaElement>()
let timer: ReturnType<typeof setTimeout> | undefined

const BASE_PLACEHOLDER =
  '把 NovelAI 提示词贴到这里～整套分节文本会自动拆到主提示词、角色和负面\n\n例如：1girl, artist:wlop, {silver hair}, 1.3::red eyes::, school uniform, looking at viewer, very aesthetic, masterpiece, no text'

/** 当前检查的是哪一段：主提示词 / 角色 N / 角色 N 负面 / 负面 */
const target = ref<FieldRef>({ kind: 'base' })
/** 角色负面只在有内容或正在检查时显示，避免切换条太长 */
const sections = computed(() =>
  fieldList().filter((f) => f.kind !== 'char' || !f.neg || readField(f).trim() || sameField(f, target.value))
)
watch(
  () => state.characters.length,
  () => {
    if (!validField(target.value)) target.value = { kind: 'base' }
  }
)
const text = computed({
  get: () => readField(target.value),
  set: (v: string) => writeField(target.value, v)
})
const isNeg = computed(() => target.value.kind === 'negative' || (target.value.kind === 'char' && !!target.value.neg))
const count = (f: FieldRef) => readField(f).split(/[,\n]/).filter((x) => x.trim()).length

function select(f: FieldRef) {
  target.value = f
  state.focus = f
}

/** 在主提示词里粘贴整套分节文本时，自动拆到各段 */
function onPaste(e: ClipboardEvent) {
  if (target.value.kind !== 'base') return
  const r = parsePromptText(e.clipboardData?.getData('text/plain') ?? '')
  if (!r.structured) return
  e.preventDefault()
  importPrompt(r, '已自动拆分')
}

async function analyze() {
  result.value = await window.api.analyze(text.value)
}
watch(
  () => [text.value, state.settings?.naiVersion, state.db?.tagCount],
  () => {
    clearTimeout(timer)
    timer = setTimeout(analyze, 200)
  },
  { immediate: true }
)

const groups = computed(() => {
  const t = result.value?.tokens ?? []
  return {
    valid: t.filter((x) => x.status === 'valid'),
    alias: t.filter((x) => x.status === 'alias'),
    unknown: t.filter((x) => x.status === 'unknown'),
    other: t.filter((x) => x.status === 'natural' || x.status === 'text')
  }
})

const allGood = computed(
  () => !!result.value && result.value.stats.valid > 0 && !result.value.stats.unknown && !result.value.stats.alias
)

function locate(t: AnalyzedToken) {
  const el = textarea.value
  if (!el) return
  // 先失焦再设选区后聚焦，Chromium 才会把滚动条滚到选区位置
  el.blur()
  el.setSelectionRange(t.start, t.end)
  el.focus()
}

/** 通过 execCommand 写入文本框，保留原生撤销栈，误清空/误替换后可以 Ctrl+Z 恢复 */
function setPrompt(text: string) {
  const el = textarea.value
  if (el && el.offsetParent !== null && text !== el.value) {
    el.focus()
    el.select()
    const ok = text ? document.execCommand('insertText', false, text) : document.execCommand('delete')
    if (ok && el.value === text) return
  }
  writeField(target.value, text)
}

function replacement(t: AnalyzedToken, tag: TagInfo): string {
  const prefix = t.prefix && t.kind === 'action' ? t.prefix : tag.category === 1 ? 'artist:' : ''
  return prefix + tag.display
}

function applyReplacements(items: { t: AnalyzedToken; text: string }[]) {
  let p = text.value
  for (const { t, text } of [...items].sort((a, b) => b.t.start - a.t.start)) {
    p = p.slice(0, t.start) + text + p.slice(t.end)
  }
  setPrompt(p)
}

function replaceWith(t: AnalyzedToken, tag: TagInfo) {
  applyReplacements([{ t, text: replacement(t, tag) }])
  toast(`已替换为 ${tag.display}`)
}

function fixAllAliases() {
  applyReplacements(groups.value.alias.map((t) => ({ t, text: replacement(t, t.aliasOf!) })))
  toast('已全部修正为标准写法')
}

function cut(p: string, t: AnalyzedToken): string {
  let end = t.end
  while (end < p.length && /[\s,]/.test(p[end])) end++
  return p.slice(0, t.start) + p.slice(end)
}

function removeToken(t: AnalyzedToken) {
  setPrompt(cut(text.value, t))
}

function removeAllUnknown() {
  let p = text.value
  for (const t of [...groups.value.unknown].sort((a, b) => b.start - a.start)) p = cut(p, t)
  setPrompt(p)
  toast('已移除不存在的 tag，可 Ctrl+Z 撤销')
}

function clearPrompt() {
  if (!text.value) return
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
    if (ch === '"') inQuote = !inQuote
    if (!inQuote && (ch === ',' || ch === '\n' || ch === '\r')) {
      parts.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  parts.push(buf)
  const out = parts
    .map((s) => (s.includes('"') || /text:/i.test(s) ? s.trim() : s.replace(/\s+/g, ' ').trim()))
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
          v-for="f in sections"
          :key="fieldLabel(f)"
          :class="['section-tab', { on: sameField(f, target), neg: f.kind === 'negative' || (f.kind === 'char' && f.neg) }]"
          @click="select(f)"
        >
          {{ fieldLabel(f) }}<span class="section-count">{{ count(f) }}</span>
        </button>
      </div>
      <div :class="['composer', { neg: isNeg }]">
        <textarea
          ref="textarea"
          v-model="text"
          spellcheck="false"
          :placeholder="target.kind === 'base' ? BASE_PLACEHOLDER : `${fieldLabel(target)}（可空）`"
          @focus="state.focus = target"
          @paste="onPaste"
        ></textarea>
        <div class="composer-bar">
          <div class="stats" v-if="result && result.stats.total">
            <span class="pill"><i></i>共 {{ result.stats.total }}</span>
            <span class="pill ok"><i></i>有效 {{ result.stats.valid }}</span>
            <span class="pill alias" v-if="result.stats.alias"><i></i>别名 {{ result.stats.alias }}</span>
            <span class="pill bad" v-if="result.stats.unknown"><i></i>不存在 {{ result.stats.unknown }}</span>
            <span class="pill nl" v-if="result.stats.natural + result.stats.text"><i></i>句子 {{ result.stats.natural + result.stats.text }}</span>
          </div>
          <span v-else class="muted small">支持 {} [] 1.3:: artist: | source# Text: 等语法</span>
          <div class="actions">
            <button class="icon-btn" title="整理格式" @click="formatPrompt"><Icon name="align" /></button>
            <button class="icon-btn" title="复制" @click="copy(text)"><Icon name="copy" /></button>
            <button class="icon-btn" title="清空" @click="clearPrompt"><Icon name="trash" /></button>
            <button class="btn accent" @click="state.tab = 'ai'"><Icon name="sparkle" :size="16" />AI 优化</button>
          </div>
        </div>
      </div>
    </section>

    <section class="pane right scroll">
      <div v-if="!state.db?.loaded" class="empty">
        <Mascot mood="sleep" :size="220" />
        <p>还没有 tag 数据哦，先去下载 Danbooru 的 tag 库吧</p>
        <button class="btn primary" @click="state.tab = 'settings'"><Icon name="download" :size="16" />去下载</button>
      </div>
      <div v-else-if="!result?.tokens.length" class="empty">
        <Mascot mood="check" :size="220" />
        <p>在左边输入提示词，我会帮你一个个检查～</p>
      </div>
      <div v-else-if="allGood" class="cheer">
        <Mascot mood="happy" :size="76" />
        <div>
          <b>全部 tag 都存在！</b>
          <div class="muted small">没有拼写错误和别名，可以直接用啦</div>
        </div>
      </div>
      <div v-else-if="result.stats.unknown >= 3" class="cheer warn">
        <Mascot mood="confused" :size="76" />
        <div>
          <b>有 {{ result.stats.unknown }} 个 tag 认不出来</b>
          <div class="muted small">点候选可以一键替换，或者交给 AI 优化</div>
        </div>
        <button class="btn accent small ml-auto" @click="state.tab = 'ai'"><Icon name="sparkle" :size="14" />AI 优化</button>
      </div>

      <div class="group" v-if="groups.unknown.length">
        <div class="group-head">
          <span class="group-badge bad"><Icon name="x" :size="14" :stroke="2.2" /></span>
          <h3>不存在的 tag</h3>
          <span class="group-count">{{ groups.unknown.length }}</span>
          <button class="btn ghost small ml-auto" @click="removeAllUnknown"><Icon name="trash" :size="14" />全部移除</button>
        </div>
        <div class="unknown-item" v-for="(t, i) in groups.unknown" :key="'u' + i" :style="{ '--i': i }">
          <div class="unknown-head" @click="locate(t)">
            <span class="tag-raw wavy">{{ t.prefix ?? '' }}{{ t.core }}</span>
            <span class="muted small" v-if="t.section">第 {{ t.section + 1 }} 段</span>
            <button class="icon-btn sm ml-auto" title="移除" @click.stop="removeToken(t)"><Icon name="x" :size="14" /></button>
          </div>
          <div class="suggest" v-if="t.suggestions?.length">
            <span class="muted small">是不是想找：</span>
            <button v-for="s in t.suggestions" :key="s.name" class="chip" @click="replaceWith(t, s)">
              {{ s.display }}<span class="chip-zh" v-if="s.zh">{{ s.zh }}</span>
            </button>
          </div>
          <div v-else class="muted small">没有相近的 tag，可以试试 AI 优化</div>
        </div>
      </div>

      <div class="group" v-if="groups.alias.length">
        <div class="group-head">
          <span class="group-badge alias"><Icon name="swap" :size="14" :stroke="2" /></span>
          <h3>别名 / 非标准写法</h3>
          <span class="group-count">{{ groups.alias.length }}</span>
          <button class="btn ghost small ml-auto" @click="fixAllAliases"><Icon name="check" :size="14" />全部修正</button>
        </div>
        <div class="alias-item" v-for="(t, i) in groups.alias" :key="'a' + i" :style="{ '--i': i }" @click="locate(t)">
          <span class="tag-raw">{{ t.core }}</span>
          <span class="arrow"><Icon name="arrow" :size="16" /></span>
          <TagCard :tag="t.aliasOf!" />
          <button class="btn small" @click.stop="replaceWith(t, t.aliasOf!)">修正</button>
        </div>
      </div>

      <div class="group" v-if="groups.valid.length">
        <div class="group-head">
          <span class="group-badge ok"><Icon name="check" :size="14" :stroke="2.2" /></span>
          <h3>有效 tag</h3>
          <span class="group-count">{{ groups.valid.length }}</span>
          <span class="muted small ml-auto">双击中文可编辑</span>
        </div>
        <div class="tag-grid">
          <div v-for="(t, i) in groups.valid" :key="'v' + i" class="valid-wrap">
            <TagCard :tag="t.tag!" :weight="t.weight" :prefix="t.prefix" :index="i" editable @click="locate(t)" />
            <div v-if="t.warning" class="warn-line"><Icon name="warn" :size="13" />{{ t.warning }}</div>
          </div>
        </div>
      </div>

      <div class="group" v-if="groups.other.length">
        <div class="group-head">
          <span class="group-badge nl"><Icon name="chat" :size="14" :stroke="2" /></span>
          <h3>自然语言 / 文字</h3>
          <span class="group-count">{{ groups.other.length }}</span>
        </div>
        <div class="nl-item" v-for="(t, i) in groups.other" :key="'n' + i" :style="{ '--i': i }" @click="locate(t)">
          <span :class="['badge', t.status]">{{ t.status === 'text' ? '文字' : '句子' }}</span>
          <span>{{ t.prefix ?? '' }}{{ t.core }}</span>
          <div v-if="t.warning" class="warn-line"><Icon name="warn" :size="13" />{{ t.warning }}</div>
        </div>
      </div>
    </section>
  </div>
</template>
