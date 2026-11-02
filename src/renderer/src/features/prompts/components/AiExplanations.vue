<script setup lang="ts">
import type { AiChange } from '@shared/prompts/types'
import BasisPill from './BasisPill.vue'
defineProps<{ changes: AiChange[] }>()
</script>
<template>
  <div
    v-if="changes.length"
    class="inline-explanations"
  >
    <div
      v-for="(change, index) in changes"
      :key="index"
      class="inline-explanation"
    >
      <BasisPill :basis="change.basis" />
      <div>
        {{ change.text }}<small v-if="change.evidence">{{ change.evidence }}</small>
      </div>
    </div>
  </div>
</template>
<style scoped>
.inline-explanations {
  display: grid;
  gap: 10px;
  padding: 12px 14px;
}

.inline-explanation {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.inline-explanation small {
  display: block;
  font-size: 11px;
  color: var(--text2);
}
</style>
