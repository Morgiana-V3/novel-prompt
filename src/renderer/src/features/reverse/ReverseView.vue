<script setup lang="ts">
import { vSegIndicator } from '../../shared/lib/seg-indicator'
import { useModelManager } from './use-model-manager'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { FrontendRequest, FrontendContext } from '@shared/contracts/desktop'
import ReversePrompt from './ReversePrompt.vue'
import type { ReverseModel, ReverseResult, ReverseStatus } from '@shared/reverse/types'
import { shellState } from '../../shared/state/shell'
import { reportError, toast } from '../../shared/lib/notifications'
import { cleanErr } from '../../shared/lib/format'
import { type CharDraft } from '../prompts/public/draft'
import { imageState } from '../generation/public'
import { settingsState } from '../settings/state'
import { reverseTrialParams } from './trial-defaults'
import Icon from '../../shared/ui/Icon.vue'
import Mascot from '../../shared/ui/Mascot.vue'
import ReverseModels from './ReverseModels.vue'
import ReverseReference from './ReverseReference.vue'
import ArtistRecommendations from './ArtistRecommendations.vue'
import { estimateArtistMix, rankArtists } from '@shared/reverse/candidates'
import { COMPARE_MAX, TUNE_MAX_ROUNDS, TUNE_ROUND_SIZE, useStyleMatch } from './use-style-match'
import { fusedProbabilities, memberWeights } from './mix-weights'
import ReverseComparison from './ReverseComparison.vue'
import { useReverseTrials, type ReverseTrial } from './use-reverse-trials'
import { modelSize as size, summarizeReverseModels } from './model-summary'
import { loadReversePreferences, saveReversePreferences } from './preferences'
import SplitHandle from '../../shared/ui/SplitHandle.vue'

const status = ref<ReverseStatus>()
const fullPrompt = ref<InstanceType<typeof ReversePrompt>>()
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
const stage = ref<'recognition' | 'trials'>('recognition')
/*
 * 推荐画师列表的勾选只用于「对比画师」（各单独出一张）；混合组成是另一份固定推荐，
 * 默认就是推测组成，可在列表里把画师加入 / 移出组成，「调优比例」只调组成的比例。
 */
