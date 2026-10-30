<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ReverseModel, ReverseResult, ReverseStatus } from '@shared/reverse/types'
import { shellState } from '../../shared/state/shell'
import { toast } from '../../shared/lib/notifications'
import { cleanErr } from '../../shared/lib/format'
import type { CharDraft } from '../prompts/state'
import { imageState } from '../generation/state'
import { settingsState } from '../settings/state'
import { reverseTrialParams } from './trial-defaults'
import Icon from '../../shared/ui/Icon.vue'
import ReverseModels from './ReverseModels.vue'
import ReverseCharacters from './ReverseCharacters.vue'
import ReverseReference from './ReverseReference.vue'
import ReverseTrials from './ReverseTrials.vue'
import ArtistWeights from './ArtistWeights.vue'
import ArtistRecommendations from './ArtistRecommendations.vue'
import { removeStyleArtist, styleArtists } from './artist-weights'
import ReverseComparison from './ReverseComparison.vue'
import { useReverseTrials, type ReverseTrial } from './use-reverse-trials'
import { modelSize as size, summarizeReverseModels } from './model-summary'
import { loadReversePreferences, saveReversePreferences } from './preferences'

const status = ref<ReverseStatus>()
const preferences = loadReversePreferences()
const selection = ref<ReverseModel[]>(preferences.models)
const threshold = ref(preferences.tagThreshold)
const characterThreshold = ref(preferences.characterThreshold)
const pixaiCharacterThreshold = ref(preferences.pixaiCharacterThreshold)
const artistThreshold = ref(preferences.artistThreshold)
watch(
  [selection, threshold, characterThreshold, pixaiCharacterThreshold, artistThreshold],
  () => {
    try {
      saveReversePreferences({
        models: [...selection.value],
        tagThreshold: threshold.value,
        characterThreshold: characterThreshold.value,
        pixaiCharacterThreshold: pixaiCharacterThreshold.value,
        artistThreshold: artistThreshold.value,
      })
    } catch (e) {
      error.value = `设置保存失败：${cleanErr(e)}`
    }
  },
  { deep: true },
)
const pane = ref<'recognition' | 'characters' | 'trials'>('recognition')
const stage = ref<'recognition' | 'trials'>('recognition')
const analyzedModels = ref('')
const modelsChanged = computed(
  () => !!result.value && analyzedModels.value !== [...selection.value].sort().join(','),
)
const previewStyles = ref<string[]>([])
const {
  state: trialsState,
  run: runTrials,
  stop: stopTrials,
  clear: clearTrials,
} = useReverseTrials()
const previewTrials = computed(() => trialsState.trials)
const models = computed(() => summarizeReverseModels(status.value, selection.value))
const missingModels = computed(() => models.value.filter((model) => !model.ready))
const missingBytes = computed(() =>
  missingModels.value.reduce((total, model) => total + model.missingBytes, 0),
)
const filteredTags = computed(() =>
  (result.value?.tags ?? []).filter((tag) => tag.score >= threshold.value),
)
const selectedReady = computed(
  () => !!status.value && models.value.length > 0 && models.value.every((model) => model.ready),
)
watch(
  selection,
  () => {
    refresh().catch((e) => {
      error.value = cleanErr(e)
    })
  },
  { deep: true },
)
watch(threshold, () => {
  if (result.value) {
    content.value = filteredTags.value.map((t) => t.name).join(', ')
  }
})
const error = ref('')
const image = ref<File>()
const imageUrl = ref('')
const picker = ref<HTMLInputElement>()
const result = ref<ReverseResult>()
const content = ref('')
const style = ref('')
const characterText = ref('')
const characters = ref<CharDraft[]>([])
const croppedResult = ref<ReverseResult>()
const reference = ref<InstanceType<typeof ReverseReference>>()
const cropEnabled = ref(false)
const hasCrop = ref(false)
const cropModels = computed<ReverseModel[]>(() =>
  selection.value.filter((model) => model === 'wd' || model === 'pixai'),
)
const cropReady = computed(
  () =>
    cropModels.value.length > 0 &&
    !!status.value &&
    status.value.models.filter((m) => cropModels.value.includes(m.model)).every((m) => m.ready),
)
const characterResult = computed(() => croppedResult.value ?? result.value)
const characterUsesPixai = computed(
  () =>
    characterResult.value?.characterModel === 'pixai' ||
    (!characterResult.value && selection.value.includes('pixai')),
)
const activeCharacterThreshold = computed({
  get: () => (characterUsesPixai.value ? pixaiCharacterThreshold.value : characterThreshold.value),
  set: (value: number) => {
    if (characterUsesPixai.value) {
      pixaiCharacterThreshold.value = value
    } else {
      characterThreshold.value = value
    }
  },
})
const promptContent = computed(() =>
  [characterText.value.trim(), content.value.trim()].filter(Boolean).join(', '),
)
const running = ref(false)
const actionBusy = ref(false)
const modelsOpen = ref(false)
const modelOperation = computed(() =>
  ['downloading', 'verifying'].includes(status.value?.phase ?? ''),
)
const notices = computed(() =>
  (result.value?.warnings ?? [])
    .filter((warning) => !warning.startsWith('画师候选'))
    .map((warning) =>
      warning.startsWith('检测到多个人物') ? '多个人物：请手动分配角色标签。' : warning,
    ),
)
watch(
  () => shellState.tab,
  (tab) => {
    if (tab !== 'reverse') {
      modelsOpen.value = false
    }
  },
)
const busy = computed(
  () =>
    running.value ||
    trialsState.running ||
    actionBusy.value ||
    ['downloading', 'verifying', 'running'].includes(status.value?.phase ?? ''),
)
const recognitionMessage = computed(() => {
  if (busy.value) {
    return trialsState.running ? trialsState.progress : status.value?.message || '正在处理…'
  }
  if (!status.value) {
    return '正在检查本地模型…'
  }
  if (image.value && !selectedReady.value) {
    return '请先准备所选模型，再点击「开始识别」'
  }
  if (modelsChanged.value) {
    return '模型选择已更改；当前仍为上次结果，点击「重新识别」更新'
  }
  if (result.value) {
    return `已识别 ${filteredTags.value.length} 个标签 · ${result.value.seconds.toFixed(1)} 秒`
  }
  return ''
})
const recognitionLabel = computed(() => {
  if (running.value) {
    return '识别中…'
  }
  return result.value ? '重新识别' : '开始识别'
})
const combined = computed(() =>
  [style.value.trim(), promptContent.value.trim()].filter(Boolean).join(', '),
)
const progress = computed(() =>
  status.value?.totalBytes
    ? Math.min(100, (status.value.completedBytes / status.value.totalBytes) * 100)
    : 0,
)
let timer: ReturnType<typeof setInterval>
let polling = false
const cancelRequested = ref(false)

