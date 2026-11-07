<script setup lang="ts">
import { promptState } from './state'
import { settingsState } from '../settings/state'
import { skillsState } from '../skills/state'
import { usePagePresentation } from '../../shared/lib/page-presentation'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { AiPreviewResult, Confidence, PreviewPoint } from '@shared/prompts/types'
import { copy, toast } from '../../shared/lib/notifications'
import { workKey } from './actions'
import { cleanErr } from '../../shared/lib/format'
import Icon from '../../shared/ui/Icon.vue'
import Mascot from '../../shared/ui/Mascot.vue'
import BasisPill from './components/BasisPill.vue'
import EvidenceNote from './components/EvidenceNote.vue'
import type { IconName } from '../../shared/ui/icons'
import { activeTask, cancelTask } from '../../shared/state/tasks'
import { usePageShortcuts } from '../../shared/lib/shortcuts'
import { lockTabs, tabRef } from '../creation/public/session'

const { navigate, isActive, editor } = usePagePresentation()

const running = ref(false)
const steps = tabRef<string[]>('preview.steps', () => [])
const error = tabRef('preview.error', () => '')
const task = computed(() => activeTask('preview'))
let offStep: (() => void) | undefined
/** 推测结果存在全局，图片预览可以拿它和实际出图对照 */
const result = computed(() => promptState.lastPreview?.result ?? null)
const stale = computed(
  () => !!promptState.lastPreview && !running.value && promptState.lastPreview.key !== workKey(),
)

onMounted(() => {
  offStep = window.api.onAiStep('preview', (text) => {
    if (running.value) {
      steps.value.push(text)
    }
  })
})
const unlockTabs = lockTabs(() => running.value && '画面推测进行中')
onBeforeUnmount(() => {
  offStep?.()
  unlockTabs()
})

function openSkill() {
  skillsState.skillPanel = true
}

/* ---------- 推测 ---------- */
async function run() {
  if (running.value) {
    return
  }
  if (!settingsState.settings?.apiKey) {
    error.value = '请先在「应用设置 → AI 服务 → 模型接口」中填写 API Key'
    return
  }
  if (
    !promptState.prompt.trim() &&
    !promptState.characters.some((character) => character.prompt.trim())
  ) {
    error.value = '请先输入主提示词或角色提示词'
    return
  }
  running.value = true
  error.value = ''
  steps.value = []
  const key = workKey()
  try {
    const preview = await window.api.preview({
      base: promptState.prompt,
      negative: promptState.negative,
      characters: promptState.characters
        .filter((character) => character.prompt.trim())
        .map((character) => ({ ...character })),
      params: { ...promptState.params },
      expectation: '',
      forecastOnly: true,
      version: settingsState.settings.naiVersion,
    })
    promptState.lastPreview = { key, result: preview }
  } catch (error2) {
    error.value = cleanErr(error2)
  } finally {
    running.value = false
  }
}

/* ---------- 结果 ---------- */
const CONF_LABEL: Record<Confidence, { text: string; cls: string }> = {
  high: { text: '较确定', cls: 'ok' },
  medium: { text: '大概率', cls: 'alias' },
  low: { text: '推测', cls: '' },
}
const RISK_LABEL: Record<Confidence, { text: string; cls: string }> = {
  high: { text: '高', cls: 'bad' },
  medium: { text: '中', cls: 'alias' },
  low: { text: '低', cls: '' },
}
const POINTS: {
  key: 'style' | 'composition' | 'scene' | 'lighting'
  label: string
  icon: IconName
  badge: string
}[] = [
  { key: 'style', label: '画风', icon: 'sparkle', badge: 'pink' },
  { key: 'composition', label: '构图镜头', icon: 'frame', badge: 'nl' },
  { key: 'scene', label: '场景', icon: 'scene', badge: 'ok' },
  { key: 'lighting', label: '光影色调', icon: 'sun', badge: 'alias' },
]
const points = computed(() =>
  result.value
    ? POINTS.map((section) => ({
        ...section,
        point: result.value![section.key] as PreviewPoint,
      })).filter((section) => section.point.text)
    : [],
)

/** AI 常把多个 tag 合成一条（"a, b, c"），拆开分别展示；数值权重 n::a, b:: 内部的逗号不拆 */
function splitTags(text: string): string[] {
  const out: string[] = []
  let buf = ''
  let inWeight = false
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('::', i)) {
      inWeight = !inWeight
      buf += '::'
      i++
      continue
    }
    const ch = text[i]
    if (!inWeight && /[,，、/]/.test(ch)) {
      out.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  out.push(buf)
  return [...new Set(out.map((text2) => text2.trim()).filter(Boolean))]
}

