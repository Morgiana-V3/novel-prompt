<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { NaiFreeCheck, NaiGenParams, NaiGenResult, NaiImage, NaiNoiseSchedule, NaiSampler, NaiSubscription } from '@shared/types'
import { state, copy, toast, importPrompt, workKey, cleanErr, DEFAULT_PARAMS, DEFAULT_GEN, GEN_PARAMS_KEY, loadGenParams, type GenOnly } from '../store'
import { resizeWithin } from '../autosize'
import { readPngPrompt, type ImportedPrompt } from '@shared/prompt-import'
import RecipeLibrary from '../components/RecipeLibrary.vue'
import type { NaiGenRequest } from '@shared/types'
import { applyWorkspace, saveSettings } from '../store'
import Icon from '../components/Icon.vue'
import Mascot from '../components/Mascot.vue'
import PromptEditor from '../components/PromptEditor.vue'
import WorkspaceBar from '../components/WorkspaceBar.vue'
import SharedParams from '../components/SharedParams.vue'
import PositionEditor from '../components/PositionEditor.vue'
import InpaintEditor from '../components/InpaintEditor.vue'
import ImageViewer from '../components/ImageViewer.vue'
import ThemeSelect from '../components/ThemeSelect.vue'
import { usePageShortcuts, runKeyLabel, runKeyShort } from '../shortcuts'

const PARAMS_KEY = GEN_PARAMS_KEY
const loadGen = loadGenParams

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
const recipeOpen = ref(false), retentionSaving = ref(false)
const favoriteId = ref('')
const currentRecipe = computed<NaiGenRequest>(() => ({ base: state.prompt, negative: state.negative,
  characters: state.characters.filter(c => c.prompt.trim()).map(c => ({ ...c })),
  version: version.value, params: { ...gen, ...params, seed: gen.seed === null || (gen.seed as unknown) === '' ? null : Number(gen.seed) } }))
const galleryFilter = ref('all')
const visibleGallery = computed(() => gallery.value.filter(g => galleryFilter.value === 'all' || g.storage === galleryFilter.value))
const galleryHint = computed(() => ({ all: '临时未留存：退出软件后清理；已留存与工作台归档：持续保留。', temporary: '仅临时保存，软件完全退出后清理。满意的图片可点击「留存图片」。', saved: '手动留存或开启自动留存后的图片，退出软件后仍保留。', workspace: '工作台的版本图片，随会话保留。' }[galleryFilter.value]))
async function toggleRetention(event: Event) {
  retentionSaving.value = true
  try { await saveSettings({ naiAutoSave: (event.target as HTMLInputElement).checked }) } catch(e) { toast(cleanErr(e)); (event.target as HTMLInputElement).checked = !!state.settings?.naiAutoSave } finally { retentionSaving.value = false }
}
async function retain(images: NaiImage[]) {
  try { for (const img of images) await window.api.naiRetain(img.name); await refreshGallery(); toast('已留存到图库') } catch(e) { toast(cleanErr(e)) }
}
async function favorite(img: NaiImage) {
  try { favoriteId.value = (await window.api.recipesCreate(img.name)).id; toast('已收藏此图的完整生成配置'); recipeOpen.value = true } catch(e) { toast(cleanErr(e)) }
}
async function applyRecipe(r: NaiGenRequest) {
  try {
    await saveSettings({naiVersion:r.version}); applyWorkspace(r, '加载收藏配置前')
    for (const k of Object.keys(params) as (keyof typeof params)[]) (params as Record<string, unknown>)[k] = r.params[k]
    for (const k of Object.keys(gen) as (keyof GenOnly)[]) (gen as unknown as Record<string, unknown>)[k] = r.params[k]
    recipeOpen.value = false; toast('配置已加载，可调整后生成')
  } catch(e) { toast(cleanErr(e)) }
}
const current = computed({
  get: () => state.currentImage,
  set: (image: NaiImage | null) => { state.currentImage = image }
})
const latestBatchTemporary = computed(() => {
  if (!current.value || !last.value?.images.some(i => i.name === current.value!.name)) return []
  const names = new Set(last.value.images.map(i => i.name))
  return gallery.value.filter(g => names.has(g.name) && g.storage === 'temporary')
})
const lightbox = ref(false)
const posEditing = ref(false)
const inpaintSource = ref<NaiImage | null>(null)
const inpaintBusy = ref(false)
function prepareUpdate(): void {
  if (running.value || inpaintSource.value || posEditing.value) throw new Error('请先完成生图或关闭局部重绘、角色位置编辑器，再重启更新')
}
defineExpose({ prepareUpdate })

async function onInpaintGenerated(response: NaiGenResult) {
  last.value = response
  if (response.subscription) sub.value = response.subscription
  if (response.images.length) current.value = response.images[response.images.length - 1]
  try { await refreshGallery() } catch (e) { toast(`结果已保存，图库刷新失败：${cleanErr(e)}`) }
}

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
  if (current.value) current.value = gallery.value.find(g => g.name === current.value!.name) ?? null
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