async function refresh() {
  if (polling) {
    return
  }
  polling = true
  try {
    status.value = await window.api.reverseStatus([...selection.value])
  } catch (e) {
    error.value = cleanErr(e)
  } finally {
    polling = false
  }
}
onMounted(() => {
  window.addEventListener('paste', paste)
  refresh().catch((e) => {
    error.value = cleanErr(e)
  })
  timer = setInterval(() => {
    if (shellState.tab === 'reverse' || busy.value) {
      refresh().catch((e) => {
        error.value = cleanErr(e)
      })
    }
  }, 900)
})
onBeforeUnmount(() => {
  window.removeEventListener('paste', paste)
  clearInterval(timer)
  URL.revokeObjectURL(imageUrl.value)
})

async function manage(action: 'install' | 'import' | 'cancel' | 'remove') {
  error.value = ''
  actionBusy.value = true
  if (action !== 'cancel') {
    cancelRequested.value = false
  }
  try {
    if (action === 'install') {
      status.value = await window.api.reverseInstall([...selection.value])
    } else if (action === 'import') {
      status.value = await window.api.reverseImport([...selection.value])
    } else if (action === 'cancel') {
      cancelRequested.value = true
      await window.api.reverseCancel()
    } else {
      await window.api.reverseRemove([...selection.value])
      modelsOpen.value = false
    }
    await refresh()
  } catch (e) {
    error.value = cleanErr(e)
  } finally {
    actionBusy.value = false
  }
}

