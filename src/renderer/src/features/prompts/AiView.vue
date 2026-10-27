<script setup lang="ts">
import { reportError } from '../../shared/lib/notifications'
import { promptState } from './state'
import { settingsState } from '../settings/state'
import { shellState } from '../../shared/state/shell'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AiCharacter, AiOptimizeResult, ChangeScope } from '@shared/prompts/types'
import { copy, toast } from '../../shared/lib/notifications'
import { applyWorkspace, revertTo, sectionText } from './actions'
import { cleanErr } from '../../shared/lib/format'
import { type Tab } from '../../shared/state/shell'
import { type Snapshot } from './state'
import { vAutosize, resizeWithin } from '../../shared/lib/autosize'
import { diffTags, diffSize, type TagDiff } from './tag-diff'
import Icon from '../../shared/ui/Icon.vue'
import Mascot from '../../shared/ui/Mascot.vue'
import PromptEditor from './components/PromptEditor.vue'
import WorkspaceBar from './components/WorkspaceBar.vue'
import BasisPill from './components/BasisPill.vue'
import EvidenceNote from './components/EvidenceNote.vue'
import DiffChips from './components/DiffChips.vue'
import { activeTask, cancelTask } from '../../shared/state/tasks'
import { usePageShortcuts, runKeyLabel, runKeyShort } from '../../shared/lib/shortcuts'

/**
 * 一个输入框，按当前提示词自动决定做什么：
 * - 当前提示词为空：把描述生成整套提示词（semantic）
 * - 已有提示词：在它的基础上按要求修改（optimize，要求可留空 = 只做规范化检查）
 * - 已有提示词但想推倒重来：勾选「按描述重新生成」，不带当前提示词（semantic）
 * 以前的两个模式本质是同一流程，「描述转提示词」也会带上当前提示词，和「优化 + 额外要求」几乎重合。
 */
const request = ref('')
const fresh = ref(false)
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
const steps = ref<string[]>([])
const result = ref<AiOptimizeResult | null>(null)
const error = ref('')
const task = computed(() => activeTask('optimize'))
let offStep: (() => void) | undefined
/** 发起请求时的提示词，用于对比改动 */
const sent = ref<{ base: string; negative: string; characters: AiCharacter[] } | null>(null)
/** 结果已经采用到当前提示词 */
const adopted = ref(false)
/** 采用前那一份历史，撤销时精确回到它（期间可能有导入、清空、Agent 修改等其他历史） */
let beforeAdopt: Snapshot | null = null

