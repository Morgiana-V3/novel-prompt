<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ReverseTrial } from './use-reverse-trials'
import { importGenerationRequest } from '../prompts/public/import-export'
import { openTabForLoad } from '../creation/public/navigation'
import { selectReferenceImage } from '../generation/public'
import { cleanErr } from '../../shared/lib/format'
import { shellState } from '../../shared/state/shell'
import { sendToArtistStudio } from '../artists/public/handoff'
import { parsePrompt } from '@shared/prompts/parser'
import Icon from '../../shared/ui/Icon.vue'
import { reportError, toast } from '../../shared/lib/notifications'
import { backdropCloser } from '../../shared/lib/dialog-motion'

const props = defineProps<{
  index: number
  /** 显示名称，如「第 2 轮 · 方案 3」；不传时为「方案 N」 */
  title?: string
  stylePrompt?: string
  trial?: ReverseTrial
  disabled?: boolean
  status: string
  /** 本轮按风格相似度的名次（1 为最像）与有分数的方案数 */
  rank?: number
  total?: number
}>()
const emit = defineEmits<{ retry: [] }>()
const actionBusy = ref(false)
const actionError = ref('')
const retained = ref(false)
async function act(action: 'retain' | 'adopt') {
  const trial = props.trial
  if (!trial?.image || props.disabled || actionBusy.value) {
    return
  }
  actionBusy.value = true
  actionError.value = ''
  try {
    if (action === 'adopt') {
      if (!openTabForLoad()) {
        return
      }
      await importGenerationRequest(JSON.parse(JSON.stringify(trial.request)), '已采用反推方案')
      selectReferenceImage(trial.image)
      shellState.tab = 'generate'
    } else {
      if (
        !retained.value &&
        trial.image.storage !== 'saved' &&
        trial.image.storage !== 'workspace'
      ) {
        await window.api.naiRetain(trial.image.name)
      }
      retained.value = true
    }
  } catch (error) {
    actionError.value = cleanErr(error)
  } finally {
    actionBusy.value = false
  }
}
watch(
  () => [props.trial?.image?.name, props.trial?.image?.url],
  () => {
    retained.value = props.trial?.image?.storage === 'saved'
    actionError.value = ''
  },
  { immediate: true },
)
/** 带到画师调试：这次的内容、角色和画师作为底稿，试图出的图直接作为基准图，不用重新生成 */
function toArtistStudio() {
  const trial = props.trial
  if (!trial?.image || props.disabled) {
    return
  }
  sendToArtistStudio({
    kind: 'reverse',
    id: trial.image.name,
    title: `反推 · ${trial.style || '无画师对照'}`,
    request: JSON.parse(JSON.stringify(trial.request)),
    image: trial.image,
  })
}
/** 画师串拆成「名字 × 权重」标签，比整串文字好读 */
const artists = computed(() =>
  parsePrompt(props.trial?.style ?? props.stylePrompt ?? '')
    .filter((token) => token.prefix === 'artist:')
    .map((token) => ({ name: token.core, weight: token.weight })),
)
/** 余弦相似度通常落在 0.4～1 之间，映射成进度条长度 */
const scorePercent = computed(() => {
  const score = props.trial?.score
  return score === undefined ? 0 : Math.round(Math.min(1, Math.max(0, (score - 0.4) / 0.6)) * 100)
})
const displayTitle = computed(() => props.title ?? `方案 ${props.index + 1}`)
const isBest = computed(() => props.rank === 1 && (props.total ?? 0) > 1)
function copyStyle() {
  const style = props.trial?.style ?? props.stylePrompt ?? ''
  if (!style) {
    return
  }
  window.api
    .copy(style)
    .then(() => toast('画师串已复制'))
    .catch(reportError)
}
/* ---------- 完整提示词与参数：侧栏空间有限，改用弹窗查看 ---------- */
const detailDialog = ref<HTMLDialogElement>()
function openDetails() {
  detailDialog.value?.showModal()
}
function closeDetails() {
  detailDialog.value?.close()
}
const detailBackdrop = backdropCloser(() => closeDetails())
function copyText(text: string) {
  if (!text) {
    return
  }
  window.api
    .copy(text)
    .then(() => toast('已复制'))
    .catch(reportError)
}
function retain() {
  act('retain').catch(reportError)
}
function adopt() {
  act('adopt').catch(reportError)
}
function retry() {
  emit('retry')
}
const styleLabel = computed(() => {
  const style = props.trial?.style ?? props.stylePrompt
  return style === undefined ? '识别后推荐画师组合' : style || '无画师对照'
})
</script>

