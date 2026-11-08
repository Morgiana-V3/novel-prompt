<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AiOptimizeResult, InpaintDraft } from '@shared/prompts/types'
import type { NaiGenRequest } from '@shared/generation/types'
import type { FrontendRequest, FrontendContext } from '@shared/contracts/desktop'
import {
  MAX_CHARACTERS,
  isGridPosition,
  parsePosition,
  joinPrompt,
} from '@shared/generation/presets'
import ReversePromptResult from './ReversePromptResult.vue'
import ReverseTagBoard from './ReverseTagBoard.vue'
import { importGenerationRequest } from '../prompts/public/import-export'
import { openTabForLoad } from '../creation/public/navigation'
import { generationParams } from '../generation/public'
import { promptState } from '../prompts/public/draft'
import { settingsState } from '../settings/state'
import { activeTask } from '../../shared/state/tasks'
import { shellState } from '../../shared/state/shell'
import { cleanErr } from '../../shared/lib/format'
import { reportError, toast } from '../../shared/lib/notifications'

const props = withDefaults(
  defineProps<{
    file?: File
    disabled: boolean
    artistStyle: string
    tags?: string[]
    characterTags?: string[]
  }>(),
  { file: undefined, tags: () => [], characterTags: () => [] },
)
const draft = ref<InpaintDraft>({ base: '', negative: '', characters: [] })
const version = computed(() => settingsState.settings?.naiVersion ?? 'v5')
const dimensions = ref<{ width: number; height: number } | null>(null)
const params = computed(() => ({
  ...promptState.params,
  ...generationParams,
  ...dimensions.value,
  qualityTags: false,
  ucPreset: 'none' as const,
  seed: null,
  count: 1,
}))
const includeArtist = ref(true)
const artist = computed(() => (includeArtist.value ? props.artistStyle : ''))
const proposal = ref<AiOptimizeResult | null>(null)
const notes = ref('')
const diagnostics = ref<string[]>([])
const error = ref('')
const composing = ref(false)
const cancelRequested = ref(false)
const running = computed(() => composing.value)
const locked = computed(() => props.disabled || running.value)
const hasDraft = computed(
  () => !!draft.value.base.trim() || draft.value.characters.some((role) => role.prompt.trim()),
)
const displayedDraft = computed(() =>
  proposal.value
    ? {
        base: proposal.value.positive,
        negative: proposal.value.negative,
        characters: proposal.value.characters,
      }
    : draft.value,
)
// 仅识图稿也可展示分类；复用本地词库解析，避免把英文描述或负面词当作标签。
const promptTags = ref<string[]>([])
const promptCharacters = ref<string[]>([])
const explanationTags = computed(() => (props.tags.length ? props.tags : promptTags.value))
const explanationCharacters = computed(() =>
  props.characterTags.length ? props.characterTags : promptCharacters.value,
)
watch(
  () =>
    [
      props.tags.length,
      displayedDraft.value.base,
      ...displayedDraft.value.characters.map((role) => role.prompt),
    ] as const,
  async ([localCount, ...texts], _previous, onCleanup) => {
    let stale = false
    onCleanup(() => {
      stale = true
    })
    promptTags.value = []
    promptCharacters.value = []
    if (localCount || !texts.some((text) => text.trim())) {
      return
    }
    try {
      const analyses = await Promise.all(
        texts.filter((text) => text.trim()).map((text) => window.api.analyze(text)),
      )
      if (stale) {
        return
      }
      const tokens = analyses
        .flatMap((analysis) => analysis.tokens)
        .filter(
          (token) =>
            token.status !== 'natural' &&
            token.status !== 'text' &&
            token.weight > 0 &&
            token.prefix !== 'artist:' &&
            (token.tag ?? token.aliasOf)?.category !== 1,
        )
      const label = (token: (typeof tokens)[number]) =>
        (token.tag ?? token.aliasOf)?.display ?? token.core
      promptCharacters.value = tokens
        .filter((token) => (token.tag ?? token.aliasOf)?.category === 4)
        .map(label)
      promptTags.value = tokens
        .filter((token) => (token.tag ?? token.aliasOf)?.category !== 4)
        .map(label)
    } catch (cause) {
      if (!stale) {
        reportError(cause)
      }
    }
  },
  { immediate: true },
)
const progress = computed(() =>
  composing.value ? activeTask('optimize')?.message || '正在分析参考图…' : '',
)
watch(
  () => activeTask('optimize')?.id,
  (id) => {
    if (id && composing.value && cancelRequested.value) {
      void window.api.tasksCancel(id).catch(reportError)
    }
  },
)
const problems = computed(() => {
  const result: string[] = []
  if (draft.value.characters.length > MAX_CHARACTERS[version.value]) {
    result.push(
      `当前模型最多支持 ${MAX_CHARACTERS[version.value]} 条角色提示词，请切回反推时的模型或重新反推`,
    )
  }
  draft.value.characters.forEach((role, index) => {
    if (
      role.position?.trim() &&
      (!parsePosition(role.position) ||
        (version.value === 'v4.5' && !isGridPosition(role.position)))
    ) {
      result.push(
        `角色 ${index + 1} 的位置无效：${version.value === 'v4.5' ? '当前模型需要 A1~E5，请重新反推' : '请重新反推以获取有效坐标'}`,
      )
    }
  })
  return result
})

