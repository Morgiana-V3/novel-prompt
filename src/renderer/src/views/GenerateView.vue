<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { NaiFreeCheck, NaiGenParams, NaiGenResult, NaiImage, NaiNoiseSchedule, NaiSampler, NaiSubscription } from '@shared/types'
import { state, copy, toast, importPrompt, workKey, cleanErr, DEFAULT_PARAMS } from '../store'
import { resizeWithin } from '../autosize'
import { readPngPrompt, type ImportedPrompt } from '@shared/prompt-import'
import Icon from '../components/Icon.vue'
import Mascot from '../components/Mascot.vue'
import PromptEditor from '../components/PromptEditor.vue'
import WorkspaceBar from '../components/WorkspaceBar.vue'
import SharedParams from '../components/SharedParams.vue'

/** 只属于生图的参数；画幅、质量词、UC 预设与画面推测共用（state.params） */
type GenOnly = Omit<NaiGenParams, 'width' | 'height' | 'qualityTags' | 'ucPreset'>

const PARAMS_KEY = 'np-gen-params'
const DEFAULT_GEN: GenOnly = {
  steps: 23,
  scale: 5,
  cfgRescale: 0,
  sampler: 'k_euler_ancestral',
  noiseSchedule: 'native',
  seed: null,
  count: 1
}

function loadGen(): GenOnly {
  try {
    const saved = JSON.parse(localStorage.getItem(PARAMS_KEY) ?? '{}') as Partial<GenOnly>
    const out = { ...DEFAULT_GEN }
    for (const k of Object.keys(DEFAULT_GEN) as (keyof GenOnly)[]) if (k in saved) (out as Record<string, unknown>)[k] = saved[k]
    return { ...out, seed: null }
  } catch {
    return { ...DEFAULT_GEN }
  }
}

const gen = reactive<GenOnly>(loadGen())
watch(gen, (p) => localStorage.setItem(PARAMS_KEY, JSON.stringify({ ...p, seed: null })), { deep: true })
const params = state.params

const SAMPLERS: { v: NaiSampler; label: string }[] = [
  { v: 'k_euler_ancestral', label: 'Euler Ancestral' },
  { v: 'k_euler', label: 'Euler' },
  { v: 'k_dpmpp_2s_ancestral', label: 'DPM++ 2S Ancestral' },
  { v: 'k_dpmpp_2m_sde', label: 'DPM++ 2M SDE' },
  { v: 'k_dpmpp_2m', label: 'DPM++ 2M' },
  { v: 'k_dpmpp_sde', label: 'DPM++ SDE' }
]
const SCHEDULES: NaiNoiseSchedule[] = ['native', 'karras', 'exponential', 'polyexponential']

/** 种子留空即默认，不参与比较 */
const GEN_KEYS = ['steps', 'scale', 'cfgRescale', 'sampler', 'noiseSchedule', 'count'] as const
const isDefault = computed(
  () =>
    GEN_KEYS.every((k) => gen[k] === DEFAULT_GEN[k]) &&
    (gen.seed === null || (gen.seed as unknown) === '') &&
    (Object.keys(DEFAULT_PARAMS) as (keyof typeof DEFAULT_PARAMS)[]).every((k) => params[k] === DEFAULT_PARAMS[k])
)
function resetDefaults() {
  Object.assign(gen, DEFAULT_GEN)
  Object.assign(params, DEFAULT_PARAMS)
  toast('已恢复默认参数')
}

/** 高级设置（默认收起）：不常改的参数，收起时在标题上显示当前值 */
const advancedSummary = computed(() =>
  [
    SAMPLERS.find((s) => s.v === gen.sampler)?.label ?? gen.sampler,
    gen.noiseSchedule,
    `Rescale ${gen.cfgRescale}`,
    params.qualityTags ? '质量词开' : '质量词关',
    `UC ${params.ucPreset}`
  ].join(' · ')
)
const advancedChanged = computed(
  () =>
    gen.sampler !== DEFAULT_GEN.sampler ||
    gen.noiseSchedule !== DEFAULT_GEN.noiseSchedule ||
    gen.cfgRescale !== DEFAULT_GEN.cfgRescale ||
    params.qualityTags !== DEFAULT_PARAMS.qualityTags ||
    params.ucPreset !== DEFAULT_PARAMS.ucPreset
)