function select(file?: File) {
  if (!file || busy.value) {
    return
  }
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    file.size > 25 * 1024 * 1024
  ) {
    error.value = '请选择不超过 25 MB 的 PNG、JPEG 或 WebP 图片'
    return
  }
  URL.revokeObjectURL(imageUrl.value)
  image.value = file
  imageUrl.value = URL.createObjectURL(file)
  pane.value = 'recognition'
  stage.value = 'recognition'
  result.value = undefined
  content.value = ''
  style.value = ''
  characterText.value = ''
  characters.value = []
  croppedResult.value = undefined
  cropEnabled.value = false
  hasCrop.value = false
  error.value = ''
  previewStyles.value = []
  clearTrials()
}
function paste(event: ClipboardEvent) {
  if (shellState.tab !== 'reverse' || modelsOpen.value || event.defaultPrevented) {
    return
  }
  const target = event.target
  if (
    target instanceof HTMLElement &&
    target.closest('input, textarea, [contenteditable="true"], [role="dialog"], dialog')
  ) {
    return
  }
  const file = Array.from(event.clipboardData?.files ?? []).find((item) =>
    item.type.startsWith('image/'),
  )
  if (file) {
    event.preventDefault()
    select(file)
  }
}
function rejectDrop(event: DragEvent) {
  if (event.dataTransfer?.types.includes('Files')) {
    event.dataTransfer.dropEffect = 'none'
  }
}
function picked(event: Event) {
  const input = event.target as HTMLInputElement
  select(input.files?.[0])
  input.value = ''
}
async function analyze() {
  if (!image.value || busy.value || !selectedReady.value) {
    return
  }
  error.value = ''
  previewStyles.value = []
  clearTrials()
  running.value = true
  cancelRequested.value = false
  result.value = undefined
  content.value = ''
  style.value = ''
  croppedResult.value = undefined
  characterText.value = ''
  characters.value = []
  try {
    const bytes = new Uint8Array(await image.value.arrayBuffer())
    if (cancelRequested.value) {
      throw new Error('已取消识别')
    }
    const selectedModels = [...selection.value]
    result.value = await window.api.reverseAnalyze(bytes, selectedModels)
    analyzedModels.value = selectedModels.sort().join(',')
    content.value = filteredTags.value.map((tag) => tag.name).join(', ')
  } catch (e) {
    error.value = cleanErr(e)
  } finally {
    running.value = false
    await refresh()
  }
}
async function analyzeCrop() {
  if (!reference.value || !hasCrop.value || busy.value || !cropReady.value) {
    return
  }
  error.value = ''
  running.value = true
  cancelRequested.value = false
  croppedResult.value = undefined
  try {
    const bytes = await reference.value.bytes()
    if (cancelRequested.value) {
      throw new Error('已取消识别')
    }
    croppedResult.value = await window.api.reverseAnalyze(bytes, [...cropModels.value])
    pane.value = 'characters'
  } catch (e) {
    error.value = cleanErr(e)
  } finally {
    running.value = false
    await refresh()
  }
}
function cropSelected(selected: boolean) {
  hasCrop.value = selected
  croppedResult.value = undefined
}
function openCharacters() {
  pane.value = 'characters'
  stage.value = 'recognition'
}
function openTrials() {
  pane.value = 'trials'
  stage.value = 'recognition'
}
function startTrials() {
  if (
    result.value &&
    !busy.value &&
    previewStyles.value.length > 0 &&
    previewStyles.value.length <= 6
  ) {
    stage.value = 'trials'
  }
}
async function preview() {
  if (stage.value !== 'trials' || busy.value || !result.value) {
    return
  }
  const styles = previewStyles.value.map((value) => value.trim())
  if (new Set(styles).size !== styles.length) {
    trialsState.error = '选中的画师串有重复，请修改或取消勾选'
    return
  }
  await runTrials(
    styles.map((style) => ({
      style,
      request: {
        base: [style, promptContent.value.trim()].filter(Boolean).join(', '),
        negative: '',
        characters: characters.value.map((role) => ({ ...role })),
        version: settingsState.settings?.naiVersion ?? 'v4.5',
        params: reverseTrialParams(settingsState.settings?.naiVersion ?? 'v4.5'),
      },
    })),
    result.value.style,
  )
}
async function retryTrial(trial: ReverseTrial) {
  if (busy.value || !trial) {
    return
  }
  await runTrials(
    [
      {
        style: trial.style,
        request: {
          ...trial.request,
          params: { ...trial.request.params, seed: null },
        },
      },
    ],
    result.value?.style,
  )
}
function clearCrop() {
  reference.value?.clear()
  hasCrop.value = false
  croppedResult.value = undefined
  cropEnabled.value = false
}
function toggleArtist(name: string) {
  if (busy.value) {
    return
  }
  const matching = styleArtists(style.value).filter((artist) => artist.core === name)
  if (matching.length) {
    for (const artist of matching.reverse()) {
      style.value = removeStyleArtist(style.value, artist.index)
    }
  } else {
    style.value = [style.value.trim(), `artist:${name}`].filter(Boolean).join(', ')
  }
}
async function copy(text: string) {
  try {
    await window.api.copy(text)
    toast('已复制')
  } catch (e) {
    error.value = cleanErr(e)
  }
}
function prepareUpdate() {
  if (busy.value) {
    throw new Error('请先停止图片识别或组合试图，再重启更新')
  }
}
defineExpose({ prepareUpdate })