<template>
  <article
    class="reverse-trial-inspector"
    :aria-label="`${displayTitle} 信息`"
  >
    <header class="ti-head">
      <h3>{{ displayTitle }}</h3>
      <span
        v-if="isBest"
        class="ti-best"
        >最佳配置</span
      >
      <span class="ti-status">{{ status }}</span>
    </header>

    <div class="inspector-body">
      <section class="ti-section">
        <h4>
          画师
          <button
            class="icon-btn sm"
            :disabled="!artists.length"
            title="复制画师串"
            aria-label="复制画师串"
            @click="copyStyle"
          >
            <Icon
              name="copy"
              :size="13"
            />
          </button>
        </h4>
        <div
          v-if="artists.length"
          class="ti-artists"
          :title="styleLabel"
        >
          <span
            v-for="artist in artists"
            :key="artist.name"
            class="ti-artist"
            ><span>{{ artist.name }}</span
            ><b v-if="artist.weight !== 1">× {{ artist.weight }}</b></span
          >
        </div>
        <p
          v-else
          class="ti-muted"
        >
          {{ styleLabel }}
        </p>
      </section>

      <section
        v-if="trial?.score !== undefined"
        class="ti-section"
      >
        <h4
          title="用 K3 模型分别提取参考图和这张图的画风特征，计算两者的余弦相似度；越接近 1 越像，仅供参考"
        >
          风格相似度
        </h4>
        <div class="ti-score">
          <b>{{ trial.score.toFixed(3) }}</b>
          <span v-if="rank && total && total > 1">全部 {{ total }} 张中第 {{ rank }}</span>
        </div>
        <div
          class="ti-meter"
          aria-hidden="true"
        >
          <i :style="{ width: `${scorePercent}%` }"></i>
        </div>
      </section>

      <p
        v-if="trial?.error"
        class="preview-error"
      >
        {{ trial.error }}
      </p>

      <section
        v-if="trial?.image"
        class="ti-actions"
      >
        <div class="ti-primary">
          <button
            class="btn"
            :disabled="disabled || actionBusy"
            title="在生图创作中打开这套配置"
            @click="adopt"
          >
            <Icon
              name="generate"
              :size="14"
            />生图创作
          </button>
          <button
            class="btn primary"
            :disabled="disabled || actionBusy"
            title="作为底稿带到画师调试，继续调整画师与权重"
            @click="toArtistStudio"
          >
            <Icon
              name="palette"
              :size="14"
            />画师调试
          </button>
        </div>
        <div class="ti-secondary">
          <button
            class="ti-link"
            :disabled="disabled || actionBusy || retained"
            :title="retained ? '这张图已留存' : '留存到图库，不随临时文件清理'"
            @click="retain"
          >
            <Icon
              :name="retained ? 'check' : 'download'"
              :size="13"
            />{{ retained ? '已留存' : '留存' }}
          </button>
          <button
            class="ti-link"
            :disabled="disabled || actionBusy"
            title="同样的画师与内容，换一个种子再出一张"
            @click="retry"
          >
            <Icon
              name="dice"
              :size="13"
            />换种子再试
          </button>
        </div>
      </section>
      <p
        v-if="actionError"
        class="preview-error"
        role="alert"
      >
        {{ actionError }}
      </p>
      <button
        v-if="trial?.request"
        class="ti-details-entry"
        @click="openDetails"
      >
        <Icon
          name="file"
          :size="13"
        />查看完整提示词与参数
      </button>
    </div>
    <dialog
      v-if="trial?.request"
      ref="detailDialog"
      class="ti-dialog"
      :aria-label="`${displayTitle} 的完整提示词与参数`"
      @pointerdown="detailBackdrop.onPointerdown"
      @click="detailBackdrop.onClick"
    >
      <header>
        <h3>{{ displayTitle }} · 完整提示词与参数</h3>
        <button
          class="icon-btn"
          aria-label="关闭"
          @click="closeDetails"
        >
          <Icon
            name="x"
            :size="18"
          />
        </button>
      </header>
      <div class="ti-dialog-body">
        <div class="ti-params">
          <span>{{ trial.request.version.toUpperCase() }}</span>
          <span>{{ trial.request.params.width }} × {{ trial.request.params.height }}</span>
          <span>{{ trial.request.params.steps }} 步</span>
          <span>种子 {{ trial.request.params.seed }}</span>
          <span>Guidance {{ trial.request.params.scale }}</span>
          <span>Rescale {{ trial.request.params.cfgRescale }}</span>
          <span>{{ trial.request.params.sampler }}</span>
          <span>{{ trial.request.params.noiseSchedule }}</span>
          <span>质量词{{ trial.request.params.qualityTags ? '开启' : '关闭' }}</span>
          <span>UC {{ trial.request.params.ucPreset }}</span>
        </div>
        <section class="ti-prompt">
          <h4>
            主提示词<button
              class="icon-btn sm"
              title="复制主提示词"
              aria-label="复制主提示词"
              @click="copyText(trial.request.base)"
            >
              <Icon
                name="copy"
                :size="13"
              />
            </button>
          </h4>
          <pre>{{ trial.request.base || '无' }}</pre>
        </section>
        <section class="ti-prompt">
          <h4>负面提示词</h4>
          <pre :class="{ empty: !trial.request.negative }">{{
            trial.request.negative || '无'
          }}</pre>
        </section>
        <section
          v-for="(character, roleIndex) in trial.request.characters"
          :key="roleIndex"
          class="ti-prompt"
        >
          <h4>
            角色 {{ roleIndex + 1 }}<small>位置 {{ character.position || '自动' }}</small
            ><button
              class="icon-btn sm"
              :title="`复制角色 ${roleIndex + 1}`"
              :aria-label="`复制角色 ${roleIndex + 1}`"
              @click="copyText(character.prompt)"
            >
              <Icon
                name="copy"
                :size="13"
              />
            </button>
          </h4>
          <pre>{{ character.prompt }}</pre>
          <template v-if="character.negative">
            <h4>角色负面</h4>
            <pre>{{ character.negative }}</pre>
          </template>
        </section>
      </div>
    </dialog>
  </article>
