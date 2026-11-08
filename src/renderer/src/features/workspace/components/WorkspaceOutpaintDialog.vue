<script setup lang="ts">
import { reportError } from '../../../shared/lib/notifications'
import type { NaiVersion } from '@shared/generation/types'
import { subscriptionState, refreshSubscription } from '../../generation/subscription'
/**
 * 扩图：需要预览新画布并逐边调整，单独使用对话框。
 * 放大、增强参数较少，改用工具栏按钮下方的轻量面板（WorkspaceToolPopover）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { PageImageTool } from '@shared/workspace/model'
import { pageImageToolSize } from '@shared/workspace/model'
import Icon from '../../../shared/ui/Icon.vue'
import { toolBlockedReason, toolCostNote } from '../image-tool-rules'

refreshSubscription().catch(reportError)

const EXPAND_STEP_PX = 64

const props = defineProps<{
  width: number
  height: number
  imageUrl: string
  count: number
  steps: number
  model: NaiVersion
  disabled: boolean
}>()
const emit = defineEmits<{ run: [tool: PageImageTool]; close: [] }>()

const opened = ref(true)
const expansion = ref({ left: 0, right: 0, top: 0, bottom: 0 })

const sides = [
  { key: 'left', label: '左' },
  { key: 'right', label: '右' },
  { key: 'top', label: '上' },
  { key: 'bottom', label: '下' },
] as const

const presets = [
  { label: '左右 +128', value: { left: 128, right: 128, top: 0, bottom: 0 } },
  { label: '上下 +128', value: { left: 0, right: 0, top: 128, bottom: 128 } },
  { label: '四周 +64', value: { left: 64, right: 64, top: 64, bottom: 64 } },
  { label: '竖图转横', value: null },
] as const

const tool = computed<PageImageTool>(() => ({ kind: 'outpaint', ...expansion.value }))
const source = computed(() => ({
  width: props.width,
  height: props.height,
  count: props.count,
  steps: props.steps,
  version: props.model,
}))
const resultSize = computed(() => pageImageToolSize(tool.value, props.width, props.height))
const hasExpansion = computed(() => Object.values(expansion.value).some((size) => size > 0))
const blockedReason = computed(() => toolBlockedReason(tool.value, source.value))
const costNote = computed(() =>
  toolCostNote(
    tool.value,
    source.value,
    subscriptionState.error ? undefined : subscriptionState.subscription,
  ),
)

/** 预览框：原图在扩展后画布里的位置 */
const previewBox = computed(() => {
  const total = resultSize.value
  const boxMax = 180
  const ratio = Math.min(boxMax / total.width, boxMax / total.height)
  return {
    outer: { width: `${total.width * ratio}px`, height: `${total.height * ratio}px` },
    inner: {
      left: `${expansion.value.left * ratio}px`,
      top: `${expansion.value.top * ratio}px`,
      width: `${props.width * ratio}px`,
      height: `${props.height * ratio}px`,
    },
  }
})

function adjust(side: keyof typeof expansion.value, delta: number) {
  const next = expansion.value[side] + delta
  expansion.value[side] = Math.min(2048, Math.max(0, next))
}

function applyPreset(value: (typeof presets)[number]['value']) {
  if (value) {
    expansion.value = { ...value }
    return
  }
  // 竖图转横：左右对称扩展到与高度相同的宽度
  const extra = Math.max(0, Math.ceil((props.height - props.width) / 2 / EXPAND_STEP_PX)) * 64
  expansion.value = { left: extra, right: extra, top: 0, bottom: 0 }
}

function run() {
  if (props.disabled || blockedReason.value) {
    return
  }
  emit('run', JSON.parse(JSON.stringify(tool.value)))
  opened.value = false
}