async function source(url: string) {
  try {
    await window.api.openWebUrl(url)
  } catch (e) {
    error.value = cleanErr(e)
  }
}
</script>

<template>
  <section
    class="reverse-view"
    :class="{ 'is-recognition': stage === 'recognition' }"
    @dragenter.stop.prevent
    @dragover.stop.prevent="rejectDrop"
    @dragleave.stop.prevent
    @drop.stop.prevent
  >
    <div class="reverse-topbar">
      <nav
        class="reverse-steps"
        aria-label="图片反推步骤"
      >
        <button
          :class="{ active: stage === 'recognition' }"
          :aria-current="stage === 'recognition' ? 'step' : undefined"
          :disabled="busy"
          @click="stage = 'recognition'"
        >
          1 · 识别与提示词
        </button>
        <span aria-hidden="true">→</span>
        <button
          :class="{ active: stage === 'trials' }"
          :aria-current="stage === 'trials' ? 'step' : undefined"
          :disabled="busy || !result || !previewStyles.length || previewStyles.length > 6"
          @click="startTrials"
        >
          2 · 试图与对比
        </button>
      </nav>
      <div
        v-show="stage === 'trials'"
        class="reverse-execution"
      >
        <div class="reverse-preview-actions">
          <button
            class="btn small"
            :disabled="!result || busy"
            @click="openTrials"
          >
            调整组合
          </button>
          <button
            class="btn primary"
            :disabled="
              !result ||
              busy ||
              imageState.generating ||
              !previewStyles.length ||
              previewStyles.length > 6
            "
            @click="preview"
          >
            {{ trialsState.running ? '正在生成…' : `生成 ${previewStyles.length || 3} 张预览` }}
          </button>
          <button
            v-if="trialsState.running"
            class="btn"
            :disabled="trialsState.stopRequested"
            @click="stopTrials"
          >
            {{ trialsState.stopRequested ? '正在停止…' : '停止试图' }}
          </button>
        </div>
        <p
          v-if="trialsState.error"
          class="reverse-error"
          role="alert"
        >
          {{ trialsState.error }}
        </p>
      </div>
    </div>
    <ReverseComparison
      v-show="stage === 'trials'"
      :reference-url="imageUrl"
      :reference-name="image?.name ?? ''"
      :styles="previewStyles"
      :trials="previewTrials"
      :previous="trialsState.previous"
      :running="trialsState.running"
      :disabled="busy || imageState.generating"
      :active="stage === 'trials' && shellState.tab === 'reverse'"
      @retry="retryTrial"
    />
    <div
      v-show="stage === 'recognition'"
      class="reverse-workspace is-recognition"
      aria-label="参考图与识别结果"
    >
      <section class="reverse-input">
        <div class="reverse-panel-head">
          <span>参考图</span
          ><span
            v-if="image"
            class="reverse-file"
            :title="image.name"
            >{{ image.name }}</span
          >
          <button
            v-if="result"
            class="btn small ghost"
            :disabled="busy"
            title="调整角色 / 框选人物"
            @click="openCharacters"
          >
            角色
          </button>
        </div>
        <ReverseReference
          ref="reference"
          :url="imageUrl"
          :file="image"
          :disabled="busy || modelsOpen || stage !== 'recognition' || shellState.tab !== 'reverse'"
          :crop-enabled="cropEnabled && pane === 'characters' && stage === 'recognition'"
          @choose="picker?.click()"
          @file="select"
          @selected="cropSelected"
        />
        <div
          v-if="image && pane === 'characters' && stage === 'recognition'"
          class="reverse-crop-tools"
        >
          <button
            class="btn small"
            :disabled="busy"
            :aria-pressed="cropEnabled"
            @click="cropEnabled = !cropEnabled"
          >
            框选人物
          </button>
          <button
            class="btn small"
            :disabled="busy || !hasCrop || !cropReady"
            @click="analyzeCrop"
          >
            识别选区
          </button>
          <button
            class="btn small"
            :disabled="busy || (!hasCrop && !croppedResult)"
            @click="clearCrop"
          >
            返回全图
          </button>
          <span v-if="!cropReady">{{
            cropModels.length ? '请下载所选的角色模型' : '请勾选内容 / 角色或 PixAI 角色'
          }}</span>
          <span v-else-if="cropEnabled && !hasCrop">在图上拖动框选</span>
        </div>
      </section>
      <section
        v-show="stage === 'recognition'"
        class="reverse-adjustments"
      >
        <div
          v-show="stage === 'recognition'"
          class="reverse-toolbar"
        >
          <input
            ref="picker"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            @change="picked"
          />
          <button
            class="btn small"
            :disabled="busy"
            @click="picker?.click()"
          >
            <Icon
              name="image"
              :size="15"
            />{{ image ? '更换图片' : '选择图片' }}
          </button>
          <button
            v-if="image"
            class="btn small primary reverse-run"
            :disabled="!image || !selectedReady || busy"
            @click="analyze"
          >
            <Icon
              name="search"
              :size="14"
            />{{ recognitionLabel }}
          </button>
          <button
            v-if="running || actionBusy || modelOperation"
            class="btn small"
            :disabled="cancelRequested"
            @click="manage('cancel')"
          >
            {{ running || status?.phase === 'running' ? '取消识别' : '取消下载' }}
          </button>
          <span
            v-if="recognitionMessage"
            class="reverse-stage"
            role="status"
            >{{ recognitionMessage }}</span
          >
          <button
            class="btn small ghost reverse-model-toggle"
            :disabled="trialsState.running"
            aria-label="模型管理"
            :title="selectedReady ? '本地模型已就绪' : '管理本地模型'"
            @click="modelsOpen = true"
          >
            <span
              class="model-dot"
              :class="{ ready: selectedReady }"
            ></span
            >模型<Icon
              name="sliders"
              :size="14"
            />
          </button>
        </div>

        <div
          v-show="stage === 'recognition'"
          class="reverse-options"
        >
          <label
            v-for="option in [
              ['wd', '内容 / 角色'],
              ['k2', 'K2 画师'],
              ['k3', 'K3 画师 / 评分'],
              ['pixai', 'PixAI 角色'],
            ] as const"
            :key="option[0]"
          >
            <input
              v-model="selection"
              type="checkbox"
              :value="option[0]"
              :disabled="busy || (selection.length === 1 && selection.includes(option[0]))"
            />{{ option[1] }}
          </label>
        </div>
        <div
          v-if="stage === 'recognition' && status && !selectedReady && !modelOperation"
          class="reverse-setup"
        >
          <div class="reverse-setup-heading">
            <div>
              <strong
                >还需要 {{ missingModels.length }} 个本地模型 · 待下载
                {{ size(missingBytes) }}</strong
              >
              <p>
                {{
                  image
                    ? '参考图已保留，模型就绪后点击「开始识别」。'
                    : '首次使用需下载所选模型，之后可离线识别。'
                }}
              </p>
            </div>
            <button
              class="btn small primary"
              :disabled="busy"
              @click="manage('install')"
            >
              下载并启用
            </button>
          </div>
          <ul class="reverse-missing-models">
            <li
              v-for="model in missingModels"
              :key="model.id"
            >
              <strong>{{ model.name }}</strong>
              <span>{{ model.purpose }}</span>
              <span
                >{{ model.partial ? '待补全' : '待下载' }} · {{ size(model.missingBytes) }}</span
              >
            </li>
          </ul>
        </div>
        <div
          v-if="modelOperation && status"
          class="reverse-download"
        >
          <template v-if="status.totalBytes > 0">
            <progress
              :value="progress"
              max="100"
              aria-label="本次模型传输进度"
            /><span
              >本次传输 {{ size(status.completedBytes) }} / {{ size(status.totalBytes) }}</span
            >
          </template>
          <span v-else>正在检查本地文件，确认本次需要下载或导入的大小…</span>
        </div>
        <p
          v-if="error || status?.phase === 'error'"
          class="reverse-error"
          role="alert"
        >
          {{ error || status?.message }}
        </p>

        <div
          v-if="!result"
          class="reverse-recognition-empty"
        >
          <Icon
            name="search"
            :size="30"
          />
          <strong>{{ running ? '正在识别参考图…' : '等待识别' }}</strong>
        </div>
        <div
          v-show="!!result"
          class="seg reverse-adjustment-tabs"
        >
          <button
            :class="{ on: pane === 'recognition' }"
            @click="pane = 'recognition'"
          >
            识别结果
          </button>
          <button
            :class="{ on: pane === 'characters' }"
            @click="pane = 'characters'"
          >
            角色识别
          </button>
          <button
            :class="{ on: pane === 'trials' }"
            :disabled="!result"
            @click="pane = 'trials'"
          >
            画师组合
          </button>
        </div>
        <section
          v-show="!!result && pane === 'recognition'"
          class="reverse-output"
          :data-ready="!!result"
          aria-label="反推结果"
        >
          <div class="reverse-content-panel">
            <div class="reverse-panel-head">
              <label for="reverse-content">基础提示词</label
              ><label
                v-if="result?.tags.length"
                class="reverse-threshold"
                >阈值<input
                  v-model.number="threshold"
                  aria-label="基础标签阈值"
                  type="number"
                  min="0.05"
                  max="1"
                  step="0.05"
                  :disabled="busy" /></label
              ><span
                v-if="result"
                class="reverse-meta"
                >{{ filteredTags.length }} 个标签 · {{ result.seconds.toFixed(1) }} 秒</span
              ><button
                class="icon-btn sm"
                :disabled="!content.trim()"
                title="复制基础词"
                aria-label="复制基础词"
                @click="copy(content)"
              >
                <Icon
                  name="copy"
                  :size="14"
                />
              </button>
            </div>
            <textarea
              id="reverse-content"
              v-model="content"
              :disabled="!result || busy"
              rows="5"
              placeholder="识别后显示基础提示词"
              spellcheck="false"
            />
            <p
              v-for="notice in notices"
              :key="notice"
              class="reverse-notice"
            >
              {{ notice }}
            </p>
          </div>
          <div class="reverse-style-panel">
            <ArtistRecommendations
              v-model:threshold="artistThreshold"
              :result="result"
              :selected="styleArtists(style).map((artist) => artist.core)"
              :busy="busy"
              :running="running"
              @toggle="toggleArtist"
            />
            <div class="reverse-style-editor">
              <div class="reverse-panel-head">
                <label for="reverse-style">画师串</label
                ><button
                  class="icon-btn sm"
                  :disabled="!style || busy"
                  title="清空画师串"
                  aria-label="清空画师串"
                  @click="style = ''"
                >
                  <Icon
                    name="x"
                    :size="14"
                  /></button
                ><button
                  class="icon-btn sm"
                  :disabled="!style.trim()"
                  title="复制画师串"
                  aria-label="复制画师串"
                  @click="copy(style)"
                >
                  <Icon
                    name="copy"
                    :size="14"
                  />
                </button>
              </div>
              <ArtistWeights
                v-model="style"
                :disabled="!result || busy"
              />
              <textarea
                id="reverse-style"
                v-model="style"
                :disabled="!result || busy"
                rows="2"
                placeholder="点击候选添加，可直接编辑"
                spellcheck="false"
              />
            </div>
          </div>
          <footer class="reverse-result-actions">
            <button
              class="btn small"
              :disabled="!combined"
              @click="copy(combined)"
            >
              复制组合
            </button>
          </footer>
        </section>
        <ReverseCharacters
          v-show="!!result && pane === 'characters'"
          v-model:threshold="activeCharacterThreshold"
          v-model:base="characterText"
          v-model:characters="characters"
          :result="characterResult"
          :cropped="!!croppedResult"
          :busy="busy"
          :general-threshold="threshold"
        />
        <ReverseTrials
          v-if="result"
          v-show="pane === 'trials'"
          :key="imageUrl"
          :result="result"
          :style-prompt="style"
          :disabled="busy"
          @selection-change="previewStyles = $event"
        />
        <footer
          v-if="result"
          class="reverse-next-step"
        >
          <span>已选 {{ previewStyles.length }} 个方案</span>
          <button
            class="btn primary"
            :disabled="busy || !result || !previewStyles.length || previewStyles.length > 6"
            @click="startTrials"
          >
            去试图
          </button>
        </footer>
      </section>
    </div>
    <ReverseModels
      v-if="modelsOpen"
      :status="status"
      :selection="selection"
      :busy="busy"
      :error="error"
      @close="modelsOpen = false"
      @manage="manage"
      @source="source"
    />
  </section>