const hasToken = computed(() => !!state.settings?.naiToken?.trim())
const freeOnly = computed(() => state.settings?.naiFreeOnly !== false)
const version = computed(() => state.settings?.naiVersion ?? 'v4.5')

const sub = ref<NaiSubscription | null>(null)
const subError = ref('')
const subLoading = ref(false)
const check = ref<NaiFreeCheck | null>(null)

const running = ref(false)
const cancelling = ref(false)
const steps = ref<string[]>([])
const error = ref('')
const last = ref<NaiGenResult | null>(null)
const gallery = ref<NaiImage[]>([])
const current = ref<NaiImage | null>(null)
const lightbox = ref(false)

const leftPane = ref<HTMLElement>()
const resizeAll = () => resizeWithin(leftPane.value)

const anlas = computed(() => {
  const s = sub.value
  if (!s || (s.anlasFixed === undefined && s.anlasPurchased === undefined)) return undefined
  return (s.anlasFixed ?? 0) + (s.anlasPurchased ?? 0)
})

/** 当前图片是用最近一次推测过的那套提示词生成的：可以把推测和实际出图放在一起看 */
const matchedPreview = computed(() => {
  const lp = state.lastPreview
  if (!lp || !current.value) return null
  return state.imageKeys[current.value.name] === lp.key ? lp.result : null
})
const previewIsCurrent = computed(() => !!state.lastPreview && state.lastPreview.key === workKey())

async function refreshSub() {
  if (!hasToken.value) return
  subLoading.value = true
  subError.value = ''
  try {
    sub.value = await window.api.naiSubscription()
  } catch (e) {
    subError.value = cleanErr(e)
  } finally {
    subLoading.value = false
  }
}

async function refreshGallery() {
  gallery.value = await window.api.naiList()
  if (current.value && !gallery.value.some((g) => g.name === current.value!.name)) current.value = null
}

let checkTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => [params.width, params.height, gen.steps, version.value, sub.value, freeOnly.value],
  () => {
    clearTimeout(checkTimer)
    checkTimer = setTimeout(async () => {
      check.value = await window.api.naiFreeCheck(
        { width: params.width, height: params.height, steps: gen.steps } as NaiGenParams,
        version.value,
        sub.value ? { ...sub.value } : undefined
      )
    }, 150)
  },
  { immediate: true }
)

onMounted(() => {
  window.api.onNaiStep((s) => {
    if (running.value) steps.value.push(s)
  })
  window.addEventListener('resize', resizeAll)
  window.addEventListener('keydown', onKey)
  refreshGallery()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeAll)
  window.removeEventListener('keydown', onKey)
})

watch(
  () => state.tab,
  async (t) => {
    if (t !== 'generate') return
    await nextTick()
    resizeAll()
    if (hasToken.value && !sub.value && !subLoading.value) refreshSub()
  }
)
watch(
  () => state.characters.length,
  () => nextTick(resizeAll)
)
watch(hasToken, (v) => {
  if (v && state.tab === 'generate') refreshSub()
  if (!v) sub.value = null
})

/* ---------- 生成 ---------- */
function randomizeSeed() {
  gen.seed = null
}

