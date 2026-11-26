<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import {
  MAX_CANVAS_AI_REFERENCES,
  type CanvasAiEdit,
  type CanvasAiMessage,
  type CanvasAiMode,
} from '@shared/canvas-ai'
import { cleanErr } from '../../shared/lib/format'
import { settingsState } from '../settings/state'
import Icon from '../../shared/ui/Icon.vue'
import type { IconName } from '../../shared/ui/icons'
import { buildCanvasAiSnapshot } from './canvas-ai-edits'
import { operationLabel, TOOL_ICONS } from './operations'
import type { CanvasAsset, CanvasImage, CanvasOperation, CanvasSession } from './session'
import type { CanvasPreview } from './use-canvas-previews'

type CanvasRefItem =
  | {
      id: number
      kind: 'image'
      title: string
      typeLabel: string
      details?: string
      icon: IconName
      image: CanvasImage
    }
  | {
      id: number
      kind: 'operation'
      title: string
      typeLabel: string
      details?: string
      icon: IconName
      operation: CanvasOperation
    }

interface ThreadMessage extends CanvasAiMessage {
  references?: string[]
  appliedChanges?: string[]
}

interface Conversation {
  id: string
  draft: string
  explicitIds: number[]
  messages: ThreadMessage[]
  mode: CanvasAiMode
  pending: boolean
  step: string
  error: string
}

type ReferencePicker =
  { kind: 'mention'; query: string; start: number; end: number } | { kind: 'search'; query: string }

const props = defineProps<{
  session: CanvasSession
  title: string
  imagePreview: (asset: CanvasAsset) => CanvasPreview | undefined
}>()

const emit = defineEmits<{
  close: []
  focusClassic: []
  applyEdit: [edit: CanvasAiEdit, done: (summaries: string[]) => void]
}>()

function createConversation(): Conversation {
  return {
    id: crypto.randomUUID(),
    draft: '',
    explicitIds: [],
    messages: [],
    mode: 'edit',
    pending: false,
    step: '',
    error: '',
  }
}

const conversations = ref<Conversation[]>([createConversation()])
const activeId = ref(conversations.value[0].id)
const conversation = computed(
  () => conversations.value.find((entry) => entry.id === activeId.value) ?? conversations.value[0],
)
const historyOpen = ref(false)
const picker = ref<ReferencePicker | null>(null)
const highlight = ref(0)
const panelRef = ref<HTMLElement>()
const messagesRef = ref<HTMLElement>()
const composerRef = ref<HTMLTextAreaElement>()
const searchInputRef = ref<HTMLInputElement>()
const listboxId = useId()
const historyId = useId()

let disposed = false
let activeTaskId: string | null = null
let offAiStep: (() => void) | undefined
let offTasks: (() => void) | undefined

const configuredModel = computed(() => {
  const settings = settingsState.settings
  if (!settings) {
    return ''
  }
  return settings.apiKey?.trim() && settings.model?.trim() ? settings.model.trim() : ''
})

const canvasItems = computed<CanvasRefItem[]>(() => {
  const images: CanvasRefItem[] = props.session.images.map((image) => {
    const dims =
      image.asset.width && image.asset.height
        ? `${image.asset.width}×${image.asset.height}`
        : undefined
    return {
      id: image.id,
      kind: 'image',
      title: image.asset.label ?? `图片 ${image.id}`,
      typeLabel: '图片',
      details: dims,
      icon: 'image',
      image,
    }
  })
  const operations: CanvasRefItem[] = props.session.operations.map((operation) => {
    const label = operationLabel(operation.kind)
    const promptPreview = operation.request.base.trim().slice(0, 48)
    return {
      id: operation.id,
      kind: 'operation',
      title: `${label} #${operation.id}`,
      typeLabel: label,
      details: promptPreview || undefined,
      icon: TOOL_ICONS[operation.kind],
      operation,
    }
  })
  return [...images, ...operations]
})

const itemsById = computed(() => new Map(canvasItems.value.map((item) => [item.id, item])))

const explicitRefs = computed(() =>
  conversation.value.explicitIds.flatMap((id) => {
    const item = itemsById.value.get(id)
    return item ? [item] : []
  }),
)