</template>

<style scoped>
.reverse-view {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
  padding: 16px 20px;
  overflow: hidden;
  scrollbar-gutter: stable;
}

.reverse-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.reverse-topbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
  flex-wrap: wrap;
  background: var(--bg);
}

.reverse-setup p {
  margin: 6px 0 0;
  color: var(--text2);
  font-size: 12px;
  line-height: 1.6;
}

.reverse-steps {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  flex-shrink: 0;
  color: var(--muted);
}

.reverse-steps button {
  padding: 9px 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--text2);
  background: var(--bg);
  font-size: 13px;
  cursor: pointer;
}

.reverse-steps button.active {
  border-color: var(--pink-line);
  background: var(--pink-soft);
  color: var(--pink-deep);
  font-weight: 600;
}

.reverse-steps button:disabled {
  cursor: default;
  opacity: 0.55;
}

.reverse-options {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
}

.reverse-options label {
  display: flex;
  gap: 5px;
  align-items: center;
}

.reverse-threshold {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 400;
  color: var(--text2);
}

.reverse-threshold input {
  width: 62px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 3px;
  color: var(--text);
}

.reverse-stage {
  font-size: 12px;
  color: var(--text2);
  min-width: 0;
}

.reverse-model-toggle {
  margin-left: auto;
  flex-shrink: 0;
}

