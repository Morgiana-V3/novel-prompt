<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId } from 'vue'
import Icon from '../../../shared/ui/Icon.vue'

const props = defineProps<{ modelValue: string; categories: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const id = useId()
const input = ref<HTMLInputElement>()
const menu = ref<HTMLElement>()
const opened = ref(false)
const query = ref('')
const active = ref(-1)
const choices = computed(() => {
  const text = query.value.trim()
  const matches = props.categories
    .filter((name) => name.toLowerCase().includes(text.toLowerCase()))
    .map((name) => ({ value: name, label: name }))
  if (text && !props.categories.includes(text)) {
    matches.push({ value: text, label: `新建「${text}」` })
  }
  return text ? matches : [{ value: '', label: '不分类' }, ...matches]
})
function close() {
  opened.value = false
  menu.value?.hidePopover()
  window.removeEventListener('resize', close)
}
async function open(all = false) {
  if (all) {
    query.value = ''
  }
  opened.value = true
  active.value = -1
  await nextTick()
  if (!opened.value || !input.value || !menu.value) {
    return
  }
  const bounds = input.value.getBoundingClientRect()
  const below = innerHeight - bounds.bottom - 8
  const above = bounds.top - 48
  const height = Math.min(180, choices.value.length * 32 + 8)
  const upwards = below < height && above > below
  const available = Math.max(40, upwards ? above : below)
  Object.assign(menu.value.style, {
    left: `${Math.max(8, Math.min(bounds.left, innerWidth - Math.max(bounds.width, 160) - 8))}px`,
    top: `${upwards ? bounds.top - Math.min(height, available) - 4 : bounds.bottom + 4}px`,
    width: `${Math.max(bounds.width, 160)}px`,
    maxHeight: `${Math.min(180, available)}px`,
  })
  menu.value.showPopover()
  window.addEventListener('resize', close)
}
async function update(event: Event) {
  const value = (event.target as HTMLInputElement).value
  emit('update:modelValue', value)
  query.value = value
  await open()
}
async function toggle() {
  input.value?.focus({ preventScroll: true })
  if (opened.value) {
    close()
  } else {
    await open(true)
  }
}
function choose(value: string) {
  emit('update:modelValue', value)
  close()
  input.value?.focus({ preventScroll: true })
}
async function key(event: KeyboardEvent) {
  if (event.isComposing) {
    return
  }
  if (event.key === 'Tab') {
    close()
  }
  if (event.key === 'Escape' && opened.value) {
    event.preventDefault()
    event.stopPropagation()
    close()
  } else if (event.key === 'Enter' && opened.value) {
    event.preventDefault()
    event.stopPropagation()
    choose(choices.value[active.value]?.value ?? props.modelValue.trim())
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    event.stopPropagation()
    if (!opened.value) {
      await open(true)
    }
    if (active.value < 0) {
      active.value = event.key === 'ArrowDown' ? 0 : choices.value.length - 1
    } else {
      active.value =
        (active.value + (event.key === 'ArrowDown' ? 1 : -1) + choices.value.length) %
        choices.value.length
    }
    await nextTick()
    menu.value?.children[active.value]?.scrollIntoView({ block: 'nearest' })
  }
}
onBeforeUnmount(close)
</script>

<template>
  <div class="snippet-category-field">
    <input
      ref="input"
      :value="modelValue"
      class="input"
      role="combobox"
      aria-label="片段分类"
      aria-autocomplete="list"
      :aria-expanded="opened"
      :aria-controls="id"
      :aria-activedescendant="opened && active >= 0 ? `${id}-${active}` : undefined"
      maxlength="80"
      placeholder="选择或新建分类"
      autocomplete="off"
      @click="open(true)"
      @input="update"
      @keydown="key"
      @blur="close"
    />
    <button
      type="button"
      class="category-toggle"
      aria-label="选择已有分类"
      tabindex="-1"
      @mousedown.prevent
      @click="toggle"
    >
      <Icon
        name="chevron"
        :size="12"
      />
    </button>
    <div
      :id="id"
      ref="menu"
      popover="manual"
      class="snippet-category-menu"
      role="listbox"
      aria-label="片段分类选项"
      @mousedown.prevent
    >
      <button
        v-for="(choice, index) in choices"
        :id="`${id}-${index}`"
        :key="choice.value"
        type="button"
        role="option"
        :aria-selected="choice.value === modelValue"
        :class="{ active: index === active }"
        tabindex="-1"
        @pointermove="active = index"
        @click="choose(choice.value)"
      >
        {{ choice.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.snippet-category-field {
  position: relative;
  flex: 1;
  min-width: 0;
}

.snippet-category-field .input {
  width: 100%;
  height: 30px;
  padding: 0 26px 0 10px;
  border-radius: 8px;
  font-size: 12px;
}

.category-toggle {
  position: absolute;
  inset: 0 0 0 auto;
  width: 26px;
  display: grid;
  place-items: center;
  color: var(--muted);
  background: transparent;
}

.category-toggle .icon {
  transform: rotate(90deg);
}

.snippet-category-menu {
  position: fixed;
  inset: auto;
  margin: 0;
  padding: 4px;
  overflow: auto;
  border: 1px solid var(--line2);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
  box-shadow: var(--shadow-pop);
}

.snippet-category-menu button {
  display: block;
  width: 100%;
  min-height: 32px;
  padding: 6px 10px;
  border-radius: 6px;
  text-align: left;
  overflow-wrap: anywhere;
  font-size: 12px;
}

.snippet-category-menu button.active,
.snippet-category-menu button[aria-selected='true'] {
  background: var(--pink-soft);
  color: var(--pink-deep);
}
</style>
