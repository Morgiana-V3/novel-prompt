<script setup lang="ts">
import Icon from '../../../shared/ui/Icon.vue'
import FavoriteButton from '../../../shared/ui/FavoriteButton.vue'
import type { PageWorkspace } from '@shared/workspace/model'
import type { useVersionBrowser } from '../use-version-browser'
defineProps<{
  viewedCandidates: PageWorkspace['versions']
  viewed: PageWorkspace['versions'][number]
  current: PageWorkspace['versions'][number]
  viewedGroup: ReturnType<typeof useVersionBrowser>['viewedGroup']['value']
  busy: boolean
  operation: string
  clearingImage: string | null
}>()
const emit = defineEmits<{
  view: [versionId: string]
  missing: [version: PageWorkspace['versions'][number]]
  confirm: [versionId: string | null]
  remove: [versionId: string]
}>()
</script>

<template>
  <div
    class="pw-candidates scroll"
    aria-label="本版本图片预览"
  >
    <article
      v-for="versionItem in viewedCandidates"
      :key="versionItem.id"
      class="pw-candidate"
      :class="{ selected: versionItem.id === viewed.id }"
      :data-version-id="versionItem.id"
    >
      <button
        class="pw-candidate-open"
        :aria-pressed="versionItem.id === viewed.id"
        :disabled="busy"
        @click="emit('view', versionItem.id)"
      >
        <div class="pw-candidate-image">
          <img
            v-if="versionItem.image && !versionItem.image.missing"
            :src="versionItem.image.url"
            :alt="versionItem.label"
            loading="lazy"
            @error="emit('missing', versionItem)"
          /><span
            v-else
            class="muted"
            >{{
              versionItem.imageCleared ? '图片已清理' : versionItem.image ? '图片缺失' : '暂无图片'
            }}</span
          >
        </div>
        <div class="pw-candidate-caption">
          <b
            >第
            {{ viewedGroup.versions.findIndex((candidate) => candidate.id === versionItem.id) + 1 }}
            张</b
          ><span
            v-if="versionItem.id === current.id"
            class="pw-current"
            >当前蓝本</span
          ><span
            v-else-if="versionItem.id === viewed.id"
            class="muted"
            >查看中</span
          >
        </div>
      </button>
      <button
        v-if="versionItem.image && clearingImage !== versionItem.id"
        class="icon-btn sm pw-candidate-delete"
        :disabled="busy"
        title="删除这张图片"
        :aria-label="`删除图片：${versionItem.label}`"
        @click.stop="emit('confirm', versionItem.id)"
      >
        <Icon
          name="trash"
          :size="14"
        />
      </button>
      <FavoriteButton
        v-if="versionItem.image && !versionItem.image.missing"
        :image="versionItem.image"
        class="candidate-favorite"
      />
      <Transition name="popover">
        <div
          v-if="clearingImage === versionItem.id"
          class="pw-candidate-delete-confirm"
          role="alertdialog"
          :aria-label="`确认删除图片：${versionItem.label}`"
          @click.stop
          @keydown.esc.stop="emit('confirm', null)"
        >
          <b>删除这张图片？</b><span>提示词和版本记录保留。</span>
          <div class="row">
            <button
              class="btn ghost small"
              :disabled="busy"
              @click="emit('confirm', null)"
            >
              取消</button
            ><button
              class="btn primary small"
              :disabled="busy"
              @click="emit('remove', versionItem.id)"
            >
              {{ operation === 'save' ? '删除中…' : '确认删除' }}
            </button>
          </div>
        </div>
      </Transition>
    </article>
    <div
      v-if="!viewedCandidates.length"
      class="pw-candidates-empty muted"
    >
      本版图片已清理，提示词和版本记录仍可查看。
    </div>
  </div>
</template>

<style scoped>
.pw-candidate :deep(.candidate-favorite) {
  position: absolute;
  left: 10px;
  top: 10px;
  background: var(--bg);
}

.pw-candidate-list {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 20;
  background: var(--bg);
  border: 1px solid var(--line2);
  border-radius: 12px;
  box-shadow: var(--shadow-pop);
  display: flex;
  gap: 8px;
  overflow: auto;
  max-height: 145px;
  padding: 8px 4px;
  scrollbar-gutter: stable;
}

.pw-candidate-list button {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 94px;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 10px;
  font-size: 10px;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out);
}

.pw-candidate-list button:hover:not(.selected) {
  border-color: var(--pink-line);
  background: var(--panel);
}

.pw-candidate-list button.selected {
  border-color: var(--pink);
  background: var(--pink-soft);
}

.pw-candidate-list img,
.pw-candidate-missing {
  height: 74px;
  width: 80px;
  object-fit: contain;
}

.pw-candidate-missing {
  display: grid;
  place-items: center;
  color: var(--muted);
}

.pw-candidates {
  position: relative;
  margin-bottom: 8px;
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(180px, 100%), 1fr));
  align-content: start;
  gap: 14px;
  padding: 12px 0 20px;
  animation: fade-in var(--dur-base) var(--ease-out);
}

.pw-candidate:hover,
.pw-candidate.selected {
  border-color: var(--pink-line);
  background: var(--pink-soft);
}

.pw-candidate-image {
  height: 220px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  overflow: hidden;
  background: var(--panel);
}

.pw-candidate-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.pw-candidate-caption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 4px 2px;
  font-size: 12px;
}

.pw-candidate-caption span {
  font-size: 11px;
}

.pw-candidate {
  min-width: 0;
  padding: 8px;
  text-align: left;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--bg);
  position: relative;
  transition:
    border-color var(--dur-base) var(--ease-out),
    background-color var(--dur-base) var(--ease-out);
}

.pw-candidate-open {
  display: block;
  width: 100%;
  padding: 0;
  text-align: left;
  border-radius: 9px;
}

.pw-candidate-open:disabled {
  cursor: not-allowed;
}

.pw-candidate-delete {
  position: absolute;
  top: 14px;
  right: 14px;
  background: var(--bg);
  box-shadow: var(--shadow-sm);
  opacity: 0;
  pointer-events: none;
  transition:
    opacity var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out);
}

.pw-candidate:hover .pw-candidate-delete,
.pw-candidate:focus-within .pw-candidate-delete {
  opacity: 1;
  pointer-events: auto;
}

.pw-candidate-delete:hover {
  color: var(--bad);
}

.pw-candidate-delete-confirm {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg);
  box-shadow: var(--shadow-sm);
  font-size: 12px;
  line-height: 1.7;
  transform-origin: bottom right;
}

.pw-candidate-delete-confirm > span {
  display: block;
  color: var(--muted);
}

.pw-candidate-delete-confirm .row {
  justify-content: flex-end;
  gap: 6px;
  margin-top: 8px;
}

.pw-candidates-empty {
  grid-column: 1/-1;
  text-align: center;
  padding: 40px 12px;
  font-size: 12px;
}

@media (hover: none) {
  .pw-candidate-delete {
    opacity: 1;
    pointer-events: auto;
  }
}
</style>
