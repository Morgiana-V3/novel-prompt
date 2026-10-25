<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AiCharacter, AiOptimizeResult, ChangeScope } from '@shared/types'
import { state, copy, toast, applyWorkspace, undoWorkspace, sectionText, cleanErr, type Tab } from '../store'
import { vAutosize, resizeWithin } from '../autosize'
import { diffTags, diffSize, type TagDiff } from '../tag-diff'
import Icon from '../components/Icon.vue'
import Mascot from '../components/Mascot.vue'
import PromptEditor from '../components/PromptEditor.vue'
import WorkspaceBar from '../components/WorkspaceBar.vue'
import BasisPill from '../components/BasisPill.vue'
import EvidenceNote from '../components/EvidenceNote.vue'
import DiffChips from '../components/DiffChips.vue'
import { activeTask, cancelTask } from '../tasks'

const mode = ref<'optimize' | 'semantic'>('optimize')
const instruction = ref('')
const running = ref(false)
const steps = ref<string[]>([])
const result = ref<AiOptimizeResult | null>(null)
const error = ref('')
const task = computed(() => activeTask('optimize'))
let offStep: (() => void) | undefined
/** 发起请求时的提示词，用于对比改动 */
const sent = ref<{ base: string; negative: string; characters: AiCharacter[] } | null>(null)
/** 结果已经采用到当前提示词 */
const adopted = ref(false)

watch(mode, () => {
  if (!running.value) error.value = ''
})

const leftPane = ref<HTMLElement>()
const resizeAll = () => resizeWithin(leftPane.value)

onMounted(() => {
  offStep = window.api.onAiStep('optimize', (s) => {
    if (running.value) steps.value.push(s)
  })
  window.addEventListener('resize', resizeAll)
})
onBeforeUnmount(() => { offStep?.(); window.removeEventListener('resize', resizeAll) })

// 视图常驻但可能是隐藏状态（v-show），隐藏时量不出内容高度，切回来时重算一次
watch(
  () => state.tab,
  async (t) => {
    if (t !== 'ai') return
    await nextTick()
    resizeAll()
  }
)
// 当前提示词被其他页面整体替换时（导入、恢复历史），文本框高度要重算
watch(
  () => state.characters.length,
  () => nextTick(resizeAll)
)

const charCount = computed(() => state.characters.filter((c) => c.prompt.trim()).length)

const SCOPE_LABEL: Record<ChangeScope, string> = {
  positive: '正向',
  character: '角色',
  negative: '负面',
  optional: '可选建议（未改动提示词）'
}
const changeGroups = computed(() =>
  (Object.keys(SCOPE_LABEL) as ChangeScope[])
    .map((scope) => ({ scope, label: SCOPE_LABEL[scope], items: result.value?.changes.filter((c) => c.scope === scope) ?? [] }))
    .filter((g) => g.items.length)
)

/* ---------- 改动对比：原文为空的段落不显示（描述转提示词时全是新增） ---------- */
const empty: TagDiff = { added: [], removed: [], changed: [] }
const diffs = computed(() => {
  const r = result.value
  const s = sent.value
  if (!r || !s) return null
  const d = (a: string, b: string) => (a.trim() ? diffTags(a, b) : empty)
  return {
    base: d(s.base, r.positive),
    negative: d(s.negative, r.negative),
    chars: r.characters.map((c, i) => d(s.characters[i]?.prompt ?? '', c.prompt))
  }
})
const totalChanges = computed(() =>
  diffs.value ? diffSize(diffs.value.base) + diffSize(diffs.value.negative) + diffs.value.chars.reduce((n, d) => n + diffSize(d), 0) : 0
)

async function run() {
  if (running.value) return
  if (!state.settings?.apiKey) {
    error.value = '请先在「设置 / 数据」中填写 DeepSeek API Key'
    return
  }
  if (mode.value === 'optimize' && !state.prompt.trim() && !charCount.value) {
    error.value = '请先输入要优化的提示词'
    return
  }
  if (mode.value === 'semantic' && !instruction.value.trim()) {
    error.value = '请输入画面描述'
    return
  }
  running.value = true
  error.value = ''
  steps.value = []
  result.value = null
  adopted.value = false
  const characters = state.characters
    .filter((c) => c.prompt.trim())
    .map((c) => ({ prompt: c.prompt, negative: c.negative, position: c.position }))
  sent.value = { base: state.prompt, negative: state.negative, characters }
  try {
    result.value = await window.api.optimize({
      mode: mode.value,
      prompt: state.prompt,
      negative: state.negative,
      characters,
      instruction: instruction.value,
      version: state.settings.naiVersion
    })
  } catch (e) {
    error.value = cleanErr(e)
  } finally {
    running.value = false
  }
}

