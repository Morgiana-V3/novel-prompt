<script setup lang="ts">
import { reportError } from '../../shared/lib/notifications'
import { promptState } from './state'
import { settingsState } from '../settings/state'
import { usePagePresentation } from '../../shared/lib/page-presentation'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AiCharacter, AiOptimizeResult, AiPreviousRound } from '@shared/prompts/types'
import { copy, toast } from '../../shared/lib/notifications'
import { sectionText, workKey, current } from './actions'
import { cleanErr } from '../../shared/lib/format'
import { vAutosize, resizeWithin } from '../../shared/lib/autosize'
import { type ReviewGroup, type ReviewField } from './prompt-review'
import Icon from '../../shared/ui/Icon.vue'
import RunButton from '../../shared/ui/RunButton.vue'
import Mascot from '../../shared/ui/Mascot.vue'
import EvidenceNote from './components/EvidenceNote.vue'
import AiFieldAdoption from './components/AiFieldAdoption.vue'
import AiScopedReview from './components/AiScopedReview.vue'
import AiReviewOverview from './components/AiReviewOverview.vue'
import { usePartialAdoption } from './use-partial-adoption'
import { imageState } from '../generation/public'
import { activeTask, cancelTask } from '../../shared/state/tasks'
import { usePageShortcuts } from '../../shared/lib/shortcuts'
import { lockTabs, tabRef } from '../creation/public/session'
import type { DesktopState, FrontendContext, FrontendRequest } from '@shared/contracts/desktop'

const { navigate, isActive } = usePagePresentation()

/**
 * 一个输入框，按当前提示词自动决定做什么：
 * - 当前提示词为空：把描述生成整套提示词（semantic）
 * - 已有提示词：在它的基础上按要求修改（optimize，要求可留空 = 只做规范化检查）
 * - 已有提示词但想推倒重来：勾选「按描述重新生成」，不带当前提示词（semantic）
 * 以前的两个模式本质是同一流程，「描述转提示词」也会带上当前提示词，和「优化 + 额外要求」几乎重合。
 */
const request = tabRef('ai.request', () => '')
const fresh = tabRef('ai.fresh', () => false)
const requestExpanded = tabRef('ai.requestExpanded', () => false)
function toggleRequest(event: Event) {
  if (mode.value === 'optimize') {
    requestExpanded.value = (event.target as HTMLDetailsElement).open
  }
  nextTick(resizeAll).catch(reportError)
}
const hasPrompt = computed(
  () =>
    !!promptState.prompt.trim() ||
    promptState.characters.some((character) => character.prompt.trim()),
)
const mode = computed<'optimize' | 'semantic'>(() =>
  hasPrompt.value && !fresh.value ? 'optimize' : 'semantic',
)
const runLabel = computed(() => (mode.value === 'optimize' ? '优化提示词' : '生成提示词'))
const running = ref(false)
const steps = tabRef<string[]>('ai.steps', () => [])
const result = tabRef<AiOptimizeResult | null>('ai.result', () => null)
const resultSource = tabRef<'internal' | 'external'>('ai.resultSource', () => 'internal')
const error = tabRef('ai.error', () => '')
const task = computed(() => activeTask('optimize'))
function cancelRun() {
  if (task.value) {
    cancelTask(task.value.id).catch(reportError)
  }
}
let offStep: (() => void) | undefined
/** 发起请求时的提示词，用于对比改动 */
const sent = tabRef<{ base: string; negative: string; characters: AiCharacter[] } | null>(
  'ai.sent',
  () => null,
)
/** 结果已经采用到当前提示词 */
const adopted = tabRef('ai.adopted', () => false)
const partial = usePartialAdoption('ai')
const isAdopted = computed(() => partial.all.value)
const sentKey = tabRef('ai.sentKey', () => '')
/** 上一轮发出的修改要求；与上一轮输出一起交给 AI 判断是否已收敛 */
const sentInstruction = tabRef('ai.sentInstruction', () => '')
/** 已达标：AI 判定且程序确认无需修改 */
const converged = computed(() => result.value?.verdict === 'converged')
/** 「按描述重新生成」不带当前提示词，也不带上一轮 */
const scratchless = () => !(fresh.value && hasPrompt.value)
/** 上一轮的输出与修改依据：只有优化模式且有结果时才带上 */
function previousRound(): AiPreviousRound | undefined {
  if (!result.value || !sent.value || mode.value !== 'optimize') {
    return undefined
  }
  return JSON.parse(
    JSON.stringify({
      positive: result.value.positive,
      negative: result.value.negative,
      characters: result.value.characters,
      instruction: sentInstruction.value,
      changes: result.value.changes.map(({ scope, text, basis }) => ({ scope, text, basis })),
      verdict: result.value.verdict,
      reviewKey: result.value.reviewKey,
    }),
  )
}
const presetKey = () =>
  JSON.stringify([
    settingsState.settings?.naiVersion,
    promptState.params.qualityTags,
    promptState.params.qualityMode,
    promptState.params.ucPreset,
  ])