const selectedArtists = ref<string[]>([])
const selectedCount = computed(() => selectedArtists.value.length)
/** 调优要靠 K3 风格特征打分 */
const tuneAvailable = computed(() => !!result.value?.style)
const TUNE_MAX_IMAGES = TUNE_ROUND_SIZE * TUNE_MAX_ROUNDS
const matchIdle = computed(() => !!result.value && !busy.value && !imageState.generating)
const canCompare = computed(
  () => matchIdle.value && selectedCount.value > 0 && selectedCount.value <= COMPARE_MAX,
)
const canTune = computed(() => matchIdle.value && tuneAvailable.value && mixParts.value.length >= 2)
const compareTitle = computed(() => {
  if (selectedCount.value > COMPARE_MAX) {
    return `一次最多对比 ${COMPARE_MAX} 位画师`
  }
  if (!selectedCount.value) {
    return '先在推荐画师里选几位'
  }
  return '勾选的画师各单独出一张，看哪位的画风最接近参考图'
})
const tuneTitle = computed(() => {
  if (!tuneAvailable.value) {
    return '需要勾选「K3 画师 / 评分」并重新识别'
  }
  if (mixParts.value.length < 2) {
    return '混合组成至少要有 2 位画师才能调比例'
  }
  return `只调混合组成的比例：每轮 ${TUNE_ROUND_SIZE} 张，最多 ${TUNE_MAX_ROUNDS} 轮，不再变像就停`
})
const {
  state: trialsState,
  run: runTrials,
  stop: stopTrials,
  clear: clearTrials,
} = useReverseTrials()
/* 匹配画风：出图与 K3 打分复用试图流程（buildCandidate 为函数声明，提升可用） */
const match = useStyleMatch({
  trials: trialsState,
  runCandidates: (candidates) => runTrials(candidates, result.value?.style),
  buildCandidate,
  stop: stopTrials,
})
const { rounds: matchRounds, best: matchBest, bestTune, imageCount: matchImages } = match
const models = computed(() => summarizeReverseModels(status.value, selection.value))
const missingModels = computed(() => models.value.filter((model) => !model.ready))
const missingBytes = computed(() =>
  missingModels.value.reduce((total, model) => total + model.missingBytes, 0),
)
/** 分类标签与完整提示词共享同一份本地识别结果。 */
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
const error = ref('')
const image = ref<File>()
const imageUrl = ref('')
const picker = ref<HTMLInputElement>()
const result = ref<ReverseResult>()
const content = ref('')
const characterText = ref('')
const characters = ref<CharDraft[]>([])
const characterUsesPixai = computed(
  () =>
    result.value?.characterModel === 'pixai' ||
    (!result.value && selection.value.includes('pixai')),
)
const activeCharacterThreshold = computed(() =>
  characterUsesPixai.value ? pixaiCharacterThreshold.value : characterThreshold.value,
)
const promptContent = computed(() =>
  [characterText.value.trim(), content.value.trim()].filter(Boolean).join(', '),
)
const running = ref(false)
const analyzing = ref(false)
const actionBusy = ref(false)
const modelsOpen = ref(false)
const modelOperation = computed(() =>
  ['downloading', 'verifying'].includes(status.value?.phase ?? ''),
)
const notices = computed(() =>
  (result.value?.warnings ?? [])
    .filter((warning) => !warning.startsWith('画师候选'))
    .map((warning) =>
      warning.startsWith('检测到多个人物')
        ? '检测到多个人物，角色归属请以完整提示词为准。'
        : warning,
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
    analyzing.value ||
    !!fullPrompt.value?.running ||
    running.value ||
    match.state.running ||
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
    return '请先准备所选模型，再点击「开始反推」'
  }
  if (result.value) {
    return `已识别 ${filteredTags.value.length} 个标签 · ${result.value.seconds.toFixed(1)} 秒`
  }
  return ''
})
/** 识别前 / 识别中，空白区域的标题与提示 */
const emptyTitle = computed(() => {
  if (running.value) {
    return '正在识别参考图…'
  }
  return image.value ? '准备好了，开始反推吧' : '放入一张参考图'
})
const emptyHint = computed(() => {
  if (running.value) {
    return status.value?.message || ''
  }
  if (!image.value) {
    return '拖入、粘贴或点击左侧选择图片'
  }
  return recognitionMessage.value
})
const progress = computed(() =>
  status.value?.totalBytes
    ? Math.min(100, (status.value.completedBytes / status.value.totalBytes) * 100)
    : 0,
)
const cancelRequested = ref(false)
const { refresh, manage } = useModelManager({
  status,
  selection,
  error,
  actionBusy,
  cancelRequested,
  modelsOpen,
  shouldPoll: () => shellState.tab === 'reverse' || busy.value,
})

