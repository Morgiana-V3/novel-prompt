<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { AiPreviewResult, Confidence, PreviewIssueKind, PreviewPoint, UcPreset } from '@shared/types'
import { state, copy, toast, toDrafts, type CharDraft } from '../store'
import { parsePromptText, readPngPrompt, type ImportedPrompt } from '../prompt-import'
import { vAutosize, resizeWithin } from '../autosize'
import Icon from '../components/Icon.vue'
import Mascot from '../components/Mascot.vue'
import CharacterEditor from '../components/CharacterEditor.vue'
import BasisPill from '../components/BasisPill.vue'
import EvidenceNote from '../components/EvidenceNote.vue'
import type { IconName } from '../components/icons'

const form = reactive({
  base: '',
  negative: '',
  characters: [] as CharDraft[],
  expectation: '',
  width: 832,
  height: 1216,
  qualityTags: true,
  ucPreset: 'heavy' as UcPreset
})

const SIZES = [
  { key: 'portrait', label: '竖图', w: 832, h: 1216 },
  { key: 'landscape', label: '横图', w: 1216, h: 832 },
  { key: 'square', label: '方图', w: 1024, h: 1024 }
]
const UC_OPTIONS: { key: UcPreset; label: string }[] = [
  { key: 'heavy', label: 'Heavy' },
  { key: 'light', label: 'Light' },
  { key: 'human', label: '人物' },
  { key: 'none', label: '无' }
]
const sizeKey = computed(() => SIZES.find((s) => s.w === form.width && s.h === form.height)?.key ?? 'custom')

const running = ref(false)
const steps = ref<string[]>([])
const result = ref<AiPreviewResult | null>(null)
const error = ref('')
const dragDepth = ref(0)
const fileInput = ref<HTMLInputElement>()

const leftPane = ref<HTMLElement>()
const resizeAll = () => resizeWithin(leftPane.value)

onMounted(() => {
  window.api.onAiStep((s) => {
    if (running.value) steps.value.push(s)
  })
  window.addEventListener('resize', resizeAll)
})
onBeforeUnmount(() => window.removeEventListener('resize', resizeAll))

watch(
  () => state.tab,
  async (t) => {
    if (t !== 'preview') return
    await nextTick()
    resizeAll()
  }
)

/* ---------- 导入 ---------- */
function applyImport(r: ImportedPrompt, source: string) {
  form.base = r.base
  form.negative = r.negative
  form.characters = toDrafts(r.characters)
  if (r.width && r.height) {
    form.width = r.width
    form.height = r.height
  }
  // NAI 元数据里的提示词已经包含自动追加的质量词和 UC 预设，避免重复计算
  if (r.fromMetadata) {
    form.qualityTags = false
    form.ucPreset = 'none'
  }
  result.value = null
  error.value = ''
  const parts = [r.base && '主提示词', r.characters.length && `${r.characters.length} 个角色`, r.negative && '负面'].filter(Boolean)
  toast(parts.length ? `${source}：${parts.join(' / ')}` : '没有识别到提示词')
  nextTick(resizeAll)
}

/** 粘贴到主提示词时，如果识别到分节标记或元数据 JSON，自动拆分到各个输入框 */
function onBasePaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text/plain') ?? ''
  const r = parsePromptText(text)
  if (!r.structured) return
  e.preventDefault()
  applyImport(r, '已自动拆分')
}

async function pasteClipboard() {
  const text = await window.api.readClipboard()
  if (!text.trim()) {
    toast('剪贴板里没有文字')
    return
  }
  applyImport(parsePromptText(text), '已导入')
}

async function loadImage(file: File) {
  try {
    applyImport(await readPngPrompt(file), '已读取原图')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) loadImage(file)
  input.value = ''
}

