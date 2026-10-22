<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AiOptimizeResult, ChangeScope } from '@shared/types'
import { state, copy, toast, toDrafts } from '../store'
import { vAutosize, resizeWithin } from '../autosize'
import { parsePromptText } from '../prompt-import'
import Icon from '../components/Icon.vue'
import Mascot from '../components/Mascot.vue'
import CharacterEditor from '../components/CharacterEditor.vue'
import BasisPill from '../components/BasisPill.vue'
import EvidenceNote from '../components/EvidenceNote.vue'

const mode = ref<'optimize' | 'semantic'>('optimize')
const instruction = ref('')
const running = ref(false)
const steps = ref<string[]>([])
const result = ref<AiOptimizeResult | null>(null)
const error = ref('')

watch(mode, () => {
  if (!running.value) error.value = ''
})

const leftPane = ref<HTMLElement>()
const resizeAll = () => resizeWithin(leftPane.value)

onMounted(() => {
  // 画面推测也会推送 ai:step，只记录本页任务的进度
  window.api.onAiStep((s) => {
    if (running.value) steps.value.push(s)
  })
  window.addEventListener('resize', resizeAll)
})

onBeforeUnmount(() => window.removeEventListener('resize', resizeAll))

// 视图常驻但可能是隐藏状态（v-show），隐藏时量不出内容高度，切回来时重算一次
watch(
  () => state.tab,
  async (t) => {
    if (t !== 'ai') return
    await nextTick()
    resizeAll()
  }
)

/** 粘贴分节文本 / NAI 元数据时，自动拆到正向、角色、负面三处 */
function onPromptPaste(e: ClipboardEvent) {
  const r = parsePromptText(e.clipboardData?.getData('text/plain') ?? '')
  if (!r.structured) return
  e.preventDefault()
  state.prompt = r.base
  state.negative = r.negative
  state.characters = toDrafts(r.characters)
  const parts = [r.base && '正向', r.characters.length && `${r.characters.length} 个角色`, r.negative && '负面'].filter(Boolean)
  toast(`已自动拆分：${parts.join(' / ')}`)
  nextTick(resizeAll)
}

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

async function run() {
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
  try {
    result.value = await window.api.optimize({
      mode: mode.value,
      prompt: state.prompt,
      negative: state.negative,
      characters: state.characters
        .filter((c) => c.prompt.trim())
        .map((c) => ({ prompt: c.prompt, negative: c.negative, position: c.position })),
      instruction: instruction.value,
      version: state.settings.naiVersion
    })
  } catch (e) {
    error.value = String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')
  } finally {
    running.value = false
  }
}

/** 把结果写回输入框（含角色），方便继续优化 */
function fillInputs(r: AiOptimizeResult) {
  state.prompt = r.positive
  if (r.negative) state.negative = r.negative
  state.characters = toDrafts(r.characters)
}

function apply() {
  if (!result.value) return
  fillInputs(result.value)
  state.tab = 'compare'
  toast(result.value.characters.length ? '已应用到比对页，角色提示词已填入 AI 优化页' : '已应用到比对页，负面已同步到输入框')
}

function keepEditing() {
  if (!result.value) return
  fillInputs(result.value)
  mode.value = 'optimize'
  toast('已填回左侧，可以继续调整')
  nextTick(resizeAll)
}

function toPreview() {
  const r = result.value
  if (!r) return
  state.previewDraft = { base: r.positive, negative: r.negative, characters: r.characters, structured: true }
  state.tab = 'preview'
}

function toGenerate() {
  const r = result.value
  if (!r) return
  state.generateDraft = { base: r.positive, negative: r.negative, characters: r.characters, structured: true }
  state.tab = 'generate'
}

function fullText(r: AiOptimizeResult): string {
  const parts = [`[Prompt]\n${r.positive}`]
  r.characters.forEach((c, i) => {
    parts.push(`[Character ${i + 1}${c.position ? ' @ ' + c.position : ''}]\n${c.prompt}`)
    if (c.negative) parts.push(`[Character ${i + 1} Undesired Content]\n${c.negative}`)
  })
  if (r.negative) parts.push(`[Undesired Content]\n${r.negative}`)
  return parts.join('\n\n')
}
</script>

