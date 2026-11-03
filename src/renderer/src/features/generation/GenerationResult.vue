<script setup lang="ts">
import { computed } from 'vue'
import type { NaiImage } from '@shared/images/types'
import Icon from '../../shared/ui/Icon.vue'
import { FavoriteButton } from '../favorites/public'
import { copy } from '../../shared/lib/notifications'
const props = defineProps<{
  current: NaiImage
  running: boolean
  inpaintBusy: boolean
  hasCharacters: boolean
  latestBatchTemporary: NaiImage[]
  pendingDelete: string | null
  deleting: string | null
  /** 当前生图参数已固定为这张图的种子 */
  seedFixed: boolean
}>()
const emit = defineEmits<{
  seed: [image: NaiImage]
  loadPrompt: [image: NaiImage]
  copyImage: [image: NaiImage]
  reveal: [image: NaiImage]
  save: [image: NaiImage]
  lightbox: []
  retain: [images: NaiImage[]]
  remove: [image: NaiImage]
  inpaint: [image: NaiImage]
  positions: []
  workspace: []
}>()
const storageLabel = computed(() => {
  if (props.current.storage === 'temporary') {
    return '临时'
  }
  if (props.current.storage === 'workspace') {
    return '工作台存档'
  }
  return '已留存'
})
const deleteLabel = computed(() => {
  if (props.deleting === props.current.name) {
    return '删除中…'
  }
  if (props.pendingDelete === props.current.name) {
    return '确认删除'
  }
  return '删除图片'
})
</script>

<template>
  <div class="result-card viewer">
    <div class="result-head">
      <span class="group-badge pink"
        ><Icon
          name="image"
          :size="14"
      /></span>
      <span class="pill">{{ storageLabel }}</span>
      <h3>
        {{ current.width && current.height ? `${current.width}×${current.height}` : '图片' }}
      </h3>
      <button
        v-if="current.seed !== undefined"
        class="pill seed"
        title="复制种子"
        @click="copy(String(current.seed))"
      >
        种子 {{ current.seed }}
      </button>
      <div class="actions ml-auto">
        <button
          class="icon-btn sm seed-toggle"
          :class="{ on: seedFixed }"
          :aria-pressed="seedFixed"
          :aria-label="seedFixed ? '取消固定种子' : '固定这个种子'"
          :title="seedFixed ? '已固定此种子，点击恢复随机' : '固定这个种子'"
          @click="emit('seed', current)"
        >
          <Icon
            name="paw"
            :size="15"
          />
        </button>
        <button
          class="icon-btn sm"
          title="加载这张图的提示词和生成参数"
          @click="emit('loadPrompt', current)"
        >
          <Icon
            name="paste"
            :size="15"
          />
        </button>
        <button
          class="icon-btn sm"
          title="复制图片"
          @click="emit('copyImage', current)"
        >
          <Icon
            name="copy"
            :size="15"
          />
        </button>
        <button
          class="icon-btn sm"
          title="在文件夹中显示"
          @click="emit('reveal', current)"
        >
          <Icon
            name="book"
            :size="15"
          />
        </button>
        <button
          class="btn small primary"
          @click="emit('save', current)"
        >
          <Icon
            name="download"
            :size="14"
          />
        </button>
      </div>
    </div>
    <div
      class="viewer-stage"
      @click="emit('lightbox')"
    >
      <img
        :key="current.url"
        :src="current.url"
        alt="生成结果"
        draggable="false"
      />
      <div
        v-if="running"
        class="viewer-busy"
      >
        <Icon
          name="image"
          :size="16"
          class="spin-slow"
        />下一张生成中…
      </div>
    </div>
    <div
      v-if="current.storage === 'temporary'"
      class="row viewer-retain"
    >
      <button
        class="btn small primary"
        @click="emit('retain', [current])"
      >
        留存图片</button
      ><button
        v-if="latestBatchTemporary.length"
        class="btn small"
        @click="emit('retain', latestBatchTemporary)"
      >
        留存最近一批剩余 {{ latestBatchTemporary.length }} 张
      </button>
    </div>
    <div class="row viewer-actions">
      <FavoriteButton :image="current" />
      <button
        class="btn small gallery-delete"
        :class="{ 'danger-confirm': pendingDelete === current.name }"
        :disabled="!!deleting || current.storage === 'workspace'"
        :aria-label="deleteLabel"
        @click="emit('remove', current)"
      >
        <Icon
          name="trash"
          :size="14"
        /><span class="action-label">{{ deleteLabel }}</span>
      </button>
      <button
        class="btn small accent"
        :disabled="running || inpaintBusy"
        @click="emit('inpaint', current)"
      >
        <Icon
          name="edit"
          :size="14"
        />局部重绘
      </button>
      <button
        class="btn ghost small"
        :disabled="!hasCharacters"
        :title="
          hasCharacters
            ? '以当前图片为底图，调整角色提示词的位置'
            : '先添加角色提示词，再对照图片定位'
        "
        aria-label="对照图片定位"
        @click="emit('positions')"
      >
        <Icon
          name="frame"
          :size="14"
        /><span class="action-label">对照图片定位</span>
      </button>
      <button
        class="btn ghost small ml-auto"
        :disabled="running || inpaintBusy"
        title="以这张图片新建工作台项目"
        aria-label="用于新项目"
        @click="emit('workspace')"
      >
        <Icon
          name="chat"
          :size="14"
        /><span class="action-label">用于新项目</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 固定种子是可切换状态：选中时显示粉色底，再点一次恢复随机 */
.seed-toggle.on {
  background: var(--pink-soft);
  color: var(--pink-deep);
  box-shadow: inset 0 0 0 1px var(--pink-line);
}

.seed-toggle.on:hover {
  background: color-mix(in srgb, var(--pink) 16%, var(--bg));
}

/*
 * 查看区按自身宽度适配（容器查询），三行都不换行：
 * 窄时标题里的徽标先隐藏、尺寸省略；底部次要操作收成图标（保留 title），主操作和「确认删除」保留文字。
 */
.viewer {
  container: viewer / inline-size;
}

.result-head,
.viewer-retain,
.viewer-actions {
  flex-wrap: nowrap;
  min-width: 0;
}

.result-head h3 {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-head .actions {
  flex-shrink: 0;
  flex-wrap: nowrap;
}

.viewer-retain,
.viewer-actions {
  padding: 10px 12px;
}

.viewer-retain > span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.viewer-retain .btn,
.viewer-actions > * {
  flex-shrink: 0;
}

@container viewer (width < 560px) {
  .result-head .group-badge {
    display: none;
  }

  .viewer-actions .btn.ghost .action-label,
  .viewer-actions .gallery-delete:not(.danger-confirm) .action-label {
    display: none;
  }

  .viewer-actions .btn.ghost,
  .viewer-actions .gallery-delete:not(.danger-confirm) {
    padding: 0 8px;
  }
}

@container viewer (width < 440px) {
  .viewer-retain > span {
    display: none;
  }
}
</style>