const implicitRefs = computed(() => {
  const selectedId = props.session.selectedId
  if (selectedId === null || explicitRefs.value.length >= MAX_CANVAS_AI_REFERENCES) {
    return []
  }
  if (conversation.value.explicitIds.includes(selectedId)) {
    return []
  }
  const item = itemsById.value.get(selectedId)
  return item ? [item] : []
})

const canAttach = computed(() => explicitRefs.value.length < MAX_CANVAS_AI_REFERENCES)

const pickerOptions = computed(() => {
  const query = picker.value?.query.trim().toLocaleLowerCase() ?? ''
  const attached = new Set(conversation.value.explicitIds)
  return canvasItems.value.filter((item) => {
    if (attached.has(item.id)) {
      return false
    }
    if (!query) {
      return true
    }
    return [item.title, item.typeLabel, item.details, `#${item.id}`].some((text) =>
      text?.toLocaleLowerCase().includes(query),
    )
  })
})

const highlightedOptionId = computed(() =>
  picker.value && canAttach.value && pickerOptions.value.length
    ? `${listboxId}-${highlightedIndex()}`
    : undefined,
)

function highlightedIndex() {
  return Math.min(highlight.value, Math.max(0, pickerOptions.value.length - 1))
}

function conversationTitle(entry: Conversation, showDraft = false): string {
  const firstUser = entry.messages.find((message) => message.role === 'user')?.content
  const title = firstUser || (showDraft ? entry.draft : '')
  return title.replace(/\s+/gu, ' ').trim() || '新对话'
}

function previewUrlFor(item: CanvasRefItem): string | undefined {
  if (item.kind !== 'image') {
    return undefined
  }
  const preview = props.imagePreview(item.image.asset)
  return preview?.state === 'ready' ? preview.url : undefined
}

async function revealMessages() {
  await nextTick()
  if (messagesRef.value) {
    messagesRef.value.scrollTop = messagesRef.value.scrollHeight
  }
}

function focusInput() {
  if (composerRef.value?.disabled) {
    panelRef.value?.focus({ preventScroll: true })
  } else {
    ;(composerRef.value ?? panelRef.value)?.focus({ preventScroll: true })
  }
  revealMessages().catch(() => {})
}

function selectConversation(id: string) {
  activeId.value = id
  historyOpen.value = false
  picker.value = null
  nextTick(focusInput).catch(() => {})
}

function startConversation() {
  const entry = createConversation()
  conversations.value.unshift(entry)
  selectConversation(entry.id)
}

function toggleHistory() {
  picker.value = null
  historyOpen.value = !historyOpen.value
}

function updateMention() {
  const input = composerRef.value
  const end = input?.selectionStart ?? 0
  const activeMention =
    input && end === input.selectionEnd
      ? input.value.slice(0, end).match(/(?:^|[^A-Za-z0-9_.%+@-])[@＠]([^@＠\n]{0,64})$/u)
      : null
  if (activeMention) {
    const query = activeMention[1]
    picker.value = { kind: 'mention', query, start: end - query.length - 1, end }
    historyOpen.value = false
    highlight.value = 0
  } else if (picker.value?.kind === 'mention') {
    picker.value = null
  }
}

function onDraftInput(event: Event) {
  if (!(event instanceof InputEvent && event.isComposing)) {
    updateMention()
  }
}

function onMentionCaret(event: KeyboardEvent) {
  if (
    picker.value?.kind === 'mention' &&
    ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
  ) {
    updateMention()
  }
}

async function openReferenceSearch() {
  if (picker.value?.kind === 'search') {
    picker.value = null
    focusInput()
    return
  }
  historyOpen.value = false
  picker.value = { kind: 'search', query: '' }
  highlight.value = 0
  await nextTick()
  searchInputRef.value?.focus()
}

function removeReference(id: number) {
  const thread = conversation.value
  thread.explicitIds = thread.explicitIds.filter((entry) => entry !== id)
}

