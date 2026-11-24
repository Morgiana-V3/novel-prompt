<script setup lang="ts" generic="T extends string | number | boolean | null">
import Icon from './Icon.vue'
import { reportError } from '../lib/notifications'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useAttrs, useId, watch } from 'vue'

defineOptions({ inheritAttrs: false })
const props = defineProps<{
  modelValue: T
  options: readonly { value: T; label: string; disabled?: boolean }[]
  disabled?: boolean
  compact?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
const attrs = useAttrs()
const id = useId()
const trigger = ref<HTMLButtonElement>()
const menu = ref<HTMLElement>()
const opened = ref(false)
const portal = shallowRef<string | HTMLElement>('body')
const active = ref(-1)
const position = ref({ left: '0px', top: '0px', width: '0px', maxHeight: '240px' })
const label = computed(
  () => props.options.find((option) => option.value === props.modelValue)?.label ?? '请选择',
)

function close() {
  opened.value = false
}
async function open() {
  if (!trigger.value || trigger.value.matches(':disabled') || !props.options.length) {
    return
  }
  portal.value = trigger.value.closest('dialog') ?? 'body'
  active.value = props.options.findIndex(
    (option) => option.value === props.modelValue && !option.disabled,
  )
  if (active.value < 0) {
    active.value = props.options.findIndex((option) => !option.disabled)
  }
  const bounds = trigger.value.getBoundingClientRect()
  const safeTop = Math.max(
    8,
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--titlebar-safe-height'),
    ) || 40,
  )
  const below = innerHeight - bounds.bottom - 14
  const above = bounds.top - safeTop - 14
  const rowHeight = props.compact ? 30 : 34
  const desired = Math.min(252, props.options.length * rowHeight + 12)
  const upwards = below < desired && above > below
  const height = Math.max(0, Math.min(desired, upwards ? above : below))
  const metrics = document.createElement('canvas').getContext('2d')
  const font = getComputedStyle(trigger.value)
  if (metrics) {
    metrics.font = `600 ${font.fontSize} ${font.fontFamily}`
  }
  const optionPadding = props.compact ? 48 : 66
  const contentWidth =
    Math.max(...props.options.map((option) => metrics?.measureText(option.label).width ?? 0)) +
    optionPadding
  const minWidth = props.compact ? 132 : 150
  const width = Math.min(Math.max(bounds.width, minWidth, contentWidth), innerWidth - 16)
  position.value = {
    left: `${Math.max(8, Math.min(bounds.left, innerWidth - width - 8))}px`,
    top: `${upwards ? bounds.top - height - 6 : bounds.bottom + 6}px`,
    width: `${width}px`,
    maxHeight: `${height}px`,
  }
  opened.value = true
  await revealActive()
}
async function revealActive() {
  await nextTick()
  menu.value
    ?.querySelector<HTMLElement>(`[data-index="${active.value}"]`)
    ?.scrollIntoView({ block: 'nearest' })
}
function select(index: number) {
  const option = props.options[index]
  if (!option || option.disabled) {
    return
  }
  emit('update:modelValue', option.value)
  close()
  trigger.value?.focus({ preventScroll: true })
}
function keydown(event2: KeyboardEvent) {
  if (event2.key === 'Tab') {
    close()
    return
  }
  if (event2.key === 'Escape') {
    if (opened.value) {
      event2.preventDefault()
      event2.stopPropagation()
      close()
    }
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event2.key)) {
    return
  }
  event2.preventDefault()
  event2.stopPropagation()
  if (!opened.value) {
    void open().catch(reportError)
    return
  }
  if (event2.key === 'Enter' || event2.key === ' ') {
    select(active.value)
    return
  }
  const available = props.options
    .map((option, i) => (option.disabled ? -1 : i))
    .filter((i) => i >= 0)
  if (!available.length) {
    return
  }
  const current = available.indexOf(active.value)
  if (event2.key === 'Home') {
    active.value = available[0]
  } else {
    if (event2.key === 'End') {
      active.value = available[available.length - 1]
    } else {
      active.value =
        available[
          (current + (event2.key === 'ArrowDown' ? 1 : -1) + available.length) % available.length
        ]
    }
  }
  void revealActive().catch(reportError)
}
function outside(event2: Event) {
  const target = event2.target as Node
  if (!trigger.value?.contains(target) && !menu.value?.contains(target)) {
    close()
  }
}
function scroll(event2: Event) {
  if (!menu.value?.contains(event2.target as Node)) {
    close()
  }
}
watch(opened, (value) => {
  const method = value ? 'addEventListener' : 'removeEventListener'
  document[method]('pointerdown', outside, true)
  document[method]('scroll', scroll, true)
  window[method]('resize', close)
})
watch(
  () => props.disabled,
  (value) => {
    if (value) {
      close()
    }
  },
)
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outside, true)
  document.removeEventListener('scroll', scroll, true)
  window.removeEventListener('resize', close)
})
</script>