function close() {
  opened.value = false
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    close()
  }
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <Teleport to="body">
    <Transition
      name="modal"
      appear
      @after-leave="emit('close')"
    >
      <div
        v-if="opened"
        class="pit-mask"
        @pointerdown.self="close"
      >
        <div
          class="pit-dialog modal-panel"
          role="dialog"
          aria-label="扩图"
        >
          <div class="pit-head">
            <span class="group-badge pink"
              ><Icon
                name="tool-outpaint"
                :size="14"
            /></span>
            <h3>扩图</h3>
            <span class="pill">当前底稿 {{ width }}×{{ height }}</span>
            <button
              class="icon-btn sm ml-auto"
              title="关闭（Esc）"
              aria-label="关闭"
              @click="close"
            >
              <Icon
                name="x"
                :size="15"
              />
            </button>
          </div>

          <div class="pit-body">
            <div class="pit-main">
              <div class="pit-preview">
                <div
                  class="pit-preview-outer"
                  :class="{ expanding: hasExpansion }"
                  :style="previewBox.outer"
                >
                  <img
                    :src="imageUrl"
                    alt="当前底稿"
                    draggable="false"
                    :style="previewBox.inner"
                  />
                </div>
                <span class="pit-size">
                  {{ width }}×{{ height }} → <b>{{ resultSize.width }}×{{ resultSize.height }}</b>
                </span>
              </div>

              <div class="pit-options">
                <div class="pit-sides">
                  <div
                    v-for="side in sides"
                    :key="side.key"
                    class="pit-side"
                  >
                    <span>{{ side.label }}</span>
                    <button
                      class="icon-btn sm"
                      :aria-label="`${side.label}侧减少 64 像素`"
                      :disabled="!expansion[side.key]"
                      @click="adjust(side.key, -EXPAND_STEP_PX)"
                    >
                      −
                    </button>
                    <b>{{ expansion[side.key] }}</b>
                    <button
                      class="icon-btn sm"
                      :aria-label="`${side.label}侧增加 64 像素`"
                      @click="adjust(side.key, EXPAND_STEP_PX)"
                    >
                      <Icon
                        name="plus"
                        :size="13"
                      />
                    </button>
                  </div>
                </div>
                <div class="pit-presets">
                  <button
                    v-for="preset in presets"
                    :key="preset.label"
                    class="btn ghost small"
                    @click="applyPreset(preset.value)"
                  >
                    {{ preset.label }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="pit-foot">
            <span
              class="small"
              :class="blockedReason ? 'pit-warn' : 'muted'"
            >
              {{ blockedReason || costNote }}
            </span>
            <button
              class="btn ghost"
              @click="close"
            >
              取消
            </button>
            <button
              class="btn accent"
              :disabled="disabled || !!blockedReason"
              @click="run"
            >
              <Icon
                name="tool-outpaint"
                :size="15"
              />开始扩图
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.pit-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: calc(var(--titlebar-safe-height) + 24px) 24px 24px;
  background: var(--scrim);
  backdrop-filter: blur(3px);
}

.pit-dialog {
  display: flex;
  flex-direction: column;
  width: 560px;
  max-width: 100%;
  max-height: 100%;
  background: var(--panel);
  border: 1px solid var(--line2);
  border-radius: 18px;
  box-shadow: var(--shadow-modal);
  overflow: hidden;
}

.pit-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line);
}

.pit-head h3 {
  margin: 0;
  font-size: 14px;
}

.pit-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px;
  overflow: auto;
}

.pit-description {
  margin: 0;
  color: var(--text2);
  font-size: 12px;
  line-height: 1.7;
}

.pit-main {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}

.pit-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.pit-preview-outer {
  position: relative;
  border-radius: 6px;
  background: var(--hover);
  transition:
    width var(--dur-base) var(--ease-glide),
    height var(--dur-base) var(--ease-glide);
}

.pit-preview-outer.expanding {
  background: repeating-linear-gradient(
    45deg,
    var(--pink-soft),
    var(--pink-soft) 6px,
    transparent 6px,
    transparent 12px
  );
  outline: 1px dashed var(--pink-line);
}

.pit-preview-outer img {
  position: absolute;
  object-fit: fill;
  border-radius: 4px;

  /* 小尺寸预览随扩图边距移动，只过渡实际变化的定位与尺寸 */
  transition:
    left var(--dur-base) var(--ease-glide),
    top var(--dur-base) var(--ease-glide),
    width var(--dur-base) var(--ease-glide),
    height var(--dur-base) var(--ease-glide);
}

.pit-size {
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.pit-size b {
  color: var(--text);
}

.pit-options {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pit-sides {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.pit-side {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px 4px 10px;
  border: 1px solid var(--line2);
  border-radius: 10px;
  font-size: 12px;
}

.pit-side > span {
  color: var(--text2);
  margin-right: auto;
}

.pit-side b {
  min-width: 34px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.pit-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pit-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--line);
}

.pit-foot > span {
  margin-right: auto;
}

.pit-warn {
  color: var(--bad);
}
</style>
