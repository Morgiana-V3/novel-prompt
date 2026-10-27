<script setup lang="ts">
import Icon from '../../../shared/ui/Icon.vue'
import type { PageWorkspace } from '@shared/workspace/model'
import type { useVersionBrowser } from '../use-version-browser'
defineProps<{
  groupCards: ReturnType<typeof useVersionBrowser>['groupCards']['value']
  viewedGroup: ReturnType<typeof useVersionBrowser>['viewedGroup']['value']
  editingPrompt: boolean
}>()
const emit = defineEmits<{
  view: [versionId: string]
  missing: [version: PageWorkspace['versions'][number]]
}>()
</script>

<template>
  <aside
    class="pw-history scroll"
    aria-label="配置版本"
  >
    <button
      v-for="group in groupCards"
      :key="group.id"
      class="pw-version"
      :disabled="editingPrompt"
      :class="{ selected: viewedGroup.id === group.id }"
      @click="emit('view', group.cover.id)"
    >
      <img
        v-if="group.cover.image && !group.cover.image.missing"
        :src="group.cover.image.url"
        alt=""
        loading="lazy"
        @error="emit('missing', group.cover)"
      />
      <div
        v-else
        class="pw-version-empty"
      >
        <Icon name="chat" />
      </div>
      <div>
        <b>{{ group.label.replace('方案 ', '版本 ') }}</b
        ><span
          v-if="group.adopted"
          class="pw-current"
          >当前蓝本</span
        ><small>{{ group.versions.filter((v) => v.image).length }} 张图片</small>
      </div>
    </button>
  </aside>
</template>

<style scoped>
.pw-version {
  width: 100%;
  text-align: left;
  padding: 7px;
  border: 1px solid transparent;
  border-radius: 12px;
  margin-bottom: 10px;
}

.pw-version:hover {
  background: var(--hover);
}

.pw-version.selected {
  border-color: var(--pink-line);
  background: var(--pink-soft);
}

.pw-version img {
  width: 100%;
  height: 98px;
  object-fit: contain;
  border-radius: 6px;
  background: var(--bg);
}

.pw-version div {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  margin-top: 6px;
}

.pw-version small {
  width: 100%;
  font-size: 10px;
  color: var(--muted);
}

@media (width <= 1050px) {
  .pw-history {
    width: 130px;
  }
}

@media (width <= 800px) {
  .pw-history {
    position: absolute;
    left: 0;
    top: 46px;
    bottom: 0;
    z-index: 4;
    box-shadow: var(--shadow);
    width: 170px;
  }
}

.pw-version-empty {
  height: 70px;
  display: grid;
  place-items: center;
  color: var(--pink);
}

.pw-history {
  width: 172px;
  flex-shrink: 0;
  background: var(--side);
  padding: 16px 12px;
  border-right: 1px solid var(--line);
  max-width: 18%;
}

.pw-version b {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pw-version > div {
  min-width: 0;
}
</style>
