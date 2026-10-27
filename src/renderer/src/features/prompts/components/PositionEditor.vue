<script setup lang="ts">
import { promptState } from '../state'
import { imageState } from '../../generation/state'
import { settingsState } from '../../settings/state'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { parsePosition, isGridPosition } from '@shared/generation/presets'
import { pushHistory } from '../actions'
import Icon from '../../../shared/ui/Icon.vue'
import type { AiCharacter } from '@shared/prompts/types'
import type { NaiImage } from '@shared/images/types'
import type { NaiVersion } from '@shared/generation/types'

/**
 * 角色位置编辑器（参考 NovelAI 的 Character Positions）：
 * - V4.5：5×5 网格，拖动后吸附到格子中心，写回 A1~E5
 * - V5：自由坐标，拖动写回 "x,y"（两位小数）；按住 Shift 吸附到网格中心
 * 默认编辑共享角色；提供 characters 时仅编辑调用方草稿。
 */
const props = defineProps<{
  start?: number
  characters?: AiCharacter[]
  version?: NaiVersion
  params?: { width: number; height: number }
  image?: NaiImage | null
}>()
const emit = defineEmits<{ close: [] }>()
const opened = ref(true)
const close = () => {
  opened.value = false
}

const COLORS = [
  '#ff6b9a',
  '#3b82f6',
  '#1f9d68',
  '#c97f00',
  '#7c3aed',
  '#e5484d',
  '#0891b2',
  '#db2777',
]
const COLS = 'ABCDE'
const color = (i: number) => COLORS[i % COLORS.length]

const isV5 = computed(() => (props.version ?? settingsState.settings?.naiVersion) === 'v5')
const chars = computed(() => props.characters ?? promptState.characters)
const dimensions = computed(() => props.params ?? promptState.params)
const localReference = ref({ ...imageState.positionReference })
const referenceSettings = computed(() =>
  props.characters ? localReference.value : imageState.positionReference,
)
const selected = ref(Math.min(props.start ?? 0, Math.max(0, chars.value.length - 1)))

/* ---------- 当前预览图片作为参考底图 ---------- */
const reference = computed(() =>
  props.image !== undefined ? props.image : imageState.currentImage,
)
const referenceSize = ref<{ w: number; h: number } | null>(null)
const referenceError = ref(false)
const showReference = computed(
  () => !!reference.value && referenceSettings.value.visible && !referenceError.value,
)
const ratioMismatch = computed(() => {
  const size = referenceSize.value
  return (
    !!size &&
    Math.abs(size.w / size.h / (dimensions.value.width / dimensions.value.height) - 1) > 0.01
  )
})
watch(
  () => reference.value?.url,
  () => {
    referenceSize.value = null
    referenceError.value = false
  },
)
function onReferenceLoad(event2: Event) {
  const img = event2.target as HTMLImageElement
  referenceSize.value = { w: img.naturalWidth, h: img.naturalHeight }
  referenceError.value = false
}

/* ---------- 画布尺寸：按当前画幅等比缩放，并保证整个弹窗能放进窗口 ---------- */
const MAX_W = 520
const viewH = ref(window.innerHeight)
const onResize = () => (viewH.value = window.innerHeight)
const box = computed(() => {
  const width = dimensions.value.width || 832
  const height = dimensions.value.height || 1216
  const maxH = Math.max(260, Math.min(520, viewH.value - 230))
  const s = Math.min(MAX_W / width, maxH / height)
  return { w: Math.round(width * s), h: Math.round(height * s) }
})

/* ---------- 位置换算 ---------- */
const clamp = (pixelValue: number) => Math.min(1, Math.max(0, pixelValue))
const cellOf = (pixelValue: number) => Math.min(4, Math.max(0, Math.floor(pixelValue * 5)))
const cellCenter = (i: number) => (i + 0.5) / 5
const toGrid = (x: number, y: number) => `${COLS[cellOf(x)]}${cellOf(y) + 1}`
const fmt = (pixelValue: number) => String(Number(clamp(pixelValue).toFixed(2)))