/** 采用结果：写入当前提示词（写入前自动存历史），可选跳到下一步 */
function adopt(next?: Tab) {
  const r = result.value
  if (!r) return
  if (!adopted.value) {
    applyWorkspace({ base: r.positive, negative: r.negative, characters: r.characters }, 'AI 优化前')
    adopted.value = true
    nextTick(resizeAll)
  }
  if (next) state.tab = next
  else toast('已采用，所有页面都会用这套提示词')
}

function undoAdopt() {
  if (undoWorkspace()) adopted.value = false
  nextTick(resizeAll)
}

const fullText = (r: AiOptimizeResult) => sectionText({ base: r.positive, negative: r.negative, characters: r.characters })
</script>

<template>
  <div class="view ai">
    <section class="pane left scroll" ref="leftPane">
      <div class="seg block big">
        <button :class="{ on: mode === 'optimize' }" @click="mode = 'optimize'"><Icon name="wand" :size="15" />优化现有提示词</button>
        <button :class="{ on: mode === 'semantic' }" @click="mode = 'semantic'"><Icon name="chat" :size="15" />描述转提示词</button>
      </div>

      <div class="field" v-if="mode === 'semantic'">
        <label class="field-label">画面描述</label>
        <div class="composer short">
          <textarea
            v-autosize
            v-model="instruction"
            placeholder="例如：樱花树下的长椅上坐着两个女孩。左边是银发红瞳、穿白色连衣裙的少女，正笑着把头靠在右边女孩的肩上；右边是黑色短发、戴眼镜、穿学生制服的女孩，低头看书。午后阳光，柔和的水彩风。"
          ></textarea>
        </div>
      </div>

      <WorkspaceBar />

      <PromptEditor
        :base-label="mode === 'optimize' ? '主提示词' : '要保留的主提示词（可选）'"
        :char-label="mode === 'optimize' ? '角色提示词（可选）' : '要保留的角色（可选）'"
        :char-hint="mode === 'optimize' ? '多人画面时填写' : '留空则由 AI 按描述拆分'"
        neg-hint="留空则由 AI 按规范生成"
      />

      <div class="field" v-if="mode === 'optimize'">
        <label class="field-label">额外要求（可选）</label>
        <div class="composer short">
          <textarea v-autosize v-model="instruction" placeholder="例如：风格偏厚涂一点；换成夜景；表情更生动"></textarea>
        </div>
      </div>

      <div class="row">
        <button class="btn accent big" :disabled="running" @click="run">
          <Icon name="sparkle" :size="17" :class="{ spin: running }" />
          {{ running ? '正在思考' : '开始' }}
        </button>
        <button v-if="running && task" class="btn ghost" :disabled="task.status==='cancelling'" @click="cancelTask(task.id)"><Icon name="stop" :size="15" />{{ task.status==='cancelling' ? '正在取消…' : '取消' }}</button>
        <span class="pill">目标 {{ state.settings?.naiVersion.toUpperCase() }}</span>
        <span class="pill nl" v-if="charCount"><i></i>{{ charCount }} 个角色</span>
      </div>

      <div v-if="error" class="error-box"><Icon name="warn" :size="16" />{{ error }}</div>

      <div class="timeline" v-if="steps.length">
        <div v-for="(s, i) in steps" :key="i" :class="['tl-item', { live: running && i === steps.length - 1 }]">{{ s }}</div>
      </div>
    </section>

    <section class="pane right scroll">
      <div v-if="running && !result" class="empty">
        <Mascot mood="reading" :size="240" />
        <p>正在翻 tag 库挑词<span class="dots"><i></i><i></i><i></i></span></p>
      </div>
      <div v-else-if="error && !result" class="empty">
        <Mascot mood="oops" :size="230" />
        <p>出了点问题，看看左边的报错信息吧</p>
      </div>
      <div v-else-if="!result" class="empty">
        <Mascot mood="chill" :size="230" />
        <p v-if="mode === 'semantic'">
          用中文把画面讲清楚就好。我会数清画面里有几个人，把共享的画风、构图、背景放进主提示词，每个人的外貌、服装、动作拆成单独的角色提示词并排好位置，再给容易串色的角色加上角色负面，最后配一套负面提示词。
        </p>
        <p v-else>
          我会先把画面拆成一个个概念，去本地 Danbooru 库里找真实存在的 tag，按侧栏里启用的 Skill 排好顺序，最后再检查一遍，不存在的 tag 会自动换掉。结果要点「采用」才会写进当前提示词。
        </p>
      </div>
      <template v-else>
        <div class="cheer">
          <Mascot :mood="result.invalid.length ? 'confused' : 'wink'" :size="76" />
          <div>
            <b>{{ adopted ? '已采用到当前提示词' : result.invalid.length ? '大部分搞定了，还有几个 tag 要你看看' : '优化好啦！' }}</b>
            <div class="muted small">
              {{ result.characters.length ? `${result.characters.length} 个角色提示词` : '单角色 / 无角色提示词' }}
              <template v-if="totalChanges"> · 共 {{ totalChanges }} 处 tag 改动</template>
            </div>
          </div>
          <div class="actions ml-auto">
            <button v-if="adopted" class="btn small" @click="undoAdopt"><Icon name="swap" :size="13" />撤销采用</button>
            <button v-else class="btn small primary" @click="adopt()"><Icon name="check" :size="13" />采用</button>
          </div>
        </div>

        <div class="result-card" style="--d: 0ms">
          <div class="result-head">
            <span class="group-badge pink"><Icon name="sparkle" :size="14" /></span>
            <h3>{{ result.characters.length ? '主提示词' : '正向提示词' }}</h3>
            <button class="icon-btn sm ml-auto" title="复制" @click="copy(result.positive)"><Icon name="copy" :size="15" /></button>
          </div>
          <pre class="result-text">{{ result.positive }}</pre>
          <DiffChips v-if="diffs" :diff="diffs.base" />
        </div>

        <div class="result-card" v-for="(c, i) in result.characters" :key="i" :style="{ '--d': (i + 1) * 70 + 'ms' }">
          <div class="result-head">
            <span class="group-badge nl"><Icon name="user" :size="14" /></span>
            <h3>角色 {{ i + 1 }}</h3>
            <span class="pill" v-if="c.position">{{ c.position }}</span>
            <button class="icon-btn sm ml-auto" title="复制" @click="copy(c.prompt)"><Icon name="copy" :size="15" /></button>
          </div>
          <pre class="result-text">{{ c.prompt }}</pre>
          <DiffChips v-if="diffs?.chars[i]" :diff="diffs.chars[i]" />
          <div v-if="c.negative" class="notes"><span class="chip-zh">角色负面：</span>{{ c.negative }}</div>
        </div>

        <div class="result-card" v-if="result.negative" style="--d: 140ms">
          <div class="result-head">
            <span class="group-badge bad"><Icon name="stop" :size="14" /></span>
            <h3>负面提示词</h3>
            <button class="icon-btn sm ml-auto" title="复制" @click="copy(result.negative)"><Icon name="copy" :size="15" /></button>
          </div>
          <pre class="result-text">{{ result.negative }}</pre>
          <DiffChips v-if="diffs" :diff="diffs.negative" />
        </div>

        <div class="result-card warn-card" v-if="result.invalid.length" style="--d: 200ms">
          <div class="result-head">
            <span class="group-badge alias"><Icon name="warn" :size="14" /></span>
            <h3>还没通过校验的 tag</h3>
          </div>
          <div class="notes">{{ result.invalid.join(', ') }}</div>
        </div>

        <div class="result-card warn-card" v-if="result.fidelity?.length" style="--d: 210ms">
          <div class="result-head">
            <span class="group-badge alias"><Icon name="warn" :size="14" /></span>
            <h3>画面文字被改写了，请手动恢复原文</h3>
          </div>
          <div class="notes">{{ result.fidelity.join('；') }}</div>
        </div>

        <div class="result-card warn-card" v-if="result.dropped?.length" style="--d: 220ms">
          <div class="result-head">
            <span class="group-badge alias"><Icon name="warn" :size="14" /></span>
            <h3>原有内容被删掉了，AI 没有说明理由</h3>
          </div>
          <div class="notes">{{ result.dropped?.join(', ') }}</div>
        </div>

        <div class="result-card" style="--d: 240ms">
          <div class="result-head">
            <span class="group-badge ok"><Icon name="book" :size="14" /></span>
            <h3>修改说明</h3>
            <span class="muted small ml-auto" v-if="result.changes.length">悬停依据标签查看含义</span>
          </div>
          <div class="notes lead" v-if="result.notes">{{ result.notes }}</div>
          <div class="change-group" v-for="g in changeGroups" :key="g.scope">
            <div class="change-group-title">{{ g.label }}</div>
            <div class="effect-list">
              <div class="effect-row" v-for="(c, i) in g.items" :key="i" :style="{ '--i': i }">
                <span class="meta"><BasisPill :basis="c.basis" /></span>
                <div class="grow">
                  {{ c.text }}
                  <span class="evidence" v-if="c.evidence">{{ c.evidence }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <EvidenceNote :info="result.evidence" />

        <div class="row">
          <button class="btn" @click="copy(fullText(result))"><Icon name="copy" :size="15" />复制全部</button>
          <button class="btn" @click="adopt('compare')"><Icon name="compare" :size="15" />{{ adopted ? '' : '采用并' }}逐个比对</button>
          <button class="btn" @click="adopt('preview')"><Icon name="eye" :size="15" />{{ adopted ? '' : '采用并' }}推测画面</button>
          <button class="btn accent" @click="adopt('generate')"><Icon name="image" :size="15" />{{ adopted ? '' : '采用并' }}生图</button>
        </div>
      </template>
    </section>
  </div>
</template>
