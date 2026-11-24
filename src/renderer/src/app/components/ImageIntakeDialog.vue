<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { backdropCloser, closeDialogThen } from '../../shared/lib/dialog-motion'
import Icon from '../../shared/ui/Icon.vue'
import ThemeSelect from '../../shared/ui/ThemeSelect.vue'
import type { IconName } from '../../shared/ui/icons'

type IntakeAction = 'decode' | 'reverse' | 'workspace' | 'gallery'
type DirectAction = Exclude<IntakeAction, 'gallery'>

interface DirectActionItem {
  action: DirectAction
  label: string
  icon: IconName
  hint: string
  isDisabled: boolean
}

const props = defineProps<{
  fileName: string
  imageUrl: string
  width: number
  height: number
  metadata: 'checking' | 'available' | 'absent'
  busy: boolean
  error: string
  collections: readonly { id: string; name: string }[]
  defaultCollectionId: string
}>()
const emit = defineEmits<{
  choose: [action: IntakeAction, collectionId?: string]
  cancel: []
}>()

const dialog = ref<HTMLDialogElement>()
const actionList = ref<HTMLElement>()
const galleryPanel = ref<HTMLElement>()
const galleryConfirm = ref<HTMLButtonElement>()
const titleId = useId()
const hintIdPrefix = useId()
const galleryPanelId = useId()
const isClosing = ref(false)
const pendingAction = ref<IntakeAction>()

// 预览
const hasPreviewError = ref(false)
const hasKnownSize = computed(() => props.width > 0 && props.height > 0)

watch(
  () => props.imageUrl,
  () => {
    hasPreviewError.value = false
  },
)

// 直接执行的用途：只通知父组件，不在这里触发任何后续业务
const decodeHint = computed(() => {
  if (props.metadata === 'checking') {
    return '正在检查生成记录…'
  }
  if (props.metadata === 'absent') {
    return '这张图片没有内嵌生成记录'
  }
  return '恢复原图提示词和可用的生成参数'
})
const directActions = computed<DirectActionItem[]>(() => [
  {
    action: 'decode',
    label: '读取生成记录',
    icon: 'file',
    hint: decodeHint.value,
    isDisabled: props.busy || props.metadata !== 'available',
  },
  {
    action: 'reverse',
    label: '反推画面提示词',
    icon: 'reverse',
    hint: '载入反推页，由你开始识别',
    isDisabled: props.busy,
  },
  {
    action: 'workspace',
    label: '作为精修底稿',
    icon: 'refine',
    hint: '用这张图新建精修项目',
    isDisabled: props.busy,
  },
])

function hintId(action: IntakeAction): string {
  return `${hintIdPrefix}-${action}`
}

function isPending(action: IntakeAction): boolean {
  return props.busy && pendingAction.value === action
}

function chooseDirect(item: DirectActionItem) {
  if (item.isDisabled || isClosing.value) {
    return
  }
  pendingAction.value = item.action
  emit('choose', item.action)
}

// 保存到图库：先原位选择图集，确认后才通知父组件
const isGalleryExpanded = ref(false)
const targetCollectionId = ref(resolveCollectionId())
const collectionOptions = computed(() =>
  props.collections.map((collection) => ({ value: collection.id, label: collection.name })),
)
const hasTargetCollection = computed(() =>
  props.collections.some((collection) => collection.id === targetCollectionId.value),
)
const canConfirmGallery = computed(() => !props.busy && hasTargetCollection.value)

function resolveCollectionId(): string {
  const hasDefaultCollection = props.collections.some(
    (collection) => collection.id === props.defaultCollectionId,
  )
  if (hasDefaultCollection) {
    return props.defaultCollectionId
  }
  return props.collections[0]?.id ?? ''
}

watch(
  () => [props.collections, props.defaultCollectionId] as const,
  () => {
    if (!hasTargetCollection.value) {
      targetCollectionId.value = resolveCollectionId()
    }
  },
)

async function toggleGallery() {
  if (props.busy || isClosing.value) {
    return
  }
  isGalleryExpanded.value = !isGalleryExpanded.value

  if (!isGalleryExpanded.value) {
    return
  }
  await nextTick()
  galleryPanel.value?.querySelector<HTMLButtonElement>('.theme-select')?.focus()
}

function confirmGallery() {
  if (!canConfirmGallery.value || isClosing.value) {
    return
  }
  pendingAction.value = 'gallery'
  emit('choose', 'gallery', targetCollectionId.value)
}