<template>
  <button
    ref="trigger"
    v-bind="attrs"
    type="button"
    class="theme-select"
    :class="{ input: !compact, 'theme-select-compact': compact, expanded: opened }"
    :disabled="disabled"
    role="combobox"
    aria-haspopup="listbox"
    :aria-expanded="opened"
    :aria-controls="opened ? id : undefined"
    :aria-activedescendant="opened && active >= 0 ? `${id}-${active}` : undefined"
    @click="opened ? close() : open()"
    @keydown="keydown"
    @blur="close"
  >
    <span>{{ label }}</span
    ><Icon
      name="chevron"
      class="theme-select-caret"
      :size="compact ? 10 : 12"
    />
  </button>
  <Teleport :to="portal">
    <Transition name="select-menu">
      <div
        v-if="opened"
        ref="menu"
        class="theme-select-menu"
        :class="{ 'theme-select-menu-compact': compact }"
        :style="position"
        @pointerdown.prevent
      >
        <div
          :id="id"
          class="theme-select-options scroll"
          role="listbox"
          :aria-label="String(attrs['aria-label'] ?? '选项')"
        >
          <div
            v-for="(option, indexItem) in options"
            :id="`${id}-${indexItem}`"
            :key="indexItem"
            :data-index="indexItem"
            role="option"
            :aria-selected="option.value === modelValue"
            :aria-disabled="option.disabled || undefined"
            :class="[
              'theme-select-option',
              {
                active: indexItem === active,
                selected: option.value === modelValue,
                disabled: option.disabled,
              },
            ]"
            @pointermove="!option.disabled && (active = indexItem)"
            @click="select(indexItem)"
          >
            <span :title="option.label">{{ option.label }}</span
            ><span
              v-if="option.value === modelValue"
              aria-hidden="true"
              ><Icon
                name="check"
                :size="13"
            /></span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="less">
.theme-select.input {
  justify-content: space-between;
  gap: 12px;
  text-align: left;
  cursor: pointer;
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
}

.theme-select {
  display: inline-flex;
  align-items: center;
}

.theme-select-compact {
  justify-content: center;
  gap: 5px;
  min-width: 0;
  min-height: 24px;
  max-width: 100%;
  padding: 3px 7px;
  border-radius: 6px;
  background: var(--hover);
  color: var(--text2);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.25;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

.theme-select-compact:hover:enabled,
.theme-select-compact.expanded {
  background: var(--pink-soft);
  color: var(--text);
}

.theme-select-compact:focus-visible {
  box-shadow: inset 0 0 0 1px var(--pink-deep);
}

.theme-select-compact:disabled {
  background: transparent;
}

.theme-select-compact:disabled .theme-select-caret {
  visibility: hidden;
}

.theme-select > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.theme-select-caret {
  flex-shrink: 0;
  fill: none;
  stroke: var(--muted);
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
  transform: rotate(90deg);
  transition: transform var(--dur-base) var(--ease-out);
}

.theme-select.expanded .theme-select-caret {
  transform: rotate(-90deg);
}

.theme-select:hover:not(:disabled),
.theme-select.expanded {
  border-color: var(--pink-line);
}

.theme-select:focus:not(:focus-visible, .expanded) {
  box-shadow: none;
}

.theme-select-menu {
  position: fixed;
  z-index: 200;
  display: flex;
  padding: 5px;
  overflow: hidden;
  background: var(--bg);
  border: 1px solid var(--pink-line);
  border-radius: 12px;
  box-shadow: var(--shadow-pop);
}

.theme-select-menu-compact {
  border-color: var(--line2);
  border-radius: 9px;
}

.theme-select-menu-compact .theme-select-option {
  min-height: 30px;
  padding: 5px 8px;
  font-size: 12px;
}

.theme-select-options {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: auto;
  overscroll-behavior: contain;
  border-radius: 7px;
}

.theme-select-option > span:first-child {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.theme-select-option > span:last-child:not(:first-child) {
  flex-shrink: 0;
}

.theme-select-option {
  min-height: 34px;
  padding: 7px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border-radius: 7px;
  font-size: 12.5px;
  color: var(--text2);
  cursor: pointer;
  transition:
    color var(--dur-fast),
    background-color var(--dur-fast);

  &.active {
    background: var(--pink-soft);
  }
}

.theme-select-option.selected {
  color: var(--pink-deep);
  font-weight: 600;
}

.theme-select-option.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.theme-select:disabled {
  color: var(--muted);
  cursor: not-allowed;
}

.select-menu-enter-active {
  transition:
    opacity var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}

.select-menu-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-in),
    transform var(--dur-fast) var(--ease-in);
  pointer-events: none;
}

.select-menu-enter-from,
.select-menu-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}
</style>
