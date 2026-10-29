<script setup lang="ts">
import GenerationResult from './GenerationResult.vue'
import { useGallery } from './use-gallery'

import { reportError } from '../../shared/lib/notifications'
import { promptState } from '../prompts/state'
import { imageState } from './state'
import { artistTrials, runArtistTrials, type ArtistTrial } from './artist-trials'
import ArtistTrialQueue from './components/ArtistTrialQueue.vue'
import { activeTask } from '../../shared/state/tasks'
import { settingsState } from '../settings/state'
import { shellState } from '../../shared/state/shell'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  NaiFreeCheck,
  NaiGenParams,
  NaiGenResult,
  NaiSubscription,
} from '@shared/generation/types'
import type { NaiImage } from '@shared/images/types'
import { toast } from '../../shared/lib/notifications'
import { importImagePrompt, importGenerationRequest, workKey } from '../prompts/actions'
import { cleanErr } from '../../shared/lib/format'
import { DEFAULT_PARAMS } from '../prompts/state'
import { DEFAULT_GEN, generationParams } from './state'
import { resizeWithin } from '../../shared/lib/autosize'
import { readPngPrompt } from '../prompts/png-import'
import { type ImportedPrompt } from '@shared/prompts/import'
import RecipeLibrary from './components/RecipeLibrary.vue'
import type { NaiGenRequest } from '@shared/generation/types'
import { saveSettings } from '../settings/state'
import Icon from '../../shared/ui/Icon.vue'
import Mascot from '../../shared/ui/Mascot.vue'
import PromptEditor from '../prompts/components/PromptEditor.vue'
import WorkspaceBar from '../prompts/components/WorkspaceBar.vue'
import GenerationParameters from './components/GenerationParameters.vue'
import PositionEditor from '../prompts/components/PositionEditor.vue'
import InpaintEditor from '../inpaint/components/InpaintEditor.vue'
import ImageViewer from '../../shared/ui/ImageViewer.vue'
import ThemeSelect from '../../shared/ui/ThemeSelect.vue'
import { usePageShortcuts, runKeyLabel, runKeyShort } from '../../shared/lib/shortcuts'

const gen = generationParams
const params = promptState.params

/** 种子留空即默认，不参与比较 */
const GEN_KEYS = ['steps', 'scale', 'cfgRescale', 'sampler', 'noiseSchedule', 'count'] as const
const isDefault = computed(
  () =>
    GEN_KEYS.every((field) => gen[field] === DEFAULT_GEN[field]) &&
    (gen.seed === null || (gen.seed as unknown) === '') &&
    (Object.keys(DEFAULT_PARAMS) as (keyof typeof DEFAULT_PARAMS)[]).every(
      (field) => params[field] === DEFAULT_PARAMS[field],
    ),
)
function resetDefaults() {
  Object.assign(gen, DEFAULT_GEN)
  Object.assign(params, DEFAULT_PARAMS)
  toast('已恢复默认参数')
}

/** 高级设置（默认收起）：不常改的参数，收起时在标题上显示当前值 */
const hasToken = computed(() => !!settingsState.settings?.naiToken?.trim())
const freeOnly = computed(() => settingsState.settings?.naiFreeOnly !== false)
const version = computed(() => settingsState.settings?.naiVersion ?? 'v4.5')

const sub = ref<NaiSubscription | null>(null)
const subError = ref('')
const subLoading = ref(false)
const check = ref<NaiFreeCheck | null>(null)

const running = ref(false)
watch(
  running,
  (value) => {
    imageState.generating = value
  },
  { flush: 'sync' },
)
const pendingTrials = computed(() =>
  artistTrials.trials.filter((trial) => trial.selected && trial.state === 'pending'),
)
const cancelling = ref(false)
const steps = ref<string[]>([])
const error = ref('')
const last = ref<NaiGenResult | null>(null)
const {
  gallery,
  current,
  galleryFilter,
  visibleGallery,
  galleryHint,
  latestBatchTemporary,
  refreshGallery,
  pendingDelete,
  deleting,
  remove,
  changeImage,
  galleryIndex,
  saveAs,
  copyImage,
  reveal,
  openFolder,
  retain,
  lightbox,
} = useGallery(last)
const sortTrialsByScore = ref(false)
const completedTrials = computed(() => {
  const trials = artistTrials.trials.filter(
    (trial) => trial.image && gallery.value.some((image) => image.name === trial.image!.name),
  )
  return sortTrialsByScore.value ? trials.sort((a, b) => (b.score ?? -2) - (a.score ?? -2)) : trials
})
const currentTrial = computed(() =>
  artistTrials.trials.find((trial) => trial.image?.name === current.value?.name),
)
const referenceOpen = ref(false)
function showTrial(trial: ArtistTrial) {
  current.value = gallery.value.find((image) => image.name === trial.image?.name) ?? null
}
watch(
  () => artistTrials.trials,
  () => {
    error.value = ''
    last.value = null
    current.value = null
  },
)