async function attachReference(item: CanvasRefItem) {
  if (!canAttach.value) {
    return
  }
  const thread = conversation.value
  thread.explicitIds = [...explicitRefs.value.map(({ id }) => id), item.id]
  const currentPicker = picker.value
  picker.value = null
  if (currentPicker?.kind === 'mention') {
    thread.draft =
      thread.draft.slice(0, currentPicker.start) + thread.draft.slice(currentPicker.end)
  }
  await nextTick()
  focusInput()
  if (currentPicker?.kind === 'mention') {
    composerRef.value?.setSelectionRange(currentPicker.start, currentPicker.start)
  }
}

function handlePickerKey(event: KeyboardEvent): boolean {
  if (!picker.value || event.isComposing || event.keyCode === 229) {
    return false
  }
  const count = canAttach.value ? pickerOptions.value.length : 0
  const index = highlightedIndex()
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (count) {
      event.preventDefault()
      highlight.value = (index + (event.key === 'ArrowDown' ? 1 : count - 1)) % count
      nextTick(() => {
        document.getElementById(`${listboxId}-${highlight.value}`)?.scrollIntoView({
          block: 'nearest',
        })
      }).catch(() => {})
    }
    return true
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault()
    if (count) {
      attachReference(pickerOptions.value[index]).catch(() => {})
    }
    return true
  }
  return false
}

function handleComposerKey(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229 || handlePickerKey(event)) {
    return
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    send().catch(() => {})
  }
}

function dismiss() {
  if (picker.value) {
    picker.value = null
    focusInput()
  } else if (historyOpen.value) {
    historyOpen.value = false
  } else {
    emit('close')
  }
}

function closePopoversOnOutsidePress(event: PointerEvent) {
  if (!(event.target instanceof Node)) {
    return
  }
  if (!panelRef.value?.contains(event.target)) {
    picker.value = null
    historyOpen.value = false
  }
}

function toggleMode() {
  const thread = conversation.value
  thread.mode = thread.mode === 'chat' ? 'edit' : 'chat'
}

function cancelActiveRequest() {
  if (activeTaskId && typeof window.canvasApi?.tasksCancel === 'function') {
    void window.canvasApi.tasksCancel(activeTaskId).catch(() => {})
  }
}

async function send() {
  const thread = conversation.value
  const content = thread.draft.trim()
  if (!content || thread.pending) {
    return
  }
  if (!configuredModel.value) {
    emit('focusClassic')
    return
  }

  picker.value = null
  historyOpen.value = false
  const requestMode = thread.mode
  const attached = [...explicitRefs.value, ...implicitRefs.value]
  const previousDraft = thread.draft
  const previousExplicit = [...thread.explicitIds]

  thread.messages.push({
    role: 'user',
    content,
    references: attached.map((item) => item.title),
  })
  thread.draft = ''
  thread.explicitIds = []
  thread.error = ''
  thread.pending = true
  thread.step = '正在理解画布与需求…'
  revealMessages().catch(() => {})

  try {
    const result = await window.canvasApi.askCanvasAi({
      mode: requestMode,
      referencedIds: attached.map((item) => item.id),
      messages: thread.messages.slice(-24).map(({ role, content: text }) => ({
        role,
        content: text,
      })),
      canvas: buildCanvasAiSnapshot(props.session, props.title),
    })
    if (disposed) {
      return
    }
    const replyMessage: ThreadMessage = {
      role: 'assistant',
      content: result.message,
    }
    thread.messages.push(replyMessage)
    if (requestMode === 'edit' && result.edit) {
      emit('applyEdit', result.edit, (summaries) => {
        if (!disposed && summaries.length) {
          replyMessage.appliedChanges = summaries
          revealMessages().catch(() => {})
        }
      })
    }
  } catch (reason) {
    if (!disposed) {
      thread.error = cleanErr(reason)
      thread.draft = previousDraft
      thread.explicitIds = previousExplicit
      thread.messages.pop()
    }
  } finally {
    thread.pending = false
    thread.step = ''
    activeTaskId = null
    if (!disposed && activeId.value === thread.id) {
      revealMessages().catch(() => {})
    }
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', closePopoversOnOutsidePress)
  if (typeof window.canvasApi?.onAiStep === 'function') {
    offAiStep = window.canvasApi.onAiStep('canvas', (text) => {
      const current = conversations.value.find((entry) => entry.pending)
      if (current) {
        current.step = text
        revealMessages().catch(() => {})
      }
    })
  }
  if (typeof window.canvasApi?.onTasks === 'function') {
    offTasks = window.canvasApi.onTasks((snapshot) => {
      const running = snapshot.tasks.find(
        (task) => task.kind === 'canvas-ai' && task.status === 'running',
      )
      activeTaskId = running?.id ?? null
    })
  }
})