/** 点击 tag 在左侧输入框中定位；负面相关的 tag 优先在负面里找 */
function locateTag(tag: string, preferNeg = false) {
  const core = tag
    .replace(/^-?\d+(\.\d+)?::\s*/, '')
    .replace(/\s*::$/, '')
    .replace(/[{}[\]]/g, '')
    .trim()
    .toLowerCase()
  if (!core) {
    return
  }
  const needles = [...new Set([core, core.replace(/ /g, '_'), core.replace(/^artist:\s*/, '')])]
  const els = [...(editor()?.querySelectorAll<HTMLTextAreaElement>('textarea[data-src]') ?? [])]
  if (preferNeg) {
    els.sort(
      (leftTextarea, rightTextarea) =>
        Number(rightTextarea.dataset.src === 'neg') - Number(leftTextarea.dataset.src === 'neg'),
    )
  }
  for (const el of els) {
    const text = el.value.toLowerCase()
    for (const text2 of needles) {
      const i = text.indexOf(text2)
      if (i < 0) {
        continue
      }
      el.scrollIntoView({
        block: 'center',
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      })
      el.focus({ preventScroll: true })
      el.setSelectionRange(i, i + text2.length)
      return
    }
  }
  toast('输入框里没找到这个 tag')
}

function resultText(preview: AiPreviewResult): string {
  const parts = [`【画面】\n${preview.summary}`]
  for (const section of POINTS) {
    if (preview[section.key].text) {
      parts.push(`【${section.label}】\n${preview[section.key].text}`)
    }
  }
  preview.characters.forEach((character) =>
    parts.push(
      `【${character.name}${character.position ? ' · ' + character.position : ''}】\n${character.text}`,
    ),
  )
  if (preview.emphasis.length) {
    parts.push(
      `【被强调】\n${preview.emphasis.map((effect) => `- ${effect.tag}：${effect.effect}`).join('\n')}`,
    )
  }
  if (preview.suppressed.length) {
    parts.push(
      `【被压制】\n${preview.suppressed.map((effect) => `- ${effect.tag}：${effect.effect}`).join('\n')}`,
    )
  }
  if (preview.risks.length) {
    parts.push(
      `【风险】\n${preview.risks.map((risk) => `- [${RISK_LABEL[risk.level].text}] ${risk.text}${risk.evidence ? `（依据：${risk.evidence}）` : ''}`).join('\n')}`,
    )
  }
  return parts.join('\n\n')
}

function toGenerate() {
  navigate('generate')
}

usePageShortcuts(() => isActive('preview'), {
  run,
  cancel: () => task.value && cancelTask(task.value.id),
  canCancel: () => running.value && !!task.value,
})
</script>

