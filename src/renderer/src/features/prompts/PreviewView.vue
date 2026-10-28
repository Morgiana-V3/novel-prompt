<script setup lang="ts">
import { promptState } from './state'
import { settingsState } from '../settings/state'
import { skillsState } from '../skills/state'
import { shellState } from '../../shared/state/shell'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  AiPreviewResult,
  Confidence,
  PreviewIssueKind,
  PreviewPoint,
} from '@shared/prompts/types'
import { copy, toast } from '../../shared/lib/notifications'
import { workKey } from './actions'
import { cleanErr } from '../../shared/lib/format'
import { vAutosize, resizeWithin } from '../../shared/lib/autosize'
import Icon from '../../shared/ui/Icon.vue'
import Mascot from '../../shared/ui/Mascot.vue'
import PromptEditor from './components/PromptEditor.vue'
import WorkspaceBar from './components/WorkspaceBar.vue'
import SharedParams from '../generation/components/SharedParams.vue'
import BasisPill from './components/BasisPill.vue'
import EvidenceNote from './components/EvidenceNote.vue'
import type { IconName } from '../../shared/ui/icons'
import { activeTask, cancelTask } from '../../shared/state/tasks'
import { usePageShortcuts, runKeyLabel, runKeyShort } from '../../shared/lib/shortcuts'

const expectation = ref('')
const running = ref(false)
const steps = ref<string[]>([])
const error = ref('')
const task = computed(() => activeTask('preview'))
let offStep: (() => void) | undefined
/** 推测结果存在全局，生图页可以拿它和实际出图对照 */
const result = computed(() => promptState.lastPreview?.result ?? null)
const stale = computed(
  () => !!promptState.lastPreview && !running.value && promptState.lastPreview.key !== workKey(),
)

const leftPane = ref<HTMLElement>()
const resizeAll = () => resizeWithin(leftPane.value)

onMounted(() => {
  offStep = window.api.onAiStep('preview', (text) => {
    if (running.value) {
      steps.value.push(text)
    }
  })
  window.addEventListener('resize', resizeAll)
})
onBeforeUnmount(() => {
  offStep?.()
  window.removeEventListener('resize', resizeAll)
})

watch(
  () => shellState.tab,
  async (tab) => {
    if (tab !== 'preview') {
      return
    }
    await nextTick()
    resizeAll()
  },
)
watch(
  () => promptState.characters.length,
  () => nextTick(resizeAll),
)

function openSkill() {
  skillsState.skillPanel = true
}

/* ---------- 推测 ---------- */
async function run() {
  if (running.value) {
    return
  }
  if (!settingsState.settings?.apiKey) {
    error.value = '请先在「设置 / 数据」中填写 DeepSeek API Key'
    return
  }
  if (
    !promptState.prompt.trim() &&
    !promptState.characters.some((character) => character.prompt.trim())
  ) {
    error.value = '请先输入主提示词或角色提示词'
    return
  }
  running.value = true
  error.value = ''
  steps.value = []
  const key = workKey()
  try {
    const preview = await window.api.preview({
      base: promptState.prompt,
      negative: promptState.negative,
      characters: promptState.characters
        .filter((character) => character.prompt.trim())
        .map((character) => ({ ...character })),
      params: { ...promptState.params },
      expectation: expectation.value,
      version: settingsState.settings.naiVersion,
    })
    promptState.lastPreview = { key, result: preview }
  } catch (error2) {
    error.value = cleanErr(error2)
  } finally {
    running.value = false
  }
}

/* ---------- 结果 ---------- */
const CONF_LABEL: Record<Confidence, { text: string; cls: string }> = {
  high: { text: '较确定', cls: 'ok' },
  medium: { text: '大概率', cls: 'alias' },
  low: { text: '推测', cls: '' },
}
const RISK_LABEL: Record<Confidence, { text: string; cls: string }> = {
  high: { text: '高', cls: 'bad' },
  medium: { text: '中', cls: 'alias' },
  low: { text: '低', cls: '' },
}
const ISSUE_LABEL: Record<PreviewIssueKind, { text: string; cls: string }> = {
  unknown: { text: '不存在', cls: 'bad' },
  conflict: { text: '冲突', cls: 'bad' },
  trait: { text: '设定冲突', cls: 'alias' },
  alias: { text: '别名', cls: 'alias' },
  weight: { text: '权重', cls: 'alias' },
  warn: { text: '提醒', cls: 'alias' },
  redundant: { text: '冗余', cls: 'nl' },
  weak: { text: '效果弱', cls: 'nl' },
}