onBeforeUnmount(() => {
  disposed = true
  document.removeEventListener('pointerdown', closePopoversOnOutsidePress)
  offAiStep?.()
  offTasks?.()
})

defineExpose({ focusInput })
</script>

<template>
  <aside
    ref="panelRef"
    class="ai-drawer"
    aria-label="画布 AI 助手"
    tabindex="-1"
    @pointerdown.stop
    @wheel.stop
    @keydown.stop
    @keydown.esc.stop.prevent="dismiss"
  >
    <header class="ai-header">
      <Icon
        class="ai-header-mark"
        name="sparkle"
        :size="16"
      />
      <div class="ai-history-anchor">
        <button
          type="button"
          class="ai-thread-trigger"
          title="切换对话"
          aria-label="切换对话"
          :aria-expanded="historyOpen"
          :aria-controls="historyOpen ? historyId : undefined"
          @click="toggleHistory"
        >
          <span class="truncate">{{ conversationTitle(conversation) }}</span>
          <Icon
            class="ai-thread-chevron"
            name="chevron"
            :size="13"
          />
        </button>
        <div
          v-if="historyOpen"
          :id="historyId"
          class="ai-popover ai-history"
          role="group"
          aria-label="对话记录"
        >
          <button
            v-for="entry in conversations"
            :key="entry.id"
            type="button"
            class="ai-history-row"
            :aria-current="entry.id === activeId ? 'true' : undefined"
            :title="conversationTitle(entry, true)"
            @click="selectConversation(entry.id)"
          >
            <span class="truncate">{{ conversationTitle(entry, true) }}</span>
            <Icon
              v-if="entry.id === activeId"
              name="check"
              :size="14"
            />
          </button>
        </div>
      </div>
      <button
        type="button"
        class="icon-btn sm"
        title="新建对话"
        aria-label="新建对话"
        @click="startConversation"
      >
        <Icon
          name="plus"
          :size="15"
        />
      </button>
      <button
        type="button"
        class="icon-btn sm"
        title="关闭画布 AI (Esc)"
        aria-label="关闭画布 AI"
        @click="emit('close')"
      >
        <Icon
          name="x"
          :size="15"
        />
      </button>
    </header>

    <div
      ref="messagesRef"
      class="ai-messages scroll"
      role="log"
      aria-label="对话消息"
      aria-live="polite"
    >
      <div
        v-if="!conversation.messages.length"
        class="ai-empty"
      >
        <Icon
          class="ai-empty-icon"
          name="sparkle"
          :size="22"
        />
        <p>从当前画布开始对话</p>
        <button
          v-if="!configuredModel"
          type="button"
          class="btn small"
          @click="emit('focusClassic')"
        >
          前往主窗口配置模型
        </button>
        <span v-else>用 @ 引用画布图片或盒子，修改参数或生成整套工作流</span>
      </div>

      <article
        v-for="(message, index) in conversation.messages"
        :key="index"
        :class="'chat-' + message.role"
      >
        <div
          v-if="message.references?.length"
          class="ai-sent-references"
        >
          <span
            v-for="(name, refIndex) in message.references"
            :key="refIndex"
            :title="name"
            class="truncate"
          >
            @{{ name }}
          </span>
        </div>
        <div class="ai-message-content">{{ message.content }}</div>
        <div
          v-if="message.appliedChanges?.length"
          class="ai-applied-list"
          aria-label="已应用到画布的变更"
        >
          <span
            v-for="(change, changeIndex) in message.appliedChanges"
            :key="changeIndex"
            class="ai-applied-pill"
          >
            <Icon
              name="check"
              :size="11"
            />
            <span>{{ change }}</span>
          </span>
        </div>
      </article>

      <div
        v-if="conversation.pending"
        class="ai-pending"
        role="status"
      >
        <Icon
          class="spin-slow"
          name="paw"
          :size="13"
        />
        <span>{{ conversation.step || '正在思考…' }}</span>
      </div>
    </div>

    <form
      class="ai-composer"
      @submit.prevent="send"
    >
      <div
        v-if="picker"
        class="ai-popover ai-references"
      >
        <label
          v-if="picker.kind === 'search'"
          class="ai-reference-search"
        >
          <Icon
            name="at"
            :size="14"
          />
          <input
            ref="searchInputRef"
            v-model="picker.query"
            type="search"
            placeholder="搜索当前画布图片或盒子"
            aria-label="搜索当前画布元素"
            :aria-controls="listboxId"
            :aria-activedescendant="highlightedOptionId"
            @input="highlight = 0"
            @keydown="handlePickerKey"
          />
        </label>
        <p
          v-else
          class="ai-reference-caption"
        >
          引用当前画布
        </p>

        <p
          v-if="!canAttach"
          class="ai-reference-empty"
        >
          每条消息最多引用 {{ MAX_CANVAS_AI_REFERENCES }} 个元素
        </p>
        <p
          v-else-if="!pickerOptions.length"
          class="ai-reference-empty"
        >
          {{ canvasItems.length ? '没有可添加的匹配元素' : '当前画布还没有图片或盒子' }}
        </p>

        <div
          :id="listboxId"
          class="ai-reference-options scroll"
          role="listbox"
          aria-label="当前画布元素"
        >
          <template v-if="canAttach">
            <button
              v-for="(item, index) in pickerOptions"
              :id="`${listboxId}-${index}`"
              :key="item.id"
              type="button"
              class="ai-reference-row"
              role="option"
              tabindex="-1"
              :aria-selected="highlightedIndex() === index"
              @pointerenter="highlight = index"
              @click="attachReference(item)"
            >
              <img
                v-if="previewUrlFor(item)"
                :src="previewUrlFor(item)"
                alt=""
              />
              <Icon
                v-else
                :name="item.icon"
                :size="14"
              />
              <span class="ai-reference-label">
                <span class="truncate">{{ item.title }}</span>
                <small
                  v-if="item.details"
                  class="truncate"
                >
                  {{ item.details }}
                </small>
              </span>
              <small class="ai-reference-type">{{ item.typeLabel }}</small>
            </button>
          </template>
        </div>
      </div>

      <p
        v-if="conversation.error"
        class="ai-error"
        role="alert"
      >
        {{ conversation.error }}
      </p>

      <div
        v-if="explicitRefs.length || implicitRefs.length"
        class="ai-chips"
      >
        <button
          v-for="item in explicitRefs"
          :key="'exp-' + item.id"
          type="button"
          class="ai-chip"
          :title="'点击移除引用 · ' + item.title"
          :aria-label="'移除引用 ' + item.title"
          @click="removeReference(item.id)"
        >
          <Icon
            :name="item.icon"
            :size="12"
          />
          <span class="truncate">{{ item.title }}</span>
          <Icon
            name="x"
            :size="11"
          />
        </button>
        <span
          v-for="item in implicitRefs"
          :key="'imp-' + item.id"
          class="ai-chip ai-chip-implicit"
          :title="'当前画布选中 · ' + item.title"
        >
          <Icon
            :name="item.icon"
            :size="12"
          />
          <span class="truncate">{{ item.title }}</span>
        </span>
      </div>

      <textarea
        ref="composerRef"
        v-model="conversation.draft"
        rows="3"
        placeholder="输入消息，按 @ 引用画布图片或盒子"
        aria-label="输入消息"
        :disabled="conversation.pending"
        :aria-controls="picker?.kind === 'mention' ? listboxId : undefined"
        :aria-activedescendant="picker?.kind === 'mention' ? highlightedOptionId : undefined"
        @input="onDraftInput"
        @click="picker?.kind === 'mention' && updateMention()"
        @keyup="onMentionCaret"
        @compositionend="updateMention"
        @keydown="handleComposerKey"
      />

      <div class="ai-composer-actions">
        <button
          type="button"
          class="icon-btn sm ai-action-icon"
          title="引用画布元素 (@)"
          aria-label="引用画布元素"
          :aria-expanded="Boolean(picker)"
          :aria-controls="picker ? listboxId : undefined"
          :disabled="conversation.pending"
          @click="openReferenceSearch"
        >
          <Icon
            name="at"
            :size="15"
          />
        </button>

        <button
          type="button"
          class="ai-composer-toggle"
          title="切换只读对话或协助编辑画布"
          :aria-label="conversation.mode === 'chat' ? '启用协助编辑' : '切回只读对话'"
          :aria-pressed="conversation.mode === 'edit'"
          :disabled="conversation.pending"
          @click="toggleMode"
        >
          <Icon
            :name="conversation.mode === 'chat' ? 'chat' : 'edit'"
            :size="13"
          />
          <span>{{ conversation.mode === 'chat' ? '只读' : '协助编辑' }}</span>
        </button>

        <button
          type="button"
          class="ai-model-trigger truncate"
          :title="
            configuredModel
              ? `当前模型：${configuredModel}（在主窗口设置中修改）`
              : '还没有可用模型，点击前往主窗口配置'
          "
          @click="emit('focusClassic')"
        >
          <span class="truncate">{{ configuredModel || '去设置模型' }}</span>
        </button>

        <button
          v-if="conversation.pending"
          type="button"
          class="ai-send ai-stop"
          title="停止生成"
          aria-label="停止生成"
          @click="cancelActiveRequest"
        >
          <Icon
            name="stop"
            :size="14"
          />
        </button>
        <button
          v-else
          type="submit"
          class="ai-send"
          title="发送 (Enter)"
          aria-label="发送"
          :disabled="!conversation.draft.trim()"
        >
          <Icon
            name="arrow-up"
            :size="15"
          />
        </button>
      </div>
    </form>
  </aside>