/** 没写位置时生图的自动排布（与 main/nai/client.ts 一致：只算有内容的角色，按顺序从左到右均匀排开） */
const autoPos = (i: number) => {
  const sent = chars.value
    .map((character, field) => (character.prompt.trim() ? field : -1))
    .filter((field) => field >= 0)
  const idx = sent.indexOf(i)
  const numericValue = sent.length || chars.value.length
  const field2 = idx >= 0 ? idx : i
  return { x: Math.round(((field2 + 1) / (numericValue + 1)) * 10) / 10, y: 0.5 }
}

interface Dot {
  i: number
  x: number
  y: number
  set: boolean
  /** 同一点上的第几个，用于错开显示 */
  stack: number
}
const dots = computed<Dot[]>(() => {
  const seen = new Map<string, number>()
  return chars.value.map((character, i) => {
    const position = parsePosition(character.position ?? '')
    const { x, y } = position ?? autoPos(i)
    const key = `${x.toFixed(3)},${y.toFixed(3)}`
    const stack = seen.get(key) ?? 0
    seen.set(key, stack + 1)
    return { i, x, y, set: !!position, stack }
  })
})
const anySet = computed(() => dots.value.some((position) => position.set))

/** V4.5 下被占用的格子：高亮显示 */
const cells = computed(() =>
  isV5.value
    ? []
    : dots.value
        .filter((position) => position.set)
        .map((position) => ({ i: position.i, col: cellOf(position.x), row: cellOf(position.y) })),
)

function write(i: number, x: number, y: number, snap: boolean) {
  const character = chars.value[i]
  if (!character) {
    return
  }
  if (!isV5.value) {
    character.position = toGrid(x, y)
  } else if (snap) {
    character.position = `${fmt(cellCenter(cellOf(x)))},${fmt(cellCenter(cellOf(y)))}`
  } else {
    character.position = `${fmt(x)},${fmt(y)}`
  }
}

/* ---------- 拖动 ---------- */
const canvas = ref<HTMLElement>()
const dragging = ref<number | null>(null)

function pointToXY(pointerEvent: PointerEvent) {
  const bounds = canvas.value!.getBoundingClientRect()
  return {
    x: clamp((pointerEvent.clientX - bounds.left) / bounds.width),
    y: clamp((pointerEvent.clientY - bounds.top) / bounds.height),
  }
}

function onDotDown(pointerEvent: PointerEvent, i: number) {
  pointerEvent.preventDefault()
  pointerEvent.stopPropagation()
  selected.value = i
  dragging.value = i
  ;(pointerEvent.currentTarget as HTMLElement).setPointerCapture(pointerEvent.pointerId)
}
function onDotMove(pointerEvent: PointerEvent, i: number) {
  if (dragging.value !== i) {
    return
  }
  const { x, y } = pointToXY(pointerEvent)
  write(i, x, y, pointerEvent.shiftKey)
}
function onDotUp(pointerEvent: PointerEvent, i: number) {
  if (dragging.value !== i) {
    return
  }
  dragging.value = null
  ;(pointerEvent.currentTarget as HTMLElement).releasePointerCapture(pointerEvent.pointerId)
}

/** 点击画布空白处：把选中的角色放到这里 */
function onCanvasDown(pointerEvent: PointerEvent) {
  if (!chars.value.length) {
    return
  }
  const { x, y } = pointToXY(pointerEvent)
  write(selected.value, x, y, pointerEvent.shiftKey)
  dragging.value = selected.value
  canvas.value!.setPointerCapture(pointerEvent.pointerId)
}
function onCanvasMove(pointerEvent: PointerEvent) {
  if (dragging.value === null) {
    return
  }
  const { x, y } = pointToXY(pointerEvent)
  write(dragging.value, x, y, pointerEvent.shiftKey)
}
function onCanvasUp(pointerEvent: PointerEvent) {
  if (dragging.value === null) {
    return
  }
  dragging.value = null
  if (canvas.value?.hasPointerCapture(pointerEvent.pointerId)) {
    canvas.value.releasePointerCapture(pointerEvent.pointerId)
  }
}