.model-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--muted);
}

.model-dot.ready {
  background: var(--ok);
}

.reverse-setup {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 12px;
  background: var(--panel);
  border: 1px solid var(--line);
  padding: 8px 12px;
  border-radius: 6px;
}

.reverse-setup-heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.reverse-missing-models {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.reverse-missing-models li {
  display: flex;
  flex-direction: column;
  gap: 5px;
  line-height: 1.5;
}

.reverse-missing-models span {
  color: var(--text2);
  font-size: 11px;
}

.reverse-setup .btn {
  margin-left: auto;
}

.reverse-download {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--text2);
}

progress {
  flex: 1;
  height: 5px;
  accent-color: var(--pink-deep);
}

.reverse-view.is-recognition {
  overflow: hidden;
}

.reverse-workspace.is-recognition {
  display: grid;
  grid-template-columns: minmax(240px, 0.8fr) minmax(380px, 1.2fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 12px;
  flex: 1;
  min-height: 0;
}

.reverse-preview-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 4px 0;
  font-size: 13px;
}

.reverse-execution {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  margin-left: auto;
  min-width: 0;
}

.reverse-adjustments {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  gap: 12px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
}

.reverse-adjustments > * {
  flex-shrink: 0;
}

.reverse-recognition-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 28px 16px;
  color: var(--text2);
  text-align: center;
  font-size: 12px;
  line-height: 1.7;
}

