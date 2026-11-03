<script setup lang="ts">
import GenerationResult from './GenerationResult.vue'
import CollectionPicker from '../gallery/CollectionPicker.vue'
import { generationCollection } from '../gallery/collections-state'
import { useGallery } from './use-gallery'

import { reportError } from '../../shared/lib/notifications'
import { promptState } from '../prompts/state'
import { imageState } from './state'
import { refreshSubscription as refreshSub, subscriptionState } from './subscription'
import { activeTask } from '../../shared/state/tasks'
import { settingsState } from '../settings/state'
import { shellState } from '../../shared/state/shell'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { NaiFreeCheck, NaiGenParams, NaiGenResult } from '@shared/generation/types'
import type { NaiImage } from '@shared/images/types'
import { toast } from '../../shared/lib/notifications'
import { importImagePrompt, workKey } from '../prompts/actions'
import { cleanErr } from '../../shared/lib/format'
import { DEFAULT_PARAMS } from '../prompts/state'
import { DEFAULT_GEN, generationParams } from './state'
import { resizeWithin } from '../../shared/lib/autosize'
import { readPngPrompt } from '../prompts/png-import'
import { type ImportedPrompt } from '@shared/prompts/import'
import { rememberFavorite, revealFavorite } from '../favorites/public'
import { FavoriteButton } from '../favorites/public'
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
import { usePagePresentation } from '../../shared/lib/page-presentation'
import { useSettingsPopover } from './use-settings-popover'
const { embedded, navigate, isActive } = usePagePresentation()
const {
  open: parametersOpen,
  dock: settingsDock,
  trigger: parametersTrigger,
} = useSettingsPopover(embedded)
const sentRecipes = ref<Record<string, string>>({})

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

const sub = computed(() => subscriptionState.subscription)
const check = ref<NaiFreeCheck | null>(null)
const checkError = ref('')
const feeStatus = computed(() => {
  if (!hasToken.value) {
    return { text: '未配置', tone: '', hint: '请先配置 NovelAI Token' }
  }
  if (!check.value) {
    return {
      text: checkError.value ? '待确认' : '检查中',
      tone: '',
      hint: checkError.value || '正在检查当前配置的免费资格',
    }
  }
  const paid = freeOnly.value ? '需调整' : '可能扣费'
  return {
    text: check.value.ok ? '预计免费' : paid,
    tone: check.value.ok ? 'ok' : 'bad',
    hint: [...check.value.reasons, ...check.value.notes].join('\n'),
  }
})