/* ---------- 键盘：方向键微调选中角色 ---------- */
function onKey(event2: KeyboardEvent) {
  if (!opened.value) {
    return
  }
  if (event2.key === 'Escape') {
    close()
    return
  }
  const target = event2.target as HTMLElement | null
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
    return
  }
  const movement = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
    event2.key
  ]
  if (!movement || !chars.value.length) {
    return
  }
  event2.preventDefault()
  const dot = dots.value[selected.value]
  if (!dot) {
    return
  }
  if (!isV5.value) {
    const col = Math.min(4, Math.max(0, cellOf(dot.x) + movement[0]))
    const row = Math.min(4, Math.max(0, cellOf(dot.y) + movement[1]))
    chars.value[selected.value].position = `${COLS[col]}${row + 1}`
  } else {
    const step = event2.shiftKey ? 0.1 : 0.01
    write(selected.value, dot.x + movement[0] * step, dot.y + movement[1] * step, false)
  }
}

/* ---------- 列表操作 ---------- */
function clearOne(i: number) {
  chars.value[i].position = ''
}
function clearAll() {
  for (const character of chars.value) {
    character.position = ''
  }
}
/** 按当前顺序从左到右均匀排开（写成明确的位置） */
function spread() {
  const numericValue = chars.value.length
  chars.value.forEach((_, i) => write(i, (i + 1) / (numericValue + 1), 0.5, false))
}
/** 把坐标写法统一转换成当前版本支持的写法 */
function normalizeAll() {
  dots.value.forEach((position) => position.set && write(position.i, position.x, position.y, false))
}

const excerpt = (text: string) => {
  const text2 = text.replace(/\s+/g, ' ').trim()
  return text2.length > 46 ? `${text2.slice(0, 46)}…` : text2 || '（空）'
}
const posNote = (i: number) => {
  const path = chars.value[i]?.position?.trim()
  if (!path) {
    return anySet.value ? '自动（按顺序排开）' : '未设置（由模型决定）'
  }
  if (!parsePosition(path)) {
    return '写法无法解析，生图时会被忽略'
  }
  if (!isV5.value && !isGridPosition(path)) {
    return '坐标写法，V4.5 只支持网格，拖动后会转换'
  }
  return ''
}
const hasConvertible = computed(() =>
  dots.value.some(
    (position) =>
      position.set && !isV5.value && !isGridPosition(chars.value[position.i].position ?? ''),
  ),
)

watch(
  () => chars.value.length,
  (numericValue) => {
    if (!numericValue) {
      close()
    } else if (selected.value >= numericValue) {
      selected.value = numericValue - 1
    }
  },
)