.reverse-recognition-empty strong {
  color: var(--text);
  font-size: 15px;
}

.reverse-recognition-empty p {
  margin: 0;
}

.reverse-recognition-empty span {
  color: var(--muted);
  font-size: 11px;
}

.reverse-next-step {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: auto;
  padding-top: 16px;
  font-size: 12px;
  color: var(--text2);
  line-height: 1.6;
}

.reverse-next-step .btn {
  flex-shrink: 0;
}

.reverse-adjustment-tabs {
  width: fit-content;
  margin-bottom: 0;
}

.reverse-input,
.reverse-content-panel,
.reverse-style-panel {
  border: 1px solid var(--line2);
  border-radius: 8px;
  background: var(--bg);
  min-width: 0;
  overflow: hidden;
}

.reverse-input {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.reverse-input :deep(.reverse-drop) {
  flex: 1;
  height: auto;
  min-height: 0;
}

.reverse-input > :not(.reverse-drop) {
  flex-shrink: 0;
}

.reverse-panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 5px 12px;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

.reverse-file,
.reverse-meta {
  margin-left: auto;
  color: var(--muted);
  font-size: 11px;
  font-weight: 400;
}

.reverse-file {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 65%;
}

.reverse-panel-head .icon-btn:first-of-type {
  margin-left: auto;
}

.reverse-meta + .icon-btn {
  margin-left: 0 !important;
}

.reverse-crop-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 10px;
  border-top: 1px solid var(--line);
}