const recipeOpen = ref(false)
const retentionSaving = ref(false)
const favoriteId = ref('')
const currentRecipe = computed<NaiGenRequest>(() => ({
  base: promptState.prompt,
  negative: promptState.negative,
  characters: promptState.characters
    .filter((character) => character.prompt.trim())
    .map((character) => ({ ...character })),
  version: version.value,
  params: {
    ...gen,
    ...params,
    seed: gen.seed === null || (gen.seed as unknown) === '' ? null : Number(gen.seed),
  },
}))
async function toggleRetention(event: Event) {
  retentionSaving.value = true
  try {
    await saveSettings({ naiAutoSave: (event.target as HTMLInputElement).checked })
  } catch (error2) {
    toast(cleanErr(error2))
    ;(event.target as HTMLInputElement).checked = !!settingsState.settings?.naiAutoSave
  } finally {
    retentionSaving.value = false
  }
}
async function favorite(img: NaiImage) {
  try {
    if (
      artistTrials.trials.some((trial) => trial.image?.name === img.name) &&
      img.storage === 'temporary'
    ) {
      await window.api.naiRetain(img.name)
      await refreshGallery()
    }
    favoriteId.value = (await window.api.recipesCreate(img.name)).id
    toast('已收藏此图的完整生成配置')
    recipeOpen.value = true
  } catch (error2) {
    toast(cleanErr(error2))
  }
}
async function applyRecipe(request: NaiGenRequest) {
  if (running.value) {
    return
  }
  try {
    rememberTrialDraft()
    await importGenerationRequest(request, '已加载收藏配置')
    artistTrials.active = false
    recipeOpen.value = false
  } catch (error2) {
    toast(cleanErr(error2))
  }
}
const posEditing = ref(false)
const inpaintSource = ref<NaiImage | null>(null)
const inpaintBusy = ref(false)
function prepareUpdate(): void {
  if (running.value || inpaintSource.value || posEditing.value) {
    throw new Error('请先完成生图或关闭局部重绘、角色位置编辑器，再重启更新')
  }
}
defineExpose({ prepareUpdate })

async function onInpaintGenerated(response: NaiGenResult) {
  last.value = response
  if (response.subscription) {
    sub.value = response.subscription
  }
  if (response.images.length) {
    current.value = response.images[response.images.length - 1]
  }
  try {
    await refreshGallery()
  } catch (error2) {
    toast(`结果已保存，图库刷新失败：${cleanErr(error2)}`)
  }
}

const leftPane = ref<HTMLElement>()
const resizeAll = () => resizeWithin(leftPane.value)

const anlas = computed(() => {
  const subscription = sub.value
  if (
    !subscription ||
    (subscription.anlasFixed === undefined && subscription.anlasPurchased === undefined)
  ) {
    return undefined
  }
  return (subscription.anlasFixed ?? 0) + (subscription.anlasPurchased ?? 0)
})

/** 当前图片是用最近一次推测过的那套提示词生成的：可以把推测和实际出图放在一起看 */
const matchedPreview = computed(() => {
  const lp = promptState.lastPreview
  if (!lp || !current.value) {
    return null
  }
  return imageState.imageKeys[current.value.name] === lp.key ? lp.result : null
})

async function refreshSub() {
  if (!hasToken.value) {
    return
  }
  subLoading.value = true
  subError.value = ''
  try {
    sub.value = await window.api.naiSubscription()
  } catch (error2) {
    subError.value = cleanErr(error2)
  } finally {
    subLoading.value = false
  }
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
        sub.value ? { ...sub.value } : undefined,
      )
    }, 150)
  },
  { immediate: true },
)