onMounted(() => {
  if (!props.characters) {
    pushHistory('编辑角色位置之前')
  }
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', onResize)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onResize)
})
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
        class="pos-mask"
        @pointerdown.self="close()"
      >
        <div class="pos-dialog modal-panel">
          <div class="pos-head">
            <span class="group-badge pink"
              ><Icon
                name="frame"
                :size="14"
            /></span>
            <h3>角色位置</h3>
            <span class="pill">{{ isV5 ? 'V5 · 自由坐标' : 'V4.5 · 5×5 网格' }}</span>
            <span class="pill">{{ dimensions.width }}×{{ dimensions.height }}</span>
            <button
              class="icon-btn sm ml-auto"
              title="关闭（Esc）"
              @click="close()"
            >
              <Icon
                name="x"
                :size="15"
              />
            </button>
          </div>

          <div class="pos-body">
            <div class="pos-stage">
              <div
                ref="canvas"
                class="pos-canvas"
                title="拖动圆点或点击定位；方向键微调，Shift 加大步长或吸附网格"
                :class="{
                  'with-reference': showReference && referenceSize && referenceSettings.opacity > 0,
                }"
                :style="{ width: box.w + 'px', height: box.h + 'px' }"
                @pointerdown="onCanvasDown"
                @pointermove="onCanvasMove"
                @pointerup="onCanvasUp"
                @pointercancel="onCanvasUp"
              >
                <img
                  v-if="reference && !referenceError"
                  v-show="showReference"
                  :key="reference.url"
                  class="pos-reference-image"
                  :src="reference.url"
                  :style="{ opacity: referenceSettings.opacity / 100 }"
                  alt="当前预览图片的坐标参考底图"
                  draggable="false"
                  @load="onReferenceLoad"
                  @error="referenceError = true"
                />
                <div class="pos-grid">
                  <div
                    v-for="n in 25"
                    :key="n"
                    class="pos-cell"
                  >
                    <span>{{ COLS[(n - 1) % 5] }}{{ Math.floor((n - 1) / 5) + 1 }}</span>
                  </div>
                </div>
                <div
                  v-for="c in cells"
                  :key="'c' + c.i"
                  class="pos-hl"
                  :style="{ left: c.col * 20 + '%', top: c.row * 20 + '%', '--c': color(c.i) }"
                ></div>
                <div
                  v-for="d in dots"
                  :key="d.i"
                  :class="[
                    'pos-dot',
                    { ghost: !d.set, on: selected === d.i, drag: dragging === d.i },
                  ]"
                  :style="{
                    left: `calc(${d.x * 100}% + ${d.stack * 10}px)`,
                    top: `calc(${d.y * 100}% + ${d.stack * 10}px)`,
                    '--c': color(d.i),
                  }"
                  :title="`角色 ${d.i + 1}${d.set ? '' : '（未设置位置，拖动即可设置）'}`"
                  @pointerdown="onDotDown($event, d.i)"
                  @pointermove="onDotMove($event, d.i)"
                  @pointerup="onDotUp($event, d.i)"
                  @pointercancel="onDotUp($event, d.i)"
                >
                  {{ d.i + 1 }}
                </div>
              </div>
            </div>

            <div class="pos-list">
              <div class="pos-reference">
                <div class="pos-reference-head">
                  <span class="group-badge pink"
                    ><Icon
                      name="image"
                      :size="14"
                  /></span>
                  <b>参考底图</b>
                  <button
                    class="icon-btn sm ml-auto"
                    :class="{ on: showReference }"
                    :disabled="!reference || referenceError"
                    :aria-pressed="showReference"
                    :title="showReference ? '隐藏参考底图' : '显示参考底图'"
                    @click="referenceSettings.visible = !referenceSettings.visible"
                  >
                    <Icon
                      name="eye"
                      :size="15"
                    />
                  </button>
                </div>
                <template v-if="reference && !referenceError">
                  <div
                    class="pos-reference-name"
                    :title="reference.name"
                  >
                    {{ reference.name }}
                  </div>
                  <label class="pos-opacity">
                    <span
                      >底图不透明度 <b>{{ referenceSettings.opacity }}%</b></span
                    >
                    <input
                      v-model.number="referenceSettings.opacity"
                      class="range"
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      :disabled="!showReference"
                      aria-label="底图不透明度"
                    />
                  </label>
                  <div class="pos-reference-note muted">
                    {{
                      ratioMismatch
                        ? '图片比例与当前画幅不同，底图按当前画幅拉伸，点位仍按当前画幅计算。'
                        : '可对照底图拖动角色圆点。'
                    }}
                  </div>
                </template>
                <div
                  v-else
                  class="pos-reference-note muted"
                  role="status"
                >
                  {{
                    referenceError
                      ? '底图加载失败，可回到生图预览重新选择图片。仍可直接编辑坐标。'
                      : '当前没有参考图片，可直接编辑坐标。'
                  }}
                </div>
              </div>
              <div
                v-for="(character, index) in chars"
                :key="index"
                :class="['pos-item', { on: selected === index }]"
                :style="{ '--c': color(index) }"
                @click="selected = index"
              >
                <span class="pos-num">{{ index + 1 }}</span>
                <div class="pos-info">
                  <div class="pos-line">
                    <b>角色 {{ index + 1 }}</b>
                    <input
                      v-model="character.position"
                      class="input sm pos-input"
                      spellcheck="false"
                      :placeholder="isV5 ? '0.3,0.5 或 B3' : 'B3'"
                      @click.stop
                    />
                    <button
                      class="icon-btn sm"
                      title="清除位置"
                      :disabled="!character.position"
                      @click.stop="clearOne(index)"
                    >
                      <Icon
                        name="x"
                        :size="13"
                      />
                    </button>
                  </div>
                  <div class="pos-excerpt">{{ excerpt(character.prompt) }}</div>
                  <div
                    v-if="posNote(index)"
                    class="pos-note"
                  >
                    {{ posNote(index) }}
                  </div>
                </div>
              </div>
              <div class="pos-actions">
                <button
                  class="btn ghost small"
                  title="按角色顺序从左到右均匀排开"
                  @click="spread"
                >
                  <Icon
                    name="align"
                    :size="13"
                  />均匀排开
                </button>
                <button
                  v-if="hasConvertible"
                  class="btn ghost small"
                  @click="normalizeAll"
                >
                  <Icon
                    name="swap"
                    :size="13"
                  />转成网格
                </button>
                <button
                  class="btn ghost small"
                  :disabled="!anySet"
                  title="全部交给模型决定"
                  @click="clearAll"
                >
                  <Icon
                    name="reset"
                    :size="13"
                  />全部清除
                </button>
              </div>
              <details class="pos-help muted">
                <summary>位置说明</summary>
                位置会实时写回角色提示词。全部留空时由模型自行排布；只要有一个角色设了位置，没设的角色会按顺序从左到右排开（虚线圆点）。{{
                  characters
                    ? '完成后返回草稿，保存草稿才会采用修改。'
                    : '打开前的内容已存入历史，可以撤销。'
                }}
              </details>
            </div>
          </div>

          <div class="pos-foot">
            <button
              class="btn primary small"
              @click="close()"
            >
              <Icon
                name="check"
                :size="14"
              />完成
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.pos-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: calc(var(--titlebar-safe-height) + 24px) 24px 24px;
  background: rgb(16 16 20 / 42%);
  backdrop-filter: blur(3px);
}

