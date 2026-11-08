<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { NaiImage } from '@shared/images/types'
import type { WorkspaceToolKind } from './state'
import type { IconName } from '../../shared/ui/icons'
import Icon from '../../shared/ui/Icon.vue'
import { FavoriteButton } from '../favorites/public'
import { copy } from '../../shared/lib/notifications'
const props = defineProps<{
  current: NaiImage
  running: boolean
  inpaintBusy: boolean
  hasCharacters: boolean
  pendingDelete: string | null
  deleting: string | null
  /** 当前生图参数已固定为这张图的种子 */
  seedFixed: boolean
  /** 之后又改过提示词或参数，这张是上一次配置的结果 */
  stale?: boolean
  /** 刚生成出来的图：播放一次“去噪显影” */
  fresh?: boolean
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
  workspace: [tool?: WorkspaceToolKind]
}>()

/* ---------- 去精修：直接点新建精修项目；下拉选工具则项目打开后直接打开该工具 ---------- */
const REFINE_TOOLS: { key: WorkspaceToolKind; label: string; icon: IconName }[] = [
  { key: 'outpaint', label: '扩图', icon: 'tool-outpaint' },
  { key: 'enhance', label: '精修', icon: 'tool-enhance' },
  { key: 'upscale', label: '放大', icon: 'tool-upscale' },
]
const refineMenu = ref(false)
const refineAnchor = ref<HTMLElement>()
function toggleRefineMenu() {
  refineMenu.value = !refineMenu.value
}
function closeRefineOutside(event: PointerEvent) {
  if (refineMenu.value && !refineAnchor.value?.contains(event.target as Node)) {
    refineMenu.value = false
  }
}
watch(refineMenu, (open) => {
  if (open) {
    document.addEventListener('pointerdown', closeRefineOutside, true)
  } else {
    document.removeEventListener('pointerdown', closeRefineOutside, true)
  }
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeRefineOutside, true))
function sendToRefine(tool?: WorkspaceToolKind) {
  refineMenu.value = false
  emit('workspace', tool)
}
function retainCurrent() {
  emit('retain', [props.current])
}
/*
 * 换图时先在后台解码新图，解码完成再替换同一个 <img> 的地址：
 * 旧画面保留到新图就绪，结果卡片不会先塌陷消失再撑开。
 */
const shownUrl = ref(props.current.url)
let swapRequest = 0
watch(
  () => props.current.url,
  async (url) => {
    const request = ++swapRequest
    const next = new Image()
    next.src = url
    await next.decode().catch(() => undefined)
    if (request === swapRequest) {
      shownUrl.value = url
    }
  },
)
const developing = computed(() => !!props.fresh && shownUrl.value === props.current.url)

const storageLabel = computed(() => {
  if (props.current.storage === 'temporary') {
    return '临时'
  }
  if (props.current.storage === 'workspace') {
    return '精修存档'
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
      <button
        v-if="current.storage === 'temporary'"
        class="pill storage-retain"
        title="这是临时图片，退出后会清理；点击留存到图库"
        @click="retainCurrent"
      >
        临时 · 留存
      </button>
      <span
        v-else
        class="pill"
        >{{ storageLabel }}</span
      >
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
      <Transition name="fade">
        <span
          v-if="stale"
          class="pill result-stale"
          title="提示词或生成参数已调整，这张是上一次配置的结果；再次生成可查看最新效果"
          >旧配置</span
        >
      </Transition>
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
            name="lock"
            :size="15"
          />
        </button>
        <button
          class="icon-btn sm"
          title="加载这张图的提示词和生成参数"
          @click="emit('loadPrompt', current)"
        >
          <Icon
            name="import"
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
            name="folder"
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
      :class="['viewer-stage', { busy: running }]"
      @click="emit('lightbox')"
    >
      <span
        class="viewer-frame"
        :class="{ developing }"
      >
        <img
          :src="shownUrl"
          alt="生成结果"
          draggable="false"
        />
        <span
          v-if="developing"
          class="denoise-grain"
          aria-hidden="true"
        ></span>
      </span>
      <div
        v-if="running"
        class="viewer-busy"
      >
        <Icon
          name="paw"
          :size="16"
          class="spin-slow"
        />下一张生成中…
      </div>
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
          name="tool-inpaint"
          :size="14"
        />局部重绘
      </button>
      <button
        class="btn ghost small"
        :disabled="!hasCharacters"
        :title="
          hasCharacters
            ? '以这张图为参考，调整当前提示词的角色位置，用于下一次出图'
            : '先添加角色提示词，再调整角色位置'
        "
        aria-label="调整角色位置"
        @click="emit('positions')"
      >
        <Icon
          name="position"
          :size="14"
        /><span class="action-label">调整角色位置</span>
      </button>
      <div
        ref="refineAnchor"
        class="refine-split ml-auto"
      >
        <button
          class="btn small refine-main"
          :disabled="running || inpaintBusy"
          title="用这张图新建图片精修项目，可对比历史版本、全程带着 AI 上下文继续修图"
          aria-label="去精修"
          @click="sendToRefine()"
        >
          <Icon
            name="refine"
            :size="14"
          /><span class="action-label">去精修</span>
        </button>
        <button
          class="btn small refine-more"
          :class="{ on: refineMenu }"
          :disabled="running || inpaintBusy"
          :aria-expanded="refineMenu"
          aria-label="选择精修工具"
          title="新建项目后直接打开扩图、精修或放大"
          @click="toggleRefineMenu"
        >
          <Icon
            name="chevron"
            :size="12"
          />
        </button>
        <Transition name="popover-up">
          <div
            v-if="refineMenu"
            class="refine-menu"
          >
            <button
              v-for="tool in REFINE_TOOLS"
              :key="tool.key"
              @click="sendToRefine(tool.key)"
            >
              <Icon
                :name="tool.icon"
                :size="14"
              />{{ tool.label }}
            </button>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 临时图片的状态标签可直接点击留存，不另占一行 */
.storage-retain {
  color: var(--pink-deep);
  background: var(--pink-soft);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out);
}

.storage-retain:hover {
  background: color-mix(in srgb, var(--pink) 18%, var(--bg));
}

/* 去精修：主按钮 + 下拉选工具 */
.refine-split {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}

.refine-main {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.refine-more {
  padding: 0 7px;
  border-left: 0;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}

.refine-more .icon {
  transform: rotate(-90deg);
  transition: transform var(--dur-base) var(--ease-glide);
}

.refine-more.on .icon {
  transform: rotate(90deg);
}

.refine-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 132px;
  padding: 6px;
  border: 1px solid var(--line2);
  border-radius: 12px;
  background: var(--bg);
  box-shadow: var(--shadow-pop);
  transform-origin: bottom right;
}

.refine-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 8px;
  font-size: 12.5px;
  text-align: left;
  transition: background-color var(--dur-fast) var(--ease-out);
}

.refine-menu button:hover {
  background: var(--hover);
}

.result-stale {
  gap: 5px;
  color: var(--alias);
  background: color-mix(in srgb, var(--alias) 10%, var(--bg));
  cursor: help;
}

.result-stale::before {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentcolor;
}

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
