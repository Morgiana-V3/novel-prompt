<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { parsePosition, isGridPosition } from '@shared/nai-presets'
import { state, pushHistory } from '../store'
import Icon from './Icon.vue'

/**
 * 角色位置编辑器（参考 NovelAI 的 Character Positions）：
 * - V4.5：5×5 网格，拖动后吸附到格子中心，写回 A1~E5
 * - V5：自由坐标，拖动写回 "x,y"（两位小数）；按住 Shift 吸附到网格中心
 * 修改实时同步到 state.characters[i].position
 */
const props = defineProps<{ start?: number }>()
const emit = defineEmits<{ close: [] }>()

const COLORS = ['#ff6b9a', '#3b82f6', '#1f9d68', '#c97f00', '#7c3aed', '#e5484d', '#0891b2', '#db2777']
const COLS = 'ABCDE'
const color = (i: number) => COLORS[i % COLORS.length]

const isV5 = computed(() => state.settings?.naiVersion === 'v5')
const chars = computed(() => state.characters)
const selected = ref(Math.min(props.start ?? 0, Math.max(0, state.characters.length - 1)))

/* ---------- 画布尺寸：按当前画幅等比缩放 ---------- */
const MAX_W = 520
const MAX_H = 520
const box = computed(() => {
  const w = state.params.width || 832
  const h = state.params.height || 1216
  const s = Math.min(MAX_W / w, MAX_H / h)
  return { w: Math.round(w * s), h: Math.round(h * s) }
})

/* ---------- 位置换算 ---------- */
const clamp = (v: number) => Math.min(1, Math.max(0, v))
const cellOf = (v: number) => Math.min(4, Math.max(0, Math.floor(v * 5)))
const cellCenter = (i: number) => (i + 0.5) / 5
const toGrid = (x: number, y: number) => `${COLS[cellOf(x)]}${cellOf(y) + 1}`
const fmt = (v: number) => String(Number(clamp(v).toFixed(2)))

/** 没写位置时生图的自动排布（与 main/nai/client.ts 一致：只算有内容的角色，按顺序从左到右均匀排开） */
const autoPos = (i: number) => {
  const sent = state.characters.map((c, k) => (c.prompt.trim() ? k : -1)).filter((k) => k >= 0)
  const idx = sent.indexOf(i)
  const n = sent.length || state.characters.length
  const k = idx >= 0 ? idx : i
  return { x: Math.round(((k + 1) / (n + 1)) * 10) / 10, y: 0.5 }
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
  return chars.value.map((c, i) => {
    const p = parsePosition(c.position)
    const { x, y } = p ?? autoPos(i)
    const key = `${x.toFixed(3)},${y.toFixed(3)}`
    const stack = seen.get(key) ?? 0
    seen.set(key, stack + 1)
    return { i, x, y, set: !!p, stack }
  })
})
const anySet = computed(() => dots.value.some((d) => d.set))

/** V4.5 下被占用的格子：高亮显示 */
const cells = computed(() =>
  isV5.value
    ? []
    : dots.value.filter((d) => d.set).map((d) => ({ i: d.i, col: cellOf(d.x), row: cellOf(d.y) }))
)

function write(i: number, x: number, y: number, snap: boolean) {
  const c = state.characters[i]
  if (!c) return
  if (!isV5.value) c.position = toGrid(x, y)
  else if (snap) c.position = `${fmt(cellCenter(cellOf(x)))},${fmt(cellCenter(cellOf(y)))}`
  else c.position = `${fmt(x)},${fmt(y)}`
}

/* ---------- 拖动 ---------- */
const canvas = ref<HTMLElement>()
const dragging = ref<number | null>(null)

function pointToXY(e: PointerEvent) {
  const r = canvas.value!.getBoundingClientRect()
  return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) }
}

function onDotDown(e: PointerEvent, i: number) {
  e.preventDefault()
  e.stopPropagation()
  selected.value = i
  dragging.value = i
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function onDotMove(e: PointerEvent, i: number) {
  if (dragging.value !== i) return
  const { x, y } = pointToXY(e)
  write(i, x, y, e.shiftKey)
}
function onDotUp(e: PointerEvent, i: number) {
  if (dragging.value !== i) return
  dragging.value = null
  ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
}

/** 点击画布空白处：把选中的角色放到这里 */
function onCanvasDown(e: PointerEvent) {
  if (!chars.value.length) return
  const { x, y } = pointToXY(e)
  write(selected.value, x, y, e.shiftKey)
  dragging.value = selected.value
  canvas.value!.setPointerCapture(e.pointerId)
}
function onCanvasMove(e: PointerEvent) {
  if (dragging.value === null) return
  const { x, y } = pointToXY(e)
  write(dragging.value, x, y, e.shiftKey)
}
function onCanvasUp(e: PointerEvent) {
  if (dragging.value === null) return
  dragging.value = null
  if (canvas.value?.hasPointerCapture(e.pointerId)) canvas.value.releasePointerCapture(e.pointerId)
}

/* ---------- 键盘：方向键微调选中角色 ---------- */
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
    return
  }
  const target = e.target as HTMLElement | null
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
  if (!d || !chars.value.length) return
  e.preventDefault()
  const dot = dots.value[selected.value]
  if (!dot) return
  if (!isV5.value) {
    const col = Math.min(4, Math.max(0, cellOf(dot.x) + d[0]))
    const row = Math.min(4, Math.max(0, cellOf(dot.y) + d[1]))
    state.characters[selected.value].position = `${COLS[col]}${row + 1}`
  } else {
    const step = e.shiftKey ? 0.1 : 0.01
    write(selected.value, dot.x + d[0] * step, dot.y + d[1] * step, false)
  }
}