</template>

<style scoped>
.reverse-trial-inspector {
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 18px calc(18px - var(--scrollbar-size)) 18px 18px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  background: var(--bg);
  font-size: 12px;
}

.ti-head {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  margin-bottom: 16px;
}

.ti-head h3 {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: 14px;
  text-overflow: ellipsis;
}

.ti-best {
  padding: 1px 8px;
  border-radius: 999px;
  color: var(--pink-deep);
  background: var(--pink-soft);
  font-size: 11px;
  font-weight: 600;
}

.ti-status {
  margin-left: auto;
  color: var(--muted);
  font-size: 11px;
}

.inspector-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-wrap: anywhere;
  line-height: 1.6;
}

.ti-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ti-section h4 {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  margin: 0;
  white-space: nowrap;
  color: var(--text2);
  font-size: 11.5px;
  font-weight: 600;
}

.ti-section h4 small {
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 400;
}

.ti-section h4 .icon-btn {
  margin-left: auto;
}

.ti-artists {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ti-artist {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  max-width: 100%;
  padding: 4px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--panel);
  font-size: 12px;
}

.ti-artist > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ti-artist b {
  flex-shrink: 0;
  color: var(--pink-deep);
  font: 600 11px var(--mono);
}

.ti-muted {
  margin: 0;
  color: var(--muted);
}

.ti-score {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.ti-score b {
  font-size: 22px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.ti-score span {
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
}

.ti-meter {
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--hover);
}

.ti-meter i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--pink);
  transition: width var(--dur-slow) var(--ease-glide);
}

.preview-error {
  margin: 0;
  color: var(--bad);
}

/* 操作：两个去向并排等宽；留存 / 换种子 / 收藏是轻量的次要操作 */
.ti-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 0;
  border-top: 1px solid var(--line);
}

.ti-primary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.ti-primary .btn {
  justify-content: center;
  gap: 6px;
  min-width: 0;
  padding-inline: 10px;
  white-space: nowrap;
}

.ti-secondary {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ti-link {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  height: 28px;
  padding: 0 8px;
  border-radius: 8px;
  color: var(--text2);
  font-size: 12px;
  transition:
    color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out);
}

.ti-link:hover:not(:disabled) {
  color: var(--pink-deep);
  background: var(--pink-soft);
}

.ti-link:disabled {
  color: var(--muted);
}

.ti-details-entry {
  display: inline-flex;
  white-space: nowrap;
  align-self: flex-start;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  border-radius: 8px;
  color: var(--text2);
  font-size: 12px;
  transition:
    color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out);
}

.ti-details-entry:hover {
  color: var(--pink-deep);
  background: var(--pink-soft);
}

/* 完整提示词弹窗：与画师调试的「查看底稿」一致 */
.ti-dialog {
  flex-direction: column;
  width: min(600px, 92vw);
  max-height: 85dvh;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--line2);
  border-radius: 16px;
  background: var(--bg);
  color: var(--text);
  box-shadow: var(--shadow-modal);
}

/* flex-direction 写在基础类上，[open] 只负责显示：退场期间方向不失效 */
.ti-dialog[open] {
  display: flex;
}

.ti-dialog > header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--line);
}

.ti-dialog > header h3 {
  margin: 0;
  font-size: 15px;
}

.ti-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px calc(20px - var(--scrollbar-size)) 20px 20px;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.ti-params {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ti-params span {
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--text2);
  background: var(--hover);
  font-size: 11px;
}

.ti-prompt {
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
}

.ti-prompt h4 {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 22px;
  margin: 0 0 4px;
  color: var(--text2);
  font-size: 11.5px;
  font-weight: 600;
}

.ti-prompt h4 small {
  color: var(--muted);
  font-weight: 400;
}

.ti-prompt h4 .icon-btn {
  margin-left: auto;
}

.ti-prompt pre {
  max-height: 240px;
  margin: 0;
  overflow: auto;
  color: var(--text);
  font: 11.5px/1.7 var(--mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}

.ti-prompt pre.empty {
  color: var(--muted);
  font-family: inherit;
}
</style>