.reverse-crop-tools span {
  color: var(--text2);
  font-size: 11px;
}

.reverse-output {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  min-width: 0;
}

.reverse-content-panel {
  display: flex;
  flex-direction: column;
  flex: none;
}

.reverse-output textarea {
  display: block;
  width: 100%;
  padding: 12px;
  color: var(--text);
  background: var(--bg);
  border: 0;
  resize: none;
  field-sizing: content;
  overflow: hidden;
  font: 12px/1.7 var(--mono);
  border-radius: 0;
}

.reverse-output textarea:focus {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--pink-line);
}

.reverse-output textarea:disabled {
  color: var(--muted);
  opacity: 1;
  background: var(--bg);
}

#reverse-content {
  min-height: 100px;
}

.reverse-style-panel {
  flex: none;
  display: flex;
  flex-direction: column;
}

.reverse-artists {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.reverse-artist-group {
  padding: 10px 12px;
  min-width: 0;
}

.reverse-artist-group + .reverse-artist-group {
  border-left: 1px solid var(--line);
}

.reverse-model-name {
  font-size: 11px;
  color: var(--text2);
  margin-bottom: 5px;
}

.reverse-artists ol {
  list-style: none;
  padding: 0;
  margin: 0;
  counter-reset: artist;
}

.reverse-artists li {
  display: flex;
  align-items: center;
  counter-increment: artist;
}

.reverse-artists li::before {
  content: counter(artist);
  width: 15px;
  flex-shrink: 0;
  font-size: 10px;
  color: var(--muted);
}

.reverse-artist {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  min-height: 28px;
  padding: 4px;
  background: none;
  border: 0;
  border-radius: 4px;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  font-size: 12px;
}

.reverse-artist span {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reverse-artist small {
  color: var(--muted);
  font-size: 10px;
}

.reverse-artist > .icon {
  color: var(--muted);
  flex-shrink: 0;
}

.reverse-artist:hover,
.reverse-artist.selected {
  background: var(--pink-soft);
  color: var(--pink-deep);
}

.reverse-artists-empty {
  display: grid;
  place-items: center;
  flex: none;
  color: var(--muted);
  font-size: 12px;
}

.reverse-style-editor {
  flex-shrink: 0;
  border-top: 1px solid var(--line);
}

.reverse-style-editor .reverse-panel-head {
  min-height: 32px;
  border: 0;
  padding-block: 3px;
}

#reverse-style {
  min-height: 65px;
  padding-top: 4px;
}

.reverse-notice {
  margin: 0;
  padding: 6px 12px;
  border-top: 1px solid var(--line);
  color: var(--alias);
  font-size: 11px;
  line-height: 1.5;
}

.reverse-result-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

.reverse-error {
  margin: 0;
  color: var(--bad);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

@media (width <= 1150px) {
  .reverse-view {
    padding: 12px;
  }
}

@media (width <= 1000px) {
  .reverse-view.is-recognition {
    overflow: auto;
  }

  .reverse-workspace.is-recognition {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto;
    flex: none;
  }

  .reverse-input {
    height: clamp(280px, 45vh, 480px);
  }

  .reverse-adjustments {
    overflow: visible;
  }
}
</style>