function onDragEnter(e: DragEvent) {
  if (e.dataTransfer?.types.includes('Files')) dragDepth.value++
}
function onDragOver(e: DragEvent) {
  // 文件必须阻止默认行为，否则 Electron 会直接打开图片
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
}
function onDragLeave(e: DragEvent) {
  if (e.dataTransfer?.types.includes('Files')) dragDepth.value = Math.max(0, dragDepth.value - 1)
}
function onDrop(e: DragEvent) {
  dragDepth.value = 0
  const file = e.dataTransfer?.files?.[0]
  if (file) {
    e.preventDefault()
    loadImage(file)
    return
  }
  const r = parsePromptText(e.dataTransfer?.getData('text/plain') ?? '')
  if (r.structured) {
    e.preventDefault()
    applyImport(r, '已自动拆分')
  }
}

/** 其他页面送来的整套提示词（如 AI 优化的结果） */
watch(
  () => state.previewDraft,
  (d) => {
    if (!d) return
    state.previewDraft = null
    form.expectation = ''
    applyImport(d, '已带入')
  },
  { immediate: true }
)

function fromCompare() {
  if (!state.prompt.trim() && !state.negative.trim()) {
    toast('比对页还是空的')
    return
  }
  form.base = state.prompt
  form.negative = state.negative
  toast('已带入比对页的提示词')
  nextTick(resizeAll)
}

function clearAll() {
  Object.assign(form, { base: '', negative: '', characters: [], expectation: '' })
  result.value = null
  error.value = ''
  steps.value = []
  nextTick(resizeAll)
}

function setSize(w: number, h: number) {
  form.width = w
  form.height = h
}

function openSkill() {
  window.api.openSkill('nai-preview.md')
}

/* ---------- 推测 ---------- */
async function run() {
  if (!state.settings?.apiKey) {
    error.value = '请先在「设置 / 数据」中填写 DeepSeek API Key'
    return
  }
  if (!form.base.trim() && !form.characters.some((c) => c.prompt.trim())) {
    error.value = '请先输入主提示词或角色提示词'
    return
  }
  running.value = true
  error.value = ''
  steps.value = []
  result.value = null
  try {
    result.value = await window.api.preview({
      base: form.base,
      negative: form.negative,
      characters: form.characters.map((c) => ({ prompt: c.prompt, negative: c.negative, position: c.position })),
      params: { width: form.width, height: form.height, qualityTags: form.qualityTags, ucPreset: form.ucPreset },
      expectation: form.expectation,
      version: state.settings.naiVersion
    })
  } catch (e) {
    error.value = String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')
  } finally {
    running.value = false
  }
}

/* ---------- 结果 ---------- */
const CONF_LABEL: Record<Confidence, { text: string; cls: string }> = {
  high: { text: '较确定', cls: 'ok' },
  medium: { text: '大概率', cls: 'alias' },
  low: { text: '推测', cls: '' }
}
const RISK_LABEL: Record<Confidence, { text: string; cls: string }> = {
  high: { text: '高', cls: 'bad' },
  medium: { text: '中', cls: 'alias' },
  low: { text: '低', cls: '' }
}
const ISSUE_LABEL: Record<PreviewIssueKind, { text: string; cls: string }> = {
  unknown: { text: '不存在', cls: 'bad' },
  conflict: { text: '冲突', cls: 'bad' },
  trait: { text: '设定冲突', cls: 'alias' },
  alias: { text: '别名', cls: 'alias' },
  weight: { text: '权重', cls: 'alias' },
  warn: { text: '提醒', cls: 'alias' },
  redundant: { text: '冗余', cls: 'nl' },
  weak: { text: '效果弱', cls: 'nl' }
}

const POINTS: { key: 'style' | 'composition' | 'scene' | 'lighting'; label: string; icon: IconName; badge: string }[] = [
  { key: 'style', label: '画风', icon: 'sparkle', badge: 'pink' },
  { key: 'composition', label: '构图镜头', icon: 'frame', badge: 'nl' },
  { key: 'scene', label: '场景', icon: 'scene', badge: 'ok' },
  { key: 'lighting', label: '光影色调', icon: 'sun', badge: 'alias' }
]
const points = computed(() =>
  result.value ? POINTS.map((p) => ({ ...p, point: result.value![p.key] as PreviewPoint })).filter((p) => p.point.text) : []
)
const hasHighRisk = computed(() => !!result.value?.risks.some((r) => r.level === 'high'))
const sortedIssues = computed(() => {
  const order: PreviewIssueKind[] = ['conflict', 'unknown', 'trait', 'weight', 'alias', 'redundant', 'warn', 'weak']
  return [...(result.value?.issues ?? [])].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
})

