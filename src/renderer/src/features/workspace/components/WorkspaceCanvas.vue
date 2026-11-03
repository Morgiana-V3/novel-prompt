<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PageVersion, PageRegion, PageImageTool } from '@shared/workspace/model'
import type { IconName } from '../../../shared/ui/icons'
import Icon from '../../../shared/ui/Icon.vue'
import { FavoriteButton } from '../../favorites/public'
import ImageViewport from '../../../shared/ui/ImageViewport.vue'
import { reportError, toast } from '../../../shared/lib/notifications'

const props = defineProps<{
  viewed: PageVersion
  current: PageVersion
  overlay: string
  historical: boolean
  busy: boolean
  displayRegions: PageRegion[]
  overlayMode: 'annotation' | 'execution'
  /** 当前打开面板的修图工具，用于按钮的展开状态 */
  activeTool?: PageImageTool['kind'] | null
}>()
const zoom = defineModel<number>('zoom', { required: true })
const showMask = defineModel<boolean>('showMask', { required: true })
const emit = defineEmits<{
  missing: [version: PageVersion]
  recover: []
  edit: []
  /** anchor：触发按钮的位置，放大与精修的面板显示在按钮下方 */
  tool: [kind: PageImageTool['kind'], anchor: { left: number; bottom: number }]
}>()
const viewport = ref<InstanceType<typeof ImageViewport>>()

const emptyLabel = computed(() => {
  if (props.viewed.imageCleared) {
    return '图片已清理，提示词和生成参数仍保留'
  }
  if (props.viewed.image?.missing) {
    return '图片文件缺失，生成记录仍保留'
  }
  return '暂无图片'
})
const hasViewedImage = computed(() => !!props.viewed.image && !props.viewed.image.missing)

/** 修改类工具只作用于创作蓝本；浏览历史候选时提示先设为蓝本 */
const editBlockedReason = computed(() => {
  if (props.historical) {
    return '先把这张图设为蓝本，再在它上面修改'
  }
  if (!props.current.image || props.current.image.missing) {
    return '蓝本还没有可用图片'
  }
  return ''
})

interface ImageTool {
  key: 'inpaint' | PageImageTool['kind']
  label: string
  icon: IconName
  hint: string
}
const editTools: ImageTool[] = [
  {
    key: 'inpaint',
    label: '局部重绘',
    icon: 'tool-inpaint',
    hint: '圈出区域写批注，交给 AI 讨论或直接局部重绘',
  },
  { key: 'outpaint', label: '扩图', icon: 'tool-outpaint', hint: '向四周扩展画布并补全新区域' },
  { key: 'enhance', label: '精修', icon: 'tool-enhance', hint: '以当前图为起点重新采样，修复细节' },
  { key: 'upscale', label: '放大', icon: 'tool-upscale', hint: 'NovelAI 放大模型，宽高各 ×2' },
]