onMounted(() => {
  window.api.onNaiStep('generate', (text) => {
    if (running.value) {
      steps.value.push(text)
    }
  })
  window.addEventListener('resize', resizeAll)
})
onBeforeUnmount(() => {
  artistTrials.stopRequested = true
  window.removeEventListener('resize', resizeAll)
})

watch(
  () => shellState.tab,
  async (tab) => {
    if (tab !== 'generate') {
      return
    }
    await nextTick()
    resizeAll()
    if (hasToken.value && !sub.value && !subLoading.value) {
      refreshSub().catch(reportError)
    }
  },
)
watch(
  () => promptState.characters.length,
  () => nextTick(resizeAll),
)
watch(hasToken, (value) => {
  if (value && shellState.tab === 'generate') {
    refreshSub().catch(reportError)
  }
  if (!value) {
    sub.value = null
  }
})

/* ---------- 生成 ---------- */

async function run() {
  if (running.value || inpaintBusy.value) {
    return
  }
  if (!hasToken.value) {
    error.value = '请先在「设置 / 数据」中填写 NovelAI API Token'
    return
  }
  if (activeTask('generate') || activeTask('inpaint') || activeTask('page-generate')) {
    error.value = '请等待当前生图任务完成'
    return
  }
  if (
    !promptState.prompt.trim() &&
    !promptState.characters.some((character) => character.prompt.trim())
  ) {
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
    if (artistTrials.active) {
      const trialSeed = seed ?? crypto.getRandomValues(new Uint32Array(1))[0]
      gen.seed = trialSeed
      await runArtistTrials(
        {
          ...currentRecipe.value,
          params: { ...currentRecipe.value.params, seed: trialSeed, count: 1 },
        },
        async (result) => {
          last.value = result
          if (result.subscription) {
            sub.value = result.subscription
          }
          current.value = result.images[result.images.length - 1]
          try {
            await refreshGallery()
          } catch (e) {
            toast(`图片已生成，图库刷新失败：${cleanErr(e)}`)
          }
        },
      )
      return
    }
    const generationResult = await window.api.naiGenerate({
      base: promptState.prompt,
      negative: promptState.negative,
      characters: promptState.characters
        .filter((character) => character.prompt.trim())
        .map((character) => ({ ...character })),
      params: { ...gen, ...params, seed },
      version: version.value,
    })
    last.value = generationResult
    for (const img of generationResult.images) {
      imageState.imageKeys[img.name] = key
    }
    if (generationResult.subscription) {
      sub.value = generationResult.subscription
    }
    if (generationResult.images.length) {
      current.value = generationResult.images[generationResult.images.length - 1]
    }
    if (generationResult.stopped && !generationResult.images.length) {
      error.value = generationResult.stopped
    }
    await refreshGallery()
  } catch (error2) {
    error.value = cleanErr(error2)
    refreshSub().catch(reportError)
  } finally {
    running.value = false
  }
}

async function cancel() {
  cancelling.value = true
  artistTrials.stopRequested = true
  await window.api.naiCancel()
  toast('会在当前这张完成后停止')
}

usePageShortcuts('generate', { run, cancel, canCancel: () => running.value && !cancelling.value })
function useSeed(img: NaiImage) {
  if (img.seed === undefined) {
    return
  }
  gen.seed = img.seed
  gen.count = 1
  toast(`种子已固定为 ${img.seed}`)
}

