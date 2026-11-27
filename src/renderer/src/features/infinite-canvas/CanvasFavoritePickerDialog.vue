<script setup lang="ts">
import { onMounted, ref, shallowRef, useId } from 'vue'
import type { SavedRecipe } from '@shared/images/types'
import { backdropCloser } from '../../shared/lib/dialog-motion'
import { cleanErr } from '../../shared/lib/format'
import Icon from '../../shared/ui/Icon.vue'

const props = defineProps<{ baseImage: boolean; busy: boolean; error: string }>()
const emit = defineEmits<{ close: []; select: [recipe: SavedRecipe] }>()
const dialog = ref<HTMLDialogElement>()
const titleId = useId()
const recipes = shallowRef<SavedRecipe[]>([])
const selected = shallowRef<SavedRecipe>()
const dimensions = ref('')
const failed = ref(false)
const loading = ref(true)
const loadError = ref('')

function preview(recipe: SavedRecipe) {
  if (selected.value?.id !== recipe.id) {
    selected.value = recipe
    dimensions.value = ''
    failed.value = false
  }
}
function measure(event: Event) {
  const image = event.target as HTMLImageElement
  dimensions.value = `${image.naturalWidth} × ${image.naturalHeight} px`
}
function dismiss() {
  if (!props.busy) {
    emit('close')
  }
}
const backdrop = backdropCloser(dismiss)
onMounted(async () => {
  dialog.value?.showModal()
  try {
    recipes.value = (await window.canvasApi.recipesList()).filter((recipe) => recipe.imageUrl)
    if (recipes.value[0]) {
      preview(recipes.value[0])
    }
  } catch (reason) {
    loadError.value = cleanErr(reason)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <dialog
    ref="dialog"
    class="favorite-picker"
    :aria-labelledby="titleId"
    @keydown.stop
    @cancel.stop.prevent="dismiss"
    @pointerdown.stop="backdrop.onPointerdown"
    @click.stop="backdrop.onClick"
  >
    <header>
      <Icon
        name="star"
        :size="18"
      />
      <h2 :id="titleId">从收藏选择</h2>
    </header>
    <div class="favorite-body">
      <div class="favorite-list scroll">
        <p
          v-if="loading"
          role="status"
        >
          正在读取收藏…
        </p>
        <p
          v-else-if="loadError"
          role="alert"
        >
          {{ loadError }}
        </p>
        <p v-else-if="!recipes.length">暂无带图片的收藏。收藏一张图片后即可在这里选择。</p>
        <div
          v-else
          class="favorite-grid"
        >
          <button
            v-for="recipe in recipes"
            :key="recipe.id"
            type="button"
            :disabled="busy"
            :aria-pressed="selected?.id === recipe.id"
            :title="recipe.name"
            @click="preview(recipe)"
          >
            <img
              v-if="recipe.thumbnail"
              :src="recipe.thumbnail"
              alt=""
              loading="lazy"
              decoding="async"
            />
            <Icon
              v-else
              name="image"
              :size="20"
            />
            <span>{{ recipe.name }}</span>
          </button>
        </div>
      </div>
      <figure>
        <template v-if="selected">
          <p
            v-if="failed"
            role="alert"
          >
            无法读取收藏原图
          </p>
          <img
            v-else
            :key="selected.id"
            :src="selected.imageUrl"
            :alt="selected.name"
            @load="measure"
            @error="failed = true"
          />
          <figcaption>
            {{ selected.name }} <small>{{ dimensions }}</small>
          </figcaption>
        </template>
      </figure>
    </div>
    <footer>
      <span
        v-if="error"
        role="alert"
        >{{ error }}</span
      >
      <button
        type="button"
        class="btn small"
        :disabled="busy"
        @click="dismiss"
      >
        取消
      </button>
      <button
        type="button"
        class="btn small primary"
        :disabled="busy || !selected || !dimensions || failed"
        @click="selected && emit('select', selected)"
      >
        {{ baseImage ? '用作底图' : '添加参考图' }}
      </button>
    </footer>
  </dialog>
</template>

<style scoped>
.favorite-picker {
  width: min(810px, calc(100vw - 40px));
  height: min(548px, calc(100dvh - 68px));
  margin: auto;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--line2);
  border-radius: 16px;
  color: var(--text);
  background: var(--bg);
  box-shadow: var(--shadow-modal);
}

.favorite-picker[open] {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
}

.favorite-picker::backdrop {
  background: var(--scrim);
}

.favorite-picker header,
.favorite-picker footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
}

.favorite-picker h2 {
  margin: 0;
  font-size: 15px;
}

.favorite-picker footer {
  justify-content: flex-end;
}

.favorite-picker footer span {
  margin-right: auto;
  color: var(--bad);
}

.favorite-body {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  border-block: 1px solid var(--line);
}

.favorite-list {
  overflow: auto;
  padding: 14px;
}

.favorite-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 92px), 1fr));
  gap: 8px;
}

.favorite-grid button {
  display: grid;
  align-items: center;
  grid-template-rows: 1fr auto;
  aspect-ratio: 1;
  min-width: 0;
  padding: 4px;
  overflow: hidden;
  border: 2px solid transparent;
  border-radius: 9px;
  background: var(--hover);
}

.favorite-grid button[aria-pressed='true'] {
  border-color: var(--pink);
}

.favorite-grid span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.favorite-body img {
  width: 100%;
  height: 100%;
  min-height: 0;
  object-fit: contain;
}

.favorite-body figure {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 8px;
  min-height: 0;
  margin: 0;
  padding: 14px;
  border-left: 1px solid var(--line);
  background: var(--panel);
}

.favorite-body figcaption {
  overflow-wrap: anywhere;
}

.favorite-body small {
  display: block;
  color: var(--text2);
}
</style>