const POINTS: {
  key: 'style' | 'composition' | 'scene' | 'lighting'
  label: string
  icon: IconName
  badge: string
}[] = [
  { key: 'style', label: '画风', icon: 'sparkle', badge: 'pink' },
  { key: 'composition', label: '构图镜头', icon: 'frame', badge: 'nl' },
  { key: 'scene', label: '场景', icon: 'scene', badge: 'ok' },
  { key: 'lighting', label: '光影色调', icon: 'sun', badge: 'alias' },
]
const points = computed(() =>
  result.value
    ? POINTS.map((section) => ({
        ...section,
        point: result.value![section.key] as PreviewPoint,
      })).filter((section) => section.point.text)
    : [],
)
const hasHighRisk = computed(() => !!result.value?.risks.some((risk) => risk.level === 'high'))
const sortedIssues = computed(() => {
  const order: PreviewIssueKind[] = [
    'conflict',
    'unknown',
    'trait',
    'weight',
    'alias',
    'redundant',
    'warn',
    'weak',
  ]
  return [...(result.value?.issues ?? [])].sort(
    (leftIssue, rightIssue) => order.indexOf(leftIssue.kind) - order.indexOf(rightIssue.kind),
  )
})

/** AI 常把多个 tag 合成一条（"a, b, c"），拆开分别展示；数值权重 n::a, b:: 内部的逗号不拆 */
function splitTags(text: string): string[] {
  const out: string[] = []
  let buf = ''
  let inWeight = false
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('::', i)) {
      inWeight = !inWeight
      buf += '::'
      i++
      continue
    }
    const ch = text[i]
    if (!inWeight && /[,，、/]/.test(ch)) {
      out.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  out.push(buf)
  return [...new Set(out.map((text2) => text2.trim()).filter(Boolean))]
}

/** 点击 tag 在左侧输入框中定位；负面相关的 tag 优先在负面里找 */
function locateTag(tag: string, preferNeg = false) {
  const core = tag
    .replace(/^-?\d+(\.\d+)?::\s*/, '')
    .replace(/\s*::$/, '')
    .replace(/[{}[\]]/g, '')
    .trim()
    .toLowerCase()
  if (!core) {
    return
  }
  const needles = [...new Set([core, core.replace(/ /g, '_'), core.replace(/^artist:\s*/, '')])]
  const els = [
    ...(leftPane.value?.querySelectorAll<HTMLTextAreaElement>('textarea[data-src]') ?? []),
  ]
  if (preferNeg) {
    els.sort(
      (leftTextarea, rightTextarea) =>
        Number(rightTextarea.dataset.src === 'neg') - Number(leftTextarea.dataset.src === 'neg'),
    )
  }
  for (const el of els) {
    const text = el.value.toLowerCase()
    for (const text2 of needles) {
      const i = text.indexOf(text2)
      if (i < 0) {
        continue
      }
      el.scrollIntoView({
        block: 'center',
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      })
      el.focus({ preventScroll: true })
      el.setSelectionRange(i, i + text2.length)
      return
    }
  }
  toast('输入框里没找到这个 tag')
}

function resultText(preview: AiPreviewResult): string {
  const parts = [`【画面】\n${preview.summary}`]
  for (const section of POINTS) {
    if (preview[section.key].text) {
      parts.push(`【${section.label}】\n${preview[section.key].text}`)
    }
  }
  preview.characters.forEach((character) =>
    parts.push(
      `【${character.name}${character.position ? ' · ' + character.position : ''}】\n${character.text}`,
    ),
  )
  if (preview.emphasis.length) {
    parts.push(
      `【被强调】\n${preview.emphasis.map((effect) => `- ${effect.tag}：${effect.effect}`).join('\n')}`,
    )
  }
  if (preview.suppressed.length) {
    parts.push(
      `【被压制】\n${preview.suppressed.map((effect) => `- ${effect.tag}：${effect.effect}`).join('\n')}`,
    )
  }
  if (preview.risks.length) {
    parts.push(
      `【风险】\n${preview.risks.map((risk) => `- [${RISK_LABEL[risk.level].text}] ${risk.text}${risk.evidence ? `（依据：${risk.evidence}）` : ''}`).join('\n')}`,
    )
  }
  if (preview.gap) {
    parts.push(`【与期望的差距】\n${preview.gap}`)
  }
  if (preview.suggestions.length) {
    parts.push(
      `【建议】\n${preview.suggestions.map((suggestion, i) => `${i + 1}. ${suggestion.text}${suggestion.evidence ? `（依据：${suggestion.evidence}）` : ''}`).join('\n')}`,
    )
  }
  return parts.join('\n\n')
}

