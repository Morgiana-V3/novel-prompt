<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  useId,
  watch,
} from 'vue'
import type { PromptSnippet } from '@shared/prompts/snippets'
import { copy, reportError, toast } from '../../../shared/lib/notifications'
import { cleanErr } from '../../../shared/lib/format'
import { revealSnippets } from '../../favorites/public'
import Icon from '../../../shared/ui/Icon.vue'

type InsertMode = 'cursor' | 'append' | 'replace'
const MODES: { value: InsertMode; label: string; title: string }[] = [
  { value: 'cursor', label: '光标处', title: '插入到光标处，或替换选中的文字' },
  { value: 'append', label: '末尾', title: '追加到输入框末尾' },
  { value: 'replace', label: '替换', title: '替换整个输入框' },
]
const props = defineProps<{ disabled?: boolean }>()
const anchor = ref<HTMLElement>()
const rail = ref<HTMLElement>()
const trigger = ref<HTMLButtonElement>()
const panel = ref<HTMLElement>()
const search = ref<HTMLInputElement>()
const nameInput = ref<HTMLInputElement>()
const portal = shallowRef<string | HTMLElement>('body')
const panelId = useId()
const opened = ref(false)
const loading = ref(false)
const error = ref('')
const copied = ref(false)
const items = ref<PromptSnippet[]>([])
const query = ref('')
const category = ref('')
const mode = ref<InsertMode>('cursor')
const saving = ref(false)
const saveBusy = ref(false)
const saveDraft = reactive({ name: '', category: '', text: '' })
const selectionText = ref('')
const fieldText = ref('')
const position = ref({ left: '0px', top: '0px', width: '360px', maxHeight: '420px' })
const categories = computed(() => [
  ...new Set(items.value.map((item) => item.category).filter(Boolean)),
])
const filtered = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return items.value.filter(
    (item) =>
      (!category.value || item.category === category.value) &&
      `${item.name} ${item.text} ${item.category}`.toLowerCase().includes(keyword),
  )
})
let target: HTMLTextAreaElement | null = null
let closeTimer: ReturnType<typeof setTimeout> | undefined
let openTimer: ReturnType<typeof setTimeout> | undefined
let copiedTimer: ReturnType<typeof setTimeout> | undefined
let request = 0
function field() {
  const next = anchor.value?.nextElementSibling
  return next instanceof HTMLTextAreaElement ? next : null
}
/** 父容器的 gap、label 换行等都会改变输入框相对锚点的位置，按实际位置对齐到右上角 */
/**
 * 输入框底部至少留出这么高：工具条（22px 按钮 + 3px 边距）放在原有内边距里，
 * 只在原内边距不够时补足差额，不额外叠加。
 */