// 关闭：Esc、遮罩、关闭按钮和取消共用，busy 时不响应
function dismiss() {
  if (props.busy || isClosing.value) {
    return
  }
  isClosing.value = true
  closeDialogThen(dialog.value, () => emit('cancel'))
}

const backdrop = backdropCloser(dismiss)

// 焦点：打开时落在第一个可用用途；处理结束后若焦点已离开对话框则拉回
function restoreFocus() {
  if (isGalleryExpanded.value && galleryConfirm.value && !galleryConfirm.value.disabled) {
    galleryConfirm.value.focus()
    return
  }
  actionList.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
}

watch(
  () => props.busy,
  async (isBusy) => {
    if (isBusy) {
      return
    }
    await nextTick()

    if (!dialog.value?.contains(document.activeElement)) {
      restoreFocus()
    }
  },
)

onMounted(() => {
  dialog.value?.showModal()
  restoreFocus()
})
onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
  <dialog
    ref="dialog"
    class="image-intake"
    :aria-labelledby="titleId"
    :aria-busy="busy"
    aria-modal="true"
    @dragover.prevent
    @drop.prevent
    @keydown.stop
    @cancel.prevent="dismiss"
    @pointerdown="backdrop.onPointerdown"
    @click="backdrop.onClick"
  >
    <header class="intake-heading">
      <h2 :id="titleId">选择图片用途</h2>
      <button
        class="icon-btn"
        aria-label="关闭"
        :disabled="busy"
        @click="dismiss"
      >
        <Icon
          name="x"
          :size="16"
        />
      </button>
    </header>
    <div class="intake-body">
      <figure class="intake-preview">
        <div class="intake-preview-frame">
          <img
            v-if="imageUrl && !hasPreviewError"
            :src="imageUrl"
            :alt="fileName"
            @error="hasPreviewError = true"
          />
          <span
            v-else
            class="intake-preview-missing"
            ><Icon
              name="image"
              :size="22"
            />无法预览</span
          >
        </div>
        <figcaption>
          <span :title="fileName">{{ fileName }}</span
          ><span v-if="hasKnownSize">{{ width }} × {{ height }}</span>
        </figcaption>
      </figure>
      <div
        ref="actionList"
        class="intake-actions scroll"
        role="group"
        :aria-labelledby="titleId"
      >
        <button
          v-for="item in directActions"
          :key="item.action"
          class="intake-action"
          :class="{ pending: isPending(item.action) }"
          :disabled="item.isDisabled"
          :aria-describedby="item.hint ? hintId(item.action) : undefined"
          @click="chooseDirect(item)"
        >
          <span class="intake-action-icon"
            ><Icon
              :name="item.icon"
              :size="16"
          /></span>
          <span class="intake-action-text"
            ><span>{{ item.label }}</span
            ><small
              v-if="item.hint"
              :id="hintId(item.action)"
              >{{ item.hint }}</small
            ></span
          >
          <Icon
            v-if="item.action !== 'decode' || metadata === 'available'"
            name="chevron"
            class="intake-action-caret"
            :size="12"
          />
        </button>
        <div
          class="intake-gallery"
          :class="{ expanded: isGalleryExpanded }"
        >
          <button
            class="intake-action"
            :class="{ pending: isPending('gallery') }"
            :disabled="busy"
            :aria-expanded="isGalleryExpanded"
            :aria-controls="galleryPanelId"
            @click="toggleGallery"
          >
            <span class="intake-action-icon"
              ><Icon
                name="album"
                :size="16"
            /></span>
            <span class="intake-action-text">
              <span>保存到图库</span>
              <small>选图集后保存</small>
            </span>
            <Icon
              name="chevron"
              class="intake-action-caret"
              :size="12"
            />
          </button>
          <div
            v-if="isGalleryExpanded"
            :id="galleryPanelId"
            ref="galleryPanel"
            class="intake-gallery-panel"
          >
            <div class="intake-gallery-select">
              <ThemeSelect
                v-model="targetCollectionId"
                :options="collectionOptions"
                :disabled="busy"
                aria-label="保存到图集"
              />
            </div>
            <button
              ref="galleryConfirm"
              class="btn accent small"
              :disabled="!canConfirmGallery"
              @click="confirmGallery"
            >
              确认保存
            </button>
          </div>
        </div>
      </div>
    </div>
    <footer class="intake-footer">
      <span
        v-if="error"
        role="alert"
        >{{ error }}</span
      ><button
        class="btn small"
        :disabled="busy"
        @click="dismiss"
      >
        取消
      </button>
    </footer>
  </dialog>