function toGenerate() {
  shellState.tab = 'generate'
}

/** 把期望、差距和建议整理成 AI 优化的「额外要求」一起带过去，不用手动复制 */
function toOptimize() {
  const preview = result.value
  const parts: string[] = []
  if (expectation.value.trim()) {
    parts.push(`想要的效果：${expectation.value.trim()}`)
  }
  if (preview?.gap) {
    parts.push(`画面推测指出的差距：${preview.gap}`)
  }
  if (preview?.suggestions.length) {
    parts.push(
      `画面推测给出的建议：\n${preview.suggestions.map((suggestion, i) => `${i + 1}. ${suggestion.text}`).join('\n')}`,
    )
  }
  const highRisks = preview?.risks.filter((risk) => risk.level === 'high') ?? []
  if (highRisks.length) {
    parts.push(`需要处理的高风险：\n${highRisks.map((risk) => `- ${risk.text}`).join('\n')}`)
  }
  if (parts.length) {
    if (stale.value) {
      parts.unshift('（以下推测基于修改前的提示词，仅供参考）')
    }
    promptState.aiHandoff = {
      text: parts.join('\n\n'),
      count: (preview?.suggestions.length ?? 0) + highRisks.length,
    }
  }
  shellState.tab = 'ai'
}

usePageShortcuts('preview', {
  run,
  cancel: () => task.value && cancelTask(task.value.id),
  canCancel: () => running.value && !!task.value,
})
</script>

