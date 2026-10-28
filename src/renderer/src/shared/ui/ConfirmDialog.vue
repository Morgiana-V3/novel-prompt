<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId } from 'vue'
import Icon from './Icon.vue'

defineProps<{
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  alternateLabel?: string
  danger?: boolean
}>()
const emit = defineEmits<{ confirm: []; cancel: []; alternate: [] }>()
const dialog = ref<HTMLDialogElement>()
const id = useId()
onMounted(() => dialog.value?.showModal())
onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="confirm-dialog"
      role="alertdialog"
      :aria-labelledby="`${id}-title`"
      :aria-describedby="`${id}-message`"
      @cancel.prevent="emit('cancel')"
      @keydown.stop
    >
      <div class="confirm-head">
        <span class="group-badge pink"
          ><Icon
            name="warn"
            :size="16"
        /></span>
        <h3 :id="`${id}-title`">{{ title }}</h3>
      </div>
      <p
        :id="`${id}-message`"
        class="confirm-message"
      >
        {{ message }}
      </p>
      <div class="confirm-actions">
        <button
          class="btn ghost small"
          autofocus
          @click="emit('cancel')"
        >
          {{ cancelLabel ?? '取消' }}
        </button>
        <button
          v-if="alternateLabel"
          class="btn small"
          @click="emit('alternate')"
        >
          {{ alternateLabel }}
        </button>
        <button
          :class="['btn small', danger ? 'danger' : 'primary']"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </button>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.confirm-dialog {
  width: min(440px, calc(100vw - 40px));
  max-height: calc(100vh - 80px);
  margin: auto;
  padding: 22px;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--line2);
  border-radius: 18px;
  box-shadow: var(--shadow-modal);
}

.confirm-dialog::backdrop {
  background: var(--scrim);
  backdrop-filter: blur(3px);
}

.confirm-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.confirm-head h3 {
  margin: 0;
  font-size: 15px;
}

.confirm-message {
  margin: 16px 0 22px;
  line-height: 1.8;
  font-size: 13px;
  color: var(--text2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.confirm-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
</style>
