<script setup lang="ts">
import { computed } from 'vue'
import type { NaiImage } from '@shared/images/types'
import Icon from '../../shared/ui/Icon.vue'
import FavoriteButton from '../../shared/ui/FavoriteButton.vue'
import { copy } from '../../shared/lib/notifications'
const props = defineProps<{
  current: NaiImage
  running: boolean
  inpaintBusy: boolean
  hasCharacters: boolean
  latestBatchTemporary: NaiImage[]
  pendingDelete: string | null
  deleting: string | null
}>()
const emit = defineEmits<{
  seed: [image: NaiImage]
  loadPrompt: [image: NaiImage]
  preview: [image: NaiImage]
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
          class="icon-btn sm"
          title="固定这个种子"
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
          title="加载这张图的配置并推测画面"
          @click="emit('preview', current)"
        >
          <Icon
            name="eye"
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
      class="row"
      style="padding: 10px 12px; flex-wrap: wrap"
    >
      <span class="muted small">满意这张？留存后下次启动仍可查看。</span
      ><button
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
    <div
      class="row"
      style="padding: 10px 12px; flex-wrap: wrap"
    >
      <FavoriteButton :image="current" />
      <button
        class="btn small gallery-delete"
        :class="{ 'danger-confirm': pendingDelete === current.name }"
        :disabled="!!deleting || current.storage === 'workspace'"
        :title="
          current.storage === 'workspace'
            ? '工作台引用中，无法从图库删除'
            : '删除图片（移到回收站）'
        "
        @click="emit('remove', current)"
      >
        <Icon
          name="trash"
          :size="14"
        />{{ deleteLabel }}
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
        @click="emit('positions')"
      >
        <Icon
          name="frame"
          :size="14"
        />对照图片定位
      </button>
      <button
        class="btn ghost small ml-auto"
        :disabled="running || inpaintBusy"
        title="以这张图片新建 AI 会话"
        @click="emit('workspace')"
      >
        <Icon
          name="chat"
          :size="14"
        />用于新项目
      </button>
    </div>
  </div>
</template>

<style scoped>
.result-head,
.result-head .actions {
  flex-wrap: wrap;
}
</style>