async function run() {
  if (!hasToken.value) {
    error.value = '请先在「设置 / 数据」中填写 NovelAI API Token'
    return
  }
  if (!state.prompt.trim() && !state.characters.some((c) => c.prompt.trim())) {
    error.value = '请先输入主提示词或角色提示词'
    return
  }
  if (freeOnly.value && check.value && !check.value.ok) {
    error.value = `当前设置不满足免费条件：\n${check.value.reasons.join('\n')}\n\n可以调整尺寸/步数，或在设置中允许消耗 Anlas`
    return
  }
  running.value = true
  cancelling.value = false
  error.value = ''
  steps.value = []
  const key = workKey()
  try {
    const seed = gen.seed === null || (gen.seed as unknown) === '' ? null : Number(gen.seed)
    const r = await window.api.naiGenerate({
      base: state.prompt,
      negative: state.negative,
      characters: state.characters.filter((c) => c.prompt.trim()).map((c) => ({ ...c })),
      params: { ...gen, ...params, seed },
      version: version.value
    })
    last.value = r
    for (const img of r.images) state.imageKeys[img.name] = key
    if (r.subscription) sub.value = r.subscription
    if (r.images.length) current.value = r.images[r.images.length - 1]
    if (r.stopped && !r.images.length) error.value = r.stopped
    await refreshGallery()
  } catch (e) {
    error.value = cleanErr(e)
    refreshSub()
  } finally {
    running.value = false
  }
}

async function cancel() {
  cancelling.value = true
  await window.api.naiCancel()
  toast('会在当前这张完成后停止')
}

/* ---------- 图片操作 ---------- */
async function saveAs(img: NaiImage) {
  if (await window.api.naiSaveAs(img.name)) toast('已保存')
}
async function copyImage(img: NaiImage) {
  if (await window.api.naiCopyImage(img.name)) toast('图片已复制')
}
async function remove(img: NaiImage) {
  if (!(await window.api.naiDelete(img.name))) return
  toast('已移到回收站')
  if (current.value?.name === img.name) current.value = null
  await refreshGallery()
}
function useSeed(img: NaiImage) {
  if (img.seed === undefined) return
  gen.seed = img.seed
  gen.count = 1
  toast(`种子已固定为 ${img.seed}`)
}
const reveal = (img: NaiImage) => window.api.naiReveal(img.name)
const openFolder = () => window.api.naiReveal()

