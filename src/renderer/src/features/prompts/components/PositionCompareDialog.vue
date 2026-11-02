<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { parsePosition } from '@shared/generation/presets'
import Icon from '../../../shared/ui/Icon.vue'

export interface RolePosition {
  label: string
  position: string
}
const props = withDefaults(
  defineProps<{
    before: RolePosition[]
    after: RolePosition[]
    width?: number
    height?: number
    /** 参考底图：与角色位置编辑器相同的当前预览图 */
    reference?: { url: string; opacity: number } | null
  }>(),
  { width: 832, height: 1216, reference: null },
)
const showReference = ref(true)
const referenceFailed = ref(false)
const emit = defineEmits<{ close: [] }>()
// 先播离场过渡，结束后再通知父组件卸载
const opened = ref(true)
const close = () => {
  opened.value = false
}
const COLORS = ['#ff6b9a', '#3b82f6', '#1f9d68', '#c97f00', '#8b5cf6', '#0ea5e9']
const aspect = computed(() => `${props.width} / ${props.height}`)
/** 同一个角色在前后两侧用同一个颜色和编号；位置变了的角色额外描边 */
const panels = computed(() => {
  const roles = Math.max(props.before.length, props.after.length)
  const moved = new Set(
    Array.from({ length: roles }, (_, index) => index).filter(
      (index) => (props.before[index]?.position ?? '') !== (props.after[index]?.position ?? ''),
    ),
  )
  const markers = (list: RolePosition[]) =>
    list.flatMap((role, index) => {
      const point = parsePosition(role.position)
      return point
        ? [
            {
              index,
              label: role.label,
              position: role.position,
              moved: moved.has(index),
              color: COLORS[index % COLORS.length],
              style: { left: `${point.x * 100}%`, top: `${point.y * 100}%` },
            },
          ]
        : []
    })
  const unplaced = (list: RolePosition[]) =>
    list.filter((role) => !parsePosition(role.position)).map((role) => role.label)
  return [
    {
      key: 'before',
      title: '修改前',
      markers: markers(props.before),
      unplaced: unplaced(props.before),
    },
    {
      key: 'after',
      title: '修改后',
      markers: markers(props.after),
      unplaced: unplaced(props.after),
    },
  ]
})
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    close()
  }
}
onMounted(() => document.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey, true))
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
        class="position-compare-mask"
        @click.self="close"
      >
        <section
          class="position-compare modal-panel"
          role="dialog"
          aria-modal="true"
          aria-label="角色位置前后对比"
        >
          <header>
            <div>
              <b>角色位置对比</b>
              <p>同一角色前后颜色一致，描边的是本次移动过的角色。</p>
            </div>
            <label
              v-if="reference && !referenceFailed"
              class="reference-toggle"
              ><input
                v-model="showReference"
                type="checkbox"
              />参考底图</label
            >
            <button
              class="icon-btn"
              aria-label="关闭位置对比"
              @click="close"
            >
              <Icon
                name="x"
                :size="16"
              />
            </button>
          </header>
          <div class="position-panels">
            <figure
              v-for="panel in panels"
              :key="panel.key"
            >
              <figcaption>{{ panel.title }}</figcaption>
              <div
                class="position-canvas"
                :style="{ aspectRatio: aspect }"
              >
                <img
                  v-if="reference && showReference && !referenceFailed"
                  class="position-reference"
                  :src="reference.url"
                  :style="{ opacity: reference.opacity / 100 }"
                  alt=""
                  draggable="false"
                  @error="referenceFailed = true"
                />
                <span
                  v-for="marker in panel.markers"
                  :key="marker.index"
                  class="position-marker"
                  :class="{ moved: marker.moved }"
                  :style="{ ...marker.style, '--c': marker.color }"
                  :title="`${marker.label} · ${marker.position}`"
                  >{{ marker.index + 1 }}</span
                >
              </div>
              <ul class="position-legend">
                <li
                  v-for="marker in panel.markers"
                  :key="marker.index"
                  :class="{ moved: marker.moved }"
                >
                  <i :style="{ background: marker.color }"></i>{{ marker.label }}
                  <code>{{ marker.position }}</code>
                </li>
                <li
                  v-for="label in panel.unplaced"
                  :key="label"
                  class="unplaced"
                >
                  <i></i>{{ label }} <code>自动位置</code>
                </li>
              </ul>
            </figure>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
<style scoped>
.position-compare-mask {
  position: fixed;
  inset: 0;
  z-index: 95;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--scrim);
  backdrop-filter: blur(3px);
}

.position-compare {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: min(760px, 100%);
  max-height: calc(100vh - 48px);
  overflow: auto;
  padding: 20px 22px 22px;
  border: 1px solid var(--line2);
  border-radius: 18px;
  background: var(--bg);
  box-shadow: var(--shadow-modal);
}

header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

header > div:first-child {
  flex: 1;
}

.reference-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  font-size: 12px;
  color: var(--text2);
}

/* 底图在网格线下方：网格画在 ::after 上，盖在图片之上 */
.position-reference {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  animation: fade-in var(--dur-slow) var(--ease-out);
}

header b {
  font-size: 15px;
}

header p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.position-panels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}

figure {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  margin: 0;
}

figcaption {
  font-size: 12px;
  font-weight: 600;
  color: var(--text2);
}

/* 5×5 网格底纹，与角色位置编辑器的格子对应 */
.position-canvas {
  position: relative;
  max-height: 46vh;
  border: 1px solid var(--line2);
  border-radius: 12px;
  background-color: var(--panel);
  overflow: hidden;
}

/* 5×5 网格叠在底图之上、角色标记之下 */
.position-canvas::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
  background-image:
    linear-gradient(to right, rgb(0 0 0 / 8%) 1px, transparent 1px),
    linear-gradient(to bottom, rgb(0 0 0 / 8%) 1px, transparent 1px);
  background-size: 20% 20%;
  pointer-events: none;
}

.position-marker {
  position: absolute;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  margin: -13px 0 0 -13px;
  border-radius: 50%;
  background: var(--c);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  box-shadow: 0 2px 6px rgb(0 0 0 / 18%);
  animation: pop var(--dur-slow) var(--bounce) backwards;
}

.position-marker.moved {
  box-shadow:
    0 0 0 3px var(--bg),
    0 0 0 5px var(--c);
}

.position-legend {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
  color: var(--text2);
}

.position-legend li {
  display: flex;
  align-items: center;
  gap: 6px;
}

.position-legend li.moved {
  color: var(--text);
  font-weight: 600;
}

.position-legend i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--line2);
}

.position-legend code {
  margin-left: auto;
  font: 11px var(--mono);
  color: var(--muted);
}

@media (width <= 700px) {
  .position-panels {
    grid-template-columns: 1fr;
  }
}
</style>