const RAIL_SPACE = 26
let reserved: { input: HTMLTextAreaElement; padding: string } | undefined
function reserveSpace(enabled: boolean) {
  const input = field()
  if (reserved && (!enabled || reserved.input !== input)) {
    reserved.input.style.paddingBottom = reserved.padding
    reserved = undefined
  }
  if (enabled && input && !reserved) {
    reserved = { input, padding: input.style.paddingBottom }
    const base = parseFloat(getComputedStyle(input).paddingBottom) || 0
    input.style.paddingBottom = `${Math.max(base, RAIL_SPACE)}px`
  }
}
/** 对齐到输入框右下角的预留区；有滚动条时让开滚动条 */
function align() {
  const input = field()
  if (!input || !anchor.value || !rail.value) {
    return
  }
  const from = anchor.value.getBoundingClientRect()
  const to = input.getBoundingClientRect()
  const style = getComputedStyle(input)
  const scrollbar =
    input.offsetWidth -
    input.clientWidth -
    (parseFloat(style.borderLeftWidth) || 0) -
    (parseFloat(style.borderRightWidth) || 0)
  rail.value.style.top = `${to.bottom - from.top - rail.value.offsetHeight - 3}px`
  rail.value.style.right = `${from.right - to.right + 6 + Math.max(0, scrollbar)}px`
}
/** Alt + S：输入时不用离开键盘就能打开片段 */
function shortcut(event: KeyboardEvent) {
  if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyS') {
    event.preventDefault()
    open(true).catch(reportError)
  }
}
let resize: ResizeObserver | undefined
function keepOpen() {
  clearTimeout(closeTimer)
}
function hover() {
  keepOpen()
  clearTimeout(openTimer)
  openTimer = setTimeout(() => open().catch(reportError), 120)
}
function leave() {
  clearTimeout(openTimer)
  closeTimer = setTimeout(() => {
    if (!panel.value?.contains(document.activeElement)) {
      close()
    }
  }, 180)
}
function place() {
  if (!trigger.value || !panel.value) {
    return
  }
  const rect = trigger.value.getBoundingClientRect()
  const width = Math.min(360, innerWidth - 24)
  const safeTop = Math.max(
    12,
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--titlebar-safe-height'),
    ) || 40,
  )
  const below = innerHeight - rect.bottom - 12
  const above = rect.top - safeTop - 6
  const upwards = below < 300 && above > below
  const maxHeight = Math.max(80, Math.min(420, upwards ? above : below))
  const height = Math.min(panel.value.scrollHeight, maxHeight)
  panel.value.dataset.side = upwards ? 'top' : 'bottom'
  position.value = {
    left: `${Math.max(12, Math.min(rect.right - width, innerWidth - width - 12))}px`,
    top: `${upwards ? rect.top - height - 6 : rect.bottom + 6}px`,
    width: `${width}px`,
    maxHeight: `${maxHeight}px`,
  }
}
function onScroll(event: Event) {
  if (event.target instanceof Node && panel.value?.contains(event.target)) {
    return
  }
  close()
}
function detach() {
  window.removeEventListener('resize', close)
  document.removeEventListener('scroll', onScroll, true)
  document.removeEventListener('keydown', popupKey, true)
}
function popupKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    keyboard(event)
  } else if (
    event.key === 'Tab' &&
    event.target instanceof Node &&
    panel.value?.contains(event.target)
  ) {
    // A containing editor's focus trap must not intercept this nonmodal popup.
    event.stopPropagation()
  }
}
function close() {
  clearTimeout(openTimer)
  clearTimeout(closeTimer)
  request++
  opened.value = false
  saving.value = false
  panel.value?.hidePopover()
  detach()
}
function toggled(event: Event) {
  if ((event as ToggleEvent).newState === 'closed') {
    opened.value = false
    saving.value = false
    detach()
  }
}
async function open(focus = false) {
  clearTimeout(openTimer)
  keepOpen()
  if (props.disabled) {
    return
  }
  if (opened.value) {
    if (focus) {
      search.value?.focus({ preventScroll: true })
    }
    return
  }
  target = field()
  if (!target || target.readOnly || target.matches(':disabled')) {
    return
  }
  portal.value = trigger.value?.closest('dialog') ?? 'body'
  selectionText.value = target.value.slice(target.selectionStart, target.selectionEnd).trim()
  fieldText.value = target.value.trim()
  query.value = ''
  saving.value = false
  loading.value = true
  error.value = ''
  opened.value = true
  const currentRequest = ++request
  await nextTick()
  if (!opened.value || request !== currentRequest) {
    return
  }
  panel.value?.showPopover()
  place()
  window.addEventListener('resize', close)
  document.addEventListener('scroll', onScroll, true)
  document.addEventListener('keydown', popupKey, true)
  if (focus) {
    search.value?.focus({ preventScroll: true })
  }
  try {
    const result = await window.api.snippetsList()
    if (request === currentRequest) {
      items.value = result
      if (category.value && !result.some((item) => item.category === category.value)) {
        category.value = ''
      }
    }
  } catch (reason) {
    if (request === currentRequest) {
      error.value = cleanErr(reason)
    }
  } finally {
    if (request === currentRequest) {
      loading.value = false
      await nextTick()
      place()
    }
  }
}
function listButtons() {
  return [...(panel.value?.querySelectorAll<HTMLButtonElement>('.snippet-quick-list button') ?? [])]
}
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    if (saving.value) {
      saving.value = false
      search.value?.focus({ preventScroll: true })
      return
    }
    const restoreTrigger = panel.value?.contains(document.activeElement)
    close()
    if (restoreTrigger) {
      trigger.value?.focus({ preventScroll: true })
    }
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const buttons = listButtons()
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (event.target === search.value && event.key === 'ArrowDown') {
      event.preventDefault()
      buttons[0]?.focus()
    } else if (index >= 0) {
      event.preventDefault()
      const next = buttons[index + (event.key === 'ArrowDown' ? 1 : -1)]
      if (next) {
        next.focus()
      } else if (event.key === 'ArrowUp') {
        search.value?.focus()
      }
    }
  }
}
function focusOut(event: FocusEvent) {
  const next = event.relatedTarget
  if (next instanceof Node && (panel.value?.contains(next) || next === trigger.value)) {
    return
  }
  close()
}
async function startSave() {
  const text = selectionText.value || fieldText.value
  Object.assign(saveDraft, {
    text,
    name: text
      .split(/[,，\n]/)[0]
      .trim()
      .slice(0, 24),
    category: category.value,
  })
  saving.value = true
  await nextTick()
  place()
  nameInput.value?.focus()
  nameInput.value?.select()
}
async function saveSnippet() {
  if (saveBusy.value || !saveDraft.text) {
    return
  }
  saveBusy.value = true
  try {
    const item = await window.api.snippetsSave({ ...saveDraft })
    items.value = [item, ...items.value.filter((entry) => entry.id !== item.id)]
    saving.value = false
    toast(`已存为片段「${item.name}」`)
    await nextTick()
    place()
    search.value?.focus({ preventScroll: true })
  } catch (reason) {
    error.value = cleanErr(reason)
  } finally {
    saveBusy.value = false
  }
}
function manage() {
  close()
  revealSnippets()
}
async function insert(text: string, insertionMode = mode.value) {
  if (!target || !target.isConnected || target.readOnly || target.matches(':disabled')) {
    close()
    return
  }
  const input = target
  const start = input.selectionStart
  const end = input.selectionEnd
  close()
  await nextTick()
  input.focus()
  let from = start
  if (insertionMode === 'replace') {
    from = 0
  } else if (insertionMode === 'append') {
    from = input.value.length
  }
  const to = insertionMode === 'cursor' ? end : input.value.length
  const before = input.value.slice(0, from)
  const after = input.value.slice(to)
  const prefix = before && !/[\s,]$/.test(before) && !/^[\s,]/.test(text) ? ', ' : ''
  const suffix = after && !/^[\s,]/.test(after) && !/[\s,]$/.test(text) ? ', ' : ''
  input.setSelectionRange(from, to)
  // Keep one native undo transaction and notify v-model.
  document.execCommand('insertText', false, prefix + text + suffix)
}
function copyText() {
  const input = field()
  if (!input) {
    return
  }
  copy(input.value)
    .then(() => {
      copied.value = true
      clearTimeout(copiedTimer)
      copiedTimer = setTimeout(() => {
        copied.value = false
      }, 1200)
    })
    .catch(reportError)
}
watch(
  () => props.disabled,
  async (disabled) => {
    if (disabled) {
      close()
    }
    await nextTick()
    reserveSpace(!disabled)
    align()
  },
)
onMounted(() => {
  reserveSpace(!props.disabled)
  align()
  resize = new ResizeObserver(align)
  const input = field()
  input?.addEventListener('keydown', shortcut)
  for (const element of [input, input?.parentElement]) {
    if (element) {
      resize.observe(element)
    }
  }
})
onBeforeUnmount(() => {
  resize?.disconnect()
  field()?.removeEventListener('keydown', shortcut)
  reserveSpace(false)
  close()
  clearTimeout(copiedTimer)
})
</script>