</template>

<style scoped>
.image-intake {
  width: min(720px, calc(100vw - 40px));
  height: min(460px, calc(100dvh - 68px));
  max-width: none;
  max-height: none;
  margin: auto;
  padding: 0;
  border: 1px solid var(--line2);
  border-radius: 16px;
  background: var(--bg);
  color: var(--text);
  box-shadow: var(--shadow-modal);
  overflow: hidden;
}

.image-intake[open] {
  display: flex;
  flex-direction: column;
}

.image-intake::backdrop {
  background: var(--scrim);
}

.intake-heading,
.intake-footer,
.intake-preview figcaption {
  display: flex;
  align-items: center;
}

.intake-heading {
  justify-content: space-between;
  padding: 14px 16px 10px 20px;
}

.intake-heading h2 {
  margin: 0;
  font-size: 15px;
}

.intake-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(240px, 1fr);
  border-top: 1px solid var(--line);
}

.intake-preview {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 10px;
  margin: 0;
  padding: 16px;
  background: var(--panel);
  border-right: 1px solid var(--line);
}

.intake-preview-frame {
  position: relative;
  min-height: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 10px;
  background: var(--hover);
}

.intake-preview-frame img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.intake-preview-missing {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}

.intake-preview figcaption {
  justify-content: space-between;
  gap: 10px;
  font-size: 11px;
  color: var(--text2);
}

.intake-preview figcaption span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.intake-preview figcaption span:last-child:not(:first-child) {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.intake-actions {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  overflow: auto;
}

.intake-action {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 52px;
  padding: 9px 12px;
  text-align: left;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg);
  transition:
    border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

.intake-action-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--hover);
  color: var(--text2);
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.intake-action-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.intake-action-text small {
  font-size: 11.5px;
  font-weight: 400;
  line-height: 1.5;
  color: var(--muted);
}

.intake-action-caret {
  fill: none;
  stroke: var(--muted);
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform var(--dur-base) var(--ease-out);
}

.intake-action:hover:not(:disabled),
.intake-action.pending {
  border-color: var(--pink-line);
  background: var(--pink-soft);
}

.intake-action:hover:not(:disabled) .intake-action-icon,
.intake-action.pending .intake-action-icon {
  background: var(--bg);
  color: var(--pink-deep);
}

.intake-action:focus-visible {
  outline: none;
  border-color: var(--pink);
  box-shadow: 0 0 0 3px var(--pink-soft);
}

.intake-action:disabled {
  cursor: not-allowed;
  color: var(--muted);
  background: var(--panel);
}

.intake-action:disabled .intake-action-icon {
  color: var(--muted);
}

.intake-gallery .intake-action-caret {
  transform: rotate(90deg);
}

.intake-gallery.expanded .intake-action-caret {
  transform: rotate(-90deg);
}

.intake-gallery-panel {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--panel);
}

.intake-gallery-select {
  flex: 1;
  min-width: 0;
}

.intake-gallery-select :deep(.theme-select) {
  width: 100%;
  height: 32px;
}

.intake-gallery-panel .btn {
  flex-shrink: 0;
}

.intake-footer {
  justify-content: flex-end;
  gap: 12px;
  padding: 12px 20px;
  border-top: 1px solid var(--line);
}

.intake-footer [role='alert'] {
  min-width: 0;
  margin-right: auto;
  font-size: 12px;
  line-height: 1.5;
  color: var(--bad);
  overflow-wrap: anywhere;
}

.intake-footer .btn {
  flex-shrink: 0;
}

.intake-footer button:focus-visible,
.intake-heading button:focus-visible,
.intake-gallery-panel .btn:focus-visible {
  box-shadow: inset 0 0 0 1px var(--pink-deep);
}

@media (width <= 620px) {
  .image-intake {
    height: auto;
    max-height: calc(100dvh - 40px);
  }

  .intake-body {
    display: flex;
    flex-direction: column;
    overflow: auto;
  }

  .intake-preview {
    flex-shrink: 0;
    height: min(240px, 36dvh);
    padding: 12px;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .intake-actions {
    flex-shrink: 0;
    padding: 12px;
    overflow: visible;
  }
}
</style>