.pos-dialog {
  display: flex;
  flex-direction: column;
  max-width: 100%;
  max-height: 100%;
  background: #fff;
  border: 1px solid var(--line2);
  border-radius: 18px;
  box-shadow: 0 24px 60px rgb(20 20 30 / 22%);
  overflow: hidden;
}

.pos-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 10px 14px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
}

.pos-head h3 {
  margin: 0;
  font-size: 14px;
}

.pos-body {
  display: flex;
  gap: 16px;
  padding: 16px;
  min-height: 0;
  overflow: auto;
}

.pos-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.pos-canvas {
  position: relative;
  border-radius: 10px;
  overflow: hidden;
  touch-action: none;
  cursor: crosshair;
  background: repeating-conic-gradient(#f6f6f8 0% 25%, #fff 0% 50%) 50% / 20px 20px;
  box-shadow: inset 0 0 0 1px var(--line2);
}

.pos-reference-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  user-select: none;
}

.pos-reference {
  padding: 10px 12px;
  border: 1px solid var(--pink-line);
  border-radius: 12px;
  background: linear-gradient(135deg, var(--pink-soft), #fff);
}

.pos-reference-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.pos-reference-name {
  margin-top: 5px;
  color: var(--text2);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pos-opacity {
  display: block;
  margin-top: 9px;
  font-size: 12px;
  color: var(--text2);
}

.pos-opacity > span {
  display: flex;
  justify-content: space-between;
}

.pos-opacity b {
  color: var(--pink-deep);
  font-family: var(--mono);
  font-weight: 500;
}

.pos-opacity .range {
  display: block;
}

.pos-opacity .range:disabled {
  opacity: 0.4;
  cursor: default;
}

.pos-reference-note {
  font-size: 11.5px;
  line-height: 1.6;
  margin-top: 5px;
}

.pos-grid {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  grid-template-rows: repeat(5, 1fr);
  pointer-events: none;
}

.pos-cell {
  position: relative;
  border-right: 1px dashed var(--line2);
  border-bottom: 1px dashed var(--line2);
}

.pos-cell:nth-child(5n) {
  border-right: none;
}

.pos-cell:nth-child(n + 21) {
  border-bottom: none;
}

.pos-cell span {
  position: absolute;
  left: 5px;
  top: 3px;
  font-size: 10px;
  color: var(--muted);
  font-family: var(--mono);
  opacity: 0.8;
}

.with-reference .pos-cell {
  border-color: rgb(40 42 50 / 30%);
}

.with-reference .pos-cell span {
  padding: 0 3px;
  border-radius: 3px;
  background: rgb(255 255 255 / 80%);
  color: var(--text2);
  opacity: 1;
}

.pos-hl {
  position: absolute;
  width: 20%;
  height: 20%;
  pointer-events: none;
  background: color-mix(in srgb, var(--c) 14%, transparent);
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--c) 55%, transparent);
}