/* ---------- 列表操作 ---------- */
function clearOne(i: number) {
  state.characters[i].position = ''
}
function clearAll() {
  for (const c of state.characters) c.position = ''
}
/** 按当前顺序从左到右均匀排开（写成明确的位置） */
function spread() {
  const n = state.characters.length
  state.characters.forEach((_, i) => write(i, (i + 1) / (n + 1), 0.5, false))
}
/** 把坐标写法统一转换成当前版本支持的写法 */
function normalizeAll() {
  dots.value.forEach((d) => d.set && write(d.i, d.x, d.y, false))
}

const excerpt = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > 46 ? `${t.slice(0, 46)}…` : t || '（空）'
}
const posNote = (i: number) => {
  const p = state.characters[i]?.position?.trim()
  if (!p) return anySet.value ? '自动（按顺序排开）' : '未设置（由模型决定）'
  if (!parsePosition(p)) return '写法无法解析，生图时会被忽略'
  if (!isV5.value && !isGridPosition(p)) return '坐标写法，V4.5 只支持网格，拖动后会转换'
  return ''
}
const hasConvertible = computed(() => dots.value.some((d) => d.set && !isV5.value && !isGridPosition(state.characters[d.i].position)))

watch(
  () => state.characters.length,
  (n) => {
    if (!n) emit('close')
    else if (selected.value >= n) selected.value = n - 1
  }
)