<template>
  <div class="view ai">
    <section class="pane left scroll" ref="leftPane">
      <div class="seg block big">
        <button :class="{ on: mode === 'optimize' }" @click="mode = 'optimize'"><Icon name="wand" :size="15" />优化现有提示词</button>
        <button :class="{ on: mode === 'semantic' }" @click="mode = 'semantic'"><Icon name="chat" :size="15" />描述转提示词</button>
      </div>

      <div class="field" v-if="mode === 'semantic'">
        <label class="field-label">画面描述<span class="muted"> · 多人画面会自动拆成角色提示词</span></label>
        <div class="composer short">
          <textarea
            v-autosize
            v-model="instruction"
            placeholder="例如：樱花树下的长椅上坐着两个女孩。左边是银发红瞳、穿白色连衣裙的少女，正笑着把头靠在右边女孩的肩上；右边是黑色短发、戴眼镜、穿学生制服的女孩，低头看书。午后阳光，柔和的水彩风。"
          ></textarea>
        </div>
      </div>

      <div class="field">
        <label class="field-label">
          {{ mode === 'optimize' ? '正向提示词' : '要保留的主提示词（可选）' }}<span class="muted"> · 与比对页同步，粘贴分节文本会自动拆分</span>
        </label>
        <div class="composer short">
          <textarea v-autosize v-model="state.prompt" spellcheck="false" placeholder="1girl, silver hair, ..." @paste="onPromptPaste"></textarea>
        </div>
      </div>

      <CharacterEditor
        :list="state.characters"
        :label="mode === 'optimize' ? '角色提示词（可选）' : '要保留的角色（可选）'"
        :hint="mode === 'optimize' ? '多人画面时填写' : '留空则由 AI 按描述拆分'"
      />

      <div class="field">
        <label class="field-label">负面提示词（可选）<span class="muted"> · 留空则由 AI 按规范生成</span></label>
        <div class="composer short neg">
          <textarea v-autosize v-model="state.negative" spellcheck="false" placeholder="lowres, worst quality, bad quality, ..."></textarea>
        </div>
      </div>

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
        <Mascot mood="busy" :size="240" />
        <p>正在翻 tag 库挑词<span class="dots"><i></i><i></i><i></i></span></p>
      </div>
      <div v-else-if="error && !result" class="empty">
        <Mascot mood="confused" :size="230" />
        <p>出了点问题，看看左边的报错信息吧</p>
      </div>
      <div v-else-if="!result" class="empty">
        <Mascot mood="chill" :size="230" />
        <p v-if="mode === 'semantic'">
          用中文把画面讲清楚就好。我会数清画面里有几个人，把共享的画风、构图、背景放进主提示词，每个人的外貌、服装、动作拆成单独的角色提示词并排好位置，再给容易串色的角色加上角色负面，最后配一套负面提示词。
        </p>
        <p v-else>
          我会先把画面拆成一个个概念，去本地 Danbooru 库里找真实存在的 tag，按 Skill 文档的规则排好顺序，最后再检查一遍，不存在的 tag 会自动换掉。
        </p>
      </div>
      <template v-else>
        <div class="cheer">
          <Mascot :mood="result.invalid.length ? 'confused' : 'wink'" :size="76" />
          <div>
            <b>{{ result.invalid.length ? '大部分搞定了，还有几个 tag 要你看看' : '优化好啦！' }}</b>
            <div class="muted small">{{ result.characters.length ? `拆成了 ${result.characters.length} 个角色提示词` : '单角色 / 无角色提示词' }}</div>
          </div>
        </div>
        <div class="result-card" style="--d: 0ms">
          <div class="result-head">
            <span class="group-badge pink"><Icon name="sparkle" :size="14" /></span>
            <h3>{{ result.characters.length ? '主提示词' : '正向提示词' }}</h3>
            <div class="actions ml-auto">
              <button class="icon-btn sm" title="复制" @click="copy(result.positive)"><Icon name="copy" :size="15" /></button>
              <button class="btn small primary" @click="apply">应用到比对页</button>
            </div>
          </div>
          <pre class="result-text">{{ result.positive }}</pre>
        </div>

        <div class="result-card" v-for="(c, i) in result.characters" :key="i" :style="{ '--d': (i + 1) * 70 + 'ms' }">
          <div class="result-head">
            <span class="group-badge nl"><Icon name="user" :size="14" /></span>
            <h3>角色 {{ i + 1 }}</h3>
            <span class="pill" v-if="c.position">{{ c.position }}</span>
            <button class="icon-btn sm ml-auto" title="复制" @click="copy(c.prompt)"><Icon name="copy" :size="15" /></button>
          </div>
          <pre class="result-text">{{ c.prompt }}</pre>
          <div v-if="c.negative" class="notes"><span class="chip-zh">角色负面：</span>{{ c.negative }}</div>
        </div>

        <div class="result-card" v-if="result.negative" style="--d: 140ms">
          <div class="result-head">
            <span class="group-badge bad"><Icon name="stop" :size="14" /></span>
            <h3>负面提示词</h3>
            <button class="icon-btn sm ml-auto" title="复制" @click="copy(result.negative)"><Icon name="copy" :size="15" /></button>
          </div>
          <pre class="result-text">{{ result.negative }}</pre>
        </div>

        <div class="result-card warn-card" v-if="result.invalid.length" style="--d: 200ms">
          <div class="result-head">
            <span class="group-badge alias"><Icon name="warn" :size="14" /></span>
            <h3>还没通过校验的 tag</h3>
          </div>
          <div class="notes">{{ result.invalid.join(', ') }}</div>
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
          <button class="btn" @click="copy(fullText(result))"><Icon name="copy" :size="15" />复制全部（含角色和负面）</button>
          <button class="btn" @click="keepEditing"><Icon name="edit" :size="15" />填回左侧继续改</button>
          <button class="btn" @click="toPreview"><Icon name="eye" :size="15" />推测画面</button>
          <button class="btn accent" @click="toGenerate"><Icon name="image" :size="15" />去生图</button>
        </div>
      </template>
    </section>
  </div>
</template>
