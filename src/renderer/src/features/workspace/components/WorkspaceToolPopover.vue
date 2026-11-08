<script setup lang="ts">
import { vSegIndicator } from '../../../shared/lib/seg-indicator'
import { reportError } from '../../../shared/lib/notifications'
import type { NaiVersion } from '@shared/generation/types'
import { subscriptionState, refreshSubscription } from '../../generation/subscription'
/**
 * 放大、增强的轻量确认面板：锚定在工具栏按钮下方，参数少的操作不打开整页对话框。
 * 放大只确认尺寸与花费；增强多出倍数、强度、噪声三个设置。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { PageImageTool } from '@shared/workspace/model'
import { pageImageToolSize } from '@shared/workspace/model'
import Icon from '../../../shared/ui/Icon.vue'
import { toolBlockedReason, toolCostNote } from '../image-tool-rules'

refreshSubscription().catch(reportError)

const POPOVER_WIDTH_PX = 300
const EDGE_GAP_PX = 8

const props = defineProps<{
  kind: 'upscale' | 'enhance'
  /** 触发按钮的位置，用于把面板放在按钮下方 */
  anchor: { left: number; bottom: number }
  width: number
  height: number
  count: number
  steps: number
  model: NaiVersion
  disabled: boolean
}>()
const emit = defineEmits<{ run: [tool: PageImageTool]; close: [] }>()

const panel = ref<HTMLElement>()
const enhance = ref<{ scale: 1 | 1.5; strength: number; noise: number }>({
  scale: 1.5,
  strength: 0.5,
  noise: 0,
})

const tool = computed<PageImageTool>(() =>
  props.kind === 'enhance' ? { kind: 'enhance', ...enhance.value } : { kind: 'upscale' },
)
const source = computed(() => ({
  width: props.width,
  height: props.height,
  count: props.kind === 'upscale' ? 1 : props.count,
  steps: props.steps,
  version: props.model,
}))
const resultSize = computed(() => pageImageToolSize(tool.value, props.width, props.height))
const blockedReason = computed(() => toolBlockedReason(tool.value, source.value))
const costNote = computed(() =>
  toolCostNote(
    tool.value,
    source.value,
    subscriptionState.error ? undefined : subscriptionState.subscription,
  ),
)
const title = computed(() => (props.kind === 'enhance' ? '增强' : '放大 2×'))
const hint = computed(() =>
  props.kind === 'enhance'
    ? '以当前图为起点重新采样，修复细节与噪点；强度越高改动越大。'
    : '宽高各放大 2 倍，不改变画面内容，适合定稿后的最后一步。',
)
const position = computed(() => {
  const maxLeft = window.innerWidth - POPOVER_WIDTH_PX - EDGE_GAP_PX
  return {
    top: `${props.anchor.bottom + 6}px`,
    left: `${Math.max(EDGE_GAP_PX, Math.min(props.anchor.left, maxLeft))}px`,
    width: `${POPOVER_WIDTH_PX}px`,
  }
})

function run() {
  if (props.disabled || blockedReason.value) {
    return
  }
  emit('run', JSON.parse(JSON.stringify(tool.value)))
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
}

/** 点击面板外关闭；工具栏按钮由自身切换开关，这里不处理，避免关闭后又被同一次点击重新打开 */
function onPointerDown(event: PointerEvent) {
  const target = event.target as Element
  if (target.closest?.('[data-tool-trigger]')) {
    return
  }
  if (panel.value && !panel.value.contains(target)) {
    emit('close')
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKey, true)
  await nextTick()
  window.addEventListener('pointerdown', onPointerDown, true)
  panel.value?.querySelector<HTMLElement>('button.accent')?.focus({ preventScroll: true })
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('pointerdown', onPointerDown, true)
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="panel"
      class="pw-tool-popover"
      role="dialog"
      :aria-label="title"
      :style="position"
    >
      <div class="ptp-head">
        <Icon
          :name="kind === 'enhance' ? 'tool-enhance' : 'tool-upscale'"
          :size="15"
        />
        <b>{{ title }}</b>
        <span class="ptp-size"
          >{{ width }}×{{ height }} → <b>{{ resultSize.width }}×{{ resultSize.height }}</b></span
        >
      </div>
      <p class="ptp-hint">{{ hint }}</p>

      <template v-if="kind === 'enhance'">
        <div class="ptp-field">
          <span class="side-label">放大倍数</span>
          <div
            v-seg-indicator
            class="seg"
          >
            <button
              :class="{ on: enhance.scale === 1 }"
              @click="enhance.scale = 1"
            >
              1×
            </button>
            <button
              :class="{ on: enhance.scale === 1.5 }"
              @click="enhance.scale = 1.5"
            >
              1.5×
            </button>
          </div>
        </div>
        <label class="ptp-field">
          <span class="side-label">强度 · {{ enhance.strength.toFixed(2) }}</span>
          <input
            v-model.number="enhance.strength"
            class="range"
            type="range"
            min="0.2"
            max="0.8"
            step="0.05"
          />
        </label>
        <label class="ptp-field">
          <span class="side-label">噪声 · {{ enhance.noise.toFixed(2) }}</span>
          <input
            v-model.number="enhance.noise"
            class="range"
            type="range"
            min="0"
            max="0.5"
            step="0.05"
          />
        </label>
      </template>

      <div class="ptp-foot">
        <span
          class="small"
          :class="blockedReason ? 'ptp-warn' : 'muted'"
          >{{ blockedReason || costNote }}</span
        >
        <button
          class="btn small ghost"
          @click="emit('close')"
        >
          取消
        </button>
        <button
          class="btn small accent"
          :disabled="disabled || !!blockedReason"
          @click="run"
        >
          {{ kind === 'enhance' ? '增强' : '放大' }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.pw-tool-popover {
  position: fixed;
  z-index: 90;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--line2);
  border-radius: 12px;
  background: var(--panel);
  box-shadow: var(--shadow-modal);
  transform-origin: top left;
  animation: pop var(--dur-base) var(--ease-glide);
}

.ptp-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.ptp-head .icon {
  color: var(--pink);
}

.ptp-size {
  margin-left: auto;
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.ptp-size b {
  color: var(--text);
}

.ptp-hint {
  margin: 0;
  color: var(--text2);
  font-size: 12px;
  line-height: 1.6;
}

.ptp-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ptp-field .seg {
  align-self: flex-start;
}

.ptp-foot {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ptp-foot > span {
  margin-right: auto;
}

.ptp-warn {
  color: var(--bad);
}
</style>
