<script setup lang="ts">
import Icon from '../../../shared/ui/Icon.vue'

/**
 * 局部采纳统一用这一张卡：整张可点，左上角小字说明是什么改动，
 * 右上角只在已采纳时出现一个勾，下方是改动内容。
 */
defineProps<{
  /** 左上角小字：替换 / 新增 / 删除 / 角色 1 等 */
  label: string
  tone?: 'add' | 'remove' | 'replace' | 'neutral'
  selected: boolean
  /** 读屏用的完整描述 */
  description: string
}>()
const emit = defineEmits<{ toggle: [] }>()
function onKey(event: KeyboardEvent) {
  if (event.target !== event.currentTarget) {
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    emit('toggle')
  }
}
</script>
<template>
  <div
    class="adopt-choice"
    :class="[tone ?? 'neutral', { selected }]"
    role="button"
    tabindex="0"
    :aria-pressed="selected"
    :aria-label="`${selected ? '取消采纳' : '采纳'}：${description}`"
    :title="selected ? '已采纳，点击撤回' : '点击采纳到编辑区'"
    @click="emit('toggle')"
    @keydown="onKey"
  >
    <div class="adopt-choice-head">
      <span class="adopt-choice-label">{{ label }}</span>
      <slot name="meta" />
      <Transition name="adopt-check">
        <span
          v-if="selected"
          class="adopt-choice-check"
          aria-hidden="true"
          ><Icon
            name="check"
            :size="16"
        /></span>
      </Transition>
    </div>
    <div class="adopt-choice-body"><slot /></div>
    <slot name="after" />
  </div>
</template>
<style scoped>
.adopt-choice {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 10px 14px 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg);
  cursor: pointer;
  text-align: left;
  animation: fade-up var(--dur-slow) var(--ease-out) backwards;

  /* 列表里由父级设置 --i，依次出现 */
  animation-delay: calc(var(--i, 0) * 30ms);
  transition:
    border-color var(--dur-base) var(--ease-out),
    background-color var(--dur-base) var(--ease-out),
    box-shadow var(--dur-base) var(--ease-out),
    transform var(--dur-slow) var(--bounce);
}

.adopt-choice:hover {
  border-color: var(--line2);
  background: var(--panel);
}

.adopt-choice:active {
  transform: scale(0.995);
}

.adopt-choice:focus-visible {
  box-shadow: var(--focus-ring);
}

.adopt-choice-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 16px;
}

/* 与对比卡片「＋ 新增内容」同样的普通小字，不再按操作上色 */
.adopt-choice-label {
  font-size: 12px;
  color: var(--text2);
}

/* 已采纳：左侧一条绿色 + 右上角的勾，卡片本身保持白底 */
.adopt-choice.selected {
  box-shadow: inset 3px 0 0 var(--ok);
}

.adopt-choice.selected:focus-visible {
  box-shadow:
    inset 3px 0 0 var(--ok),
    var(--focus-ring);
}

.adopt-choice-check {
  display: inline-flex;
  margin-left: auto;
  color: var(--ok);
}

.adopt-choice-body {
  min-width: 0;
  font-size: 13px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.adopt-check-enter-active {
  transition:
    opacity var(--dur-base) var(--ease-out),
    transform var(--dur-slow) var(--bounce);
}

.adopt-check-leave-active {
  transition: opacity var(--dur-fast) var(--ease-in);
}

.adopt-check-enter-from {
  opacity: 0;
  transform: scale(0.4);
}

.adopt-check-leave-to {
  opacity: 0;
}
</style>
