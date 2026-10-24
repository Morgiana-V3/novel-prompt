<script setup lang="ts" generic="T extends string | number | boolean | null">
import { computed, nextTick, onBeforeUnmount, ref, useAttrs, useId, watch } from 'vue'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ modelValue: T; options: readonly { value: T; label: string; disabled?: boolean }[]; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
const attrs = useAttrs()
const id = useId()
const trigger = ref<HTMLButtonElement>()
const menu = ref<HTMLElement>()
const opened = ref(false)
const active = ref(-1)
const position = ref({ left: '0px', top: '0px', width: '0px', maxHeight: '240px' })
const label = computed(() => props.options.find(o => o.value === props.modelValue)?.label ?? '请选择')

function close() { opened.value = false }
async function open() {
  if (!trigger.value || trigger.value.matches(':disabled') || !props.options.length) return
  active.value = props.options.findIndex(o => o.value === props.modelValue && !o.disabled)
  if (active.value < 0) active.value = props.options.findIndex(o => !o.disabled)
  const r = trigger.value.getBoundingClientRect()
  const safeTop = Math.max(8, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--titlebar-safe-height')) || 40)
  const below = innerHeight - r.bottom - 14, above = r.top - safeTop - 14
  const desired = Math.min(252, props.options.length * 34 + 12)
  const upwards = below < desired && above > below
  const height = Math.max(0, Math.min(desired, upwards ? above : below))
  const width = Math.min(Math.max(r.width, 150), innerWidth - 16)
  position.value = { left: `${Math.max(8, Math.min(r.left, innerWidth - width - 8))}px`,
    top: `${upwards ? r.top - height - 6 : r.bottom + 6}px`, width: `${width}px`, maxHeight: `${height}px` }
  opened.value = true
  await revealActive()
}
async function revealActive() {
  await nextTick()
  menu.value?.querySelector<HTMLElement>(`[data-index="${active.value}"]`)?.scrollIntoView({ block: 'nearest' })
}
function select(index: number) {
  const option = props.options[index]
  if (!option || option.disabled) return
  emit('update:modelValue', option.value)
  close()
  trigger.value?.focus({ preventScroll: true })
}
function keydown(e: KeyboardEvent) {
  if (e.key === 'Tab') { close(); return }
  if (e.key === 'Escape') {
    if (opened.value) { e.preventDefault(); e.stopPropagation(); close() }
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(e.key)) return
  e.preventDefault(); e.stopPropagation()
  if (!opened.value) { void open(); return }
  if (e.key === 'Enter' || e.key === ' ') { select(active.value); return }
  const available = props.options.map((o, i) => o.disabled ? -1 : i).filter(i => i >= 0)
  if (!available.length) return
  const current = available.indexOf(active.value)
  active.value = e.key === 'Home' ? available[0] : e.key === 'End' ? available[available.length - 1]
    : available[(current + (e.key === 'ArrowDown' ? 1 : -1) + available.length) % available.length]
  void revealActive()
}
function outside(e: Event) {
  const target = e.target as Node
  if (!trigger.value?.contains(target) && !menu.value?.contains(target)) close()
}
function scroll(e: Event) { if (!menu.value?.contains(e.target as Node)) close() }
watch(opened, value => {
  const method = value ? 'addEventListener' : 'removeEventListener'
  document[method]('pointerdown', outside, true)
  document[method]('scroll', scroll, true)
  window[method]('resize', close)
})
watch(() => props.disabled, value => { if (value) close() })
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outside, true)
  document.removeEventListener('scroll', scroll, true)
  window.removeEventListener('resize', close)
})
</script>

<template>
  <button ref="trigger" v-bind="attrs" type="button" class="input theme-select" :class="{ expanded: opened }"
    :disabled="disabled" role="combobox" aria-haspopup="listbox" :aria-expanded="opened"
    :aria-controls="opened ? id : undefined" :aria-activedescendant="opened && active >= 0 ? `${id}-${active}` : undefined"
    @click="opened ? close() : open()" @keydown="keydown" @blur="close">
    <span>{{ label }}</span><svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
  </button>
  <Teleport to="body">
    <Transition name="select-menu">
      <div v-if="opened" :id="id" ref="menu" class="theme-select-menu scroll" :style="position" role="listbox" :aria-label="String(attrs['aria-label'] ?? '选项')" @pointerdown.prevent>
        <div v-for="(option, i) in options" :id="`${id}-${i}`" :key="i" :data-index="i" role="option"
          :aria-selected="option.value === modelValue" :aria-disabled="option.disabled || undefined"
          :class="['theme-select-option', { active: i === active, selected: option.value === modelValue, disabled: option.disabled }]"
          @pointermove="!option.disabled && (active = i)" @click="select(i)">
          <span>{{ option.label }}</span><span v-if="option.value === modelValue" aria-hidden="true">✓</span>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.theme-select.input { display: inline-flex; align-items: center; justify-content: space-between; gap: 12px; text-align: left; cursor: pointer; color: var(--text); font: inherit; font-size: 12.5px; }
.theme-select > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.theme-select svg { flex-shrink: 0; fill: none; stroke: var(--muted); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; transition: transform .16s; }
.theme-select.expanded svg { transform: rotate(180deg); }
.theme-select:hover:not(:disabled), .theme-select.expanded { border-color: var(--pink-line); }
.theme-select:focus:not(:focus-visible):not(.expanded) { box-shadow: none; }
.theme-select-menu { position: fixed; z-index: 200; padding: 5px; overflow-y: auto; background: var(--bg); border: 1px solid var(--pink-line); border-radius: 12px; box-shadow: 0 8px 28px #24202c20; }
.theme-select-option { min-height: 34px; padding: 7px 10px; display: flex; align-items: center; justify-content: space-between; gap: 14px; border-radius: 7px; font-size: 12.5px; color: var(--text2); cursor: pointer; }
.theme-select-option.active { background: var(--pink-soft); }
.theme-select-option.selected { color: var(--pink-deep); font-weight: 600; }
.theme-select-option.disabled { opacity: .4; cursor: default; }
.select-menu-enter-active, .select-menu-leave-active { transition: opacity .14s, transform .14s; }
.select-menu-enter-from, .select-menu-leave-to { opacity: 0; transform: translateY(-3px); }
.select-menu-leave-active { pointer-events: none; }
@media (prefers-reduced-motion: reduce) { .select-menu-enter-active, .select-menu-leave-active { transition: none; } }
</style>