</template>

<style scoped>
.ai-drawer {
  position: absolute;
  z-index: 14;
  top: 52px;
  right: 12px;
  bottom: 12px;
  display: flex;
  flex-direction: column;
  width: min(384px, calc(100% - 24px));
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--line2) 92%, transparent);
  border-radius: 14px;
  background: var(--bg);
  color: var(--text);
  box-shadow: var(--shadow-pop);
}

.ai-header {
  position: relative;
  z-index: 2;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  min-height: 44px;
  padding: 5px 8px 5px 12px;
  border-bottom: 1px solid var(--line);
}

.ai-header-mark {
  flex: 0 0 auto;
  color: var(--pink-deep);
}

.ai-history-anchor {
  position: relative;
  flex: 1;
  min-width: 0;
}

.ai-thread-trigger,
.ai-history-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  padding: 5px 7px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.ai-thread-trigger {
  font-weight: 620;
}

.ai-thread-trigger:hover,
.ai-history-row:hover,
.ai-history-row[aria-current='true'] {
  background: var(--side);
}

.ai-thread-chevron {
  flex-shrink: 0;
  color: var(--muted);
  transform: rotate(90deg);
}

.ai-popover {
  position: absolute;
  z-index: 4;
  display: grid;
  overflow: hidden;
  border: 1px solid var(--line2);
  border-radius: 10px;
  background: var(--bg);
  box-shadow: var(--shadow-pop);
}