const sentPresetKey = tabRef('ai.sentPresetKey', () => '')
const presetsChanged = computed(() => !!result.value && sentPresetKey.value !== presetKey())
const stale = computed(() => partial.stale.value)

watch(mode, () => {
  if (mode.value === 'semantic') {
    requestExpanded.value = true
  }
  if (!running.value) {
    error.value = ''
  }
})
// 提示词被清空后「重新生成」没有意义，复位，避免下次有了内容时意外不带当前提示词
watch(hasPrompt, (value) => {
  if (!value) {
    fresh.value = false
  }
})

const leftPane = ref<HTMLElement>()
const resizeAll = () => resizeWithin(leftPane.value)

onMounted(() => {
  offStep = window.api.onAiStep('optimize', (text) => {
    if (running.value) {
      steps.value.push(text)
    }
  })
  window.addEventListener('resize', resizeAll)
})
const unlockTabs = lockTabs(() => running.value && '智能优化进行中')
onBeforeUnmount(() => {
  offStep?.()
  unlockTabs()
  window.removeEventListener('resize', resizeAll)
})

// 视图常驻但可能是隐藏状态（v-show），隐藏时量不出内容高度，切回来时重算一次
watch(
  () => isActive('ai'),
  async (active) => {
    if (!active) {
      return
    }
    await nextTick()
    resizeAll()
  },
)
// 当前提示词被其他页面整体替换时（导入、恢复历史），文本框高度要重算
watch(
  () => promptState.characters.length,
  () => nextTick(resizeAll),
)

const review = computed(() => {
  if (!sent.value || !result.value) {
    return []
  }
  return partial.review.value
})
function fieldChanges(group: ReviewGroup, field?: ReviewField) {
  return partial.changes.value.filter((change) => {
    if (!field) {
      return change.kind !== 'text' && change.pairKey === group.key
    }
    if (change.kind !== 'text') {
      return false
    }
    return group.key === 'global'
      ? change.bucket === field.key
      : change.pairKey === group.key && change.field === field.key
  })
}
/** 生图创作里的修改对比：逐段采纳，并带上前后所有角色位置用于位置对比图 */
const scopedProps = computed(() => {
  const roles = (characters: { position?: string }[] = []) =>
    characters.map((character, index) => ({
      label: `角色 ${index + 1}`,
      position: character.position ?? '',
    }))
  return {
    changes: result.value?.changes ?? [],
    changesFor: fieldChanges,
    selected: partial.selected.value,
    positions: { before: roles(sent.value?.characters), after: roles(result.value?.characters) },
    canvas: { width: promptState.params.width, height: promptState.params.height },
    // 与角色位置编辑器相同：用当前预览图做参考底图
    reference:
      imageState.currentImage?.url && imageState.positionReference.visible
        ? { url: imageState.currentImage.url, opacity: imageState.positionReference.opacity }
        : null,
  }
})

async function run() {
  if (running.value) {
    return
  }
  if (!settingsState.settings?.apiKey) {
    error.value = '请先在「设置」中填写 AI 服务的 API Key'
    return
  }
  if (mode.value === 'semantic' && !request.value.trim()) {
    error.value = hasPrompt.value
      ? '重新生成需要画面描述，请在上方写下想要的画面'
      : '请先描述想要的画面，或在下方粘贴已有的提示词'
    return
  }
  const adoptionBase = current('智能优化前')
  partial.reset()
  running.value = true
  error.value = ''
  steps.value = []
  const previous = scratchless() ? previousRound() : undefined
  result.value = null
  resultSource.value = 'internal'
  adopted.value = false
  // 「按描述重新生成」时不带当前提示词，避免 AI 把旧内容当作要保留的部分
  const scratch = fresh.value && hasPrompt.value
  const characters = scratch
    ? []
    : promptState.characters
        .filter((character) => character.prompt.trim())
        .map((character) => ({
          prompt: character.prompt,
          negative: character.negative,
          position: character.position,
        }))
  const base = scratch ? '' : promptState.prompt
  const negative = scratch ? '' : promptState.negative
  sent.value = { base, negative, characters }
  sentKey.value = workKey()
  sentInstruction.value = request.value
  sentPresetKey.value = presetKey()
  try {
    result.value = await window.api.optimize({
      mode: mode.value,
      prompt: base,
      negative,
      characters,
      instruction: request.value,
      ...(previous ? { previous } : {}),
      version: settingsState.settings.naiVersion,
      promptPresets: {
        qualityTags: promptState.params.qualityTags,
        qualityMode: promptState.params.qualityMode,
        ucPreset: promptState.params.ucPreset,
      },
    })
    partial.reset(adoptionBase, {
      base: result.value.positive,
      negative: result.value.negative,
      characters: result.value.characters,
    })
  } catch (error2) {
    error.value = cleanErr(error2)
  } finally {
    running.value = false
  }
}