watch(
  () => props.file,
  async (file) => {
    draft.value = { base: '', negative: '', characters: [] }
    proposal.value = null
    notes.value = ''
    diagnostics.value = []
    includeArtist.value = true
    dimensions.value = null
    error.value = ''
    if (!file) {
      return
    }
    try {
      const bitmap = await createImageBitmap(file)
      const ratio = Math.min(2, Math.max(0.5, bitmap.width / bitmap.height))
      bitmap.close()
      if (props.file !== file) {
        return
      }
      dimensions.value = {
        width: Math.floor(Math.sqrt(1024 * 1024 * ratio) / 64) * 64,
        height: Math.floor(Math.sqrt((1024 * 1024) / ratio) / 64) * 64,
      }
    } catch (cause) {
      error.value = `读取图片尺寸失败：${cleanErr(cause)}`
    }
  },
  { immediate: true },
)

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取参考图失败'))
    reader.readAsDataURL(file)
  })
}

async function compose(
  actionId?: string,
  evidence: { tags: string[]; characters: string[] } = { tags: [], characters: [] },
) {
  if (!props.file || composing.value || activeTask('optimize')) {
    throw new Error('请先选择参考图并等待当前任务完成')
  }
  composing.value = true
  cancelRequested.value = false
  error.value = ''
  try {
    const model = version.value
    const referenceImage = await readImage(props.file)
    if (cancelRequested.value) {
      throw new Error('已取消反推')
    }
    const result = await window.api.optimize(
      {
        mode: 'semantic',
        prompt: '',
        negative: '',
        characters: [],
        version: model,
        promptPresets: { qualityTags: params.value.qualityTags, ucPreset: params.value.ucPreset },
        referenceImage,
        instruction: `根据参考图生成完整生图配置，保留画面内容、构图、角色关系和可读文字，推断合适的负面词与角色位置。不要猜测画师，画师参考由独立的本地模型提供。
本地识别候选（可能错误）：${JSON.stringify(evidence)}
characters 是本地识别出的角色身份 tag 候选，不是已分配的人物顺序。结合参考图的外观、服装与道具判断每个候选对应谁；确认匹配的身份 tag 必须写入对应 characters[].prompt，不能仅在说明里提及或只保留外观。多格中同一角色每次出现都保留该身份 tag。不把所有身份混入全局或每个角色，不按候选列表顺序盲目分配；无法确认或与画面冲突的候选不强加，并在 assessment 说明。`,
      },
      actionId,
    )
    if (cancelRequested.value) {
      throw new Error('已取消反推，原草稿保留')
    }
    if (model !== version.value) {
      throw new Error('全局模型已切换，请按当前模型重新反推；原草稿保留')
    }
    applyResult(result)
  } catch (cause) {
    error.value = cleanErr(cause)
    throw cause
  } finally {
    composing.value = false
  }
}
function applyResult(result: AiOptimizeResult) {
  draft.value = JSON.parse(
    JSON.stringify({
      base: result.positive,
      negative: result.negative,
      characters: result.characters,
    }),
  )
  notes.value = result.notes
  diagnostics.value = [
    ...(result.invalid.length ? [`仍需确认的标签：${result.invalid.join('、')}`] : []),
    ...(result.warnings ?? []),
  ]
  proposal.value = null
}
function adopt() {
  if (proposal.value && !locked.value) {
    applyResult(proposal.value)
  }
}
function request(style = artist.value): NaiGenRequest {
  if (proposal.value || !hasDraft.value || problems.value.length) {
    throw new Error(problems.value.join('；') || '请先采纳完整提示词草稿')
  }
  return JSON.parse(
    JSON.stringify({
      ...draft.value,
      base: joinPrompt(style, draft.value.base),
      version: version.value,
      params: params.value,
    }),
  )
}
async function transfer() {
  if (locked.value) {
    throw new Error('请等待反推完成')
  }
  const candidate = request()
  if (!openTabForLoad(`反推 · ${props.file?.name ?? '参考图'}`)) {
    throw new Error('暂时无法打开生图标签，反推草稿已保留')
  }
  await importGenerationRequest(candidate, '已带入完整反推提示词')
  shellState.tab = 'generate'
}
async function copy() {
  await window.api.copy(JSON.stringify(request(), null, 2))
  toast('已复制完整生图配置')
}
async function cancel() {
  if (composing.value) {
    cancelRequested.value = true
    const task = activeTask('optimize')
    if (task) {
      await window.api.tasksCancel(task.id)
    }
  }
}
function desktopState() {
  return {
    reference: props.file?.name ?? '',
    draft: draft.value,
    proposal: proposal.value,
    version: version.value,
    params: params.value,
    artist: artist.value,
    running: running.value,
    error: error.value,
  }
}
async function frontendAction(input: FrontendRequest, context: FrontendContext) {
  if (locked.value) {
    throw new Error('图片反推正在处理，请稍后再操作')
  }
  await context.step(input.label)
  const abort = () => {
    void cancel().catch(reportError)
  }
  context.signal.addEventListener('abort', abort, { once: true })
  try {
    if (input.action === 'reverse-compose') {
      await compose(context.actionId)
    } else if (input.action === 'reverse-propose') {
      if (!props.file || !input.reverse_proposal) {
        throw new Error('请先载入参考图并提供完整草稿')
      }
      const candidate = input.reverse_proposal
      if (candidate.draft.characters.length > MAX_CHARACTERS[version.value]) {
        throw new Error('角色条目超过目标模型上限')
      }
      proposal.value = {
        positive: candidate.draft.base,
        negative: candidate.draft.negative,
        characters: JSON.parse(JSON.stringify(candidate.draft.characters)),
        notes: `外部 Agent 建议：${candidate.summary}`,
        invalid: [],
        dropped: null,
        fidelity: [],
        changes: [],
        warnings: ['此稿由外部 Agent 提交，未运行内置 AI 复查，请核对其查词依据与画面判断。'],
        evidence: { related: [], wiki: [], failed: [], implications: false },
      }
    } else if (input.action === 'reverse-adopt') {
      if (!proposal.value) {
        throw new Error('没有待采纳的反推方案')
      }
      adopt()
    } else if (input.action === 'reverse-transfer') {
      await transfer()
    }
  } finally {
    context.signal.removeEventListener('abort', abort)
  }
}
defineExpose({
  running,
  hasDraft,
  progress,
  compose,
  cancel,
  request,
  desktopState,
  frontendAction,
})
</script>