<template>
  <div
    ref="anchor"
    class="snippet-anchor"
  >
    <div
      v-if="!disabled"
      ref="rail"
      class="snippet-rail"
      :class="{ active: opened }"
      role="group"
      aria-label="提示词操作"
    >
      <button
        type="button"
        class="icon-btn sm"
        :class="{ done: copied }"
        aria-label="复制提示词"
        :title="copied ? '已复制' : '复制提示词'"
        @mousedown.prevent
        @click="copyText"
      >
        <Icon
          :name="copied ? 'check' : 'copy'"
          :size="13"
        />
      </button>
      <button
        ref="trigger"
        type="button"
        class="icon-btn sm snippet-trigger"
        :class="{ active: opened }"
        aria-label="引用收藏"
        title="提示词片段（Alt + S）"
        aria-haspopup="dialog"
        :aria-expanded="opened"
        :aria-controls="panelId"
        :popovertarget="panelId"
        popovertargetaction="show"
        @pointerenter="hover"
        @pointerleave="leave"
        @mousedown.prevent
        @click="open(true)"
        @keydown.down.prevent="open(true)"
        @keydown.esc.prevent="close"
      >
        <Icon
          name="star"
          :size="13"
        />
      </button>
    </div>
  </div>
  <Teleport :to="portal">
    <div
      :id="panelId"
      ref="panel"
      popover="auto"
      class="snippet-popover"
      role="dialog"
      aria-label="收藏的提示词片段"
      :style="position"
      @toggle="toggled"
      @pointerenter="keepOpen"
      @pointerleave="leave"
      @keydown="keyboard"
      @focusout="focusOut"
    >
      <div class="snippet-quick-search">
        <Icon
          name="search"
          :size="14"
        />
        <input
          ref="search"
          v-model="query"
          type="search"
          placeholder="搜索提示词片段"
          aria-label="搜索收藏片段"
        />
        <button
          class="snippet-manage"
          title="在收藏页管理全部片段"
          @click="manage"
        >
          管理
        </button>
      </div>
      <div
        v-if="categories.length"
        class="snippet-quick-categories"
        role="group"
        aria-label="收藏分类"
      >
        <button
          :class="{ on: !category }"
          @click="category = ''"
        >
          全部</button
        ><button
          v-for="name in categories"
          :key="name"
          :class="{ on: category === name }"
          @click="category = category === name ? '' : name"
        >
          {{ name }}
        </button>
      </div>
      <div
        class="snippet-quick-list"
        :aria-busy="loading"
      >
        <p v-if="loading && !items.length">正在加载…</p>
        <p
          v-else-if="error"
          role="alert"
        >
          {{ error }}
        </p>
        <template v-else>
          <button
            v-for="item in filtered"
            :key="item.id"
            type="button"
            :title="item.text"
            @mousedown.prevent
            @click="insert(item.text)"
          >
            <span class="snippet-quick-title"
              ><b>{{ item.name }}</b
              ><small v-if="item.category">{{ item.category }}</small></span
            ><span class="snippet-excerpt">{{ item.text }}</span>
          </button>
          <p v-if="!filtered.length">
            {{
              items.length
                ? '没有匹配的片段'
                : '还没有片段。选中输入框里的文字，点下方「存为片段」即可收藏。'
            }}
          </p>
        </template>
      </div>
      <form
        v-if="saving"
        class="snippet-quick-save"
        @submit.prevent="saveSnippet"
      >
        <p class="snippet-save-text">{{ saveDraft.text }}</p>
        <div>
          <input
            ref="nameInput"
            v-model="saveDraft.name"
            class="input"
            maxlength="120"
            placeholder="片段名称"
            aria-label="片段名称"
            required
          /><input
            v-model="saveDraft.category"
            class="input"
            maxlength="80"
            placeholder="分类"
            aria-label="片段分类"
          />
        </div>
        <div
          v-if="categories.length"
          class="snippet-save-categories"
        >
          <button
            v-for="name in categories"
            :key="name"
            type="button"
            :class="{ on: saveDraft.category === name }"
            @click="saveDraft.category = saveDraft.category === name ? '' : name"
          >
            {{ name }}
          </button>
        </div>
        <div>
          <button
            type="button"
            class="btn ghost small"
            @click="saving = false"
          >
            取消</button
          ><button
            class="btn primary small"
            :disabled="saveBusy"
          >
            保存
          </button>
        </div>
      </form>
      <div
        v-else
        class="snippet-quick-footer"
      >
        <div
          class="snippet-modes"
          role="radiogroup"
          aria-label="插入方式"
        >
          <button
            v-for="option in MODES"
            :key="option.value"
            type="button"
            role="radio"
            :data-mode="option.value"
            :aria-checked="mode === option.value"
            :class="{ on: mode === option.value }"
            :title="option.title"
            @mousedown.prevent
            @click="mode = option.value"
          >
            {{ option.label }}
          </button>
        </div>
        <button
          type="button"
          class="btn ghost small"
          :disabled="!selectionText && !fieldText"
          :title="selectionText ? '把选中的文字存为片段' : '把整个输入框存为片段'"
          @click="startSave"
        >
          <Icon
            name="plus"
            :size="13"
          />{{ selectionText ? '存选中文字' : '存为片段' }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/*
 * 零高度锚点紧贴在输入框上方，工具条绝对定位到输入框右下角的预留区：
 * 文字不会排进这块区域，悬停或聚焦时浮现也不会挡住正在编辑的内容。
 */
.snippet-anchor {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 0;
  flex-shrink: 0;
}

.snippet-rail {
  position: absolute;
  top: 0;
  right: 6px;
  display: flex;
  gap: 1px;
  opacity: 0;
  transition: opacity var(--dur-base) var(--ease-out);
}

.snippet-anchor:hover .snippet-rail,
.snippet-anchor:has(+ textarea:is(:hover, :focus)) .snippet-rail,
.snippet-rail:focus-within,
.snippet-rail.active {
  opacity: 1;
}

.snippet-rail .icon-btn.sm {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  color: var(--text2);
}

.snippet-rail .icon-btn:hover:not(:disabled) {
  color: var(--text);
}

.snippet-rail .icon-btn.done {
  color: var(--ok);
}

.snippet-rail .snippet-trigger.active {
  color: var(--pink-deep);
  background: var(--pink-soft);
}

.snippet-popover {
  position: fixed;
  inset: auto;
  margin: 0;
  padding: 0;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--line2);
  border-radius: 14px;
  box-shadow: var(--shadow-pop);
  overflow: hidden;
  transform-origin: top right;
}