function useTool(key: ImageTool['key'], event: MouseEvent) {
  if (key === 'inpaint') {
    emit('edit')
    return
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  emit('tool', key, { left: rect.left, bottom: rect.bottom })
}

function toolTitle(tool: ImageTool) {
  return editBlockedReason.value ? `${tool.label} · ${editBlockedReason.value}` : tool.hint
}

async function copyImage() {
  if (!props.viewed.image) {
    return
  }
  try {
    if (await window.api.naiCopyImage(props.viewed.image.name)) {
      toast('图片已复制')
    }
  } catch (error) {
    reportError(error)
  }
}

const regionSummary = computed(() => {
  if (!props.displayRegions.length || props.historical) {
    return ''
  }
  const kind = props.overlayMode === 'execution' ? '执行遮罩' : '说明区域'
  return `${kind} ${props.displayRegions.map((region) => region.label).join('、')}`
})

defineExpose({ reset: () => viewport.value?.reset() })
</script>

<template>
  <div
    class="pw-image-toolbar"
    role="toolbar"
    aria-label="图片工具"
  >
    <div
      class="pw-tool-group edit"
      role="group"
      aria-label="修图"
    >
      <button
        v-for="tool in editTools"
        :key="tool.key"
        class="pw-tool"
        data-tool-trigger
        :aria-expanded="activeTool === tool.key"
        :disabled="busy || !!editBlockedReason"
        :title="toolTitle(tool)"
        :aria-label="tool.label"
        @click="useTool(tool.key, $event)"
      >
        <Icon
          :name="tool.icon"
          :size="16"
        /><span>{{ tool.label }}</span>
      </button>
    </div>
    <span
      v-if="regionSummary"
      class="pw-tool-note muted small"
      :title="regionSummary"
      >{{ regionSummary }}</span
    >
    <div
      class="pw-tool-group view"
      role="group"
      aria-label="查看与分享"
    >
      <button
        v-if="overlay && !historical"
        class="pw-tool icon-only"
        :aria-pressed="showMask"
        :title="showMask ? '隐藏区域标记' : '显示区域标记'"
        :aria-label="showMask ? '隐藏标记' : '显示标记'"
        @click="showMask = !showMask"
      >
        <Icon
          name="eye"
          :size="16"
        />
      </button>
      <button
        class="pw-tool icon-only"
        :disabled="!hasViewedImage"
        title="复制图片到剪贴板"
        aria-label="复制图片"
        @click="copyImage"
      >
        <Icon
          name="copy"
          :size="16"
        />
      </button>
      <FavoriteButton
        v-if="hasViewedImage"
        :image="viewed.image!"
      />
      <template v-if="hasViewedImage">
        <span
          class="pw-tool-divider"
          aria-hidden="true"
        ></span>
        <button
          class="pw-tool pw-tool-zoom"
          title="适应画布"
          @click="viewport?.reset()"
        >
          {{ zoom }}%
        </button>
      </template>
    </div>
  </div>
  <ImageViewport
    v-if="hasViewedImage"
    ref="viewport"
    v-model:zoom="zoom"
    class="pw-viewport"
    :width="viewed.image!.width || 1"
    :height="viewed.image!.height || 1"
    label="创作画布"
    ><img
      :src="viewed.image!.url"
      :alt="viewed.label"
      draggable="false"
      @error="emit('missing', viewed)" /><img
      v-if="overlay && showMask && !historical"
      class="pw-overlay"
      :src="overlay"
      alt="区域标记"
      draggable="false"
  /></ImageViewport>
  <div
    v-else
    class="pw-blank"
  >
    <Icon
      name="image"
      :size="40"
    /><span>{{ emptyLabel }}</span
    ><button
      v-if="viewed.image?.missing"
      class="btn small"
      :disabled="busy"
      @click="emit('recover')"
    >
      恢复原图
    </button>
  </div>
</template>

<style scoped>
.pw-viewport {
  flex: 1;
  min-height: 120px;
  margin-bottom: 12px;
  border: 1px solid var(--line2);
  border-radius: 12px;
  background: var(--side);
}

.pw-overlay {
  pointer-events: none;
}

/*
 * 仿 NovelAI 画布上方的紧凑工具条：
 * 左侧是会产生新版本的修图工具（带文字），右侧是复制、收藏等不改图的操作（只有图标）。
 */
.pw-image-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  margin-bottom: 8px;
}

.pw-tool-group {
  display: flex;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
  height: 32px;
  padding: 2px;
  border: 1px solid var(--line2);
  border-radius: 9px;
  background: var(--bg);
}

.pw-tool-group.view {
  margin-left: auto;
}

.pw-tool-divider {
  width: 1px;
  height: 14px;
  margin: 0 2px;
  background: var(--line2);
  flex-shrink: 0;
}

.pw-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 26px;
  padding: 0 9px;
  border-radius: 7px;
  color: var(--text2);
  font-size: 12px;
  white-space: nowrap;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    transform var(--dur-slow) var(--bounce);
}

/*
 * 图标与文字行高同为 16px：两者在按钮内的上下空隙都是整数像素，
 * 125% / 150% 等缩放下按同样方式取整，不会出现图标比文字高半格的错位。
 */
.pw-tool > .icon {
  flex: none;
}

/* 中文字形落在 Segoe UI 的行高度量里，墨迹重心偏低约 0.5px；带文字的图标做同样的光学下移 */
.edit .pw-tool > .icon {
  transform: translateY(0.5px);
}

.pw-tool > span {
  line-height: 16px;
}

.pw-tool.icon-only {
  width: 26px;
  padding: 0;
}

.pw-tool:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}

.pw-tool:active:not(:disabled) {
  transform: scale(var(--press-sm));
}

.pw-tool:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.pw-tool[aria-pressed='true'],
.pw-tool[aria-expanded='true'] {
  background: var(--pink-soft);
  color: var(--pink-deep);
}

.edit .pw-tool {
  color: var(--text);
}

.edit .pw-tool:hover:not(:disabled) .icon {
  color: var(--pink-deep);
}

.pw-image-toolbar :deep(.favorite-button) {
  width: 26px;
  height: 26px;
}

.pw-tool-note {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pw-tool-zoom {
  min-width: 46px;
  font-variant-numeric: tabular-nums;
}

@media (width <= 1250px) {
  .edit .pw-tool span {
    display: none;
  }

  .edit .pw-tool {
    width: 26px;
    padding: 0;
  }
}
</style>