.ai-history {
  top: calc(100% + 5px);
  left: 0;
  width: 100%;
  max-height: min(230px, 45vh);
  padding: 4px;
  overflow-y: auto;
}

.ai-history-row {
  justify-content: space-between;
}

.ai-messages {
  flex: 1;
  min-height: 0;
  padding: 14px 12px;
  overflow-y: auto;
}

.ai-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  min-height: 120px;
  padding: 0 18px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
}

.ai-empty-icon {
  color: var(--pink-deep);
}

.ai-empty p {
  margin: 0;
  color: var(--text);
  font-size: 14px;
  font-weight: 620;
}

.ai-messages article {
  margin-bottom: 12px;
  padding: 4px 2px;
  font-size: 13px;
  line-height: 1.6;
}

.ai-messages article.chat-user {
  width: fit-content;
  max-width: 88%;
  margin-left: auto;
  padding: 8px 11px;
  border-radius: 10px 10px 3px;
  background: color-mix(in srgb, var(--pink-soft) 65%, var(--side));
}

.ai-sent-references {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 7px;
  margin-bottom: 4px;
  color: var(--pink-deep);
  font-size: 11px;
  font-weight: 500;
}

.ai-sent-references span {
  max-width: 100%;
}

.ai-message-content {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}

.ai-applied-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
}

