<script setup lang="ts">
import type { Point } from '../model'
defineProps<{ position: Point; annotated: boolean }>()
const emit = defineEmits<{ comment: []; mask: []; deleteAnnotation: []; remove: [] }>()
</script>

<template>
  <div
    class="ip-context-menu"
    :style="{ left: position.x + 'px', top: position.y + 'px' }"
    role="menu"
    aria-label="选区操作"
  >
    <button
      role="menuitem"
      @click="emit('comment')"
    >
      {{ annotated ? '修改批注' : '新增批注' }}
    </button>
    <button
      role="menuitem"
      @click="emit('mask')"
    >
      编辑此区域遮罩
    </button>
    <button
      v-if="annotated"
      role="menuitem"
      @click="emit('deleteAnnotation')"
    >
      删除批注（保留选区）
    </button>
    <button
      role="menuitem"
      @click="emit('remove')"
    >
      删除此区域
    </button>
  </div>
</template>

<style scoped>
.ip-context-menu {
  position: absolute;
  z-index: 6;
  width: 220px;
  padding: 6px;
  border: 1px solid var(--line2);
  border-radius: 12px;
  background: var(--bg);
  box-shadow: 0 10px 30px #0002;
}

.ip-context-menu button {
  display: block;
  width: 100%;
  min-height: 34px;
  text-align: left;
  padding: 7px 10px;
  border-radius: 7px;
  font-size: 12px;
}

.ip-context-menu button:hover {
  background: var(--pink-soft);
}

.ip-context-menu.fade-leave-active {
  pointer-events: none;
}
</style>