/** AI 常把多个 tag 合成一条（"a, b, c"），拆开分别展示；数值权重 n::a, b:: 内部的逗号不拆 */
function splitTags(s: string): string[] {
  const out: string[] = []
  let buf = ''
  let inWeight = false
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith('::', i)) {
      inWeight = !inWeight
      buf += '::'
      i++
      continue
    }
    const ch = s[i]
    if (!inWeight && /[,，、/]/.test(ch)) {
      out.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  out.push(buf)
  return [...new Set(out.map((t) => t.trim()).filter(Boolean))]
}

/** 点击 tag 在左侧输入框中定位；负面相关的 tag 优先在负面里找 */
function locateTag(tag: string, preferNeg = false) {
  const core = tag
    .replace(/^-?\d+(\.\d+)?::\s*/, '')
    .replace(/\s*::$/, '')
    .replace(/[{}[\]]/g, '')
    .trim()
    .toLowerCase()
  if (!core) return
  const needles = [...new Set([core, core.replace(/ /g, '_'), core.replace(/^artist:\s*/, '')])]
  const els = [...(leftPane.value?.querySelectorAll<HTMLTextAreaElement>('textarea[data-src]') ?? [])]
  if (preferNeg) els.sort((a, b) => Number(b.dataset.src === 'neg') - Number(a.dataset.src === 'neg'))
  for (const el of els) {
    const text = el.value.toLowerCase()
    for (const n of needles) {
      const i = text.indexOf(n)
      if (i < 0) continue
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.focus({ preventScroll: true })
      el.setSelectionRange(i, i + n.length)
      return
    }
  }
  toast('输入框里没找到这个 tag')
}

function resultText(r: AiPreviewResult): string {
  const parts = [`【画面】\n${r.summary}`]
  for (const p of POINTS) if (r[p.key].text) parts.push(`【${p.label}】\n${r[p.key].text}`)
  r.characters.forEach((c) => parts.push(`【${c.name}${c.position ? ' · ' + c.position : ''}】\n${c.text}`))
  if (r.emphasis.length) parts.push(`【被强调】\n${r.emphasis.map((e) => `- ${e.tag}：${e.effect}`).join('\n')}`)
  if (r.suppressed.length) parts.push(`【被压制】\n${r.suppressed.map((e) => `- ${e.tag}：${e.effect}`).join('\n')}`)
  if (r.risks.length) parts.push(`【风险】\n${r.risks.map((x) => `- [${RISK_LABEL[x.level].text}] ${x.text}${x.evidence ? `（依据：${x.evidence}）` : ''}`).join('\n')}`)
  if (r.gap) parts.push(`【与期望的差距】\n${r.gap}`)
  if (r.suggestions.length)
    parts.push(`【建议】\n${r.suggestions.map((s, i) => `${i + 1}. ${s.text}${s.evidence ? `（依据：${s.evidence}）` : ''}`).join('\n')}`)
  return parts.join('\n\n')
}

function toOptimize() {
  state.prompt = form.base
  state.negative = form.negative
  state.characters = form.characters.map((c) => ({ ...c }))
  state.tab = 'ai'
  toast(form.characters.length ? `已带入主提示词、${form.characters.length} 个角色和负面` : '已带入 AI 优化页')
}
</script>