.snippet-popover[data-side='top'] {
  transform-origin: bottom right;
}

.snippet-popover:popover-open {
  display: flex;
  flex-direction: column;
  animation: pop var(--dur-base) var(--ease-out);
}

.snippet-quick-search {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  height: 44px;
  padding: 0 8px 0 14px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
}

.snippet-quick-search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 13px;
}

.snippet-quick-search input::placeholder {
  color: var(--muted);
}

.snippet-manage {
  flex-shrink: 0;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--text2);
  transition: background-color var(--dur-fast) var(--ease-out);
}

.snippet-manage:hover {
  background: var(--hover);
  color: var(--text);
}

.snippet-quick-categories {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  padding: 10px 12px 2px;
  overflow-x: auto;
  scrollbar-width: none;
}

.snippet-quick-categories button {
  flex-shrink: 0;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--hover);
  color: var(--text2);
  font-size: 11.5px;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.snippet-quick-categories button:hover:not(.on) {
  color: var(--text);
}

.snippet-quick-categories button.on {
  background: var(--pink-soft);
  color: var(--pink-deep);
  font-weight: 600;
}

.snippet-quick-list {
  flex: 1;
  overflow: auto;
  min-height: 0;
  padding: 6px;
}

.snippet-quick-list button {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 9px 10px;
  text-align: left;
  border-radius: 10px;
  font-size: 12.5px;
  transition: background-color var(--dur-fast) var(--ease-out);
}

