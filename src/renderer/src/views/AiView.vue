<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AiOptimizeResult } from '@shared/types'
import { state, copy, toast } from '../store'
import Icon from '../components/Icon.vue'
import Mascot from '../components/Mascot.vue'

const mode = ref<'optimize' | 'semantic'>('optimize')
const instruction = ref('')
const running = ref(false)
const steps = ref<string[]>([])
const result = ref<AiOptimizeResult | null>(null)
const error = ref('')

watch(mode, () => {
  if (!running.value) error.value = ''
})

/** 文本框随内容自动增高，高度不够时由外层栏滚动，避免框内出现小滚动条 */
function autoSize(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}
const vAutosize = {
  mounted(el: HTMLTextAreaElement) {
    el.addEventListener('input', () => autoSize(el))
    autoSize(el)
  },
  updated: autoSize
}

const leftPane = ref<HTMLElement>()
function resizeAll() {
  leftPane.value?.querySelectorAll('textarea').forEach((el) => autoSize(el as HTMLTextAreaElement))
}

onMounted(() => {
  window.api.onAiStep((s) => steps.value.push(s))
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

async function run() {
  if (!state.settings?.apiKey) {
    error.value = '请先在「设置 / 数据」中填写 DeepSeek API Key'
    return
  }
  if (mode.value === 'optimize' && !state.prompt.trim()) {
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
      instruction: instruction.value,
      version: state.settings.naiVersion
    })
  } catch (e) {
    error.value = String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')
  } finally {
    running.value = false
  }
}

function apply() {
  if (!result.value) return
  state.prompt = result.value.positive
  if (result.value.negative) state.negative = result.value.negative
  state.tab = 'compare'
  toast(result.value.negative ? '已应用正向到比对页，负面已同步到输入框' : '已应用到比对页')
}

function fullText(r: AiOptimizeResult): string {
  const parts = [`[Prompt]\n${r.positive}`]
  r.characters.forEach((c, i) => parts.push(`[Character ${i + 1}${c.position ? ' @ ' + c.position : ''}]\n${c.prompt}`))
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

      <div class="field">
        <label class="field-label">{{ mode === 'optimize' ? '正向提示词' : '要保留的提示词（可选）' }}<span class="muted"> · 与比对页同步</span></label>
        <div class="composer short">
          <textarea v-autosize v-model="state.prompt" spellcheck="false" placeholder="1girl, silver hair, ..."></textarea>
        </div>
      </div>

      <div class="field">
        <label class="field-label">负面提示词（可选）<span class="muted"> · 留空则由 AI 按规范生成</span></label>
        <div class="composer short neg">
          <textarea v-autosize v-model="state.negative" spellcheck="false" placeholder="lowres, worst quality, bad quality, ..."></textarea>
        </div>
      </div>

      <div class="field">
        <label class="field-label">{{ mode === 'optimize' ? '额外要求（可选）' : '画面描述' }}</label>
        <div class="composer short">
          <textarea
            v-autosize
            v-model="instruction"
            :placeholder="
              mode === 'optimize'
                ? '例如：风格偏厚涂一点；换成夜景；表情更生动'
                : '例如：银发红瞳的少女坐在雨夜便利店门口，穿着宽大的卫衣，抬头看着镜头，霓虹灯反光，电影感'
            "
          ></textarea>
        </div>
      </div>

      <div class="row">
        <button class="btn accent big" :disabled="running" @click="run">
          <Icon name="sparkle" :size="17" :class="{ spin: running }" />
          {{ running ? '正在思考' : '开始' }}
        </button>
        <span class="pill">目标 {{ state.settings?.naiVersion.toUpperCase() }}</span>
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
        <p>
          我会先把画面拆成一个个概念，去本地 Danbooru 库里找真实存在的 tag，按 Skill 文档的规则排好顺序，最后再检查一遍，不存在的 tag 会自动换掉。
        </p>
      </div>
      <template v-else>
        <div class="cheer">
          <Mascot :mood="result.invalid.length ? 'confused' : 'wink'" :size="76" />
          <div>
            <b>{{ result.invalid.length ? '大部分搞定了，还有几个 tag 要你看看' : '优化好啦！' }}</b>
            <div class="muted small">{{ result.characters.length ? `含 ${result.characters.length} 个角色提示词` : '单角色 / 无角色提示词' }}</div>
          </div>
        </div>
        <div class="result-card" style="--d: 0ms">
          <div class="result-head">
            <span class="group-badge pink"><Icon name="sparkle" :size="14" /></span>
            <h3>正向提示词</h3>
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
            <span class="muted small" v-if="c.position">{{ c.position }}</span>
            <button class="icon-btn sm ml-auto" title="复制" @click="copy(c.prompt)"><Icon name="copy" :size="15" /></button>
          </div>
          <pre class="result-text">{{ c.prompt }}</pre>
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
          </div>
          <div class="notes">{{ result.notes }}</div>
        </div>

        <div><button class="btn" @click="copy(fullText(result))"><Icon name="copy" :size="15" />复制全部（含角色和负面）</button></div>
      </template>
    </section>
  </div>
</template>