<template>
  <div class="view preview" @dragenter="onDragEnter" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <section class="pane left scroll" ref="leftPane">
      <div :class="['import-zone', { over: dragDepth > 0 }]">
        <span class="group-badge pink"><Icon :name="dragDepth > 0 ? 'image' : 'paste'" :size="17" /></span>
        <div class="import-text">
          <b>{{ dragDepth > 0 ? '松手读取原图里的提示词' : '导入整套提示词' }}</b>
          <span>支持 [Prompt] / [Character 1] 分节文本、NAI 元数据 JSON，也可以把 NovelAI 原图拖进来</span>
        </div>
        <div class="actions">
          <button class="btn small primary" @click="pasteClipboard"><Icon name="paste" :size="14" />粘贴</button>
          <button class="btn small" @click="fileInput?.click()"><Icon name="image" :size="14" />原图</button>
        </div>
        <input ref="fileInput" type="file" accept="image/png" hidden @change="onFilePicked" />
      </div>

      <div class="field">
        <label class="field-label">主提示词<span class="muted"> · 粘贴分节文本会自动拆分</span></label>
        <div class="composer short">
          <textarea
            v-autosize
            v-model="form.base"
            data-src="pos"
            spellcheck="false"
            placeholder="2girls, artist:xxx, outdoors, cherry blossoms, ..."
            @paste="onBasePaste"
          ></textarea>
        </div>
      </div>

      <CharacterEditor :list="form.characters" />

      <div class="field">
        <label class="field-label">负面提示词（UC）<span class="muted"> · 用来判断哪些东西被压掉了</span></label>
        <div class="composer short neg">
          <textarea v-autosize v-model="form.negative" data-src="neg" spellcheck="false" placeholder="lowres, worst quality, bad quality, ..."></textarea>
        </div>
      </div>

      <div class="params">
        <div class="param">
          <span class="side-label">画幅<template v-if="sizeKey === 'custom'"> · {{ form.width }}×{{ form.height }}</template></span>
          <div class="seg block">
            <button v-for="s in SIZES" :key="s.key" :class="{ on: sizeKey === s.key }" @click="setSize(s.w, s.h)">{{ s.label }}</button>
          </div>
        </div>
        <div class="param">
          <span class="side-label">Add Quality Tags</span>
          <div class="seg block">
            <button :class="{ on: form.qualityTags }" @click="form.qualityTags = true">开</button>
            <button :class="{ on: !form.qualityTags }" @click="form.qualityTags = false">关</button>
          </div>
        </div>
        <div class="param">
          <span class="side-label">UC 预设</span>
          <div class="seg block">
            <button v-for="u in UC_OPTIONS" :key="u.key" :class="{ on: form.ucPreset === u.key }" @click="form.ucPreset = u.key">{{ u.label }}</button>
          </div>
        </div>
      </div>

      <div class="field">
        <label class="field-label">想要的效果（可选）<span class="muted"> · 填了会对比差距并给出修改建议</span></label>
        <div class="composer short mini">
          <textarea v-autosize v-model="form.expectation" placeholder="例如：两个女孩在樱花树下并肩坐着，左边的银发女孩在笑，整体是柔和的水彩风"></textarea>
        </div>
      </div>

      <div class="row">
        <button class="btn accent big" :disabled="running" @click="run">
          <Icon name="eye" :size="17" :class="{ 'spin-slow': running }" />
          {{ running ? '正在想象' : '开始推测' }}
        </button>
        <span class="pill">目标 {{ state.settings?.naiVersion.toUpperCase() }}</span>
        <div class="actions ml-auto">
          <button class="btn ghost small" title="带入比对页的正向和负面" @click="fromCompare"><Icon name="compare" :size="14" />从比对页带入</button>
          <button class="icon-btn" title="编辑推测规则（Skill 文档）" @click="openSkill"><Icon name="book" /></button>
          <button class="icon-btn" title="清空" @click="clearAll"><Icon name="trash" /></button>
        </div>
      </div>

      <div v-if="error" class="error-box"><Icon name="warn" :size="16" />{{ error }}</div>

      <div class="timeline" v-if="steps.length">
        <div v-for="(s, i) in steps" :key="i" :class="['tl-item', { live: running && i === steps.length - 1 }]">{{ s }}</div>
      </div>
    </section>

    <section class="pane right scroll">
      <div v-if="running && !result" class="empty">
        <Mascot mood="busy" :size="240" />
        <p>正在脑内作画<span class="dots"><i></i><i></i><i></i></span></p>
      </div>
      <div v-else-if="error && !result" class="empty">
        <Mascot mood="confused" :size="230" />
        <p>出了点问题，看看左边的报错信息吧</p>
      </div>
      <div v-else-if="!result" class="empty">
        <Mascot mood="chill" :size="230" />
        <p>
          把整套提示词贴进来（主提示词、角色、负面可以一起贴），或者直接把 NovelAI 原图拖进来。我会先查一遍每个 tag，再猜猜它会画成什么样、哪里可能和你想的不一样。
        </p>
      </div>
      <template v-else>
        <div :class="['cheer', { warn: hasHighRisk }]">
          <Mascot :mood="hasHighRisk ? 'confused' : 'wink'" :size="76" />
          <div>
            <b>{{ hasHighRisk ? '大概会画成这样，不过有几处要小心' : '大概会画成这样～' }}</b>
            <div class="muted small">
              {{ result.tagCount }} 个正向元素 · {{ result.characters.length ? `${result.characters.length} 个人物` : '无人物描述' }}
              · 仅为文字推测，以实际出图为准
            </div>
          </div>
          <span :class="['pill ml-auto', CONF_LABEL[result.confidence].cls]"><i></i>整体{{ CONF_LABEL[result.confidence].text }}</span>
        </div>

        <div class="result-card" style="--d: 0ms">
          <div class="result-head">
            <span class="group-badge pink"><Icon name="eye" :size="14" /></span>
            <h3>画面描述</h3>
            <button class="icon-btn sm ml-auto" title="复制" @click="copy(result.summary)"><Icon name="copy" :size="15" /></button>
          </div>
          <div class="notes lead">{{ result.summary }}</div>
        </div>

        <div class="point-grid" v-if="points.length">
          <div class="result-card" v-for="(p, i) in points" :key="p.key" :style="{ '--d': (i + 1) * 60 + 'ms' }">
            <div class="result-head">
              <span :class="['group-badge', p.badge]"><Icon :name="p.icon" :size="14" /></span>
              <h3>{{ p.label }}</h3>
              <span :class="['pill ml-auto', CONF_LABEL[p.point.confidence].cls]">{{ CONF_LABEL[p.point.confidence].text }}</span>
            </div>
            <div class="notes">{{ p.point.text }}</div>
            <div class="point-tags" v-if="p.point.tags.length">
              <button v-for="t in p.point.tags" :key="t" class="chip sm" title="在左侧定位" @click="locateTag(t)">{{ t }}</button>
            </div>
          </div>
        </div>

        <div class="result-card" v-for="(c, i) in result.characters" :key="'c' + i" :style="{ '--d': 280 + i * 60 + 'ms' }">
          <div class="result-head">
            <span class="group-badge nl"><Icon name="user" :size="14" /></span>
            <h3>{{ c.name }}</h3>
            <span class="muted small" v-if="c.position">{{ c.position }}</span>
            <span :class="['pill ml-auto', CONF_LABEL[c.confidence].cls]">{{ CONF_LABEL[c.confidence].text }}</span>
          </div>
          <div class="notes">{{ c.text }}</div>
          <div class="point-tags" v-if="c.tags.length">
            <button v-for="t in c.tags" :key="t" class="chip sm" title="在左侧定位" @click="locateTag(t)">{{ t }}</button>
          </div>
        </div>

        <div class="split-grid" v-if="result.emphasis.length || result.suppressed.length">
          <div class="result-card" v-if="result.emphasis.length" style="--d: 320ms">
            <div class="result-head">
              <span class="group-badge alias"><Icon name="sparkle" :size="14" /></span>
              <h3>被强调的元素</h3>
            </div>
            <div class="effect-list">
              <div class="effect-row stack" v-for="(e, i) in result.emphasis" :key="i" :style="{ '--i': i }">
                <div class="effect-tags">
                  <button v-for="t in splitTags(e.tag)" :key="t" class="chip sm tone-up" title="在左侧定位" @click="locateTag(t)">{{ t }}</button>
                </div>
                <span class="grow">{{ e.effect }}</span>
              </div>
            </div>
          </div>
          <div class="result-card" v-if="result.suppressed.length" style="--d: 360ms">
            <div class="result-head">
              <span class="group-badge bad"><Icon name="stop" :size="14" /></span>
              <h3>被负面压制的</h3>
            </div>
            <div class="effect-list">
              <div class="effect-row stack" v-for="(e, i) in result.suppressed" :key="i" :style="{ '--i': i }">
                <div class="effect-tags">
                  <button v-for="t in splitTags(e.tag)" :key="t" class="chip sm tone-down" title="在左侧定位" @click="locateTag(t, true)">{{ t }}</button>
                </div>
                <span class="grow">{{ e.effect }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="result-card warn-card" v-if="result.risks.length" style="--d: 400ms">
          <div class="result-head">
            <span class="group-badge alias"><Icon name="warn" :size="14" /></span>
            <h3>可能和预期不一样的地方</h3>
            <span class="group-count">{{ result.risks.length }}</span>
          </div>
          <div class="effect-list">
            <div class="effect-row" v-for="(r, i) in result.risks" :key="i" :style="{ '--i': i }">
              <span class="meta">
                <span :class="['pill', RISK_LABEL[r.level].cls]">{{ RISK_LABEL[r.level].text }}</span>
                <BasisPill :basis="r.basis" />
              </span>
              <div class="grow">
                {{ r.text }}
                <span class="evidence" v-if="r.evidence">{{ r.evidence }}</span>
                <div class="row-tags" v-if="r.tags.length">
                  <button v-for="t in r.tags" :key="t" class="chip sm" title="在左侧定位" @click="locateTag(t)">{{ t }}</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="result-card" v-if="result.gap || result.suggestions.length" style="--d: 440ms">
          <div class="result-head">
            <span class="group-badge ok"><Icon name="wand" :size="14" /></span>
            <h3>{{ result.gap ? '和想要的效果对比' : '调整建议' }}</h3>
            <button class="btn small primary ml-auto" @click="toOptimize"><Icon name="sparkle" :size="13" />送去 AI 优化</button>
          </div>
          <div class="notes" v-if="result.gap">{{ result.gap }}</div>
          <div class="effect-list" v-if="result.suggestions.length">
            <div class="effect-row" v-for="(s, i) in result.suggestions" :key="i" :style="{ '--i': i }">
              <span class="meta">
                <span class="pill">{{ i + 1 }}</span>
                <BasisPill :basis="s.basis" />
              </span>
              <div class="grow">
                {{ s.text }}
                <span class="evidence" v-if="s.evidence">{{ s.evidence }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="result-card" v-if="sortedIssues.length" style="--d: 480ms">
          <div class="result-head">
            <span class="group-badge bad"><Icon name="check" :size="14" :stroke="2.2" /></span>
            <h3>本地校验</h3>
            <span class="group-count">{{ sortedIssues.length }}</span>
            <span class="muted small ml-auto">查 tag 库和 Danbooru 统计得到，不经过 AI</span>
          </div>
          <div class="effect-list">
            <div class="effect-row" v-for="(it, i) in sortedIssues" :key="i" :style="{ '--i': i }">
              <span :class="['pill', ISSUE_LABEL[it.kind].cls]">{{ ISSUE_LABEL[it.kind].text }}</span>
              <span class="where">{{ it.where }}</span>
              <span class="grow">{{ it.text }}</span>
            </div>
          </div>
        </div>

        <EvidenceNote :info="result.evidence" />

        <div class="row">
          <button class="btn" @click="copy(resultText(result))"><Icon name="copy" :size="15" />复制推测结果</button>
          <button class="btn" @click="toOptimize"><Icon name="sparkle" :size="15" />送去 AI 优化</button>
        </div>
      </template>
    </section>
  </div>
</template>