async function readMeta(img: NaiImage): Promise<ImportedPrompt | null> {
  try {
    const bytes = await window.api.naiReadImage(img.name)
    return await readPngPrompt(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
  } catch (e) {
    toast(cleanErr(e) || '读取图片信息失败')
    return null
  }
}
/** 图片里存的是实际发送的提示词（已含质量词和 UC 预设），导入时会自动关掉这两项避免重复 */
async function loadFromImage(img: NaiImage) {
  const r = await readMeta(img)
  if (r) importPrompt(r, '已从图片读回提示词')
}
async function previewImage(img: NaiImage) {
  const r = await readMeta(img)
  if (!r) return
  importPrompt(r, '已从图片读回提示词')
  state.tab = 'preview'
}

function onKey(e: KeyboardEvent) {
  if (!lightbox.value) return
  if (e.key === 'Escape') lightbox.value = false
  const i = gallery.value.findIndex((g) => g.name === current.value?.name)
  if (e.key === 'ArrowRight' && i >= 0 && i < gallery.value.length - 1) current.value = gallery.value[i + 1]
  if (e.key === 'ArrowLeft' && i > 0) current.value = gallery.value[i - 1]
}

const fmtTime = (t: number) => new Date(t).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const fmtHours = (s?: number) => (s === undefined ? '' : s >= 3600 ? `${(s / 3600).toFixed(1)} 小时` : `${Math.ceil(s / 60)} 分钟`)
const RISK_CLS = { high: 'bad', medium: 'alias', low: '' } as const
const RISK_TEXT = { high: '高', medium: '中', low: '低' } as const
</script>

<template>
  <div class="view generate">
    <section class="pane left scroll" ref="leftPane">
      <div :class="['import-zone quota', { warn: freeOnly && check && !check.ok }]">
        <span class="group-badge pink"><Icon name="key" :size="16" /></span>
        <div class="import-text">
          <template v-if="!hasToken">
            <b>还没有配置 NovelAI Token</b>
            <span>在「设置 / 数据」里填写 Persistent API Token 后就能直接出图</span>
          </template>
          <template v-else-if="subError">
            <b>查询会员状态失败</b>
            <span>{{ subError }}</span>
          </template>
          <template v-else-if="sub">
            <b>
              {{ sub.active ? (sub.tier === 3 ? 'Opus 会员' : `会员等级 ${sub.tier ?? '未知'}`) : '没有有效订阅' }}
              <span class="quota-sep">·</span>Anlas {{ anlas !== undefined ? anlas.toLocaleString() : '未知' }}
            </b>
            <span>
              <template v-if="sub.usagePercent !== undefined">
                V5 免费额度约 {{ sub.usagePercent }}%{{ sub.usageNegative ? '（负值）' : '' }}
                <template v-if="sub.usageNextSeconds"> · {{ fmtHours(sub.usageNextSeconds) }}后恢复 1%</template>
              </template>
              <template v-else>接口没有返回 V5 免费额度</template>
              · {{ freeOnly ? '只用免费额度' : '允许消耗 Anlas' }}
            </span>
          </template>
          <template v-else>
            <b>正在查询会员状态…</b>
            <span>&nbsp;</span>
          </template>
        </div>
        <div class="actions">
          <button v-if="!hasToken" class="btn small primary" @click="state.tab = 'settings'"><Icon name="sliders" :size="14" />去设置</button>
          <button v-else class="icon-btn" title="刷新余额" @click="refreshSub"><Icon name="swap" :class="{ spin: subLoading }" /></button>
        </div>
      </div>

      <WorkspaceBar />

      <PromptEditor char-hint="点「编辑位置」可在画布上拖动角色" />

      <div class="field-head gen-params-head">
        <label class="field-label">生成参数</label>
        <button class="btn ghost small ml-auto" :disabled="isDefault" title="步数、Guidance、采样器、画幅等全部恢复默认" @click="resetDefaults">
          <Icon name="reset" :size="14" />恢复默认
        </button>
      </div>
      <div class="gen-params">
        <SharedParams :only="['size']" />
        <div class="param">
          <span class="side-label">张数（逐张生成）</span>
          <div class="seg block">
            <button v-for="n in [1, 2, 4]" :key="n" :class="{ on: gen.count === n }" @click="gen.count = n">{{ n }}</button>
          </div>
        </div>
        <div class="param">
          <span class="side-label">步数 · {{ gen.steps }}</span>
          <input class="range" type="range" min="1" max="50" v-model.number="gen.steps" />
        </div>
        <div class="param">
          <span class="side-label">Prompt Guidance · {{ gen.scale }}</span>
          <input class="range" type="range" min="0" max="10" step="0.1" v-model.number="gen.scale" />
        </div>
        <div class="param">
          <span class="side-label">种子（留空随机）</span>
          <div class="pair">
            <input class="input sm" type="number" min="0" v-model.number="gen.seed" placeholder="随机" />
            <button class="icon-btn sm" title="改回随机" @click="randomizeSeed"><Icon name="x" :size="14" /></button>
          </div>
        </div>
      </div>

      <details class="gen-advanced">
        <summary>
          <Icon name="chevron" :size="14" class="gen-advanced-arrow" />
          <span class="gen-advanced-title">高级设置</span>
          <span v-if="advancedChanged" class="gen-advanced-dot" title="有参数改过默认值"></span>
          <span class="muted gen-advanced-sum">{{ advancedSummary }}</span>
        </summary>
        <div class="gen-params">
          <div class="param">
            <span class="side-label">自定义尺寸（64 的倍数）</span>
            <div class="pair">
              <input class="input sm" type="number" min="64" step="64" v-model.number="params.width" />
              <span class="muted">×</span>
              <input class="input sm" type="number" min="64" step="64" v-model.number="params.height" />
            </div>
          </div>
          <div class="param">
            <span class="side-label">Guidance Rescale · {{ gen.cfgRescale }}</span>
            <input class="range" type="range" min="0" max="1" step="0.02" v-model.number="gen.cfgRescale" />
          </div>
          <div class="param">
            <span class="side-label">采样器</span>
            <select class="input sm" v-model="gen.sampler">
              <option v-for="s in SAMPLERS" :key="s.v" :value="s.v">{{ s.label }}</option>
            </select>
          </div>
          <div class="param">
            <span class="side-label">噪声调度</span>
            <select class="input sm" v-model="gen.noiseSchedule">
              <option v-for="s in SCHEDULES" :key="s" :value="s">{{ s }}</option>
            </select>
          </div>
          <SharedParams :only="['quality', 'uc']" />
        </div>
      </details>

      <div v-if="hasToken && check" :class="['free-check', check.ok ? 'ok' : freeOnly ? 'bad' : 'warn']">
        <Icon :name="check.ok ? 'check' : 'warn'" :size="15" :stroke="check.ok ? 2.2 : 1.8" />
        <div>
          <b>{{ check.ok ? '满足免费生成条件' : freeOnly ? '不满足免费条件，不会提交' : '可能会消耗 Anlas' }}</b>
          <div v-for="r in check.reasons" :key="r">{{ r }}</div>
          <div v-if="check.ok" class="muted">{{ check.notes[0] }}</div>
        </div>
      </div>

      <div class="row">
        <button class="btn accent big" :disabled="running" @click="run">
          <Icon name="image" :size="17" :class="{ 'spin-slow': running }" />
          {{ running ? '正在生成' : gen.count > 1 ? `生成 ${gen.count} 张` : '生成' }}
        </button>
        <button v-if="running" class="btn ghost" :disabled="cancelling" @click="cancel"><Icon name="stop" :size="15" />{{ cancelling ? '即将停止' : '停止' }}</button>
        <span class="pill">{{ version === 'v5' ? 'V5 Full' : 'V4.5 Full' }}</span>
        <div class="actions ml-auto">
          <button class="btn ghost small" :title="previewIsCurrent ? '这套提示词已经推测过' : '先让 AI 推测一下会画成什么样'" @click="state.tab = 'preview'">
            <Icon name="eye" :size="14" />{{ previewIsCurrent ? '查看推测' : '先推测画面' }}
          </button>
        </div>
      </div>

      <div v-if="error" class="error-box"><Icon name="warn" :size="16" />{{ error }}</div>

      <div class="timeline" v-if="steps.length">
        <div v-for="(s, i) in steps" :key="i" :class="['tl-item', { live: running && i === steps.length - 1 }]">{{ s }}</div>
      </div>
    </section>

    <section class="pane right scroll">
      <div v-if="running && !current" class="empty">
        <Mascot mood="paint" :size="240" />
        <p>NovelAI 正在画<span class="dots"><i></i><i></i><i></i></span></p>
      </div>
      <div v-else-if="!current && !gallery.length" class="empty">
        <Mascot :mood="hasToken ? 'idle' : 'key'" :size="230" />
        <p v-if="hasToken">生图用的是「当前提示词」，和 AI 优化、画面推测是同一份。点「生成」就能直接看到效果，图会保存在本机图库，可以预览、下载，也能读回图里的提示词。</p>
        <p v-else>要先在「设置 / 数据」里填写 NovelAI 的 Persistent API Token 才能出图哦</p>
        <button v-if="!hasToken" class="btn primary" @click="state.tab = 'settings'"><Icon name="sliders" :size="16" />去设置</button>
      </div>

      <template v-else>
        <div v-if="last && (last.stopped || last.anlasDelta)" :class="['cheer', { warn: last.stopped || (last.anlasDelta ?? 0) < 0 }]">
          <Mascot :mood="last.stopped ? 'oops' : 'thumbs'" :size="64" />
          <div>
            <b>{{ last.stopped ?? '生成完成' }}</b>
            <div class="muted small">
              本次完成 {{ last.images.length }} 张 ·
              {{
                last.anlasDelta === undefined ? 'Anlas 变化未知' : last.anlasDelta < 0 ? `消耗了 ${-last.anlasDelta} Anlas` : '没有消耗 Anlas'
              }}
            </div>
          </div>
        </div>

        <div class="result-card viewer" v-if="current">
          <div class="result-head">
            <span class="group-badge pink"><Icon name="image" :size="14" /></span>
            <h3>{{ current.width && current.height ? `${current.width}×${current.height}` : '图片' }}</h3>
            <button v-if="current.seed !== undefined" class="pill seed" title="复制种子" @click="copy(String(current.seed))">种子 {{ current.seed }}</button>
            <div class="actions ml-auto">
              <button class="icon-btn sm" title="固定这个种子" @click="useSeed(current)"><Icon name="paw" :size="15" /></button>
              <button class="icon-btn sm" title="读回这张图的提示词，替换当前提示词（可在历史里撤销）" @click="loadFromImage(current)"><Icon name="paste" :size="15" /></button>
              <button class="icon-btn sm" title="读回这张图的提示词并推测画面" @click="previewImage(current)"><Icon name="eye" :size="15" /></button>
              <button class="icon-btn sm" title="复制图片" @click="copyImage(current)"><Icon name="copy" :size="15" /></button>
              <button class="icon-btn sm" title="在文件夹中显示" @click="reveal(current)"><Icon name="book" :size="15" /></button>
              <button class="btn small primary" @click="saveAs(current)"><Icon name="download" :size="14" /></button>
            </div>
          </div>
          <div class="viewer-stage" @click="lightbox = true">
            <img :src="current.url" :key="current.url" alt="生成结果" draggable="false" />
            <div v-if="running" class="viewer-busy"><Icon name="image" :size="16" class="spin-slow" />下一张生成中…</div>
          </div>
        </div>

        <div class="result-card" v-if="matchedPreview" style="--d: 60ms">
          <div class="result-head">
            <span class="group-badge pink"><Icon name="eye" :size="14" /></span>
            <h3>推测 vs 实际</h3>
            <span class="muted small">这张图用的就是推测过的那套提示词，对照看看准不准</span>
            <button class="btn ghost small ml-auto" @click="state.tab = 'preview'">完整推测</button>
          </div>
          <div class="notes">{{ matchedPreview.summary }}</div>
          <div class="effect-list" v-if="matchedPreview.risks.length">
            <div class="effect-row" v-for="(r, i) in matchedPreview.risks" :key="i" :style="{ '--i': i }">
              <span :class="['pill', RISK_CLS[r.level]]">{{ RISK_TEXT[r.level] }}</span>
              <span class="grow">{{ r.text }}</span>
            </div>
          </div>
        </div>

        <div class="group" v-if="gallery.length">
          <div class="group-head">
            <span class="group-badge nl"><Icon name="image" :size="14" /></span>
            <h3>本机图库</h3>
            <span class="group-count">{{ gallery.length }}</span>
            <button class="btn ghost small ml-auto" @click="openFolder"><Icon name="book" :size="14" />打开文件夹</button>
          </div>
          <div class="gallery">
            <div
              v-for="(g, i) in gallery"
              :key="g.name"
              :class="['thumb', { on: current?.name === g.name }]"
              :style="{ '--i': Math.min(i, 20) }"
              :title="fmtTime(g.createdAt)"
              @click="current = g"
            >
              <img :src="g.url" loading="lazy" alt="" draggable="false" />
              <div class="thumb-actions">
                <button class="icon-btn sm" title="下载" @click.stop="saveAs(g)"><Icon name="download" :size="14" /></button>
                <button class="icon-btn sm" title="删除（移到回收站）" @click.stop="remove(g)"><Icon name="trash" :size="14" /></button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </section>

    <transition name="fade">
      <div class="lightbox" v-if="lightbox && current" @click="lightbox = false">
        <img :src="current.url" alt="" draggable="false" />
        <span class="lightbox-hint">Esc 关闭 · ← → 切换</span>
      </div>
    </transition>
  </div>
</template>
