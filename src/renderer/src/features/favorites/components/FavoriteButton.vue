<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { NaiImage, SavedRecipe } from '@shared/images/types'
import { favorites, favoriteFor, refreshFavorites, saveFavorite, removeFavorite } from '../state'
import { shellState } from '../../../shared/state/shell'
import { cleanErr } from '../../../shared/lib/format'
import { toast } from '../../../shared/lib/notifications'
import Icon from '../../../shared/ui/Icon.vue'
defineOptions({ inheritAttrs: false })
const props = defineProps<{ image?: NaiImage; item?: SavedRecipe }>()
const selected = computed(() => props.item ?? (props.image ? favoriteFor(props.image) : undefined))
const busy = computed(
  () =>
    favorites.busy.includes(props.image?.name ?? '') ||
    favorites.busy.includes(selected.value?.id ?? ''),
)
const trigger = ref<HTMLButtonElement>()
const bubble = ref<HTMLElement>()
const pending = ref<SavedRecipe>()
const opened = ref(false)
/**
 * 点击收藏立即点亮并播放一次粒子动画（乐观更新），保存失败再撤回；
 * 只给这次操作反馈，不在列表初次渲染时播放。
 */
const justSaved = ref(false)
const justRemoved = ref(false)
const optimistic = ref<boolean | null>(null)
const lit = computed(() => optimistic.value ?? !!selected.value)
/** 每次收藏换一个 key，连续点击也能从头播放粒子 */
const burst = ref(0)
let feedbackTimer: ReturnType<typeof setTimeout> | undefined
function feedback(kind: 'saved' | 'removed' | null) {
  clearTimeout(feedbackTimer)
  justSaved.value = kind === 'saved'
  justRemoved.value = kind === 'removed'
  if (kind === 'saved') {
    burst.value++
  }
  if (kind) {
    feedbackTimer = setTimeout(() => feedback(null), 800)
  }
}
onBeforeUnmount(() => clearTimeout(feedbackTimer))
const position = ref({ left: '0px', top: '0px', '--arrow-x': '50%' })
const side = ref<'top' | 'bottom'>('bottom')
onMounted(() => {
  if (!favorites.loaded) {
    void refreshFavorites().catch((error) => toast(cleanErr(error)))
  }
})
function close() {
  bubble.value?.hidePopover()
  pending.value = undefined
}
watch(() => [props.image?.name, selected.value?.id, shellState.tab], close)
async function activate() {
  if (busy.value) {
    return
  }
  if (selected.value) {
    pending.value = selected.value
    const rect = trigger.value!.getBoundingClientRect()
    const left = Math.max(8, Math.min(rect.right - 232, window.innerWidth - 240))
    position.value = {
      left: `${left}px`,
      top: `${rect.bottom + 10}px`,
      // 箭头对准星标中心
      '--arrow-x': `${Math.max(14, Math.min(rect.left + rect.width / 2 - left, 218))}px`,
    }
    side.value = 'bottom'
    bubble.value?.showPopover()
    // 下方放不下时翻到上方，按实际高度贴住星标
    const height = bubble.value?.offsetHeight ?? 0
    if (rect.bottom + 10 + height > window.innerHeight - 8) {
      side.value = 'top'
      position.value = { ...position.value, top: `${Math.max(8, rect.top - height - 10)}px` }
    }
    return
  }
  if (!props.image) {
    return
  }
  optimistic.value = true
  feedback('saved')
  try {
    await saveFavorite(props.image)
  } catch (error) {
    feedback(null)
    toast(`收藏失败：${cleanErr(error)}`)
  } finally {
    optimistic.value = null
  }
}
async function confirm() {
  const item = pending.value
  close()
  if (!item) {
    return
  }
  optimistic.value = false
  feedback('removed')
  try {
    await removeFavorite(item)
  } catch (error) {
    feedback(null)
    toast(`取消收藏失败：${cleanErr(error)}`)
  } finally {
    optimistic.value = null
  }
}
</script>
<template>
  <button
    ref="trigger"
    v-bind="$attrs"
    class="icon-btn sm favorite-button"
    :class="{ selected: lit, 'just-saved': justSaved, 'just-removed': justRemoved }"
    :aria-pressed="lit"
    :aria-busy="busy"
    :aria-expanded="opened"
    :aria-label="lit ? '取消收藏' : '收藏图片'"
    :title="lit ? '取消收藏（原图保留）' : '收藏图片与生成记录'"
    :disabled="image?.missing"
    @click.stop="activate"
  >
    <Icon
      name="star"
      :size="15"
    />
    <span
      v-if="justSaved"
      :key="burst"
      class="favorite-burst"
      aria-hidden="true"
      ><i
        v-for="n in 8"
        :key="n"
        :style="{ '--angle': `${n * 45 - 22}deg` }"
    /></span>
  </button>
  <Teleport to="body">
    <div
      ref="bubble"
      popover="auto"
      class="favorite-confirm pop-arrow pop-motion"
      :data-side="side"
      role="dialog"
      aria-label="确认取消收藏"
      :style="position"
      @toggle="opened = ($event as ToggleEvent).newState === 'open'"
      @click.stop
    >
      <strong>取消这张图片的收藏？</strong>
      <p>来源图片和同组其他收藏都会保留。</p>
      <div>
        <button
          class="btn small"
          autofocus
          @click="close"
        >
          保留</button
        ><button
          class="btn small"
          @click="confirm"
        >
          取消收藏
        </button>
      </div>
    </div>
  </Teleport>