/** 采用结果：写入当前提示词（写入前自动存历史），可选跳到下一步 */
function toggleChange(id: string) {
  if (partial.toggle(id)) {
    fresh.value = false
  }
}
function toggleChanges(ids: string[]) {
  if (partial.toggleMany(ids)) {
    fresh.value = false
  }
}

function adopt() {
  if (!result.value || !partial.adoptAll()) {
    return
  }
  fresh.value = false
  toast('已采纳全部修改，可逐项取消')
}

function undoAdopt() {
  partial.undoAll()
}

const cheerTitle = computed(() => {
  if (isAdopted.value) {
    return '已采用到当前提示词'
  }
  if (converged.value && !review.value.length) {
    return '本轮无需修改'
  }
  if (result.value?.invalid.length) {
    return '大部分搞定了，还有几个 tag 要你看看'
  }
  return resultSource.value === 'external' ? '外部 Agent 的建议' : '优化好啦！'
})
const fullText = (optimization: AiOptimizeResult) =>
  sectionText({
    base: optimization.positive,
    negative: optimization.negative,
    characters: optimization.characters,
  })

usePageShortcuts(() => isActive('ai'), {
  run,
  cancel: () => task.value && cancelTask(task.value.id),
  canCancel: () => running.value && !!task.value,
})

function desktopState(): NonNullable<DesktopState['creationAi']> {
  return JSON.parse(
    JSON.stringify({
      source: resultSource.value,
      instruction: request.value,
      fresh: fresh.value,
      running: running.value,
      error: error.value,
      result: result.value,
      sent: sent.value,
      adopted: isAdopted.value,
      stale: stale.value,
      presetsChanged: presetsChanged.value,
      changes: partial.changes.value.map((change) => ({
        id: change.id,
        selected: partial.selected.value.has(change.id),
      })),
    }),
  )
}
async function frontendAction(input: FrontendRequest, context: FrontendContext) {
  if (running.value) {
    throw new Error('智能优化仍在运行，请等待完成或取消任务')
  }
  if (input.action === 'creation-ai-config') {
    if (input.instruction !== undefined) {
      request.value = input.instruction
    }
    if (input.fresh !== undefined) {
      fresh.value = input.fresh
    }
    requestExpanded.value = true
    await context.step('已填写智能优化要求，尚未调用 AI')
  } else if (input.action === 'creation-ai-propose') {
    const proposal = input.creation_proposal
    if (!proposal) {
      throw new Error('缺少外部 Agent 建议')
    }
    await context.step('正在展示外部 Agent 建议，尚未采纳')
    const before = current('外部 Agent 建议前')
    const snapshot = {
      base: before.base,
      negative: before.negative,
      characters: before.characters.map(({ prompt, negative, position }) => ({
        prompt,
        negative,
        position,
      })),
    }
    const same = (['base', 'negative', 'characters'] as const).every(
      (key) => JSON.stringify(snapshot[key]) === JSON.stringify(proposal.draft[key]),
    )
    sent.value = snapshot
    sentKey.value = workKey()
    sentInstruction.value = request.value
    sentPresetKey.value = presetKey()
    resultSource.value = 'external'
    error.value = ''
    steps.value = []
    adopted.value = false
    result.value = {
      positive: proposal.draft.base,
      negative: proposal.draft.negative,
      characters: proposal.draft.characters,
      notes: proposal.summary,
      changes: proposal.changes,
      invalid: [],
      dropped: null,
      fidelity: [],
      evidence: { related: [], wiki: [], failed: [], implications: false },
      verdict: same ? 'converged' : 'changes',
      verdictReason: same ? '外部 Agent 本轮未提出提示词修改。' : undefined,
    }
    partial.reset(before, proposal.draft)
  } else if (input.action === 'creation-ai-review') {
    if (!result.value) {
      throw new Error('当前标签没有智能优化结果')
    }
    if (presetsChanged.value) {
      throw new Error('模型或预设已变化，请重新优化')
    }
    const ids = input.change_ids
    if (ids?.some((id) => !partial.changes.value.some((change) => change.id === id))) {
      throw new Error('修改项已变化，请重新读取当前结果')
    }
    await context.step(
      input.decision === 'undo' ? '正在撤销已采用的 AI 修改' : '正在展示并采用 AI 修改',
    )
    let ok: boolean
    if (ids) {
      ok = partial.toggleMany(
        ids.filter((id) => partial.selected.value.has(id) === (input.decision === 'undo')),
      )
    } else {
      ok = input.decision === 'undo' ? partial.undoAll() : partial.adoptAll()
    }
    if (!ok) {
      throw new Error('当前内容与建议冲突，未覆盖手动修改，请重新优化')
    }
    if (input.decision !== 'undo') {
      fresh.value = false
    }
  }
}
defineExpose({ desktopState, frontendAction })
</script>

