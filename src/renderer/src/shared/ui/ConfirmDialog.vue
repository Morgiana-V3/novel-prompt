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
  /** 付费确认：显示紧凑居中的样式，费用单独突出；amount 缺省表示暂无法估算 */
  cost?: { amount?: number; unit: string }
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
      :class="['confirm-dialog', { payment: cost }]"
      role="alertdialog"
      :aria-labelledby="`${id}-title`"
      :aria-describedby="`${id}-message`"
      @cancel.prevent="emit('cancel')"
      @keydown.stop
    >
      <div class="confirm-head">
        <span
          v-if="!cost"
          class="group-badge pink"
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
      <div
        v-if="cost"
        class="confirm-cost"
      >
        <template v-if="cost.amount !== undefined">
          <span class="confirm-cost-label">预计消耗</span>
          <span class="confirm-cost-value"
            ><b>{{ cost.amount }}</b> {{ cost.unit }}</span
          >
        </template>
        <span
          v-else
          class="confirm-cost-unknown"
          >可能产生费用，金额暂无法估算</span
        >
      </div>
      <div class="confirm-actions">
        <button
          :class="['btn', cost ? '' : 'ghost small']"
          autofocus
          @click="emit('cancel')"
        >
          {{ cancelLabel ?? '取消' }}
        </button>
        <button
          v-if="alternateLabel"
          :class="['btn', cost ? '' : 'small']"
          @click="emit('alternate')"
        >
          {{ alternateLabel }}
        </button>
        <button
          :class="['btn', cost ? '' : 'small', danger ? 'danger' : 'primary']"
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

/* ---------- 付费确认：紧凑居中，费用单独突出 ---------- */
.confirm-dialog.payment {
  width: min(320px, calc(100vw - 40px));
  padding: 22px 22px 20px;
  text-align: center;
}

.payment .confirm-head {
  justify-content: center;
}

.payment .confirm-head h3 {
  font-size: 16px;
}

.payment .confirm-message {
  margin: 6px 0 16px;
  line-height: 1.6;
}

.confirm-cost {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  margin-bottom: 20px;
  padding: 12px;
  border-radius: 12px;
  background: var(--pink-soft);
  color: var(--pink-deep);
}

.confirm-cost-label {
  font-size: 11.5px;
  color: var(--text2);
}

.confirm-cost-value {
  font-size: 13px;
  font-weight: 600;
}

.confirm-cost-value b {
  font-size: 26px;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.confirm-cost-unknown {
  font-size: 13px;
  font-weight: 600;
}

.payment .confirm-actions {
  display: grid;
  grid-auto-columns: 1fr;
  grid-auto-flow: column;
}

.payment .confirm-actions .btn {
  justify-content: center;
}
</style>