onMounted(() => {
  window.addEventListener('paste', paste)
})
onBeforeUnmount(() => {
  window.removeEventListener('paste', paste)
  URL.revokeObjectURL(imageUrl.value)
})

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
  stage.value = 'recognition'
  result.value = undefined
  content.value = ''
  selectedArtists.value = []
  characterText.value = ''
  characters.value = []
  error.value = ''
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
async function analyze(context?: FrontendContext) {
  if (!image.value || busy.value || !fullPrompt.value) {
    throw new Error('请先选择参考图并等待当前任务完成')
  }
  analyzing.value = true
  cancelRequested.value = false
  error.value = ''
  const abort = () => {
    void cancelAnalysis().catch(reportError)
  }
  context?.signal.addEventListener('abort', abort, { once: true })
  try {
    // 两路独立开始：画师结果不必等识图接口，也不会被其失败吞掉。
    const outcomes = await Promise.allSettled([
      fullPrompt.value.compose(context?.actionId),
      analyzeLocal(),
    ])
    if (!selectedReady.value && !cancelRequested.value) {
      error.value = '完整提示词可正常反推；画师参考需要先在识别设置中准备本地模型。'
    }
    if (outcomes[0].status === 'rejected' && context) {
      throw outcomes[0].reason
    }
  } finally {
    analyzing.value = false
    context?.signal.removeEventListener('abort', abort)
  }
}
function startAnalysis() {
  void analyze().catch(reportError)
}
async function cancelAnalysis() {
  cancelRequested.value = true
  await Promise.all([fullPrompt.value?.cancel(), running.value ? manage('cancel') : undefined])
}
async function analyzeLocal() {
  if (!image.value || !selectedReady.value) {
    return
  }
  error.value = ''
  clearTrials()
  running.value = true
  cancelRequested.value = false
  result.value = undefined
  content.value = ''
  selectedArtists.value = []
  characterText.value = ''
  characters.value = []
  try {
    const bytes = new Uint8Array(await image.value.arrayBuffer())
    if (cancelRequested.value) {
      throw new Error('已取消识别')
    }
    const selectedModels = [...selection.value]
    result.value = await window.api.reverseAnalyze(bytes, selectedModels)
    content.value = filteredTags.value.map((tag) => tag.name).join(', ')
    match.reset()
    showEstimate.value = false
    customMembers.value = null
    selectedArtists.value =
      estimateArtistMix(result.value)?.parts.map((part) => part.name) ??
      rankArtists(result.value)
        .slice(0, 3)
        .map((artist) => artist.name)
    // 单人图：角色候选直接放进主提示词，不用再分配；多人图提示逐个框选拆分角色
    if (multiPerson.value && characterCandidates.value.length >= 2) {
      characters.value = characterCandidates.value
        .slice(0, 6)
        .map((name) => ({ prompt: name, negative: '', position: '' }))
    } else {
      characterText.value = characterCandidates.value.join(', ')
    }
  } catch (e) {
    error.value = cleanErr(e)
  } finally {
    running.value = false
    await refresh()
  }
}
/** 达到阈值的全图角色候选 */
const characterCandidates = computed(() =>
  (result.value?.characters ?? [])
    .filter((tag) => tag.score >= activeCharacterThreshold.value)
    .map((tag) => tag.name),
)
const multiPerson = computed(
  () =>
    !!result.value &&
    (result.value.warnings.some((warning) => warning.startsWith('检测到多个人物')) ||
      result.value.tags.some(
        (tag) =>
          tag.score >= threshold.value &&
          /^(?:[2-6]\+?(?:girls|boys)|multiple (?:girls|boys))$/.test(tag.name),
      )),
)
function openTrials() {
  stage.value = 'recognition'
}
/** 对比画师：选中的画师各单独出一张 */
async function startCompare() {
  if (!canCompare.value) {
    return
  }
  stage.value = 'trials'
  await match.compare([...selectedArtists.value])
}
/** 调优比例：从当前混合组成出发逐轮试权重 */
async function startTune() {
  if (!canTune.value) {
    return
  }
  stage.value = 'trials'
  await match.tune(mixParts.value.map((part) => ({ name: part.name, weight: part.weight })))
}
function startCompareClick() {
  startCompare().catch(reportError)
}
function startTuneClick() {
  startTune().catch(reportError)
}
function cancelMatch() {
  match.cancel().catch(reportError)
}
function startTrials() {
  if (result.value && matchRounds.value.length) {
    stage.value = 'trials'
  }
}
/** 对比页顶部唯一的进度：轮次 · 已出张数 · 最佳相似度 · 额度 */
const matchStatus = computed(() => {
  const parts = [match.state.message || '还没有开始匹配']
  if (matchImages.value) {
    parts.push(`已出 ${matchImages.value} 张`)
  }
  if (matchBest.value?.score !== undefined) {
    parts.push(`最佳 ${matchBest.value.score.toFixed(3)}`)
  }
  if (match.state.spent) {
    parts.push(`已用 ${match.state.spent} Anlas`)
  }
  return parts.join(' · ')
})
/* ---------- 推测组成 ---------- */
const artistMix = computed(() => (result.value ? estimateArtistMix(result.value) : null))
/*
 * 混合组成 = 固定推荐：默认是推测组成（画师 + 按概率换算的比例），与列表勾选无关。
 * 在推荐列表里加入 / 移出画师后，整组比例按所有成员的模型概率重新换算；
 * 「比例调优」找到更像的比例后显示调优结果（成员一致时），可切回推测或恢复推荐。
 */
