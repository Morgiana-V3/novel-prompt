<script setup lang="ts">
import type { PageMessage } from '@shared/workspace/model'
import { computed } from 'vue'
import { reviewChanges } from '../../prompts/prompt-review'
import PromptReview from '../../prompts/components/PromptReview.vue'
const props = defineProps<{
  message: PageMessage
  selectedProposalId: string | null
  busy: boolean
  isStale: boolean
  adoptedVersionId: string
  executionLabel: string
  statusLabel: string
}>()
const emit = defineEmits<{ decide: [decision: 'accept' | 'reject' | 'undo'] }>()
const groups = computed(() => {
  const proposal = props.message.proposal
  return proposal ? reviewChanges(proposal.changes, proposal.before, proposal.after) : []
})
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
      <PromptReview :groups="groups" />
      <p
        v-if="!groups.length"
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

.pw-plan-kind {
  font-size: 12px;
  color: var(--pink-deep);
}
</style>