const running = ref(false)
watch(
  running,
  (value) => {
    imageState.generating = value
  },
  { flush: 'sync' },
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
const retentionSaving = ref(false)
const savingRecipe = ref(false)
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
/** 无需先出图：把当前提示词与全部生成参数存为一条收藏，在收藏页统一浏览、编辑和载入 */
async function saveRecipe() {
  if (savingRecipe.value) {
    return
  }
  savingRecipe.value = true
  try {
    const item = await window.api.recipesCreateConfig(
      JSON.parse(JSON.stringify(currentRecipe.value)),
    )
    rememberFavorite(item)
    toast('已收藏当前配置', { label: '查看', run: () => revealFavorite(item.id) })
  } catch (error2) {
    toast(`收藏失败：${cleanErr(error2)}`)
  } finally {
    savingRecipe.value = false
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

/** 当前图片是用最近一次推测过的那套提示词生成的：可以把推测和实际出图放在一起看 */
const matchedPreview = computed(() => {
  const lp = promptState.lastPreview
  if (!lp || !current.value) {
    return null
  }
  return imageState.imageKeys[current.value.name] === lp.key ? lp.result : null
})

let checkTimer: ReturnType<typeof setTimeout> | undefined
let checkEpoch = 0
watch(
  () => [params.width, params.height, gen.steps, version.value, sub.value, freeOnly.value],
  () => {
    clearTimeout(checkTimer)
    const epoch = ++checkEpoch
    check.value = null
    checkError.value = ''
    checkTimer = setTimeout(async () => {
      try {
        const result = await window.api.naiFreeCheck(
          { width: params.width, height: params.height, steps: gen.steps } as NaiGenParams,
          version.value,
          sub.value ? { ...sub.value } : undefined,
        )
        if (epoch === checkEpoch) {
          check.value = result
        }
      } catch (error) {
        if (epoch === checkEpoch) {
          checkError.value = cleanErr(error)
        }
      }
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
  window.removeEventListener('resize', resizeAll)
  clearTimeout(checkTimer)
  checkEpoch++
})

watch(
  () => isActive('generate'),
  async (active) => {
    if (!active) {
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
/* ---------- 生成 ---------- */

async function run() {
  if (running.value || inpaintBusy.value || imageState.generating) {
    return
  }
  if (!hasToken.value) {
    error.value = '请先在「设置」中填写 NovelAI API Token'
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
  if (embedded.value) {
    navigate('generate')
  }
  running.value = true
  parametersOpen.value = false
  cancelling.value = false
  error.value = ''
  steps.value = []
  const key = workKey()
  const recipeKey = JSON.stringify(currentRecipe.value)
  try {
    const seed = gen.seed === null || (gen.seed as unknown) === '' ? null : Number(gen.seed)
    const generationResult = await window.api.naiGenerate({
      collectionId: generationCollection.value,
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
      sentRecipes.value[img.name] = recipeKey
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
  await window.api.naiCancel()
  toast('会在当前这张完成后停止')
}

usePageShortcuts(() => isActive('generate') || (embedded.value && isActive('compare')), {
  run,
  cancel,
  canCancel: () => running.value && !cancelling.value,
})
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
      await importImagePrompt(importedPrompt, '已加载原图')
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
    await importImagePrompt(importedPrompt, '已加载原图')
    navigate('preview')
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
</script>

<template>
  <div
    :id="embedded ? 'creation-panel-generate' : undefined"
    :role="embedded ? 'tabpanel' : undefined"
    :aria-labelledby="embedded ? 'creation-tab-generate' : undefined"
    class="view generate"
  >
    <Teleport
      defer
      to="#creation-generation-controls"
      :disabled="!embedded"
    >
      <section
        ref="settingsDock"
        :class="['pane left with-foot', { 'creation-generation': embedded }]"
      >
        <button
          v-if="embedded"
          ref="parametersTrigger"
          class="icon-btn creation-parameters-toggle"
          :aria-expanded="parametersOpen"
          aria-haspopup="dialog"
          aria-controls="creation-generation-settings"
          title="生成设置"
          aria-label="生成设置"
          @click="parametersOpen = !parametersOpen"
        >
          <Icon
            name="sliders"
            :size="16"
          />
        </button>
        <div
          v-show="!embedded || parametersOpen"
          :id="embedded ? 'creation-generation-settings' : undefined"
          ref="leftPane"
          class="pane-body scroll"
          :class="{ 'generation-settings-popover': embedded }"
          :role="embedded ? 'dialog' : undefined"
          :aria-label="embedded ? '生成设置' : undefined"
          :data-generation-settings-open="embedded && parametersOpen ? '' : undefined"
        >
          <WorkspaceBar v-if="!embedded" />

          <PromptEditor
            v-if="!embedded"
            :disabled="running"
            char-hint="点「编辑位置」可在画布上拖动角色"
          />

          <div class="field-head gen-params-head">
            <label class="field-label">生成参数</label>
            <button
              class="btn ghost small ml-auto"
              :disabled="savingRecipe"
              title="保存当前提示词、模型和全部生成参数，无需先出图"
              @click="saveRecipe"
            >
              <Icon
                name="star"
                :size="14"
              />收藏配置
            </button>
            <button
              class="btn ghost small"
              :disabled="running"
              title="在收藏页挑选配置并载入"
              @click="shellState.tab = 'favorites'"
            >
              <Icon
                name="layers"
                :size="14"
              />载入收藏
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
            :prompt-presets-in-editor="embedded"
            :expanded-sizes="embedded"
            :gen="gen"
            :params="params"
            :disabled="running"
            @change-gen="updateGenerationOptions"
            @change-params="updatePromptParameters"
          />

          <div
            v-if="!embedded && hasToken && check"
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
            v-if="!embedded && steps.length"
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

        <CollectionPicker
          v-if="embedded"
          class="dock-collection"
        />
        <label
          v-if="embedded"
          class="retention-toggle dock-retention"
          title="自动留存生成图片，从下一批生效"
        >
          <input
            type="checkbox"
            aria-label="自动留存生成图片"
            :checked="!!settingsState.settings?.naiAutoSave"
            :disabled="retentionSaving"
            @change="toggleRetention"
          />
          <span>自动留存</span>
        </label>
        <span
          v-if="embedded"
          :class="['fee-status', feeStatus.tone]"
          :title="feeStatus.hint"
          >{{ feeStatus.text }}</span
        >
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
            <CollectionPicker v-if="!embedded" />
            <label
              v-if="!embedded"
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
                v-if="!embedded || !running"
                class="btn accent"
                :disabled="running || inpaintBusy || imageState.generating"
                :title="
                  embedded && !isActive('compare') && !isActive('generate')
                    ? '生成当前提示词'
                    : `生成（${runKeyLabel}）`
                "
                @click="run"
              >
                <Icon
                  name="image"
                  :size="17"
                  :class="{ 'spin-slow': running }"
                />
                <span>{{
                  running ? '正在生成' : gen.count > 1 ? `生成 ${gen.count} 张` : '生成'
                }}</span
                ><span
                  v-if="!running && !embedded"
                  class="kbd"
                  >{{ runKeyShort }}</span
                >
              </button>
            </div>
          </div>
        </footer>
      </section>
    </Teleport>

    <section class="pane right scroll">
      <p
        v-if="
          embedded &&
          current &&
          sentRecipes[current.name] &&
          sentRecipes[current.name] !== JSON.stringify(currentRecipe)
        "
        class="evidence-note warn"
      >
        提示词或生成参数已调整，当前图片是上一次配置的结果。再次生成可查看最新效果。
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
        <p v-else>要先在「设置」里填写 NovelAI 的 Persistent API Token 才能出图哦</p>
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
          @remove="remove"
          @inpaint="inpaintSource = $event"
          @positions="editImagePositions"
          @workspace="openImageWorkspace"
        />

        <p
          v-if="current?.storage === 'workspace'"
          class="muted small gallery-delete-note"
        >
          工作台引用中，请进入对应项目清理图片；已删除项目的图片可在 工作台首页「清理遗留图片」。
        </p>

        <div
          v-if="!embedded && matchedPreview"
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
              @click="navigate('preview')"
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
          v-if="gallery.length"
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
              :title="galleryHint"
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
                <FavoriteButton :image="image" />
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
.pane.left.creation-generation {
  position: relative;
  display: grid;
  grid-template-columns: 30px minmax(64px, 120px) auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--bg);
  overflow: visible;
}

.creation-generation .pane-foot {
  container-type: normal;
  min-width: 0;
  grid-column: 5;
  grid-row: 1;
  border-top: 0;
  padding: 0;
  background: transparent;
}

.creation-parameters-toggle {
  width: 30px;
  height: 30px;
}

.creation-generation .btn.accent {
  min-width: 86px;
  min-height: 34px;
  padding: 3px 10px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.2;
  box-shadow: none;
  gap: 8px;
}

.creation-generation > .fee-status {
  grid-column: 4;
  grid-row: 1;
  justify-self: end;
  padding: 3px 5px;
  border-radius: 5px;
  background: var(--panel);
  color: var(--text2);
  white-space: nowrap;
  font-size: 10px;
  font-weight: 400;
}

.creation-generation > .fee-status.bad {
  color: var(--bad);
}

.creation-generation .generation-settings-popover {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 8px;
  right: 8px;
  z-index: 1;
  max-height: min(65vh, calc(100vh - 180px));
  overflow: auto;
  overscroll-behavior: contain;
  padding: 16px;
  border: 1px solid var(--line2);
  border-radius: 14px;
  background: var(--bg);
  box-shadow: 0 8px 32px #0000001f;
}

.generation-settings-popover .gen-params-head {
  flex-wrap: wrap;
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

.dock-retention {
  grid-column: 3;
  grid-row: 1;
  gap: 5px;
  font-size: 11px;
}

.dock-collection {
  grid-column: 2;
  grid-row: 1;
  width: 100%;
  min-width: 0;
  max-width: 160px;
}

.dock-collection :deep(.theme-select) {
  width: 100%;
  min-width: 0;
  padding: 0 8px;
  gap: 4px;
  font-size: 11px;
  height: 30px;
}
</style>