.ai-applied-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--ok) 28%, transparent);
  border-radius: 999px;
  background: var(--ok-soft);
  color: var(--ok);
  font-size: 11px;
  font-weight: 500;
}

.ai-pending {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 12px;
}

.ai-composer {
  position: relative;
  display: grid;
  flex: 0 0 auto;
  margin: 0 8px 8px;
  padding: 7px 8px;
  border: 1px solid var(--line2);
  border-radius: 10px;
  background: var(--side);
  transition: border-color var(--dur-fast) var(--ease-out);
}

.ai-composer:focus-within {
  border-color: var(--pink-line);
  background: var(--bg);
}

.ai-composer textarea {
  min-width: 0;
  min-height: 62px;
  padding: 3px 4px;
  border: 0;
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  outline: 0;
  resize: none;
}

.ai-composer-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding-top: 3px;
}

.ai-action-icon {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
}

.ai-composer-toggle,
.ai-model-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  height: 26px;
  padding: 0 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text2);
  font-size: 11.5px;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.ai-composer-toggle {
  flex-shrink: 0;
}

.ai-composer-toggle[aria-pressed='true'] {
  background: var(--pink-soft);
  color: var(--pink-deep);
  font-weight: 560;
}

.ai-model-trigger {
  max-width: 150px;
  margin-left: auto;
  background: color-mix(in srgb, var(--line) 65%, transparent);
  color: var(--text2);
}

.ai-composer-toggle:hover:not(:disabled),
.ai-model-trigger:hover {
  background: var(--line);
  color: var(--text);
}

.ai-send {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: var(--pink);
  color: #fff;
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    opacity var(--dur-fast) var(--ease-out);
}

.ai-send:hover:not(:disabled) {
  background: var(--pink-deep);
}

.ai-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ai-stop {
  background: var(--text);
}

.ai-references {
  inset: auto 0 calc(100% + 6px);
  grid-template-rows: auto minmax(0, 1fr);
  max-height: min(240px, 42vh);
  padding: 5px;
}

.ai-reference-caption,
.ai-reference-empty {
  margin: 0;
  padding: 5px 6px;
  color: var(--muted);
  font-size: 12px;
}

.ai-reference-search {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 29px;
  margin-bottom: 4px;
  padding: 0 7px;
  border-radius: 6px;
  background: var(--side);
  color: var(--muted);
}

.ai-reference-search input {
  flex: 1;
  min-width: 0;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  outline: 0;
}

.ai-reference-options {
  min-height: 0;
  overflow-y: auto;
}

.ai-reference-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 34px;
  padding: 4px 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.ai-reference-row[aria-selected='true'] {
  background: var(--pink-soft);
  color: var(--pink-deep);
}

.ai-reference-row img {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  object-fit: cover;
}

.ai-reference-label {
  display: grid;
  flex: 1;
  min-width: 0;
}

.ai-reference-label small,
.ai-reference-type {
  color: var(--muted);
  font-size: 10.5px;
}

.ai-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-height: 58px;
  margin-bottom: 4px;
  overflow-y: auto;
}

.ai-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 140px;
  padding: 2px 6px;
  border: 0;
  border-radius: 5px;
  background: var(--pink-soft);
  color: var(--pink-deep);
  font-size: 11px;
  cursor: pointer;
}

.ai-chip-implicit {
  background: color-mix(in srgb, var(--line) 70%, transparent);
  color: var(--text2);
  cursor: default;
}

button.ai-chip:hover {
  background: color-mix(in srgb, var(--pink-soft) 80%, var(--pink-line));
}

.ai-error {
  max-height: 76px;
  margin: 0 0 6px;
  padding: 6px 8px;
  overflow: auto;
  border-radius: 7px;
  background: var(--bad-soft);
  color: var(--bad);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