.pos-dot {
  position: absolute;
  width: 30px;
  height: 30px;
  margin: -15px 0 0 -15px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--c);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  cursor: grab;
  user-select: none;
  touch-action: none;
  box-shadow:
    0 0 0 3px #fff,
    0 4px 12px rgb(0 0 0 / 22%);
  transition:
    transform 0.2s var(--bounce),
    box-shadow 0.15s;
}

.pos-dot:hover {
  transform: scale(1.1);
}

.pos-dot.on {
  box-shadow:
    0 0 0 3px #fff,
    0 0 0 6px var(--c),
    0 6px 16px rgb(0 0 0 / 25%);
  z-index: 2;
}

.pos-dot.drag {
  cursor: grabbing;
  transform: scale(1.18);
  z-index: 3;
  transition: none;
}

.pos-dot.ghost {
  background: #fff;
  color: var(--c);
  border: 2px dashed var(--c);
  box-shadow: 0 2px 6px rgb(0 0 0 / 12%);
  opacity: 0.9;
}

.pos-dot.ghost.on {
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--c) 30%, transparent);
}

.pos-tip {
  font-size: 11.5px;
  max-width: 520px;
  text-align: center;
  line-height: 1.5;
}

.pos-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 300px;
  min-width: 260px;
}

.pos-item {
  display: flex;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid var(--line);
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s;
}

.pos-item:hover {
  background: var(--panel);
}

.pos-item.on {
  border-color: var(--c);
  background: color-mix(in srgb, var(--c) 7%, #fff);
}

.pos-num {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  margin-top: 3px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--c);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}

.pos-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.pos-line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pos-line b {
  font-size: 13px;
  white-space: nowrap;
}

.pos-input {
  max-width: 110px;
  font-family: var(--mono);
}

.pos-excerpt {
  font-size: 12px;
  color: var(--text2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pos-note {
  font-size: 11.5px;
  color: var(--alias);
}

.pos-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}

.pos-help {
  font-size: 11.5px;
  line-height: 1.6;
}

.pos-foot {
  display: flex;
  justify-content: flex-end;
  padding: 10px 14px;
  border-top: 1px solid var(--line);
}
</style>
