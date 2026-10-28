<script setup lang="ts">
import { reportError } from '../lib/notifications'
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'

defineProps<{ text: string; label: string }>()
const id = useId()
const trigger = ref<HTMLButtonElement>()
const bubble = ref<HTMLDivElement>()
const opened = ref(false)
const pinned = ref(false)
const side = ref<'top' | 'bottom'>('bottom')
const position = ref({
  left: '0px',
  top: '0px',
  '--help-arrow-x': '50%',
  visibility: 'hidden' as 'hidden' | 'visible',
})
let timer: ReturnType<typeof setTimeout> | undefined

function close(): void {
  clearTimeout(timer)
  bubble.value?.hidePopover()
  opened.value = false
  pinned.value = false
}

async function show(): Promise<void> {
  clearTimeout(timer)
  if (opened.value) {
    return
  }
  document.dispatchEvent(new CustomEvent('settings-help-open', { detail: id }))
  opened.value = true
  position.value.visibility = 'hidden'
  await nextTick()
  if (!opened.value || !trigger.value || !bubble.value) {
    return
  }
  bubble.value.showPopover()
  place()
}

function place(): void {
  if (!trigger.value || !bubble.value) {
    return
  }
  const anchor = trigger.value.getBoundingClientRect()
  if (anchor.bottom < 0 || anchor.top > innerHeight) {
    close()
    return
  }
  const size = bubble.value.getBoundingClientRect()
  const center = anchor.left + anchor.width / 2
  const left = Math.max(12, Math.min(center - size.width / 2, innerWidth - size.width - 12))
  const fitsBelow = anchor.bottom + size.height + 10 <= innerHeight - 12
  side.value = fitsBelow ? 'bottom' : 'top'
  position.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(fitsBelow ? anchor.bottom + 10 : Math.max(12, anchor.top - size.height - 10))}px`,
    '--help-arrow-x': `${Math.max(12, Math.min(center - left, size.width - 12))}px`,
    visibility: 'visible',
  }
}

function scroll(): void {
  // Keyboard focus can scroll its label into view; keep its help visible and anchored.
  if (opened.value && document.activeElement === trigger.value) {
    place()
  } else {
    close()
  }
}

function blur(): void {
  clearTimeout(timer)
  timer = setTimeout(() => {
    if (!bubble.value?.matches(':hover')) {
      close()
    }
  }, 140)
}

function cancelHide(): void {
  clearTimeout(timer)
}

function hover(): void {
  clearTimeout(timer)
  timer = setTimeout(() => {
    show().catch(reportError)
  }, 200)
}

function leave(): void {
  clearTimeout(timer)
  if (!pinned.value && document.activeElement !== trigger.value) {
    timer = setTimeout(close, 140)
  }
}

function toggle(): void {
  if (pinned.value) {
    close()
  } else {
    pinned.value = true
    show().catch(reportError)
  }
}

function outside(event: PointerEvent): void {
  if (
    event.target instanceof Node &&
    !trigger.value?.contains(event.target) &&
    !bubble.value?.contains(event.target)
  ) {
    close()
  }
}

function key(event: KeyboardEvent): void {
  if (event.key === 'Escape' && opened.value) {
    event.stopPropagation()
    close()
  }
}

function otherTip(event: Event): void {
  if ((event as CustomEvent<string>).detail !== id) {
    close()
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', outside)
  document.addEventListener('keydown', key, true)
  document.addEventListener('settings-help-open', otherTip)
  document.addEventListener('scroll', scroll, true)
  window.addEventListener('resize', close)
  window.addEventListener('blur', close)
})
onBeforeUnmount(() => {
  close()
  document.removeEventListener('pointerdown', outside)
  document.removeEventListener('keydown', key, true)
  document.removeEventListener('settings-help-open', otherTip)
  document.removeEventListener('scroll', scroll, true)
  window.removeEventListener('resize', close)
  window.removeEventListener('blur', close)
})
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="help-tip"
    :class="{ open: opened }"
    :aria-label="`${label}说明`"
    :aria-describedby="opened ? id : undefined"
    @pointerenter="hover"
    @pointerleave="leave"
    @focus="show"
    @blur="blur"
    @click.prevent.stop="toggle"
  >
    <svg
      width="13"
      height="13"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="10"
        cy="10"
        r="7.25"
        stroke="currentColor"
        stroke-width="1.3"
      />
      <path
        d="M10 9v5"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
      <circle
        cx="10"
        cy="6"
        r=".9"
        fill="currentColor"
      />
    </svg>
  </button>
  <Teleport to="body">
    <div
      v-if="opened"
      :id="id"
      ref="bubble"
      role="tooltip"
      popover="manual"
      class="help-tip-bubble"
      :style="position"
      :data-side="side"
      @pointerenter="cancelHide"
      @pointerleave="leave"
    >
      {{ text }}
    </div>
  </Teleport>
</template>

<style scoped>
.help-tip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  vertical-align: middle;
  color: var(--muted);
  background: transparent;
  cursor: help;
  transition:
    color var(--dur-fast),
    background-color var(--dur-fast);
}

.help-tip:hover,
.help-tip:focus-visible {
  color: var(--text2);
  background: var(--hover);
}

.help-tip.open {
  color: var(--pink-deep);
  background: var(--pink-soft);
}

.help-tip:focus-visible {
  outline: 2px solid var(--pink);
  outline-offset: 1px;
}

.help-tip-bubble {
  --help-border: var(--pink-line);

  position: fixed;
  inset: auto;
  box-sizing: border-box;
  width: max-content;
  max-width: min(300px, calc(100vw - 24px));
  margin: 0;
  padding: 9px 12px;
  border: 1px solid var(--help-border);
  border-radius: 10px;
  color: var(--text2);
  background: var(--bg);
  box-shadow:
    0 1px 2px rgb(36 32 44 / 4%),
    0 8px 24px rgb(36 32 44 / 10%);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.65;
  letter-spacing: 0.01em;
  text-align: left;
  white-space: pre-line;
  overflow: visible;
  overflow-wrap: anywhere;
  text-wrap: pretty;
  user-select: text;
  cursor: auto;
  animation: help-tip-in var(--dur-fast) var(--ease-out);
}

.help-tip-bubble[data-side='top'] {
  --help-enter-y: 3px;
}

.help-tip-bubble::before {
  content: '';
  position: absolute;
  left: var(--help-arrow-x);
  width: 8px;
  height: 8px;
  box-sizing: border-box;
  background: var(--bg);
  border: 1px solid var(--help-border);
  border-radius: 2px 0 0;
  transform: translateX(-50%) rotate(45deg);
}

.help-tip-bubble[data-side='bottom']::before {
  top: -5px;
  border-right: 0;
  border-bottom: 0;
}

.help-tip-bubble[data-side='top']::before {
  bottom: -5px;
  border-top: 0;
  border-left: 0;
  border-radius: 0 0 2px;
}

@keyframes help-tip-in {
  from {
    opacity: 0;
    transform: translateY(var(--help-enter-y, -3px));
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-tip,
  .help-tip-bubble {
    transition: none;
    animation: none;
  }
}
</style>