const showEstimate = ref(false)
/** 用户改过的成员；null 表示使用推荐（推测组成） */
const customMembers = ref<string[] | null>(null)
const probabilities = computed(() =>
  result.value ? fusedProbabilities(result.value) : new Map<string, number>(),
)
const members = computed(
  () => customMembers.value ?? (artistMix.value?.parts ?? []).map((part) => part.name),
)
const sameMembers = (a: string[], b: string[]) =>
  a.length === b.length && a.every((name) => b.includes(name))
/** 调优结果只在成员与当前组成一致时适用 */
const tunedParts = computed(() =>
  bestTune.value &&
  sameMembers(
    bestTune.value.parts.map((part) => part.name),
    members.value,
  )
    ? bestTune.value.parts
    : null,
)
const usingTuned = computed(() => !!tunedParts.value && !showEstimate.value)
const mixKindLabel = computed(() => {
  if (usingTuned.value && bestTune.value?.trial.score !== undefined) {
    return `调优最佳 · 相似度 ${bestTune.value.trial.score.toFixed(3)}`
  }
  if (customMembers.value) {
    return '已调整成员'
  }
  return artistMix.value?.kind === 'single' ? '推荐 · 接近单一画风' : '推荐 · 混合画风'
})
const MIX_COLORS = ['var(--pink)', '#f4a7c4', '#b9a4ef', '#94c4ee']
const estimatedMembers = computed(() => {
  if (!customMembers.value && artistMix.value) {
    return artistMix.value.parts.map((part) => ({
      name: part.name,
      weight: part.weight,
      share: part.share,
    }))
  }
  return memberWeights(members.value, probabilities.value)
})
const mixParts = computed(() => {
  if (!usingTuned.value) {
    return estimatedMembers.value
  }
  const total = tunedParts.value!.reduce((sum, part) => sum + part.weight, 0) || 1
  return tunedParts.value!.map((part) => ({
    ...part,
    share: Math.round((part.weight / total) * 100),
  }))
})
const mixShares = computed(() =>
  mixParts.value.map((part, index) => ({ ...part, color: MIX_COLORS[index % MIX_COLORS.length] })),
)
/** 在推荐列表里把画师加入 / 移出混合组成 */
function toggleMember(name: string) {
  if (busy.value) {
    return
  }
  const key = name.toLowerCase()
  const current = members.value
  const next = current.some((item) => item.toLowerCase() === key)
    ? current.filter((item) => item.toLowerCase() !== key)
    : [...current, name]
  if (next.length > 4) {
    toast('混合组成最多 4 位画师')
    return
  }
  const recommended = (artistMix.value?.parts ?? []).map((part) => part.name)
  customMembers.value = sameMembers(next, recommended) ? null : next
}
function restoreRecommended() {
  customMembers.value = null
  showEstimate.value = false
}
function toggleEstimate() {
  showEstimate.value = !showEstimate.value
}
function buildCandidate(style: string) {
  if (fullPrompt.value?.hasDraft) {
    return { style, request: fullPrompt.value.request(style) }
  }
  const version = settingsState.settings?.naiVersion ?? 'v4.5'
  return {
    style,
    request: {
      base: [style, promptContent.value.trim()].filter(Boolean).join(', '),
      negative: '',
      characters: characters.value.map((role) => ({ ...role })),
      version,
      params: reverseTrialParams(version),
    },
  }
}
function retryTrial(trial: ReverseTrial) {
  if (!busy.value) {
    match.retry(trial).catch(reportError)
  }
}
function toggleArtist(name: string) {
  if (busy.value) {
    return
  }
  const key = name.toLowerCase()
  selectedArtists.value = selectedArtists.value.some((item) => item.toLowerCase() === key)
    ? selectedArtists.value.filter((item) => item.toLowerCase() !== key)
    : [...selectedArtists.value, name]
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
async function frontendAction(input: FrontendRequest, context: FrontendContext) {
  prepareUpdate()
  stage.value = 'recognition'
  if (input.action === 'reverse-load') {
    if (image.value) {
      throw new Error('反推页已有参考图，请先由用户保存草稿并更换图片；未覆盖现有内容')
    }
    if (!input.image) {
      throw new Error('请选择图库图片')
    }
    await context.step('载入反推参考图')
    const bytes = await window.api.naiReadImage(input.image.name)
    context.signal.throwIfAborted()
    select(new File([new Uint8Array(bytes)], input.image.name, { type: 'image/png' }))
    await nextTick()
  } else if (input.action === 'reverse-compose') {
    await context.step('反推画师参考与完整提示词')
    await analyze(context)
  } else {
    if (!fullPrompt.value) {
      throw new Error('完整反推编辑器尚未就绪')
    }
    await fullPrompt.value.frontendAction(input, context)
  }
}
defineExpose({
  prepareUpdate,
  frontendAction,
  desktopState: () => {
    const state = fullPrompt.value?.desktopState()
    return state
      ? {
          ...state,
          localResult: result.value ?? null,
          localError: error.value,
          running: busy.value,
        }
      : undefined
  },
})

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
        v-seg-indicator
        class="seg reverse-steps"
        aria-label="图片反推步骤"
      >
        <button
          :class="{ on: stage === 'recognition' }"
          :aria-current="stage === 'recognition' ? 'step' : undefined"
          :disabled="busy"
          @click="stage = 'recognition'"
        >
          反推结果
        </button>
        <button
          :class="{ on: stage === 'trials' }"
          :aria-current="stage === 'trials' ? 'step' : undefined"
          :disabled="!result || !matchRounds.length"
          @click="startTrials"
        >
          画风对比
        </button>
      </nav>
      <div
        v-show="stage === 'trials'"
        class="reverse-execution"
      >
        <div class="reverse-preview-actions">
          <span
            class="reverse-match-status"
            role="status"
            >{{ matchStatus }}</span
          >
          <button
            v-if="match.state.running"
            class="btn"
            :disabled="trialsState.stopRequested"
            @click="cancelMatch"
          >
            {{ trialsState.stopRequested ? '正在停止…' : '停止' }}
          </button>
          <template v-else>
            <button
              class="btn small"
              :disabled="!result"
              @click="openTrials"
            >
              调整画师
            </button>
            <button
              class="btn"
              :disabled="!canCompare"
              :title="compareTitle"
              @click="startCompareClick"
            >
              对比画师
            </button>
            <button
              class="btn primary"
              :disabled="!canTune"
              :title="tuneTitle"
              @click="startTuneClick"
            >
              调优比例
            </button>
          </template>
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
      :rounds="matchRounds"
      :running="match.state.running"
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
        <input
          ref="picker"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          @change="picked"
        />
        <div class="reverse-panel-head">
          <span>参考图</span
          ><span
            v-if="image"
            class="reverse-file"
            :title="image.name"
            >{{ image.name }}</span
          >
        </div>
        <ReverseReference
          :url="imageUrl"
          :file="image"
          :crop-enabled="false"
          :disabled="busy || modelsOpen || stage !== 'recognition' || shellState.tab !== 'reverse'"
          @choose="picker?.click()"
          @file="select"
        />
      </section>
      <SplitHandle
        v-show="stage === 'recognition'"
        class="reverse-split"
        storage-key="reverse-reference"
        variable="--reverse-reference-width"
        :min="240"
        :max="900"
        :reserve="380"
        label="参考图栏宽度"
      />
      <section
        v-show="stage === 'recognition'"
        class="reverse-adjustments"
      >
        <div class="reverse-analysis-toolbar">
          <strong>图片反推</strong>
          <span class="reverse-analysis-hint">画师参考 · 完整提示词</span>
          <button
            v-if="analyzing || running || fullPrompt?.running"
            class="btn small"
            :disabled="cancelRequested"
            @click="cancelAnalysis().catch(reportError)"
          >
            {{ cancelRequested ? '正在停止…' : '停止' }}
          </button>
          <button
            v-else
            class="btn small primary"
            :disabled="!image || busy"
            @click="startAnalysis"
          >
            {{ result || fullPrompt?.hasDraft ? '重新反推' : '开始反推' }}
          </button>
        </div>
        <details class="reverse-settings">
          <summary>识别设置</summary>
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
                name="chip"
                :size="14"
              />
            </button>
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
                      ? '参考图已保留，模型就绪后点击「开始反推」。'
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
            <button
              class="btn small"
              :disabled="cancelRequested"
              @click="manage('cancel')"
            >
              取消下载
            </button>
          </div>
        </details>
        <p
          v-if="error || status?.phase === 'error'"
          class="reverse-error"
          role="alert"
        >
          {{ error || status?.message }}
        </p>
        <div
          v-if="!result && !fullPrompt?.hasDraft && !analyzing && !fullPrompt?.running"
          class="reverse-recognition-empty"
        >
          <Mascot
            mood="search"
            :size="100"
          />
          <strong>{{ emptyTitle }}</strong>
          <p>{{ image ? '一次反推画师参考、主提示词、负面词与角色位置' : emptyHint }}</p>
          <span v-if="image">完整提示词使用设置中的 AI 识图接口</span>
        </div>
        <section
          v-if="running || result"
          class="reverse-style-panel"
          aria-label="画师参考"
        >
          <div class="reverse-panel-head">
            <span>画师参考</span
            ><span class="reverse-meta">{{ running ? '正在识别…' : '风格相似度参考' }}</span>
          </div>
          <section
            v-if="mixParts.length"
            class="reverse-mix"
            aria-label="混合组成"
          >
            <header>
              <strong>混合组成</strong>
              <span
                class="reverse-mix-kind"
                :title="
                  usingTuned
                    ? '比例来自「调优比例」里最像的结果，再次调优从这组继续'
                    : '比例按画风模型的概率换算，表示风格接近程度，不是原作者判定'
                "
                >{{ mixKindLabel }}</span
              >
              <button
                v-if="tunedParts"
                class="reverse-mix-switch"
                @click="toggleEstimate"
              >
                {{ usingTuned ? '看推测比例' : '看调优结果' }}
              </button>
              <button
                v-if="customMembers"
                class="reverse-mix-switch"
                @click="restoreRecommended"
              >
                恢复推荐
              </button>
            </header>
            <div
              class="reverse-mix-bar"
              aria-hidden="true"
            >
              <span
                v-for="part in mixShares"
                :key="part.name"
                :style="{ flexGrow: Math.max(part.share, 1), background: part.color }"
              ></span>
            </div>
            <ul class="reverse-mix-legend">
              <li
                v-for="part in mixShares"
                :key="part.name"
              >
                <i :style="{ background: part.color }"></i
                ><span :title="part.name">{{ part.name }}</span
                ><b>{{ part.share }}%</b><code title="提示词权重">{{ part.weight }}</code>
              </li>
            </ul>
          </section>
          <p
            v-if="result && !mixParts.length"
            class="reverse-notice"
          >
            {{
              selection.some((model) => model === 'k2' || model === 'k3')
                ? '没有得到可信的画师候选，可以先使用完整提示词。'
                : '尚未启用画师模型，请在识别设置中勾选 K2 或 K3。'
            }}
          </p>
          <div
            v-if="result"
            class="reverse-candidates"
          >
            <ArtistRecommendations
              v-model:threshold="artistThreshold"
              :result="result"
              :selected="selectedArtists"
              :members="members"
              :busy="busy"
              :running="running"
              @toggle="toggleArtist"
              @member="toggleMember"
            />
            <div
              v-show="!!result && !running"
              class="reverse-tabs-row"
            >
              <strong class="reverse-tabs-title">识别结果</strong>
              <span
                v-if="!selectedCount"
                class="reverse-trial-hint"
                >先在推荐画师里选几位</span
              >
              <button
                class="btn reverse-run-trials"
                :disabled="!canCompare"
                :title="compareTitle"
                @click="startCompareClick"
              >
                <Icon
                  name="compare"
                  :size="14"
                />对比画师 · {{ Math.min(selectedCount, COMPARE_MAX) }} 张
              </button>
              <button
                class="btn primary reverse-run-trials"
                :disabled="!canTune"
                :title="tuneTitle"
                @click="startTuneClick"
              >
                <Icon
                  name="sliders"
                  :size="14"
                />调优比例 · 最多 {{ TUNE_MAX_IMAGES }} 张
              </button>
            </div>
          </div>
        </section>
        <ReversePrompt
          ref="fullPrompt"
          :file="image"
          :disabled="busy"
          :evidence="promptContent"
          :artist-style="mixParts.map((part) => `${part.weight}::artist:${part.name}::`).join(', ')"
          :tags="filteredTags.map((tag) => tag.name)"
          :character-tags="characterCandidates"
        >
          <template #tags-heading>
            <div class="reverse-panel-head">
              <span>{{ result ? '画面标签分类' : '提示词标签分类' }}</span>
              <span
                v-if="result"
                class="reverse-meta"
                >{{ filteredTags.length }} 个标签 · {{ result.seconds.toFixed(1) }} 秒</span
              >
              <button
                class="icon-btn sm"
                :disabled="!content.trim()"
                title="复制画面内容"
                aria-label="复制画面内容"
                @click="copy(content)"
              >
                <Icon
                  name="copy"
                  :size="14"
                />
              </button>
            </div>
          </template>
          <template #tags-notices>
            <p
              v-for="notice in notices"
              :key="notice"
              class="reverse-notice"
            >
              {{ notice }}
            </p>
          </template>
        </ReversePrompt>
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
.reverse-local-text {
  margin: 0;
  padding: 12px;
  color: var(--text2);
  font: 12px/1.8 var(--mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}

.reverse-analysis-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 14px;
}

.reverse-analysis-toolbar .btn {
  margin-left: auto;
}

.reverse-analysis-hint {
  color: var(--muted);
  font-size: 12px;
}

.reverse-candidates {
  padding: 0 12px 10px;
}

.reverse-settings::details-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.reverse-settings:not([open]) > :not(summary) {
  display: none;
}

.reverse-settings > summary {
  padding: 8px 0;
  color: var(--text2);
  font-size: 12px;
  cursor: pointer;
}

.reverse-local-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.reverse-view {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
  padding: 16px 20px;

  /* 页面本身不滚动（滚动在右栏内），不预留滚动条槽，左右边距一致 */
  overflow: hidden;
}

.reverse-topbar {
  display: flex;
  align-items: center;
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
  flex-direction: row;
  flex-shrink: 0;
  margin: 0;
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

.reverse-model-toggle {
  margin-left: auto;
  flex-shrink: 0;
}

.reverse-rerun {
  flex-shrink: 0;
  gap: 5px;
}

/* 识别模型改过、结果仍是旧的：提醒重新识别 */
.reverse-rerun.attention {
  border-color: var(--pink-line);
  color: var(--pink-deep);
  background: var(--pink-soft);
}

.reverse-start {
  gap: 8px;
  height: 40px;
  padding: 0 22px;
  font-size: 14px;
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
  grid-template-columns: var(--reverse-reference-width, minmax(240px, 0.8fr)) 0 minmax(
      380px,
      1.2fr
    );
  grid-template-rows: minmax(0, 1fr);

  /* 中间 0 宽列是分隔条，两侧各 6px 合计仍是 12px */
  gap: 12px 6px;
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

  /* 始终预留滚动条槽，右内边距减去槽宽，滚动条出现与否左右视觉一致、内容不挤动 */
  scrollbar-gutter: stable;
  padding: 14px calc(14px - var(--scrollbar-size)) 14px 14px;
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

.recognition-dots {
  display: flex;
  gap: 6px;
}

.recognition-dots i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--pink);
  animation: dot 1.2s ease-in-out infinite;
}

.recognition-dots i:nth-child(2) {
  animation-delay: 150ms;
}

.recognition-dots i:nth-child(3) {
  animation-delay: 300ms;
}

.reverse-recognition-empty p {
  margin: 0;
}

.reverse-recognition-empty span {
  color: var(--muted);
  font-size: 11px;
}

/* 分页栏：左侧分页，右侧固定「试图 N 张」，不用滚到底部 */
.reverse-tabs-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.reverse-tabs-title {
  margin-right: auto;
  font-size: 13px;
  white-space: nowrap;
}

.reverse-trial-hint {
  color: var(--muted);
  font-size: 11.5px;
}

.reverse-run-trials {
  flex-shrink: 0;
  gap: 6px;
}

/* 推测组成：分段条 + 图例（名称 · 占比 · 权重） */
.reverse-mix {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px 14px;
  border-bottom: 1px solid var(--line);
}

.reverse-mix header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
}