<template>
  <section
    v-if="running || error || proposal || hasDraft || tags.length || characterTags.length"
    class="reverse-prompt"
    aria-label="完整生图提示词"
  >
    <section
      v-if="explanationTags.length || explanationCharacters.length"
      class="tag-explanation"
    >
      <slot name="tags-heading" />
      <ReverseTagBoard
        :tags="explanationTags"
        :character-tags="explanationCharacters"
      />
      <slot name="tags-notices" />
    </section>
    <header>
      <strong>完整提示词</strong>
      <span
        v-if="running"
        class="hint"
        role="status"
        >{{ progress }}</span
      >
      <button
        v-if="hasDraft && !proposal"
        class="btn small primary"
        :disabled="locked || !!problems.length"
        @click="transfer().catch(reportError)"
      >
        带入生图
      </button>
    </header>
    <p
      v-if="error"
      class="error"
      role="alert"
    >
      {{ error }}
    </p>
    <template v-if="proposal || hasDraft">
      <div
        v-if="proposal"
        class="actions"
      >
        <span class="hint">外部建议 · 待确认</span>
        <button
          class="btn small primary"
          :disabled="locked"
          @click="adopt"
        >
          采纳草稿
        </button>
        <button
          class="btn small"
          :disabled="locked"
          @click="proposal = null"
        >
          放弃建议
        </button>
      </div>
      <ReversePromptResult :draft="displayedDraft" />
      <div
        v-if="!proposal"
        class="actions"
      >
        <label
          v-if="artistStyle"
          class="artist-choice"
          ><input
            v-model="includeArtist"
            type="checkbox"
            :disabled="locked"
          />带入时包含推荐画师串</label
        >
        <button
          class="btn small ghost"
          :disabled="locked || !!problems.length"
          @click="copy().catch(reportError)"
        >
          复制完整配置
        </button>
      </div>
      <p
        v-for="problem in problems"
        :key="problem"
        class="error"
      >
        {{ problem }}
      </p>
      <p
        v-for="diagnostic in diagnostics"
        :key="diagnostic"
        class="error"
      >
        {{ diagnostic }}
      </p>
      <section
        v-if="proposal?.notes || notes || diagnostics.length"
        class="observations"
      >
        <h4>反推说明</h4>
        <p>{{ proposal?.notes || notes }}</p>
        <p
          v-for="notice in [...(proposal?.warnings ?? []), ...(proposal?.invalid ?? [])]"
          :key="notice"
        >
          {{ notice }}
        </p>
      </section>
    </template>
  </section>
</template>

<style scoped>
.tag-explanation {
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}

.reverse-prompt {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.reverse-prompt header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 13px;
}

.reverse-prompt header .btn {
  margin-left: auto;
}

.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.artist-choice {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.hint,
.observations {
  color: var(--text2);
  font-size: 12px;
  line-height: 1.6;
}

.observations {
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.observations h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 500;
}

.observations p {
  margin: 8px 0 0;
  user-select: text;
}

.error {
  margin: 0;
  color: var(--bad);
  font-size: 12px;
  line-height: 1.6;
}
</style>