<template>
  <div
    id="creation-panel-preview"
    role="tabpanel"
    aria-labelledby="creation-tab-preview"
    class="view preview"
  >
    <section class="pane left with-foot">
      <Teleport
        defer
        to="#creation-panel-actions"
      >
        <footer
          v-show="isActive('preview')"
          class="creation-preview-actions creation-action-bar"
        >
          <div class="row run-bar">
            <button
              class="icon-btn"
              aria-label="推测 Skill"
              @click="openSkill"
            >
              <Icon name="layers" />
            </button>
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
                @click="run"
              >
                <Icon
                  name="eye"
                  :size="14"
                  :class="{ 'spin-slow': running }"
                />
                {{ running ? '正在想象' : '开始推测' }}
              </button>
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
        v-if="running"
        class="empty"
      >
        <Mascot
          mood="search"
          motion="loop"
          :size="300"
        />
        <p>
          正在脑内作画<span class="dots"><i></i><i></i><i></i></span>
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
        <p>推测失败，请查看上方错误信息</p>
      </div>
      <div
        v-else-if="!result"
        class="empty"
      >
        <Mascot
          mood="search"
          motion="loop"
          :size="280"
        />
        <p>点击「开始推测」查看当前提示词可能生成的画面。</p>
      </div>
      <template v-else>
        <div
          v-if="stale"
          class="evidence-note warn"
        >
          <Icon
            name="warn"
            :size="14"
          />
          <div class="evidence-text">
            当前提示词或参数在推测之后改过了，下面的结果可能已经过期。<button
              class="link-btn"
              @click="run"
            >
              重新推测
            </button>
          </div>
        </div>
        <div class="forecast-meta muted small">
          仅为文字推测 · {{ CONF_LABEL[result.confidence].text }}
        </div>

        <div
          class="result-card"
          style="--d: 0ms"
        >
          <div class="result-head">
            <span class="group-badge pink"
              ><Icon
                name="eye"
                :size="14"
            /></span>
            <h3>画面描述</h3>
            <button
              class="icon-btn sm ml-auto"
              title="复制"
              @click="copy(result.summary)"
            >
              <Icon
                name="copy"
                :size="15"
              />
            </button>
          </div>
          <div class="notes lead">{{ result.summary }}</div>
        </div>

        <div
          v-if="points.length"
          class="point-grid"
        >
          <div
            v-for="(p, index) in points"
            :key="p.key"
            class="result-card"
            :style="{ '--d': (index + 1) * 60 + 'ms' }"
          >
            <div class="result-head">
              <span :class="['group-badge', p.badge]"
                ><Icon
                  :name="p.icon"
                  :size="14"
              /></span>
              <h3>{{ p.label }}</h3>
              <span :class="['pill ml-auto', CONF_LABEL[p.point.confidence].cls]">{{
                CONF_LABEL[p.point.confidence].text
              }}</span>
            </div>
            <div class="notes">{{ p.point.text }}</div>
            <div
              v-if="p.point.tags.length"
              class="point-tags"
            >
              <button
                v-for="tag in p.point.tags"
                :key="tag"
                class="chip sm"
                title="在左侧定位"
                @click="locateTag(tag)"
              >
                {{ tag }}
              </button>
            </div>
          </div>
        </div>

        <div
          v-for="(character, index) in result.characters"
          :key="'c' + index"
          class="result-card"
          :style="{ '--d': 280 + index * 60 + 'ms' }"
        >
          <div class="result-head">
            <span class="group-badge nl"
              ><Icon
                name="user"
                :size="14"
            /></span>
            <h3>{{ character.name }}</h3>
            <span
              v-if="character.position"
              class="muted small"
              >{{ character.position }}</span
            >
            <span :class="['pill ml-auto', CONF_LABEL[character.confidence].cls]">{{
              CONF_LABEL[character.confidence].text
            }}</span>
          </div>
          <div class="notes">{{ character.text }}</div>
          <div
            v-if="character.tags.length"
            class="point-tags"
          >
            <button
              v-for="tag in character.tags"
              :key="tag"
              class="chip sm"
              title="在左侧定位"
              @click="locateTag(tag)"
            >
              {{ tag }}
            </button>
          </div>
        </div>

        <div
          v-if="result.emphasis.length || result.suppressed.length"
          class="split-grid"
        >
          <div
            v-if="result.emphasis.length"
            class="result-card"
            style="--d: 320ms"
          >
            <div class="result-head">
              <span class="group-badge alias"
                ><Icon
                  name="sparkle"
                  :size="14"
              /></span>
              <h3>被强调的元素</h3>
            </div>
            <div class="effect-list">
              <div
                v-for="(e, index) in result.emphasis"
                :key="index"
                class="effect-row stack"
                :style="{ '--i': index }"
              >
                <div class="effect-tags">
                  <button
                    v-for="tagItem in splitTags(e.tag)"
                    :key="tagItem"
                    class="chip sm tone-up"
                    title="在左侧定位"
                    @click="locateTag(tagItem)"
                  >
                    {{ tagItem }}
                  </button>
                </div>
                <span class="grow">{{ e.effect }}</span>
              </div>
            </div>
          </div>
          <div
            v-if="result.suppressed.length"
            class="result-card"
            style="--d: 360ms"
          >
            <div class="result-head">
              <span class="group-badge bad"
                ><Icon
                  name="stop"
                  :size="14"
              /></span>
              <h3>被负面压制的</h3>
            </div>
            <div class="effect-list">
              <div
                v-for="(e, index) in result.suppressed"
                :key="index"
                class="effect-row stack"
                :style="{ '--i': index }"
              >
                <div class="effect-tags">
                  <button
                    v-for="tagItem in splitTags(e.tag)"
                    :key="tagItem"
                    class="chip sm tone-down"
                    title="在左侧定位"
                    @click="locateTag(tagItem, true)"
                  >
                    {{ tagItem }}
                  </button>
                </div>
                <span class="grow">{{ e.effect }}</span>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="result.risks.length"
          class="result-card warn-card"
          style="--d: 400ms"
        >
          <div class="result-head">
            <span class="group-badge alias"
              ><Icon
                name="warn"
                :size="14"
            /></span>
            <h3>画面中的不确定性</h3>
            <span class="group-count">{{ result.risks.length }}</span>
          </div>
          <div class="effect-list">
            <div
              v-for="(risk, index) in result.risks"
              :key="index"
              class="effect-row"
              :style="{ '--i': index }"
            >
              <span class="meta">
                <span :class="['pill', RISK_LABEL[risk.level].cls]">{{
                  RISK_LABEL[risk.level].text
                }}</span>
                <BasisPill :basis="risk.basis" />
              </span>
              <div class="grow">
                {{ risk.text }}
                <span
                  v-if="risk.evidence"
                  class="evidence"
                  >{{ risk.evidence }}</span
                >
                <div
                  v-if="risk.tags.length"
                  class="row-tags"
                >
                  <button
                    v-for="tag in risk.tags"
                    :key="tag"
                    class="chip sm"
                    title="在左侧定位"
                    @click="locateTag(tag)"
                  >
                    {{ tag }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <EvidenceNote :info="result.evidence" />

        <div class="row">
          <button
            class="btn"
            @click="copy(resultText(result))"
          >
            <Icon
              name="copy"
              :size="15"
            />复制推测结果
          </button>
          <button
            class="btn accent"
            @click="toGenerate"
          >
            <Icon
              name="image"
              :size="15"
            />去生图验证
          </button>
        </div>
      </template>
    </section>
  </div>
</template>