<template>
  <div class="view preview">
    <section class="pane left with-foot">
      <div
        ref="leftPane"
        class="pane-body scroll"
      >
        <WorkspaceBar />

        <PromptEditor neg-hint="用来判断哪些东西被压掉了" />

        <div class="params">
          <SharedParams />
        </div>

        <div class="field">
          <label class="field-label"
            >想要的效果（可选）<span class="muted"> · 填了会对比差距并给出修改建议</span></label
          >
          <div class="composer short mini">
            <textarea
              v-model="expectation"
              v-autosize
              placeholder="例如：两个女孩在樱花树下并肩坐着，左边的银发女孩在笑，整体是柔和的水彩风"
            ></textarea>
          </div>
        </div>

        <div
          v-if="steps.length"
          class="timeline"
        >
          <div
            v-for="(step, index) in steps"
            :key="index"
            :class="['tl-item', { live: running && index === steps.length - 1 }]"
          >
            {{ step }}
          </div>
        </div>
      </div>

      <footer class="pane-foot">
        <div
          v-if="error"
          class="error-box"
        >
          <Icon
            name="warn"
            :size="16"
          />{{ error }}
        </div>
        <div class="row run-bar">
          <button
            class="icon-btn"
            title="选择推测使用的 Skill"
            @click="openSkill"
          >
            <Icon name="layers" />
          </button>
          <div class="run-actions">
            <button
              v-if="running && task"
              class="btn ghost"
              :disabled="task.status === 'cancelling'"
              title="取消（Esc）"
              @click="cancelTask(task.id)"
            >
              {{ task.status === 'cancelling' ? '正在取消…' : '取消' }}
            </button>
            <button
              class="btn accent"
              :disabled="running"
              :title="`开始推测（${runKeyLabel}）`"
              @click="run"
            >
              <Icon
                name="eye"
                :size="17"
                :class="{ 'spin-slow': running }"
              />
              {{ running ? '正在想象' : '开始推测'
              }}<span
                v-if="!running"
                class="kbd"
                >{{ runKeyShort }}</span
              >
            </button>
          </div>
        </div>
      </footer>
    </section>

    <section class="pane right scroll">
      <div
        v-if="running"
        class="empty"
      >
        <Mascot
          mood="think"
          :size="240"
        />
        <p>
          正在脑内作画<span class="dots"><i></i><i></i><i></i></span>
        </p>
      </div>
      <div
        v-else-if="error && !result"
        class="empty"
      >
        <Mascot
          mood="confused"
          :size="230"
        />
        <p>出了点问题，看看左边的报错信息吧</p>
      </div>
      <div
        v-else-if="!result"
        class="empty"
      >
        <Mascot
          mood="crystal"
          :size="230"
        />
        <p>
          推测用的是「当前提示词」，和其他页面共用。可以在左侧粘贴整套提示词，或者把 NovelAI
          原图拖进窗口。我会先查一遍每个 tag，再猜猜它会画成什么样、哪里可能和你想的不一样。
        </p>
      </div>
      <template v-else>
        <div
          v-if="stale"
          class="evidence-note warn"
        >
          <Icon
            name="warn"
            :size="14"
          />
          <div class="evidence-text">
            当前提示词或参数在推测之后改过了，下面的结果可能已经过期。<button
              class="link-btn"
              @click="run"
            >
              重新推测
            </button>
          </div>
        </div>
        <div :class="['cheer', { warn: hasHighRisk }]">
          <Mascot
            :mood="hasHighRisk ? 'confused' : 'ok'"
            :size="76"
          />
          <div>
            <b>{{ hasHighRisk ? '大概会画成这样，不过有几处要小心' : '大概会画成这样～' }}</b>
            <div class="muted small">
              {{ result.tagCount }} 个正向元素 ·
              {{ result.characters.length ? `${result.characters.length} 个人物` : '无人物描述' }}
              · 仅为文字推测，以实际出图为准
            </div>
          </div>
          <span :class="['pill ml-auto', CONF_LABEL[result.confidence].cls]"
            ><i></i>整体{{ CONF_LABEL[result.confidence].text }}</span
          >
        </div>

        <div
          class="result-card"
          style="--d: 0ms"
        >
          <div class="result-head">
            <span class="group-badge pink"
              ><Icon
                name="eye"
                :size="14"
            /></span>
            <h3>画面描述</h3>
            <button
              class="icon-btn sm ml-auto"
              title="复制"
              @click="copy(result.summary)"
            >
              <Icon
                name="copy"
                :size="15"
              />
            </button>
          </div>
          <div class="notes lead">{{ result.summary }}</div>
        </div>

        <div
          v-if="points.length"
          class="point-grid"
        >
          <div
            v-for="(p, index) in points"
            :key="p.key"
            class="result-card"
            :style="{ '--d': (index + 1) * 60 + 'ms' }"
          >
            <div class="result-head">
              <span :class="['group-badge', p.badge]"
                ><Icon
                  :name="p.icon"
                  :size="14"
              /></span>
              <h3>{{ p.label }}</h3>
              <span :class="['pill ml-auto', CONF_LABEL[p.point.confidence].cls]">{{
                CONF_LABEL[p.point.confidence].text
              }}</span>
            </div>
            <div class="notes">{{ p.point.text }}</div>
            <div
              v-if="p.point.tags.length"
              class="point-tags"
            >
              <button
                v-for="tag in p.point.tags"
                :key="tag"
                class="chip sm"
                title="在左侧定位"
                @click="locateTag(tag)"
              >
                {{ tag }}
              </button>
            </div>
          </div>
        </div>

        <div
          v-for="(character, index) in result.characters"
          :key="'c' + index"
          class="result-card"
          :style="{ '--d': 280 + index * 60 + 'ms' }"
        >
          <div class="result-head">
            <span class="group-badge nl"
              ><Icon
                name="user"
                :size="14"
            /></span>
            <h3>{{ character.name }}</h3>
            <span
              v-if="character.position"
              class="muted small"
              >{{ character.position }}</span
            >
            <span :class="['pill ml-auto', CONF_LABEL[character.confidence].cls]">{{
              CONF_LABEL[character.confidence].text
            }}</span>
          </div>
          <div class="notes">{{ character.text }}</div>
          <div
            v-if="character.tags.length"
            class="point-tags"
          >
            <button
              v-for="tag in character.tags"
              :key="tag"
              class="chip sm"
              title="在左侧定位"
              @click="locateTag(tag)"
            >
              {{ tag }}
            </button>
          </div>
        </div>

        <div
          v-if="result.emphasis.length || result.suppressed.length"
          class="split-grid"
        >
          <div
            v-if="result.emphasis.length"
            class="result-card"
            style="--d: 320ms"
          >
            <div class="result-head">
              <span class="group-badge alias"
                ><Icon
                  name="sparkle"
                  :size="14"
              /></span>
              <h3>被强调的元素</h3>
            </div>
            <div class="effect-list">
              <div
                v-for="(e, index) in result.emphasis"
                :key="index"
                class="effect-row stack"
                :style="{ '--i': index }"
              >
                <div class="effect-tags">
                  <button
                    v-for="tagItem in splitTags(e.tag)"
                    :key="tagItem"
                    class="chip sm tone-up"
                    title="在左侧定位"
                    @click="locateTag(tagItem)"
                  >
                    {{ tagItem }}
                  </button>
                </div>
                <span class="grow">{{ e.effect }}</span>
              </div>
            </div>
          </div>
          <div
            v-if="result.suppressed.length"
            class="result-card"
            style="--d: 360ms"
          >
            <div class="result-head">
              <span class="group-badge bad"
                ><Icon
                  name="stop"
                  :size="14"
              /></span>
              <h3>被负面压制的</h3>
            </div>
            <div class="effect-list">
              <div
                v-for="(e, index) in result.suppressed"
                :key="index"
                class="effect-row stack"
                :style="{ '--i': index }"
              >
                <div class="effect-tags">
                  <button
                    v-for="tagItem in splitTags(e.tag)"
                    :key="tagItem"
                    class="chip sm tone-down"
                    title="在左侧定位"
                    @click="locateTag(tagItem, true)"
                  >
                    {{ tagItem }}
                  </button>
                </div>
                <span class="grow">{{ e.effect }}</span>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="result.risks.length"
          class="result-card warn-card"
          style="--d: 400ms"
        >
          <div class="result-head">
            <span class="group-badge alias"
              ><Icon
                name="warn"
                :size="14"
            /></span>
            <h3>可能和预期不一样的地方</h3>
            <span class="group-count">{{ result.risks.length }}</span>
          </div>
          <div class="effect-list">
            <div
              v-for="(risk, index) in result.risks"
              :key="index"
              class="effect-row"
              :style="{ '--i': index }"
            >
              <span class="meta">
                <span :class="['pill', RISK_LABEL[risk.level].cls]">{{
                  RISK_LABEL[risk.level].text
                }}</span>
                <BasisPill :basis="risk.basis" />
              </span>
              <div class="grow">
                {{ risk.text }}
                <span
                  v-if="risk.evidence"
                  class="evidence"
                  >{{ risk.evidence }}</span
                >
                <div
                  v-if="risk.tags.length"
                  class="row-tags"
                >
                  <button
                    v-for="tag in risk.tags"
                    :key="tag"
                    class="chip sm"
                    title="在左侧定位"
                    @click="locateTag(tag)"
                  >
                    {{ tag }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="result.gap || result.suggestions.length"
          class="result-card"
          style="--d: 440ms"
        >
          <div class="result-head">
            <span class="group-badge ok"
              ><Icon
                name="wand"
                :size="14"
            /></span>
            <h3>{{ result.gap ? '和想要的效果对比' : '调整建议' }}</h3>
            <button
              class="btn small primary ml-auto"
              title="把期望、差距和建议带到 AI 优化的「额外要求」"
              @click="toOptimize"
            >
              <Icon
                name="sparkle"
                :size="13"
              />带着建议去 AI 优化
            </button>
          </div>
          <div
            v-if="result.gap"
            class="notes"
          >
            {{ result.gap }}
          </div>
          <div
            v-if="result.suggestions.length"
            class="effect-list"
          >
            <div
              v-for="(tag, index) in result.suggestions"
              :key="index"
              class="effect-row"
              :style="{ '--i': index }"
            >
              <span class="meta">
                <span class="pill">{{ index + 1 }}</span>
                <BasisPill :basis="tag.basis" />
              </span>
              <div class="grow">
                {{ tag.text }}
                <span
                  v-if="tag.evidence"
                  class="evidence"
                  >{{ tag.evidence }}</span
                >
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="sortedIssues.length"
          class="result-card"
          style="--d: 480ms"
        >
          <div class="result-head">
            <span class="group-badge bad"
              ><Icon
                name="check"
                :size="14"
                :stroke="2.2"
            /></span>
            <h3>本地校验</h3>
            <span class="group-count">{{ sortedIssues.length }}</span>
            <span class="muted small ml-auto">查 tag 库和 Danbooru 统计得到，不经过 AI</span>
          </div>
          <div class="effect-list">
            <div
              v-for="(it, index) in sortedIssues"
              :key="index"
              class="effect-row"
              :style="{ '--i': index }"
            >
              <span :class="['pill', ISSUE_LABEL[it.kind].cls]">{{
                ISSUE_LABEL[it.kind].text
              }}</span>
              <span class="where">{{ it.where }}</span>
              <span class="grow">{{ it.text }}</span>
            </div>
          </div>
        </div>

        <EvidenceNote :info="result.evidence" />

        <div class="row">
          <button
            class="btn"
            @click="copy(resultText(result))"
          >
            <Icon
              name="copy"
              :size="15"
            />复制推测结果
          </button>
          <button
            class="btn"
            title="把期望、差距和建议带到 AI 优化的「额外要求」"
            @click="toOptimize"
          >
            <Icon
              name="sparkle"
              :size="15"
            />带着建议去 AI 优化
          </button>
          <button
            class="btn accent"
            @click="toGenerate"
          >
            <Icon
              name="image"
              :size="15"
            />去生图验证
          </button>
        </div>
      </template>
    </section>
  </div>
</template>