onMounted(() => {
  pushHistory('编辑角色位置之前')
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="pos-mask" @pointerdown.self="emit('close')">
      <div class="pos-dialog">
        <div class="pos-head">
          <span class="group-badge pink"><Icon name="frame" :size="14" /></span>
          <h3>角色位置</h3>
          <span class="pill">{{ isV5 ? 'V5 · 自由坐标' : 'V4.5 · 5×5 网格' }}</span>
          <span class="pill">{{ state.params.width }}×{{ state.params.height }}</span>
          <button class="icon-btn sm ml-auto" title="关闭（Esc）" @click="emit('close')"><Icon name="x" :size="15" /></button>
        </div>

        <div class="pos-body">
          <div class="pos-stage">
            <div
              ref="canvas"
              class="pos-canvas"
              :style="{ width: box.w + 'px', height: box.h + 'px' }"
              @pointerdown="onCanvasDown"
              @pointermove="onCanvasMove"
              @pointerup="onCanvasUp"
              @pointercancel="onCanvasUp"
            >
              <div class="pos-grid">
                <div v-for="n in 25" :key="n" class="pos-cell">
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
                :class="['pos-dot', { ghost: !d.set, on: selected === d.i, drag: dragging === d.i }]"
                :style="{
                  left: `calc(${d.x * 100}% + ${d.stack * 10}px)`,
                  top: `calc(${d.y * 100}% + ${d.stack * 10}px)`,
                  '--c': color(d.i)
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
            <div class="pos-tip muted">
              拖动圆点调整位置；点击空白处把选中的角色移过去；方向键微调{{ isV5 ? '（Shift 加大步长，拖动时按住 Shift 吸附网格中心）' : '一格' }}
            </div>
          </div>

          <div class="pos-list">
            <div
              v-for="(c, i) in chars"
              :key="i"
              :class="['pos-item', { on: selected === i }]"
              :style="{ '--c': color(i) }"
              @click="selected = i"
            >
              <span class="pos-num">{{ i + 1 }}</span>
              <div class="pos-info">
                <div class="pos-line">
                  <b>角色 {{ i + 1 }}</b>
                  <input class="input sm pos-input" v-model="c.position" spellcheck="false" :placeholder="isV5 ? '0.3,0.5 或 B3' : 'B3'" @click.stop />
                  <button class="icon-btn sm" title="清除位置" :disabled="!c.position" @click.stop="clearOne(i)"><Icon name="x" :size="13" /></button>
                </div>
                <div class="pos-excerpt">{{ excerpt(c.prompt) }}</div>
                <div v-if="posNote(i)" class="pos-note">{{ posNote(i) }}</div>
              </div>
            </div>
            <div class="pos-actions">
              <button class="btn ghost small" title="按角色顺序从左到右均匀排开" @click="spread"><Icon name="align" :size="13" />均匀排开</button>
              <button v-if="hasConvertible" class="btn ghost small" @click="normalizeAll"><Icon name="swap" :size="13" />转成网格</button>
              <button class="btn ghost small" :disabled="!anySet" title="全部交给模型决定" @click="clearAll"><Icon name="reset" :size="13" />全部清除</button>
            </div>
            <div class="pos-help muted">
              位置会实时写回角色提示词。全部留空时由模型自行排布；只要有一个角色设了位置，没设的角色会按顺序从左到右排开（虚线圆点）。打开前的内容已存入历史，可以撤销。
            </div>
          </div>
        </div>

        <div class="pos-foot">
          <button class="btn primary small" @click="emit('close')"><Icon name="check" :size="14" />完成</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.pos-mask {
  position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 24px;
  background: rgba(16, 16, 20, 0.42); backdrop-filter: blur(3px); animation: fade-in 0.18s;
}
@keyframes fade-in { from { opacity: 0; } }
.pos-dialog {
  display: flex; flex-direction: column; max-width: 100%; max-height: 100%; background: #fff;
  border: 1px solid var(--line2); border-radius: 18px; box-shadow: 0 24px 60px rgba(20, 20, 30, 0.22); overflow: hidden;
  animation: pop 0.28s var(--bounce);
}
.pos-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px 10px 14px; border-bottom: 1px solid var(--line); background: var(--panel); }
.pos-head h3 { margin: 0; font-size: 14px; }
.pos-body { display: flex; gap: 16px; padding: 16px; min-height: 0; overflow: auto; }
.pos-stage { display: flex; flex-direction: column; align-items: center; gap: 8px; flex-shrink: 0; }
.pos-canvas {
  position: relative; border-radius: 10px; overflow: hidden; touch-action: none; cursor: crosshair;
  background: repeating-conic-gradient(#f6f6f8 0% 25%, #fff 0% 50%) 50% / 20px 20px; box-shadow: inset 0 0 0 1px var(--line2);
}
.pos-grid { position: absolute; inset: 0; display: grid; grid-template-columns: repeat(5, 1fr); grid-template-rows: repeat(5, 1fr); pointer-events: none; }
.pos-cell { position: relative; border-right: 1px dashed var(--line2); border-bottom: 1px dashed var(--line2); }
.pos-cell:nth-child(5n) { border-right: none; }
.pos-cell:nth-child(n + 21) { border-bottom: none; }
.pos-cell span { position: absolute; left: 5px; top: 3px; font-size: 10px; color: var(--muted); font-family: var(--mono); opacity: 0.8; }
.pos-hl {
  position: absolute; width: 20%; height: 20%; pointer-events: none;
  background: color-mix(in srgb, var(--c) 14%, transparent); box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--c) 55%, transparent);
}
.pos-dot {
  position: absolute; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 50%; display: grid; place-items: center;
  background: var(--c); color: #fff; font-size: 13px; font-weight: 700; cursor: grab; user-select: none; touch-action: none;
  box-shadow: 0 0 0 3px #fff, 0 4px 12px rgba(0, 0, 0, 0.22); transition: transform 0.2s var(--bounce), box-shadow 0.15s;
}
.pos-dot:hover { transform: scale(1.1); }
.pos-dot.on { box-shadow: 0 0 0 3px #fff, 0 0 0 6px var(--c), 0 6px 16px rgba(0, 0, 0, 0.25); z-index: 2; }
.pos-dot.drag { cursor: grabbing; transform: scale(1.18); z-index: 3; transition: none; }
.pos-dot.ghost { background: #fff; color: var(--c); border: 2px dashed var(--c); box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12); opacity: 0.9; }
.pos-dot.ghost.on { box-shadow: 0 0 0 4px color-mix(in srgb, var(--c) 30%, transparent); }
.pos-tip { font-size: 11.5px; max-width: 520px; text-align: center; line-height: 1.5; }
.pos-list { display: flex; flex-direction: column; gap: 8px; width: 300px; min-width: 260px; }
.pos-item {
  display: flex; gap: 10px; padding: 8px 10px; border-radius: 12px; border: 1px solid var(--line); cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.pos-item:hover { background: var(--panel); }
.pos-item.on { border-color: var(--c); background: color-mix(in srgb, var(--c) 7%, #fff); }
.pos-num {
  flex-shrink: 0; width: 22px; height: 22px; margin-top: 3px; border-radius: 50%; display: grid; place-items: center;
  background: var(--c); color: #fff; font-size: 12px; font-weight: 700;
}
.pos-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.pos-line { display: flex; align-items: center; gap: 6px; }
.pos-line b { font-size: 13px; white-space: nowrap; }
.pos-input { max-width: 110px; font-family: var(--mono); }
.pos-excerpt { font-size: 12px; color: var(--text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pos-note { font-size: 11.5px; color: var(--alias); }
.pos-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.pos-help { font-size: 11.5px; line-height: 1.6; }
.pos-foot { display: flex; justify-content: flex-end; padding: 10px 14px; border-top: 1px solid var(--line); }
</style>
