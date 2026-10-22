<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { NaiFreeCheck, NaiGenParams, NaiGenResult, NaiImage, NaiNoiseSchedule, NaiSampler, NaiSubscription, UcPreset } from '@shared/types'
import { state, copy, toast, toDrafts, type CharDraft } from '../store'
import { vAutosize, resizeWithin } from '../autosize'
import { parsePromptText, readPngPrompt, type ImportedPrompt } from '../prompt-import'
import Icon from '../components/Icon.vue'
import Mascot from '../components/Mascot.vue'
import CharacterEditor from '../components/CharacterEditor.vue'

const PARAMS_KEY = 'np-gen-params'

const DEFAULT_PARAMS: NaiGenParams = {
  width: 832,
  height: 1216,
  steps: 23,
  scale: 5,
  cfgRescale: 0,
  sampler: 'k_euler_ancestral',
  noiseSchedule: 'native',
  seed: null,
  count: 1,
  qualityTags: true,
  ucPreset: 'heavy'
}

function loadParams(): NaiGenParams {
  try {
    return { ...DEFAULT_PARAMS, ...JSON.parse(localStorage.getItem(PARAMS_KEY) ?? '{}'), seed: null }
  } catch {
    return { ...DEFAULT_PARAMS }
  }
}

const form = reactive({ base: '', negative: '', characters: [] as CharDraft[] })
const params = reactive<NaiGenParams>(loadParams())
watch(params, (p) => localStorage.setItem(PARAMS_KEY, JSON.stringify({ ...p, seed: null })), { deep: true })