watch(mode, () => {
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
onBeforeUnmount(() => {
  offStep?.()
  window.removeEventListener('resize', resizeAll)
})

// 视图常驻但可能是隐藏状态（v-show），隐藏时量不出内容高度，切回来时重算一次
watch(
  () => shellState.tab,
  async (tab) => {
    if (tab !== 'ai') {
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

// 画面推测「带着建议去 AI 优化」：把建议追加到修改要求（保留用户已写的内容，并恢复为保留当前提示词）
watch(
  () => promptState.aiHandoff,
  (handoff) => {
    if (!handoff) {
      return
    }
    promptState.aiHandoff = null
    fresh.value = false
    const mine = request.value.trim()
    if (!mine.includes(handoff.text)) {
      request.value = mine ? `${mine}\n\n${handoff.text}` : handoff.text
    }
    toast(
      handoff.count
        ? `已带入画面推测的 ${handoff.count} 条建议，可修改后点「${runLabel.value}」`
        : `已带入想要的效果，可修改后点「${runLabel.value}」`,
    )
    nextTick(resizeAll).catch(reportError)
  },
  { immediate: true },
)

const charCount = computed(
  () => promptState.characters.filter((character) => character.prompt.trim()).length,
)

const SCOPE_LABEL: Record<ChangeScope, string> = {
  positive: '正向',
  character: '角色',
  negative: '负面',
  optional: '可选建议（未改动提示词）',
}
const changeGroups = computed(() =>
  (Object.keys(SCOPE_LABEL) as ChangeScope[])
    .map((scope) => ({
      scope,
      label: SCOPE_LABEL[scope],
      items: result.value?.changes.filter((change) => change.scope === scope) ?? [],
    }))
    .filter((changeGroup) => changeGroup.items.length),
)

/* ---------- 改动对比：原文为空的段落不显示（描述转提示词时全是新增） ---------- */
const empty: TagDiff = { added: [], removed: [], changed: [] }
const diffs = computed(() => {
  const character = result.value
  const promptSnapshot = sent.value
  if (!character || !promptSnapshot) {
    return null
  }
  const compareTags = (leftText: string, rightText: string) =>
    leftText.trim() ? diffTags(leftText, rightText) : empty
  return {
    base: compareTags(promptSnapshot.base, character.positive),
    negative: compareTags(promptSnapshot.negative, character.negative),
    chars: character.characters.map((character2, i) =>
      compareTags(promptSnapshot.characters[i]?.prompt ?? '', character2.prompt),
    ),
  }
})
const totalChanges = computed(() =>
  diffs.value
    ? diffSize(diffs.value.base) +
      diffSize(diffs.value.negative) +
      diffs.value.chars.reduce((numericValue, difference) => numericValue + diffSize(difference), 0)
    : 0,
)

async function run() {
  if (running.value) {
    return
  }
  if (!settingsState.settings?.apiKey) {
    error.value = '请先在「设置 / 数据」中填写 AI 服务的 API Key'
    return
  }
  if (mode.value === 'semantic' && !request.value.trim()) {
    error.value = hasPrompt.value
      ? '重新生成需要画面描述，请在上方写下想要的画面'
      : '请先描述想要的画面，或在下方粘贴已有的提示词'
    return
  }
  running.value = true
  error.value = ''
  steps.value = []
  result.value = null
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
  try {
    result.value = await window.api.optimize({
      mode: mode.value,
      prompt: base,
      negative,
      characters,
      instruction: request.value,
      version: settingsState.settings.naiVersion,
    })
  } catch (error2) {
    error.value = cleanErr(error2)
  } finally {
    running.value = false
  }
}

/** 采用结果：写入当前提示词（写入前自动存历史），可选跳到下一步 */
function adopt(next?: Tab) {
  const character = result.value
  if (!character) {
    return
  }
  if (!adopted.value) {
    beforeAdopt = applyWorkspace(
      { base: character.positive, negative: character.negative, characters: character.characters },
      'AI 优化前',
    )
    adopted.value = true
    // 采用后当前提示词就是这套新内容，之后继续迭代应该在它基础上改
    fresh.value = false
    nextTick(resizeAll).catch(reportError)
  }
  if (next) {
    shellState.tab = next
  } else {
    toast('已采用，所有页面都会用这套提示词')
  }
}

function undoAdopt() {
  if (revertTo(beforeAdopt, '撤销采用前')) {
    adopted.value = false
    beforeAdopt = null
  }
  nextTick(resizeAll).catch(reportError)
}

const fullText = (optimization: AiOptimizeResult) =>
  sectionText({
    base: optimization.positive,
    negative: optimization.negative,
    characters: optimization.characters,
  })

usePageShortcuts('ai', {
  run,
  cancel: () => task.value && cancelTask(task.value.id),
  canCancel: () => running.value && !!task.value,
})
</script>

<template>
  <div class="view ai">
    <section class="pane left with-foot">
      <div
        ref="leftPane"
        class="pane-body scroll"
      >
        <div class="field">
          <div class="field-head">
            <label class="field-label">{{
              mode === 'optimize' ? '修改要求（可选）' : '画面描述'
            }}</label>
            <span class="muted small ml-auto">{{
              mode === 'optimize'
                ? '留空只做规范化检查：修正错误 tag、冲突、顺序'
                : hasPrompt
                  ? '将不参考下方的当前提示词'
                  : '下方为空，会按描述生成整套提示词'
            }}</span>
          </div>
          <div class="composer short">
            <textarea
              v-model="request"
              v-autosize
              :placeholder="
                mode === 'optimize'
                  ? '例如：风格偏厚涂一点；换成夜景；左边的女孩改成在笑'
                  : '例如：樱花树下的长椅上坐着两个女孩。左边是银发红瞳、穿白色连衣裙的少女，正笑着把头靠在右边女孩的肩上；右边是黑色短发、戴眼镜、穿学生制服的女孩，低头看书。午后阳光，柔和的水彩风。'
              "
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
        </div>

        <WorkspaceBar />

        <div :class="['prompt-group', { 'is-ignored': mode === 'semantic' && hasPrompt }]">
          <PromptEditor
            char-label="角色提示词（可选）"
            :char-hint="hasPrompt ? '多人画面时填写' : '留空则由 AI 按描述拆分'"
            neg-hint="留空则由 AI 按规范生成"
          />
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
          <span
            v-if="charCount && mode === 'optimize'"
            class="pill nl"
            ><i></i>{{ charCount }} 个角色</span
          >
          <div class="run-actions">
            <button
              v-if="running && task"
              class="btn ghost"
              :disabled="task.status === 'cancelling'"
              title="取消（Esc）"
              @click="cancelTask(task.id)"
            >
              {{ task.status === 'cancelling' ? '正在取消…' : '取消' }}
            </button>
            <button
              class="btn accent"
              :disabled="running"
              :title="`${runLabel}（${runKeyLabel}）`"
              @click="run"
            >
              <Icon
                name="sparkle"
                :size="17"
                :class="{ spin: running }"
              />
              {{ running ? '正在思考' : runLabel
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
        v-if="running && !result"
        class="empty"
      >
        <Mascot
          mood="reading"
          :size="240"
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
          mood="oops"
          :size="230"
        />
        <p>出了点问题，看看左边的报错信息吧</p>
      </div>
      <div
        v-else-if="!result"
        class="empty"
      >
        <Mascot
          mood="chill"
          :size="230"
        />
        <p v-if="mode === 'semantic'">
          用中文把画面讲清楚就好。我会数清画面里有几个人，把共享的画风、构图、背景放进主提示词，每个人的外貌、服装、动作拆成单独的角色提示词并排好位置，再给容易串色的角色加上角色负面，最后配一套负面提示词。已有提示词的话，直接粘贴到左边，我会在它的基础上改。
        </p>
        <p v-else>
          我会在当前提示词的基础上按你的要求修改：去本地 Danbooru 库里找真实存在的
          tag，按侧栏里启用的 Skill 排好顺序，最后再检查一遍，不存在的 tag
          会自动换掉，你原有的内容不会被悄悄删掉。结果要点「采用」才会写进当前提示词。
        </p>
      </div>
      <template v-else>
        <div class="cheer">
          <Mascot
            :mood="result.invalid.length ? 'confused' : 'wink'"
            :size="76"
          />
          <div>
            <b>{{
              adopted
                ? '已采用到当前提示词'
                : result.invalid.length
                  ? '大部分搞定了，还有几个 tag 要你看看'
                  : '优化好啦！'
            }}</b>
            <div class="muted small">
              {{
                result.characters.length
                  ? `${result.characters.length} 个角色提示词`
                  : '单角色 / 无角色提示词'
              }}
              <template v-if="totalChanges"> · 共 {{ totalChanges }} 处 tag 改动</template>
            </div>
          </div>
          <div class="actions ml-auto">
            <button
              v-if="adopted"
              class="btn small"
              @click="undoAdopt"
            >
              <Icon
                name="swap"
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
              />采用
            </button>
          </div>
        </div>

        <div
          class="result-card"
          style="--d: 0ms"
        >
          <div class="result-head">
            <span class="group-badge pink"
              ><Icon
                name="sparkle"
                :size="14"
            /></span>
            <h3>{{ result.characters.length ? '主提示词' : '正向提示词' }}</h3>
            <button
              class="icon-btn sm ml-auto"
              title="复制"
              @click="copy(result.positive)"
            >
              <Icon
                name="copy"
                :size="15"
              />
            </button>
          </div>
          <pre class="result-text">{{ result.positive }}</pre>
          <DiffChips
            v-if="diffs"
            :diff="diffs.base"
          />
        </div>

        <div
          v-for="(character, index) in result.characters"
          :key="index"
          class="result-card"
          :style="{ '--d': (index + 1) * 70 + 'ms' }"
        >
          <div class="result-head">
            <span class="group-badge nl"
              ><Icon
                name="user"
                :size="14"
            /></span>
            <h3>角色 {{ index + 1 }}</h3>
            <span
              v-if="character.position"
              class="pill"
              >{{ character.position }}</span
            >
            <button
              class="icon-btn sm ml-auto"
              title="复制"
              @click="copy(character.prompt)"
            >
              <Icon
                name="copy"
                :size="15"
              />
            </button>
          </div>
          <pre class="result-text">{{ character.prompt }}</pre>
          <DiffChips
            v-if="diffs?.chars[index]"
            :diff="diffs.chars[index]"
          />
          <div
            v-if="character.negative"
            class="notes"
          >
            <span class="chip-zh">角色负面：</span>{{ character.negative }}
          </div>
        </div>

        <div
          v-if="result.negative"
          class="result-card"
          style="--d: 140ms"
        >
          <div class="result-head">
            <span class="group-badge bad"
              ><Icon
                name="stop"
                :size="14"
            /></span>
            <h3>负面提示词</h3>
            <button
              class="icon-btn sm ml-auto"
              title="复制"
              @click="copy(result.negative)"
            >
              <Icon
                name="copy"
                :size="15"
              />
            </button>
          </div>
          <pre class="result-text">{{ result.negative }}</pre>
          <DiffChips
            v-if="diffs"
            :diff="diffs.negative"
          />
        </div>

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

        <div
          class="result-card"
          style="--d: 240ms"
        >
          <div class="result-head">
            <span class="group-badge ok"
              ><Icon
                name="book"
                :size="14"
            /></span>
            <h3>修改说明</h3>
            <span
              v-if="result.changes.length"
              class="muted small ml-auto"
              >悬停依据标签查看含义</span
            >
          </div>
          <div
            v-if="result.notes"
            class="notes lead"
          >
            {{ result.notes }}
          </div>
          <div
            v-for="groupItem in changeGroups"
            :key="groupItem.scope"
            class="change-group"
          >
            <div class="change-group-title">{{ groupItem.label }}</div>
            <div class="effect-list">
              <div
                v-for="(entry, index) in groupItem.items"
                :key="index"
                class="effect-row"
                :style="{ '--i': index }"
              >
                <span class="meta"><BasisPill :basis="entry.basis" /></span>
                <div class="grow">
                  {{ entry.text }}
                  <span
                    v-if="entry.evidence"
                    class="evidence"
                    >{{ entry.evidence }}</span
                  >
                </div>
              </div>
            </div>
          </div>
        </div>

        <EvidenceNote :info="result.evidence" />

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
            @click="adopt('compare')"
          >
            <Icon
              name="compare"
              :size="15"
            />{{ adopted ? '' : '采用并' }}逐个比对
          </button>
          <button
            class="btn"
            @click="adopt('preview')"
          >
            <Icon
              name="eye"
              :size="15"
            />{{ adopted ? '' : '采用并' }}推测画面
          </button>
          <button
            class="btn accent"
            @click="adopt('generate')"
          >
            <Icon
              name="image"
              :size="15"
            />{{ adopted ? '' : '采用并' }}生图
          </button>
        </div>
      </template>
    </section>
  </div>
</template>