async function readMeta(img: NaiImage): Promise<ImportedPrompt | null> {
  try {
    const recipe = await window.api.naiRecipe(img.name)
    if (recipe) {
      return {
        request: recipe.request,
        base: recipe.request.base,
        negative: recipe.request.negative,
        characters: recipe.request.characters,
        width: recipe.request.params.width,
        height: recipe.request.params.height,
        structured: true,
        fromMetadata: true,
      }
    }
    const bytes = await window.api.naiReadImage(img.name)
    return await readPngPrompt(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
  } catch (error2) {
    toast(cleanErr(error2) || '读取图片信息失败')
    return null
  }
}
/** 图片里存的是实际发送的提示词（已含质量词和 UC 预设），导入时会自动关掉这两项避免重复 */
async function loadFromImage(img: NaiImage) {
  if (running.value) {
    return
  }
  const importedPrompt = await readMeta(img)
  if (importedPrompt) {
    try {
      rememberTrialDraft()
      await importImagePrompt(importedPrompt, '已加载原图')
      artistTrials.active = false
    } catch (error) {
      reportError(error)
    }
  }
}
async function previewImage(img: NaiImage) {
  if (running.value) {
    return
  }
  const importedPrompt = await readMeta(img)
  if (!importedPrompt) {
    return
  }
  try {
    rememberTrialDraft()
    await importImagePrompt(importedPrompt, '已加载原图')
    artistTrials.active = false
    shellState.tab = 'preview'
  } catch (error) {
    reportError(error)
  }
}

const fmtTime = (t: number) =>
  new Date(t).toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
const fmtHours = (seconds?: number) => {
  if (seconds === undefined) {
    return '' as const
  }
  if (seconds >= 3600) {
    return `${(seconds / 3600).toFixed(1)} 小时`
  }
  return `${Math.ceil(seconds / 60)} 分钟`
}
const RISK_CLS = { high: 'bad', medium: 'alias', low: '' } as const
const RISK_TEXT = { high: '高', medium: '中', low: '低' } as const
function updateGenerationOptions(patch: Partial<typeof gen>) {
  Object.assign(gen, patch)
}
function updatePromptParameters(patch: Partial<typeof params>) {
  Object.assign(params, patch)
}
function editImagePositions() {
  imageState.positionReference.visible = true
  posEditing.value = true
}
function openImageWorkspace() {
  if (!current.value) {
    return
  }
  imageState.workspaceImage = { ...current.value }
  shellState.tab = 'workspace'
}
function closeRecipes() {
  recipeOpen.value = false
  favoriteId.value = ''
}
function rememberTrialDraft() {
  if (artistTrials.active) {
    artistTrials.draft = JSON.parse(JSON.stringify(currentRecipe.value))
  }
}
function leaveTrials() {
  if (running.value) {
    return
  }
  rememberTrialDraft()
  artistTrials.active = false
}
async function resumeTrials() {
  if (running.value || inpaintBusy.value || !artistTrials.draft) {
    return
  }
  try {
    await importGenerationRequest(artistTrials.draft, '已恢复试图内容')
    artistTrials.active = true
  } catch (e) {
    error.value = cleanErr(e)
  }
}
</script>

<template>
  <div class="view generate">
    <section class="pane left with-foot">
      <div
        ref="leftPane"
        class="pane-body scroll"
      >
        <div :class="['import-zone quota', { warn: freeOnly && check && !check.ok }]">
          <span class="group-badge pink"
            ><Icon
              name="key"
              :size="16"
          /></span>
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
                {{
                  sub.active
                    ? sub.tier === 3
                      ? 'Opus 会员'
                      : `会员等级 ${sub.tier ?? '未知'}`
                    : '没有有效订阅'
                }}
                <span class="quota-sep">·</span>Anlas
                {{ anlas !== undefined ? anlas.toLocaleString() : '未知' }}
              </b>
              <span>
                <template v-if="sub.usagePercent !== undefined">
                  V5 免费额度约 {{ sub.usagePercent }}%{{ sub.usageNegative ? '（负值）' : '' }}
                  <template v-if="sub.usageNextSeconds">
                    · {{ fmtHours(sub.usageNextSeconds) }}后恢复 1%</template
                  >
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
            <button
              v-if="!hasToken"
              class="btn small primary"
              @click="shellState.tab = 'settings'"
            >
              <Icon
                name="sliders"
                :size="14"
              />去设置
            </button>
            <button
              v-else
              class="icon-btn"
              title="刷新余额"
              @click="refreshSub"
            >
              <Icon
                name="swap"
                :class="{ spin: subLoading }"
              />
            </button>
          </div>
        </div>

        <ArtistTrialQueue
          v-if="artistTrials.active"
          :disabled="running || inpaintBusy"
          @leave="leaveTrials"
        />
        <template v-else>
          <button
            v-if="artistTrials.trials.length"
            class="btn small"
            :disabled="running || inpaintBusy"
            @click="resumeTrials"
          >
            查看画师试图
          </button>
          <WorkspaceBar />
        </template>

        <PromptEditor
          :disabled="running"
          :base-label="artistTrials.active ? '基础提示词（不含画师串）' : undefined"
          char-hint="点「编辑位置」可在画布上拖动角色"
        />

        <div class="field-head gen-params-head">
          <label class="field-label">生成参数</label>
          <button
            class="btn ghost small ml-auto"
            @click="recipeOpen = true"
          >
            配置收藏
          </button>
          <button
            class="btn ghost small"
            :disabled="running || isDefault"
            title="步数、Guidance、采样器、画幅等全部恢复默认"
            @click="resetDefaults"
          >
            <Icon
              name="reset"
              :size="14"
            />恢复默认
          </button>
        </div>
        <GenerationParameters
          :gen="gen"
          :params="params"
          :disabled="running"
          :hide-count="artistTrials.active"
          @change-gen="updateGenerationOptions"
          @change-params="updatePromptParameters"
        />

        <div
          v-if="hasToken && check"
          :class="['free-check', check.ok ? 'ok' : freeOnly ? 'bad' : 'warn']"
        >
          <Icon
            :name="check.ok ? 'check' : 'warn'"
            :size="15"
            :stroke="check.ok ? 2.2 : 1.8"
          />
          <div>
            <b>{{
              check.ok
                ? '满足免费生成条件'
                : freeOnly
                  ? '不满足免费条件，不会提交'
                  : '可能会消耗 Anlas'
            }}</b>
            <div
              v-for="r in check.reasons"
              :key="r"
            >
              {{ r }}
            </div>
            <div
              v-if="check.ok"
              class="muted"
            >
              {{ check.notes[0] }}
            </div>
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
          <label
            class="retention-toggle"
            title="自动留存普通生图，开关从下一批生效。关闭时，临时图在软件完全退出后清理；后台任务或 Agent 连接期间仍保留。工作台图片始终归档。"
          >
            <input
              type="checkbox"
              :checked="!!settingsState.settings?.naiAutoSave"
              :disabled="retentionSaving"
              @change="toggleRetention"
            />
            自动留存
          </label>
          <div class="run-actions">
            <button
              v-if="running"
              class="btn ghost"
              :disabled="cancelling"
              title="当前这张完成后停止（Esc）"
              @click="cancel"
            >
              {{ cancelling ? '即将停止' : '停止' }}
            </button>
            <button
              class="btn accent"
              :disabled="running || inpaintBusy || (artistTrials.active && !pendingTrials.length)"
              :title="`生成（${runKeyLabel}）`"
              @click="run"
            >
              <Icon
                name="image"
                :size="17"
                :class="{ 'spin-slow': running }"
              />
              {{
                running
                  ? '正在生成'
                  : artistTrials.active
                    ? `生成所选 ${pendingTrials.length} 张`
                    : gen.count > 1
                      ? `生成 ${gen.count} 张`
                      : '生成'
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
        v-if="artistTrials.active && completedTrials.length"
        class="trial-results-head"
      >
        <strong>试图结果</strong>
        <label
          ><input
            v-model="sortTrialsByScore"
            type="checkbox"
          />按评分排序</label
        >
      </div>
      <div
        v-if="artistTrials.active"
        class="trial-results"
      >
        <button
          v-if="artistTrials.referenceUrl"
          class="trial-reference"
          @click="referenceOpen = !referenceOpen"
        >
          <img
            :src="artistTrials.referenceUrl"
            alt="试图参考图"
          />
          <span>{{ referenceOpen ? '收起参考图' : '查看参考图' }}</span>
        </button>
        <button
          v-for="trial in completedTrials"
          :key="trial.id"
          class="trial-image"
          :class="{ selected: current?.name === trial.image?.name }"
          :aria-label="`查看方案 ${trial.id}`"
          @click="showTrial(trial)"
        >
          <img
            :src="trial.image!.url"
            :alt="`方案 ${trial.id}`"
          />
          <span
            >{{ trial.id
            }}<template v-if="trial.score !== undefined">
              · {{ trial.score.toFixed(3) }}</template
            ></span
          >
        </button>
      </div>
      <img
        v-if="artistTrials.active && referenceOpen"
        class="trial-reference-expanded"
        :src="artistTrials.referenceUrl"
        alt="试图参考图"
      />
      <p
        v-if="artistTrials.active && currentTrial"
        class="trial-current-label"
      >
        方案 {{ currentTrial.id
        }}<span v-if="currentTrial.score !== undefined">
          · 风格评分 {{ currentTrial.score.toFixed(3) }}</span
        ><span v-if="currentTrial.error"> · {{ currentTrial.error }}</span>
      </p>
      <div
        v-if="running && !current"
        class="empty"
      >
        <Mascot
          mood="paint"
          :size="240"
        />
        <p>
          NovelAI 正在画<span class="dots"><i></i><i></i><i></i></span>
        </p>
      </div>
      <div
        v-else-if="artistTrials.active && !current"
        class="empty trial-empty"
      >
        <p>已载入 {{ artistTrials.trials.length }} 个组合，点击生成开始试图。</p>
      </div>
      <div
        v-else-if="!current && !gallery.length"
        class="empty"
      >
        <Mascot
          :mood="hasToken ? 'idle' : 'key'"
          :size="230"
        />
        <p v-if="hasToken">
          生图用的是「当前提示词」，和 AI
          优化、画面推测是同一份。点「生成」就能直接看到效果，图片默认临时保存，满意后可留存到图库，或开启自动留存。
        </p>
        <p v-else>要先在「设置 / 数据」里填写 NovelAI 的 Persistent API Token 才能出图哦</p>
        <button
          v-if="!hasToken"
          class="btn primary"
          @click="shellState.tab = 'settings'"
        >
          <Icon
            name="sliders"
            :size="16"
          />去设置
        </button>
      </div>

      <template v-else>
        <div
          v-if="last && (last.stopped || last.anlasDelta)"
          :class="['cheer', { warn: last.stopped || (last.anlasDelta ?? 0) < 0 }]"
        >
          <Mascot
            :mood="last.stopped ? 'oops' : 'thumbs'"
            :size="64"
          />
          <div>
            <b>{{ last.stopped ?? '生成完成' }}</b>
            <div class="muted small">
              本次完成 {{ last.images.length }} 张 ·
              {{
                last.anlasDelta === undefined
                  ? 'Anlas 变化未知'
                  : last.anlasDelta < 0
                    ? `消耗了 ${-last.anlasDelta} Anlas`
                    : '没有消耗 Anlas'
              }}
            </div>
          </div>
        </div>

        <GenerationResult
          v-if="current"
          :current="current"
          :running="running"
          :inpaint-busy="inpaintBusy"
          :has-characters="!!promptState.characters.length"
          :latest-batch-temporary="latestBatchTemporary"
          :pending-delete="pendingDelete"
          :deleting="deleting"
          @seed="useSeed"
          @load-prompt="loadFromImage"
          @preview="previewImage"
          @copy-image="copyImage"
          @reveal="reveal"
          @save="saveAs"
          @lightbox="lightbox = true"
          @retain="retain"
          @favorite="favorite"
          @remove="remove"
          @inpaint="inpaintSource = $event"
          @positions="editImagePositions"
          @workspace="openImageWorkspace"
        />

        <p
          v-if="current?.storage === 'workspace'"
          class="muted small gallery-delete-note"
        >
          工作台引用中，请进入对应项目清理图片；已删除项目的图片可在 AI 工作台首页「清理遗留图片」。
        </p>

        <div
          v-if="matchedPreview"
          class="result-card"
          style="--d: 60ms"
        >
          <div class="result-head">
            <span class="group-badge pink"
              ><Icon
                name="eye"
                :size="14"
            /></span>
            <h3>推测 vs 实际</h3>
            <button
              class="btn ghost small ml-auto"
              @click="shellState.tab = 'preview'"
            >
              完整推测
            </button>
          </div>
          <div class="notes">{{ matchedPreview.summary }}</div>
          <div
            v-if="matchedPreview.risks.length"
            class="effect-list"
          >
            <div
              v-for="(risk, index) in matchedPreview.risks"
              :key="index"
              class="effect-row"
              :style="{ '--i': index }"
            >
              <span :class="['pill', RISK_CLS[risk.level]]">{{ RISK_TEXT[risk.level] }}</span>
              <span class="grow">{{ risk.text }}</span>
            </div>
          </div>
        </div>

        <div
          v-if="gallery.length && !artistTrials.active"
          class="group"
        >
          <div class="group-head">
            <span class="group-badge nl"
              ><Icon
                name="image"
                :size="14"
            /></span>
            <h3>图片</h3>
            <ThemeSelect
              v-model="galleryFilter"
              :options="[
                { value: 'all', label: '全部' },
                { value: 'temporary', label: '临时未留存' },
                { value: 'saved', label: '已留存' },
                { value: 'workspace', label: '工作台归档' },
              ]"
              aria-label="图库筛选"
            />
            <span class="group-count">{{ visibleGallery.length }}</span>
            <button
              class="btn ghost small ml-auto"
              @click="openFolder"
            >
              <Icon
                name="book"
                :size="14"
              />打开文件夹
            </button>
          </div>
          <p class="muted small">{{ galleryHint }}</p>
          <div class="gallery">
            <div
              v-for="(image, index) in visibleGallery"
              :key="image.name"
              :class="['thumb', { on: current?.name === image.name }]"
              :style="{ '--i': Math.min(index, 20) }"
              :title="fmtTime(image.createdAt)"
              @click="current = image"
            >
              <img
                :src="image.url"
                loading="lazy"
                alt=""
                draggable="false"
              />
              <div class="thumb-actions">
                <button
                  class="icon-btn sm"
                  title="下载"
                  aria-label="下载"
                  @click.stop="saveAs(image)"
                >
                  <Icon
                    name="download"
                    :size="14"
                  />
                </button>
                <button
                  v-if="pendingDelete === image.name"
                  class="btn small danger-confirm"
                  :disabled="!!deleting"
                  title="再点一次移到回收站"
                  aria-label="确认删除"
                  @click.stop="remove(image)"
                >
                  确认删除
                </button>
                <button
                  v-else
                  class="icon-btn sm"
                  :disabled="!!deleting || image.storage === 'workspace'"
                  :title="
                    image.storage === 'workspace'
                      ? '工作台引用中，无法从图库删除'
                      : '删除（移到回收站）'
                  "
                  aria-label="删除"
                  @click.stop="remove(image)"
                >
                  <Icon
                    name="trash"
                    :size="14"
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </section>

    <RecipeLibrary
      v-if="recipeOpen"
      :current-request="currentRecipe"
      :initial-id="favoriteId"
      @close="closeRecipes"
      @apply="applyRecipe"
    />
    <ImageViewer
      v-if="lightbox && current"
      :image="current"
      :can-previous="galleryIndex > 0"
      :can-next="galleryIndex >= 0 && galleryIndex < visibleGallery.length - 1"
      :can-delete="current.storage !== 'workspace'"
      :confirm-delete="pendingDelete === current.name"
      :deleting="!!deleting"
      @close="lightbox = false"
      @previous="changeImage(-1)"
      @next="changeImage(1)"
      @delete="remove(current)"
    />
    <PositionEditor
      v-if="posEditing"
      @close="posEditing = false"
    />
    <InpaintEditor
      v-if="inpaintSource"
      :image="inpaintSource"
      :params="{ ...gen, ...params }"
      @close="inpaintSource = null"
      @busy="inpaintBusy = $event"
      @generated="onInpaintGenerated"
    />
  </div>
</template>

<style scoped>
.trial-results-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  margin-bottom: 8px;
}

.trial-results {
  display: flex;
  align-items: stretch;
  gap: 8px;
  overflow-x: auto;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.trial-reference,
.trial-image {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex: 0 0 82px;
  padding: 5px;
  background: var(--bg);
  color: var(--text2);
  border: 1px solid var(--line);
  border-radius: 8px;
  cursor: pointer;
  font-size: 11px;
}

.trial-image.selected {
  border-color: var(--text);
}

.trial-results img {
  width: 70px;
  height: 76px;
  object-fit: contain;
}

.trial-reference-expanded {
  width: 100%;
  max-height: 55vh;
  object-fit: contain;
  margin-bottom: 12px;
}

.trial-current-label {
  font-size: 12px;
  color: var(--text2);
  overflow-wrap: anywhere;
}

.trial-empty {
  min-height: 160px;
}

.retention-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text2);
  white-space: nowrap;
  cursor: pointer;
}

.retention-toggle input {
  margin: 0;
  accent-color: var(--pink);
}
</style>