const SIZES = [
  { key: 'portrait', label: '竖图', w: 832, h: 1216 },
  { key: 'landscape', label: '横图', w: 1216, h: 832 },
  { key: 'square', label: '方图', w: 1024, h: 1024 }
]
const SAMPLERS: { v: NaiSampler; label: string }[] = [
  { v: 'k_euler_ancestral', label: 'Euler Ancestral' },
  { v: 'k_euler', label: 'Euler' },
  { v: 'k_dpmpp_2s_ancestral', label: 'DPM++ 2S Ancestral' },
  { v: 'k_dpmpp_2m_sde', label: 'DPM++ 2M SDE' },
  { v: 'k_dpmpp_2m', label: 'DPM++ 2M' },
  { v: 'k_dpmpp_sde', label: 'DPM++ SDE' }
]
const SCHEDULES: NaiNoiseSchedule[] = ['native', 'karras', 'exponential', 'polyexponential']
const UC_OPTIONS: { key: UcPreset; label: string }[] = [
  { key: 'heavy', label: 'Heavy' },
  { key: 'light', label: 'Light' },
  { key: 'human', label: '人物' },
  { key: 'none', label: '无' }
]
const sizeKey = computed(() => SIZES.find((s) => s.w === params.width && s.h === params.height)?.key ?? 'custom')
const pixels = computed(() => params.width * params.height)

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
  () => [params.width, params.height, params.steps, version.value, sub.value, freeOnly.value],
  () => {
    clearTimeout(checkTimer)
    checkTimer = setTimeout(async () => {
      check.value = await window.api.naiFreeCheck(
        { ...params },
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
watch(hasToken, (v) => {
  if (v && state.tab === 'generate') refreshSub()
  if (!v) sub.value = null
})

/* ---------- 导入 ---------- */
function applyImport(r: ImportedPrompt, source: string) {
  form.base = r.base
  form.negative = r.negative
  form.characters = toDrafts(r.characters)
  if (r.width && r.height) {
    params.width = r.width
    params.height = r.height
  }
  // 元数据里的提示词已经包含质量词和 UC 预设，避免重复追加
  if (r.fromMetadata) {
    params.qualityTags = false
    params.ucPreset = 'none'
  }
  const parts = [r.base && '主提示词', r.characters.length && `${r.characters.length} 个角色`, r.negative && '负面'].filter(Boolean)
  toast(parts.length ? `${source}：${parts.join(' / ')}` : '没有识别到提示词')
  nextTick(resizeAll)
}

watch(
  () => state.generateDraft,
  (d) => {
    if (!d) return
    state.generateDraft = null
    applyImport(d, '已带入')
  },
  { immediate: true }
)

function onBasePaste(e: ClipboardEvent) {
  const r = parsePromptText(e.clipboardData?.getData('text/plain') ?? '')
  if (!r.structured) return
  e.preventDefault()
  applyImport(r, '已自动拆分')
}

function fromOptimize() {
  if (!state.prompt.trim() && !state.characters.some((c) => c.prompt.trim())) {
    toast('AI 优化页还是空的')
    return
  }
  form.base = state.prompt
  form.negative = state.negative
  form.characters = state.characters.map((c) => ({ ...c }))
  toast('已带入 AI 优化页的提示词')
  nextTick(resizeAll)
}

/* ---------- 生成 ---------- */
const cleanErr = (e: unknown) => String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')

function randomizeSeed() {
  params.seed = null
}

async function run() {
  if (!hasToken.value) {
    error.value = '请先在「设置 / 数据」中填写 NovelAI API Token'
    return
  }
  if (!form.base.trim() && !form.characters.some((c) => c.prompt.trim())) {
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
  try {
    const r = await window.api.naiGenerate({
      base: form.base,
      negative: form.negative,
      characters: form.characters.filter((c) => c.prompt.trim()).map((c) => ({ ...c })),
      params: { ...params, seed: params.seed === null || (params.seed as unknown) === '' ? null : Number(params.seed) },
      version: version.value
    })
    last.value = r
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
  params.seed = img.seed
  params.count = 1
  toast(`种子已固定为 ${img.seed}`)
}
const reveal = (img: NaiImage) => window.api.naiReveal(img.name)
const openFolder = () => window.api.naiReveal()
async function readMeta(img: NaiImage): Promise<ImportedPrompt | null> {
  try {
    const bytes = await window.api.naiReadImage(img.name)
    return await readPngPrompt(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
  } catch (e) {
    toast(e instanceof Error ? cleanErr(e.message) : '读取图片信息失败')
    return null
  }
}
async function loadFromImage(img: NaiImage) {
  const r = await readMeta(img)
  if (r) applyImport(r, '已从图片读取提示词')
}
async function toPreview(img: NaiImage) {
  const r = await readMeta(img)
  if (!r) return
  state.previewDraft = r
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

      <div class="field">
        <label class="field-label">主提示词<span class="muted"> · 粘贴分节文本会自动拆分</span></label>
        <div class="composer short">
          <textarea
            v-autosize
            v-model="form.base"
            spellcheck="false"
            placeholder="2girls, artist:xxx, outdoors, cherry blossoms, ..."
            @paste="onBasePaste"
          ></textarea>
        </div>
      </div>

      <CharacterEditor :list="form.characters" hint="位置填 B3 这类网格或 0.3,0.5 坐标才会生效" />

      <div class="field">
        <label class="field-label">负面提示词（UC）</label>
        <div class="composer short neg">
          <textarea v-autosize v-model="form.negative" spellcheck="false" placeholder="lowres, worst quality, bad quality, ..."></textarea>
        </div>
      </div>

      <div class="gen-params">
        <div class="param">
          <span class="side-label">画幅 · {{ params.width }}×{{ params.height }}</span>
          <div class="seg block">
            <button v-for="s in SIZES" :key="s.key" :class="{ on: sizeKey === s.key }" @click="(params.width = s.w), (params.height = s.h)">{{ s.label }}</button>
          </div>
        </div>
        <div class="param">
          <span class="side-label">自定义尺寸（64 的倍数）</span>
          <div class="pair">
            <input class="input sm" type="number" min="64" step="64" v-model.number="params.width" />
            <span class="muted">×</span>
            <input class="input sm" type="number" min="64" step="64" v-model.number="params.height" />
          </div>
        </div>
        <div class="param">
          <span class="side-label">步数 · {{ params.steps }}</span>
          <input class="range" type="range" min="1" max="50" v-model.number="params.steps" />
        </div>
        <div class="param">
          <span class="side-label">Prompt Guidance · {{ params.scale }}</span>
          <input class="range" type="range" min="0" max="10" step="0.1" v-model.number="params.scale" />
        </div>
        <div class="param">
          <span class="side-label">Guidance Rescale · {{ params.cfgRescale }}</span>
          <input class="range" type="range" min="0" max="1" step="0.02" v-model.number="params.cfgRescale" />
        </div>
        <div class="param">
          <span class="side-label">种子（留空随机）</span>
          <div class="pair">
            <input class="input sm" type="number" min="0" v-model.number="params.seed" placeholder="随机" />
            <button class="icon-btn sm" title="改回随机" @click="randomizeSeed"><Icon name="x" :size="14" /></button>
          </div>
        </div>
        <div class="param">
          <span class="side-label">采样器</span>
          <select class="input sm" v-model="params.sampler">
            <option v-for="s in SAMPLERS" :key="s.v" :value="s.v">{{ s.label }}</option>
          </select>
        </div>
        <div class="param">
          <span class="side-label">噪声调度</span>
          <select class="input sm" v-model="params.noiseSchedule">
            <option v-for="s in SCHEDULES" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div class="param">
          <span class="side-label">张数（逐张生成）</span>
          <div class="seg block">
            <button v-for="n in [1, 2, 4]" :key="n" :class="{ on: params.count === n }" @click="params.count = n">{{ n }}</button>
          </div>
        </div>
        <div class="param">
          <span class="side-label">Add Quality Tags</span>
          <div class="seg block">
            <button :class="{ on: params.qualityTags }" @click="params.qualityTags = true">开</button>
            <button :class="{ on: !params.qualityTags }" @click="params.qualityTags = false">关</button>
          </div>
        </div>
        <div class="param wide">
          <span class="side-label">UC 预设（由本工具拼进负面）</span>
          <div class="seg block">
            <button v-for="u in UC_OPTIONS" :key="u.key" :class="{ on: params.ucPreset === u.key }" @click="params.ucPreset = u.key">{{ u.label }}</button>
          </div>
        </div>
      </div>

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
          {{ running ? '正在生成' : params.count > 1 ? `生成 ${params.count} 张` : '生成' }}
        </button>
        <button v-if="running" class="btn ghost" :disabled="cancelling" @click="cancel"><Icon name="stop" :size="15" />{{ cancelling ? '即将停止' : '停止' }}</button>
        <span class="pill">{{ version === 'v5' ? 'V5 Full' : 'V4.5 Full' }}</span>
        <div class="actions ml-auto">
          <button class="btn ghost small" title="带入 AI 优化页的正向、角色和负面" @click="fromOptimize"><Icon name="sparkle" :size="14" />从 AI 优化带入</button>
        </div>
      </div>

      <div v-if="error" class="error-box"><Icon name="warn" :size="16" />{{ error }}</div>

      <div class="timeline" v-if="steps.length">
        <div v-for="(s, i) in steps" :key="i" :class="['tl-item', { live: running && i === steps.length - 1 }]">{{ s }}</div>
      </div>
    </section>

    <section class="pane right scroll">
      <div v-if="running && !current" class="empty">
        <Mascot mood="busy" :size="240" />
        <p>NovelAI 正在画<span class="dots"><i></i><i></i><i></i></span></p>
      </div>
      <div v-else-if="!current && !gallery.length" class="empty">
        <Mascot :mood="hasToken ? 'chill' : 'confused'" :size="230" />
        <p v-if="hasToken">把 AI 优化好的提示词带过来，点「生成」就能直接看到效果。生成的图会保存在本机图库，可以预览、下载，也能读回图里的提示词。</p>
        <p v-else>要先在「设置 / 数据」里填写 NovelAI 的 Persistent API Token 才能出图哦</p>
        <button v-if="!hasToken" class="btn primary" @click="state.tab = 'settings'"><Icon name="sliders" :size="16" />去设置</button>
      </div>

      <template v-else>
        <div v-if="last && (last.stopped || last.anlasDelta)" :class="['cheer', { warn: last.stopped || (last.anlasDelta ?? 0) < 0 }]">
          <Mascot :mood="last.stopped ? 'confused' : 'wink'" :size="64" />
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
              <button class="icon-btn sm" title="读回提示词到左侧" @click="loadFromImage(current)"><Icon name="paste" :size="15" /></button>
              <button class="icon-btn sm" title="画面推测" @click="toPreview(current)"><Icon name="eye" :size="15" /></button>
              <button class="icon-btn sm" title="复制图片" @click="copyImage(current)"><Icon name="copy" :size="15" /></button>
              <button class="icon-btn sm" title="在文件夹中显示" @click="reveal(current)"><Icon name="book" :size="15" /></button>
              <button class="btn small primary" @click="saveAs(current)"><Icon name="download" :size="14" />下载</button>
            </div>
          </div>
          <div class="viewer-stage" @click="lightbox = true">
            <img :src="current.url" :key="current.url" alt="生成结果" draggable="false" />
            <div v-if="running" class="viewer-busy"><Icon name="image" :size="16" class="spin-slow" />下一张生成中…</div>
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