.snippet-quick-list button:hover,
.snippet-quick-list button:focus-visible {
  background: var(--pink-soft);
  box-shadow: none;
}

.snippet-quick-title {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
}

.snippet-quick-title b {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.snippet-quick-title small {
  flex-shrink: 0;
  max-width: 96px;
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 11px;
}

.snippet-excerpt {
  display: -webkit-box;
  max-width: 100%;
  overflow: hidden;
  overflow-wrap: anywhere;
  color: var(--muted);
  font: 11px/1.6 var(--mono);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.snippet-quick-list p {
  margin: 18px 12px;
  color: var(--muted);
  text-align: center;
  font-size: 12px;
  line-height: 1.7;
}

.snippet-quick-footer,
.snippet-quick-save {
  flex-shrink: 0;
  border-top: 1px solid var(--line);
  background: var(--panel);
}

.snippet-quick-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
}

.snippet-modes {
  display: inline-flex;
  padding: 2px;
  gap: 2px;
  border-radius: 999px;
  background: var(--hover);
}

.snippet-modes button {
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  color: var(--text2);
  font-size: 11.5px;
  transition:
    background-color var(--dur-base) var(--ease-out),
    color var(--dur-base) var(--ease-out),
    box-shadow var(--dur-base) var(--ease-out);
}

.snippet-modes button:hover:not(.on) {
  color: var(--text);
}

.snippet-modes button.on {
  background: var(--bg);
  color: var(--text);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.snippet-quick-save {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px 12px;
  animation: fade-in var(--dur-base) var(--ease-out);
}

.snippet-save-text {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  color: var(--text2);
  font: 11px/1.6 var(--mono);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.snippet-quick-save > div {
  display: flex;
  gap: 6px;
}

.snippet-quick-save > div:last-child {
  justify-content: flex-end;
}

.snippet-quick-save > .snippet-save-categories {
  flex-wrap: wrap;
  gap: 4px;
}

.snippet-save-categories button {
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--hover);
  color: var(--text2);
  font-size: 11px;
}

.snippet-save-categories button.on {
  background: var(--pink-soft);
  color: var(--pink-deep);
}

.snippet-quick-save .input {
  min-width: 0;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 12px;
}

.snippet-quick-save .input:first-child {
  flex: 1.6;
}

.snippet-quick-save .input:last-child {
  flex: 1;
}
</style>
