<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AiPreviewResult, Confidence, PreviewIssueKind, PreviewPoint } from '@shared/types'
import { state, copy, toast, workKey, cleanErr } from '../store'
import { vAutosize, resizeWithin } from '../autosize'
import Icon from '../components/Icon.vue'
import Mascot from '../components/Mascot.vue'
import PromptEditor from '../components/PromptEditor.vue'
import WorkspaceBar from '../components/WorkspaceBar.vue'
import SharedParams from '../components/SharedParams.vue'
import BasisPill from '../components/BasisPill.vue'
import EvidenceNote from '../components/EvidenceNote.vue'
import type { IconName } from '../components/icons'
import { activeTask, cancelTask } from '../tasks'
import { usePageShortcuts, runKeyLabel, runKeyShort } from '../shortcuts'

const expectation = ref('')
const running = ref(false)
const steps = ref<string[]>([])
const error = ref('')
const task = computed(() => activeTask('preview'))
let offStep: (() => void) | undefined
/** 推测结果存在全局，生图页可以拿它和实际出图对照 */
const result = computed(() => state.lastPreview?.result ?? null)
const stale = computed(() => !!state.lastPreview && !running.value && state.lastPreview.key !== workKey())

const leftPane = ref<HTMLElement>()
const resizeAll = () => resizeWithin(leftPane.value)

onMounted(() => {
  offStep = window.api.onAiStep('preview', (s) => {
    if (running.value) steps.value.push(s)
  })
  window.addEventListener('resize', resizeAll)
})
onBeforeUnmount(() => { offStep?.(); window.removeEventListener('resize', resizeAll) })

watch(
  () => state.tab,
  async (t) => {
    if (t !== 'preview') return
    await nextTick()
    resizeAll()
  }
)
watch(
  () => state.characters.length,
  () => nextTick(resizeAll)
)

function openSkill() {
  state.skillPanel = true
}

/* ---------- 推测 ---------- */
async function run() {
  if (running.value) return
  if (!state.settings?.apiKey) {
    error.value = '请先在「设置 / 数据」中填写 DeepSeek API Key'
    return
  }
  if (!state.prompt.trim() && !state.characters.some((c) => c.prompt.trim())) {
    error.value = '请先输入主提示词或角色提示词'
    return
  }
  running.value = true
  error.value = ''
  steps.value = []
  const key = workKey()
  try {
    const r = await window.api.preview({
      base: state.prompt,
      negative: state.negative,
      characters: state.characters.filter((c) => c.prompt.trim()).map((c) => ({ ...c })),
      params: { ...state.params },
      expectation: expectation.value,
      version: state.settings.naiVersion
    })
    state.lastPreview = { key, result: r }
  } catch (e) {
    error.value = cleanErr(e)
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

function toGenerate() {
  state.tab = 'generate'
}

/** 把期望、差距和建议整理成 AI 优化的「额外要求」一起带过去，不用手动复制 */
function toOptimize() {
  const r = result.value
  const parts: string[] = []
  if (expectation.value.trim()) parts.push(`想要的效果：${expectation.value.trim()}`)
  if (r?.gap) parts.push(`画面推测指出的差距：${r.gap}`)
  if (r?.suggestions.length) parts.push(`画面推测给出的建议：\n${r.suggestions.map((s, i) => `${i + 1}. ${s.text}`).join('\n')}`)
  const highRisks = r?.risks.filter((x) => x.level === 'high') ?? []
  if (highRisks.length) parts.push(`需要处理的高风险：\n${highRisks.map((x) => `- ${x.text}`).join('\n')}`)
  if (parts.length) {
    if (stale.value) parts.unshift('（以下推测基于修改前的提示词，仅供参考）')
    state.aiHandoff = { text: parts.join('\n\n'), count: (r?.suggestions.length ?? 0) + highRisks.length }
  }
  state.tab = 'ai'
}

usePageShortcuts('preview', { run, cancel: () => task.value && cancelTask(task.value.id), canCancel: () => running.value && !!task.value })
</script>

<template>
  <div class="view preview">
    <section class="pane left with-foot">
      <div class="pane-body scroll" ref="leftPane">
        <WorkspaceBar />

        <PromptEditor neg-hint="用来判断哪些东西被压掉了" />

        <div class="params">
          <SharedParams />
        </div>

        <div class="field">
          <label class="field-label">想要的效果（可选）<span class="muted"> · 填了会对比差距并给出修改建议</span></label>
          <div class="composer short mini">
            <textarea v-autosize v-model="expectation" placeholder="例如：两个女孩在樱花树下并肩坐着，左边的银发女孩在笑，整体是柔和的水彩风"></textarea>
          </div>
        </div>

        <div class="timeline" v-if="steps.length">
          <div v-for="(s, i) in steps" :key="i" :class="['tl-item', { live: running && i === steps.length - 1 }]">{{ s }}</div>
        </div>
      </div>

      <footer class="pane-foot">
        <div v-if="error" class="error-box"><Icon name="warn" :size="16" />{{ error }}</div>
        <div class="row run-bar">
          <button class="icon-btn" title="选择推测使用的 Skill" @click="openSkill"><Icon name="layers" /></button>
          <div class="run-actions">
            <button v-if="running && task" class="btn ghost" :disabled="task.status==='cancelling'" title="取消（Esc）" @click="cancelTask(task.id)">{{ task.status==='cancelling' ? '正在取消…' : '取消' }}</button>
            <button class="btn accent" :disabled="running" :title="`开始推测（${runKeyLabel}）`" @click="run">
              <Icon name="eye" :size="17" :class="{ 'spin-slow': running }" />
              {{ running ? '正在想象' : '开始推测' }}<span v-if="!running" class="kbd">{{ runKeyShort }}</span>
            </button>
          </div>
        </div>
      </footer>
    </section>

    <section class="pane right scroll">
      <div v-if="running" class="empty">
        <Mascot mood="think" :size="240" />
        <p>正在脑内作画<span class="dots"><i></i><i></i><i></i></span></p>
      </div>
      <div v-else-if="error && !result" class="empty">
        <Mascot mood="confused" :size="230" />
        <p>出了点问题，看看左边的报错信息吧</p>
      </div>
      <div v-else-if="!result" class="empty">
        <Mascot mood="crystal" :size="230" />
        <p>
          推测用的是「当前提示词」，和其他页面共用。可以在左侧粘贴整套提示词，或者把 NovelAI 原图拖进窗口。我会先查一遍每个 tag，再猜猜它会画成什么样、哪里可能和你想的不一样。
        </p>
      </div>
      <template v-else>
        <div class="evidence-note warn" v-if="stale">
          <Icon name="warn" :size="14" />
          <div class="evidence-text">当前提示词或参数在推测之后改过了，下面的结果可能已经过期。<button class="link-btn" @click="run">重新推测</button></div>
        </div>
        <div :class="['cheer', { warn: hasHighRisk }]">
          <Mascot :mood="hasHighRisk ? 'confused' : 'ok'" :size="76" />
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
            <button class="btn small primary ml-auto" title="把期望、差距和建议带到 AI 优化的「额外要求」" @click="toOptimize"><Icon name="sparkle" :size="13" />带着建议去 AI 优化</button>
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
          <button class="btn" title="把期望、差距和建议带到 AI 优化的「额外要求」" @click="toOptimize"><Icon name="sparkle" :size="15" />带着建议去 AI 优化</button>
          <button class="btn accent" @click="toGenerate"><Icon name="image" :size="15" />去生图验证</button>
        </div>
      </template>
    </section>
  </div>
</template>