</template>
<style scoped>
.favorite-button.icon-btn {
  position: relative;
  overflow: visible;
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  transition:
    background-color var(--dur-fast) ease,
    color var(--dur-fast) ease;
}

.favorite-button.icon-btn:active {
  transform: none;
}

.favorite-button.icon-btn.selected,
.favorite-button.icon-btn.selected:hover {
  color: var(--pink-deep);
  background: var(--pink-soft);
}

.favorite-button.icon-btn:not(.selected):hover {
  background: var(--hover);
  color: var(--text);
}

.favorite-button.selected :deep(svg) {
  fill: currentcolor;
}

/* ---------- 收藏反馈：星星先缩后弹 + 光环扩散 + 粒子四散（参考 B 站点赞） ---------- */
.favorite-button.just-saved :deep(svg) {
  animation: favorite-pop var(--dur-feedback) var(--bounce);
}

.favorite-button.just-removed :deep(svg) {
  animation: favorite-drop var(--dur-slow) var(--ease-out);
}

.favorite-burst {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.favorite-burst::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 28px;
  height: 28px;
  margin: -14px 0 0 -14px;
  border: 2px solid var(--pink);
  border-radius: 50%;
  opacity: 0;
  animation: favorite-ring calc(var(--dur-feedback) * 0.85) var(--ease-out) forwards;
}

.favorite-burst i {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 4px;
  height: 4px;
  margin: -2px 0 0 -2px;
  border-radius: 50%;
  background: var(--pink);
  opacity: 0;
  animation: favorite-spark var(--dur-feedback) var(--ease-out) calc(var(--dur-feedback) * 0.1)
    forwards;
}

.favorite-burst i:nth-child(even) {
  width: 3px;
  height: 3px;
  margin: -1.5px 0 0 -1.5px;
  background: #ffc14d;
  animation-duration: calc(var(--dur-feedback) * 0.9);
}

@keyframes favorite-pop {
  0% {
    transform: scale(1);
  }

  25% {
    transform: scale(0.65);
  }

  65% {
    transform: scale(1.3) rotate(-10deg);
  }

  100% {
    transform: scale(1) rotate(0);
  }
}

@keyframes favorite-drop {
  0% {
    transform: scale(1);
  }

  45% {
    transform: scale(0.7);
    opacity: 0.5;
  }

  100% {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes favorite-ring {
  0% {
    opacity: 0.85;
    transform: scale(0.35);
    border-width: 6px;
  }

  100% {
    opacity: 0;
    transform: scale(1.45);
    border-width: 1px;
  }
}

@keyframes favorite-spark {
  0% {
    opacity: 1;
    transform: rotate(var(--angle)) translateY(-7px) scale(1);
  }

  100% {
    opacity: 0;
    transform: rotate(var(--angle)) translateY(-21px) scale(0.3);
  }
}

.favorite-confirm {
  position: fixed;
  inset: auto;
  width: 232px;
  margin: 0;
  padding: 12px;
  border: 1px solid var(--line2);
  border-radius: 12px;
  background: var(--bg);
  color: var(--text);
  box-shadow: var(--shadow-pop);
  font-size: 12px;
}

.favorite-confirm p {
  font-size: 11px;
  color: var(--muted);
  margin: 8px 0 12px;
}

.favorite-confirm > div {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
