<script setup lang="ts">
import type { AiChange } from '@shared/prompts/types'
import BasisPill from './BasisPill.vue'
defineProps<{ changes: AiChange[]; plain?: boolean }>()
</script>
<template>
  <div
    v-if="changes.length"
    class="inline-explanations"
    :class="{ plain }"
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

.inline-explanations.plain {
  padding: 0;
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