.reverse-mix header strong {
  font-size: 14px;
}

.reverse-mix-kind {
  padding: 1px 8px;
  border-radius: 999px;
  color: var(--pink-deep);
  background: var(--pink-soft);
  font-size: 11px;
}

.reverse-mix-kind + .reverse-mix-switch {
  margin-left: auto;
}

.reverse-mix header small {
  color: var(--muted);
  font-size: 11px;
}

.reverse-mix-bar {
  display: flex;
  gap: 2px;
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
}

.reverse-mix-bar span {
  flex-basis: 0;
  transition: flex-grow var(--dur-slow) var(--ease-glide);
}

.reverse-mix-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
}

.reverse-mix-legend li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.reverse-mix-legend i {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.reverse-mix-legend span {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reverse-mix-legend b {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.reverse-mix-legend code {
  color: var(--muted);
  font: 11px var(--mono);
}

.reverse-mix-switch {
  color: var(--pink-deep);
  font-size: 11.5px;
  white-space: nowrap;
}

.reverse-mix-switch:hover {
  text-decoration: underline;
}

.reverse-mix-included {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  color: var(--text2);
  font-size: 12px;
}

.reverse-match-status {
  min-width: 0;
  overflow: hidden;
  color: var(--text2);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  position: relative;
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

/*
 * 角色识别的框选工具：浮在参考图底部，不另占一行，
 * 切到「角色识别」时淡入、切走时淡出，参考图尺寸始终不变。
 */
.reverse-crop-tools {
  position: absolute;
  bottom: 14px;
  left: 50%;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  align-items: center;
  max-width: calc(100% - 28px);
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgb(255 255 255 / 92%);
  box-shadow: var(--shadow-pop);
  backdrop-filter: blur(8px);
  translate: -50% 0;
}

/* 框选模式开启时按钮保持选中态 */
.reverse-crop-tools .btn[aria-pressed='true'] {
  border-color: var(--pink-line);
  color: var(--pink-deep);
  background: var(--pink-soft);
}

.reverse-crop-tools span {
  padding: 0 6px;
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

.reverse-notice {
  margin: 0;
  padding: 6px 12px;
  border-top: 1px solid var(--line);
  color: var(--alias);
  font-size: 11px;
  line-height: 1.5;
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
    scrollbar-gutter: stable;
    padding-right: calc(12px - var(--scrollbar-size));
  }

  .reverse-workspace.is-recognition {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto;
    flex: none;
  }

  .reverse-split {
    display: none;
  }

  .reverse-input {
    height: clamp(280px, 45vh, 480px);
  }

  .reverse-adjustments {
    overflow: visible;
  }
}
</style>
