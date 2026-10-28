<script setup lang="ts">
import { nextTick, ref, useId } from 'vue'
import Icon from '../../../shared/ui/Icon.vue'

defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ select: [kind: 'file' | 'directory'] }>()
const id = useId()
const trigger = ref<HTMLButtonElement>()
const menu = ref<HTMLElement>()
const opened = ref(false)
const position = ref({ left: '0px', top: '0px' })

function toggle() {
  const bounds = trigger.value?.getBoundingClientRect()
  if (!bounds) {
    return
  }
  position.value = {
    left: `${Math.max(8, Math.min(bounds.left, innerWidth - 220))}px`,
    top: `${Math.max(48, Math.min(bounds.bottom + 6, innerHeight - 104))}px`,
  }
  menu.value?.togglePopover()
}

async function onToggle(event: ToggleEvent) {
  opened.value = event.newState === 'open'
  if (opened.value) {
    await nextTick()
    menu.value?.querySelector('button')?.focus()
  }
}

function select(kind: 'file' | 'directory') {
  menu.value?.hidePopover()
  trigger.value?.focus()
  emit('select', kind)
}
</script>

<template>
  <button
    ref="trigger"
    class="btn primary small"
    :disabled="disabled"
    :aria-expanded="opened"
    :aria-controls="id"
    @click="toggle"
    @keydown.down.prevent="toggle"
  >
    <Icon
      name="upload"
      :size="14"
    />导入 Skill
    <Icon
      name="chevron"
      :size="12"
      style="transform: rotate(90deg)"
    />
  </button>
  <div
    :id="id"
    ref="menu"
    popover="auto"
    class="skill-import-menu"
    :style="position"
    role="group"
    aria-label="选择导入类型"
    @toggle="onToggle"
  >
    <button @click="select('file')">
      <Icon
        name="book"
        :size="15"
      />Markdown 文件
    </button>
    <button @click="select('directory')">
      <Icon
        name="folder"
        :size="15"
      />Skill 文件夹
    </button>
  </div>
</template>

<style scoped>
.skill-import-menu {
  position: fixed;
  inset: auto;
  width: 212px;
  margin: 0;
  padding: 6px;
  border: 1px solid var(--line2);
  border-radius: 12px;
  background: var(--bg);
  color: var(--text);
  box-shadow: var(--shadow-pop);
}

.skill-import-menu button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px;
  border-radius: 8px;
  text-align: left;
  font-size: 12px;
}

.skill-import-menu button:hover,
.skill-import-menu button:focus-visible {
  background: var(--hover);
}
</style>