<template>
  <div
    id="creation-panel-ai"
    role="tabpanel"
    aria-labelledby="creation-tab-ai"
    class="view ai"
  >
    <section class="pane left with-foot creation-request-pane">
      <div
        ref="leftPane"
        class="pane-body scroll compact-request"
      >
        <details
          class="field request-field"
          :open="requestExpanded || mode === 'semantic'"
          @toggle="toggleRequest"
        >
          <summary class="request-summary">
            <span>{{ mode === 'optimize' ? '修改要求（可选）' : '画面描述' }}</span>
          </summary>
          <div class="composer short">
            <textarea
              v-model="request"
              v-autosize
              :placeholder="mode === 'optimize' ? '输入修改要求（可选）' : '描述你想生成的画面'"
            ></textarea>
          </div>
          <label
            v-if="hasPrompt"
            class="fresh-toggle"
          >
            <input
              v-model="fresh"
              type="checkbox"
            />
            <span>按描述重新生成，不保留当前提示词</span>
          </label>
        </details>
      </div>

      <Teleport
        defer
        to="#creation-panel-actions"
      >
        <footer
          v-show="isActive('ai')"
          class="creation-ai-actions creation-action-bar"
        >
          <div class="row run-bar">
            <div class="run-actions">
              <RunButton
                :label="runLabel"
                icon="sparkle"
                running-label="思考中"
                :running="running"
                :can-stop="!!task"
                :stopping="task?.status === 'cancelling'"
                stop-label="取消"
                stopping-label="正在取消"
                stop-title="取消（Esc）"
                @run="run"
                @stop="cancelRun"
              />
            </div>
          </div>
        </footer>
      </Teleport>
    </section>

    <section class="pane right scroll">
      <div
        v-if="error"
        class="error-box"
        role="alert"
      >
        <Icon
          name="warn"
          :size="16"
        />{{ error }}
      </div>
      <div
        v-if="running && !result"
        class="empty"
      >
        <Mascot
          mood="reading"
          motion="loop"
          :size="300"
        />
        <p>
          正在翻 tag 库挑词<span class="dots"><i></i><i></i><i></i></span>
        </p>
      </div>
      <div
        v-else-if="error && !result"
        class="empty"
      >
        <Mascot
          mood="shrug"
          motion="loop"
          :size="280"
        />
        <p>出了点问题，请查看上方的报错信息</p>
      </div>
      <div
        v-else-if="!result"
        class="empty"
      >
        <Mascot
          mood="thumbs"
          motion="loop"
          :size="280"
        />
        <p>等待{{ mode === 'semantic' ? '生成' : '优化' }}提示词</p>
      </div>
      <template v-else>
        <p
          v-if="presetsChanged"
          class="evidence-note warn preset-change-note"
        >
          模型或内置预设已改变，请重新优化以更新建议。
        </p>
        <p
          v-if="stale"
          class="error-box"
        >
          部分内容已另行编辑；采纳或取消时会保留这些编辑，冲突项需重新优化。
        </p>
        <div class="cheer compact-review-heading">
          <div>
            <b>{{ cheerTitle }}</b>
          </div>
          <div
            v-if="!(converged && !review.length)"
            class="actions ml-auto"
          >
            <button
              v-if="isAdopted"
              class="btn small"
              @click="undoAdopt"
            >
              <Icon
                name="undo"
                :size="13"
              />撤销采用
            </button>
            <button
              v-else
              class="btn small primary"
              @click="adopt()"
            >
              <Icon
                name="check"
                :size="13"
              />全部采纳
            </button>
          </div>
        </div>
        <p
          v-if="resultSource === 'external'"
          class="muted"
        >
          来源：外部 Agent。依据见建议说明；本次未调用内置 AI，未执行其自动校验流程。
        </p>

        <div
          v-if="converged || result.stabilized?.length"
          class="verdict-card"
          :class="{ converged }"
          role="status"
        >
          <Icon
            :name="converged ? 'check' : 'warn'"
            :size="15"
          />
          <div>
            <b>{{ converged ? '本轮未发现必要修改' : '部分改写未应用' }}</b>
            <p v-if="result.verdictReason">{{ result.verdictReason }}</p>
            <p
              v-for="note in result.stabilized ?? []"
              :key="note"
              class="muted"
            >
              {{ note }}
            </p>
            <p
              v-if="converged"
              class="muted"
            >
              有新的画面目标或实际图片问题时再调整；无需为了继续优化而改写。
            </p>
          </div>
        </div>
        <AiReviewOverview :notes="result.notes" />
        <AiScopedReview
          id="ai-review-compare"
          role="region"
          aria-label="提示词修改对比"
          :groups="review"
          full-context
          v-bind="scopedProps"
          @toggle="toggleChange"
          @toggle-many="toggleChanges"
        >
          <template #group-adoption="{ group }">
            <AiFieldAdoption
              v-if="fieldChanges(group).length"
              :changes="fieldChanges(group)"
              :selected="partial.selected.value"
              @toggle="toggleChange"
              @toggle-many="toggleChanges"
            />
          </template>
          <template #actions="{ field }">
            <button
              v-if="field.kind === 'prompt' && field.after"
              class="icon-btn sm ml-auto"
              :title="'复制完整' + field.label"
              @click="copy(field.after)"
            >
              <Icon
                name="copy"
                :size="15"
              />
            </button>
          </template>
        </AiScopedReview>
        <p
          v-if="!review.length && !converged"
          class="muted"
        >
          提示词没有变化。
        </p>

        <div class="ai-explanations">
          <div
            v-if="result.invalid.length"
            class="result-card warn-card"
            style="--d: 200ms"
          >
            <div class="result-head">
              <span class="group-badge alias"
                ><Icon
                  name="warn"
                  :size="14"
              /></span>
              <h3>还没通过校验的 tag</h3>
            </div>
            <div class="notes">{{ result.invalid.join(', ') }}</div>
          </div>

          <div
            v-if="result.fidelity?.length"
            class="result-card warn-card"
            style="--d: 210ms"
          >
            <div class="result-head">
              <span class="group-badge alias"
                ><Icon
                  name="warn"
                  :size="14"
              /></span>
              <h3>画面文字被改写了，请手动恢复原文</h3>
            </div>
            <div class="notes">{{ result.fidelity.join('；') }}</div>
          </div>

          <div
            v-if="result.dropped?.length"
            class="result-card warn-card"
            style="--d: 220ms"
          >
            <div class="result-head">
              <span class="group-badge alias"
                ><Icon
                  name="warn"
                  :size="14"
              /></span>
              <h3>原有内容被删掉了，AI 没有说明理由</h3>
            </div>
            <div class="notes">{{ result.dropped?.join(', ') }}</div>
          </div>

          <EvidenceNote
            v-if="resultSource === 'internal'"
            :info="result.evidence"
          />
        </div>

        <div class="row">
          <button
            class="btn"
            @click="copy(fullText(result))"
          >
            <Icon
              name="copy"
              :size="15"
            />复制全部
          </button>
          <button
            class="btn"
            @click="navigate('compare')"
          >
            <Icon
              name="compare"
              :size="15"
            />检查当前提示词
          </button>
          <button
            class="btn"
            @click="navigate('preview')"
          >
            <Icon
              name="eye"
              :size="15"
            />推测当前画面
          </button>
          <button
            class="btn accent"
            @click="navigate('generate')"
          >
            <Icon
              name="image"
              :size="15"
            />查看图片
          </button>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.compact-review-heading {
  padding: 0;
  border: 0;
  background: transparent;
  min-height: 0;
}

.ai-explanations {
  display: grid;
  gap: 16px;
}

.compact-request {
  padding: 8px 16px;
}

.pane.left.creation-request-pane {
  background: var(--bg);
}

.compact-request .request-field {
  gap: 0;
}

.request-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
  cursor: pointer;
  font-size: 12px;
  color: var(--text2);
}

.request-summary::before {
  content: '›';
  font-size: 18px;
}

.request-field[open] > .request-summary::before {
  transform: rotate(90deg);
}

.request-field .composer.short textarea {
  min-height: calc(128px - 2lh);
}

.request-field[open] > .request-summary {
  margin-bottom: 4px;
}
</style>