let offGallery: (() => void) | undefined
onMounted(() => {
  offGallery = window.api.onGalleryChanged(() => { void refreshGallery().catch(e => toast(cleanErr(e))) })
  window.api.onNaiStep('generate', (s) => {
    if (running.value) steps.value.push(s)
  })
  window.addEventListener('resize', resizeAll)
  refreshGallery()
})
onBeforeUnmount(() => {
  offGallery?.()
  window.removeEventListener('resize', resizeAll)
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
  if (running.value || inpaintBusy.value) return
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

usePageShortcuts('generate', { run, cancel, canCancel: () => running.value && !cancelling.value })

/* ---------- 图片操作 ---------- */
async function saveAs(img: NaiImage) {
  if (await window.api.naiSaveAs(img.name)) toast('已保存')
}
async function copyImage(img: NaiImage) {
  if (await window.api.naiCopyImage(img.name)) toast('图片已复制')
}
/** 删除需要在 3 秒内再点一次确认，避免和旁边的「下载」误触 */
const pendingDelete = ref<string | null>(null)
let pendingTimer: ReturnType<typeof setTimeout> | undefined
async function remove(img: NaiImage) {
  if (pendingDelete.value !== img.name) {
    pendingDelete.value = img.name
    clearTimeout(pendingTimer)
    pendingTimer = setTimeout(() => (pendingDelete.value = null), 3000)
    return
  }
  clearTimeout(pendingTimer)
  pendingDelete.value = null
  try {
    if (!(await window.api.naiDelete(img.name))) return
    toast('已移到回收站')
    if (current.value?.name === img.name) current.value = null
    await refreshGallery()
  } catch (e) { toast(cleanErr(e)) }
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
    const recipe = await window.api.naiRecipe(img.name)
    if (recipe) return { base: recipe.request.base, negative: recipe.request.negative, characters: recipe.request.characters,
      width: recipe.request.params.width, height: recipe.request.params.height, structured: true, fromMetadata: true }
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

const galleryIndex = computed(() => visibleGallery.value.findIndex(g => g.name === current.value?.name))
function changeImage(delta: number) {
  const next = visibleGallery.value[galleryIndex.value + delta]
  if (next) current.value = next
}

const fmtTime = (t: number) => new Date(t).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const fmtHours = (s?: number) => (s === undefined ? '' : s >= 3600 ? `${(s / 3600).toFixed(1)} 小时` : `${Math.ceil(s / 60)} 分钟`)
const RISK_CLS = { high: 'bad', medium: 'alias', low: '' } as const
const RISK_TEXT = { high: '高', medium: '中', low: '低' } as const
</script>

<template>
  <div class="view generate">
    <section class="pane left with-foot">
      <div class="pane-body scroll" ref="leftPane">
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
          <button class="btn ghost small ml-auto" @click="recipeOpen = true">配置收藏</button>
          <button class="btn ghost small" :disabled="isDefault" title="步数、Guidance、采样器、画幅等全部恢复默认" @click="resetDefaults">
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
              <ThemeSelect class="sm" v-model="gen.sampler" :options="SAMPLERS.map(s => ({ value: s.v, label: s.label }))" aria-label="采样器" />
            </div>
            <div class="param">
              <span class="side-label">噪声调度</span>
              <ThemeSelect class="sm" v-model="gen.noiseSchedule" :options="SCHEDULES.map(s => ({ value: s, label: s }))" aria-label="噪声调度" />
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

        <div class="timeline" v-if="steps.length">
          <div v-for="(s, i) in steps" :key="i" :class="['tl-item', { live: running && i === steps.length - 1 }]">{{ s }}</div>
        </div>
      </div>

      <footer class="pane-foot">
        <div v-if="error" class="error-box"><Icon name="warn" :size="16" />{{ error }}</div>
        <div class="row run-bar">
          <label class="retention-toggle" title="自动留存普通生图，开关从下一批生效。关闭时，临时图在软件完全退出后清理；后台任务或 Agent 连接期间仍保留。工作台图片始终归档。">
            <input type="checkbox" :checked="!!state.settings?.naiAutoSave" :disabled="retentionSaving" @change="toggleRetention">
            自动留存
          </label>
          <div class="run-actions">
            <button v-if="running" class="btn ghost" :disabled="cancelling" title="当前这张完成后停止（Esc）" @click="cancel">{{ cancelling ? '即将停止' : '停止' }}</button>
            <button class="btn accent" :disabled="running || inpaintBusy" :title="`生成（${runKeyLabel}）`" @click="run">
              <Icon name="image" :size="17" :class="{ 'spin-slow': running }" />
              {{ running ? '正在生成' : gen.count > 1 ? `生成 ${gen.count} 张` : '生成' }}<span v-if="!running" class="kbd">{{ runKeyShort }}</span>
            </button>
          </div>
        </div>
      </footer>
    </section>

    <section class="pane right scroll">
      <div v-if="running && !current" class="empty">
        <Mascot mood="paint" :size="240" />
        <p>NovelAI 正在画<span class="dots"><i></i><i></i><i></i></span></p>
      </div>
      <div v-else-if="!current && !gallery.length" class="empty">
        <Mascot :mood="hasToken ? 'idle' : 'key'" :size="230" />
        <p v-if="hasToken">生图用的是「当前提示词」，和 AI 优化、画面推测是同一份。点「生成」就能直接看到效果，图片默认临时保存，满意后可留存到图库，或开启自动留存。</p>
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
            <span class="pill">{{ current.storage === 'temporary' ? '临时' : current.storage === 'workspace' ? '工作台存档' : '已留存' }}</span><h3>{{ current.width && current.height ? `${current.width}×${current.height}` : '图片' }}</h3>
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
          <div v-if="current.storage === 'temporary'" class="row" style="padding:10px 12px"><span class="muted small">满意这张？留存后下次启动仍可查看。</span><button class="btn small primary" @click="retain([current])">留存图片</button><button v-if="latestBatchTemporary.length" class="btn small" @click="retain(latestBatchTemporary)">留存最近一批剩余 {{ latestBatchTemporary.length }} 张</button></div>
          <div class="row" style="padding: 10px 12px; flex-wrap: wrap">
            <button class="btn small" @click="favorite(current)">收藏此图配置</button>
            <button class="btn small accent" :disabled="running || inpaintBusy" @click="inpaintSource = current">
              <Icon name="edit" :size="14" />局部重绘
            </button>
            <button class="btn ghost small" :disabled="!state.characters.length" :title="state.characters.length ? '以当前图片为底图，调整角色提示词的位置' : '先添加角色提示词，再对照图片定位'" @click="state.positionReference.visible = true; posEditing = true">
              <Icon name="frame" :size="14" />对照图片定位
            </button>
            <button class="btn ghost small ml-auto" :disabled="running || inpaintBusy" title="以这张图片新建 AI 会话" @click="state.workspaceImage = { ...current }; state.tab = 'workspace'">
              <Icon name="chat" :size="14" />用于新会话
            </button>
          </div>
        </div>

        <div class="result-card" v-if="matchedPreview" style="--d: 60ms">
          <div class="result-head">
            <span class="group-badge pink"><Icon name="eye" :size="14" /></span>
            <h3>推测 vs 实际</h3>
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
            <h3>图片</h3><ThemeSelect v-model="galleryFilter" :options="[{value:'all',label:'全部'},{value:'temporary',label:'临时未留存'},{value:'saved',label:'已留存'},{value:'workspace',label:'工作台归档'}]" aria-label="图库筛选" />
            <span class="group-count">{{ visibleGallery.length }}</span>
            <button class="btn ghost small ml-auto" @click="openFolder"><Icon name="book" :size="14" />打开文件夹</button>
          </div>
          <p class="muted small">{{ galleryHint }}</p>
          <div class="gallery">
            <div
              v-for="(g, i) in visibleGallery"
              :key="g.name"
              :class="['thumb', { on: current?.name === g.name }]"
              :style="{ '--i': Math.min(i, 20) }"
              :title="fmtTime(g.createdAt)"
              @click="current = g"
            >
              <img :src="g.url" loading="lazy" alt="" draggable="false" />
              <div class="thumb-actions">
                <button class="icon-btn sm" title="下载" aria-label="下载" @click.stop="saveAs(g)"><Icon name="download" :size="14" /></button>
                <button v-if="pendingDelete === g.name" class="btn small danger-confirm" title="再点一次移到回收站" aria-label="确认删除" @click.stop="remove(g)">确认删除</button>
                <button v-else-if="g.storage !== 'workspace'" class="icon-btn sm" title="删除（移到回收站）" aria-label="删除" @click.stop="remove(g)"><Icon name="trash" :size="14" /></button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </section>

    <RecipeLibrary v-if="recipeOpen" :current-request="currentRecipe" :initial-id="favoriteId" @close="recipeOpen=false;favoriteId=''" @apply="applyRecipe" />
    <ImageViewer v-if="lightbox && current" :image="current" :can-previous="galleryIndex > 0" :can-next="galleryIndex >= 0 && galleryIndex < visibleGallery.length - 1"
      @close="lightbox = false" @previous="changeImage(-1)" @next="changeImage(1)" />
    <PositionEditor v-if="posEditing" @close="posEditing = false" />
    <InpaintEditor v-if="inpaintSource" :image="inpaintSource" :params="{ ...gen, ...params }"
      @close="inpaintSource = null" @busy="inpaintBusy = $event" @generated="onInpaintGenerated" />
  </div>
</template>

<style scoped>
.retention-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text2); white-space: nowrap; cursor: pointer; }
.retention-toggle input { margin: 0; accent-color: var(--pink); }
</style>
