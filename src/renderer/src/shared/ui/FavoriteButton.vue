<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { NaiImage, SavedRecipe } from '@shared/images/types'
import {
  favorites,
  favoriteFor,
  refreshFavorites,
  saveFavorite,
  removeFavorite,
} from '../state/favorites'
import { shellState } from '../state/shell'
import { cleanErr } from '../lib/format'
import { toast } from '../lib/notifications'
import Icon from './Icon.vue'
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
const position = ref({ left: '0px', top: '0px' })
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
  if (selected.value) {
    pending.value = selected.value
    const rect = trigger.value!.getBoundingClientRect()
    position.value = {
      left: `${Math.max(8, Math.min(rect.right - 232, window.innerWidth - 240))}px`,
      top: `${Math.max(8, rect.bottom + 120 < window.innerHeight ? rect.bottom + 8 : rect.top - 116)}px`,
    }
    bubble.value?.showPopover()
    return
  }
  try {
    if (props.image) {
      await saveFavorite(props.image)
    }
  } catch (error) {
    toast(`收藏失败：${cleanErr(error)}`)
  }
}
async function confirm() {
  const item = pending.value
  close()
  if (!item) {
    return
  }
  try {
    await removeFavorite(item)
  } catch (error) {
    toast(`取消收藏失败：${cleanErr(error)}`)
  }
}
</script>
<template>
  <button
    ref="trigger"
    v-bind="$attrs"
    class="icon-btn sm favorite-button"
    :class="{ selected: !!selected }"
    :aria-pressed="!!selected"
    :aria-expanded="opened"
    :aria-label="selected ? '取消收藏' : '收藏图片'"
    :title="selected ? '取消收藏（原图保留）' : '收藏图片与生成记录'"
    :disabled="image?.missing || busy"
    @click.stop="activate"
  >
    <Icon
      name="star"
      :size="15"
    />
  </button>
  <Teleport to="body">
    <div
      ref="bubble"
      popover="auto"
      class="favorite-confirm"
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
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  transition:
    background-color 150ms ease,
    color 150ms ease;
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
  box-shadow: var(--shadow-sm);
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
