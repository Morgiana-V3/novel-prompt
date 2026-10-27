<script setup lang="ts">
import type { PageMessage } from '@shared/workspace/model'
import { changeLabel } from '@shared/prompts/inpaint-plan'
import { diffPrompt } from '../../prompts/prompt-diff'
import DiffChips from '../../prompts/components/DiffChips.vue'
defineProps<{
  message: PageMessage
  selectedProposalId: string | null
  busy: boolean
  isStale: boolean
  adoptedVersionId: string
  executionLabel: string
  statusLabel: string
}>()
const emit = defineEmits<{ decide: [decision: 'accept' | 'reject' | 'undo'] }>()
</script>

<template>
  <details
    v-if="message.proposal"
    :id="`proposal-${message.id}`"
    class="pw-proposal"
    :open="
      selectedProposalId === message.id ||
      (message.proposal.status === 'pending' && !message.proposal.superseded)
    "
  >
    <summary>
      <b>{{ message.proposal.title }}</b
      ><span class="pill">{{ statusLabel }}</span>
    </summary>
    <div class="pw-proposal-body">
      <p class="pw-plan-kind">建议执行：{{ executionLabel }}</p>
      <p
        v-if="message.proposal!.warning"
        class="pw-warning"
      >
        {{ message.proposal!.warning }}
      </p>
      <div
        v-for="(changeItem, index) in message.proposal!.changes"
        :key="index"
        class="pw-change"
      >
        <label>{{ changeLabel(changeItem) }}</label
        ><DiffChips :diff="diffPrompt(changeItem.before, changeItem.after)" />
        <p v-if="changeItem.reason">{{ changeItem.reason }}</p>
        <details v-if="changeItem.before || changeItem.after">
          <summary>完整修改前后</summary>
          <pre>{{ changeItem.before || '（空）' }}</pre>
          <pre>{{ changeItem.after || '（空）' }}</pre>
        </details>
      </div>
      <p
        v-if="!message.proposal!.changes.length"
        class="muted small"
      >
        保持当前提示词，使用上述执行方式继续尝试。
      </p>
      <p
        v-if="message.proposal!.status === 'pending' && isStale"
        class="muted small"
      >
        上下文或执行设置已改变，请基于当前状态重新提出方案。
      </p>
      <div
        v-if="message.proposal!.status === 'pending'"
        class="row"
      >
        <button
          class="btn small primary"
          :disabled="busy || isStale"
          @click="emit('decide', 'accept')"
        >
          采纳方案</button
        ><button
          class="btn ghost small"
          :disabled="busy"
          @click="emit('decide', 'reject')"
        >
          不采用
        </button>
      </div>
      <button
        v-if="message.proposal!.status === 'accepted'"
        class="btn ghost small"
        :disabled="busy || message.versionId !== adoptedVersionId"
        @click="emit('decide', 'undo')"
      >
        撤销采纳
      </button>
    </div>
  </details>
</template>

<style scoped>
.pw-proposal > summary {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 12px;
}

.pw-proposal > summary .pill {
  margin-left: auto;
  flex-shrink: 0;
}

.pw-proposal-body {
  margin-top: 10px;
}

.pw-proposal {
  border: 1px solid var(--pink-line);
  border-radius: 12px;
  padding: 13px;
  margin-top: 12px;
  background: var(--bg);
}

.pw-proposal > .row > b {
  font-size: 12px;
}

.pw-proposal .pill {
  font-size: 9px;
}

.pw-warning {
  color: var(--alias);
  font-size: 11px;
  white-space: pre-wrap;
}

.pw-change {
  border-top: 1px solid var(--line);
  padding: 12px 0;
}

.pw-change label {
  font-weight: 600;
  font-size: 11px;
}

.pw-change p {
  font-size: 11px;
  color: var(--text2);
  margin: 8px 0 0;
}

.pw-change details {
  font-size: 10px;
  color: var(--muted);
  margin-top: 8px;
}

.pw-change summary {
  cursor: pointer;
}

.pw-change pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 180px;
  overflow: auto;
  background: var(--panel);
  padding: 8px;
  border-radius: 8px;
  font: 10px/1.7 var(--mono);
  user-select: text;
}

.pw-change-board > h3 {
  font-size: 14px;
}

.pw-change-board > .pw-proposal {
  margin: 15px 0;
}

.pw-plan-kind {
  font-size: 12px;
  color: var(--pink-deep);
}

.pw-change-board pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 11px;
}

.pw-change > label {
  display: block;
  margin-bottom: 8px;
}

.pw-change :deep(.diff-row) {
  padding: 0;
  margin: 0 0 10px;
}

.pw-change :deep(.diff-prose) {
  margin: 10px 0;
}

.pw-change-board {
  flex: 1;
  min-height: 0;
  padding: 8px 0;
}
</style>
