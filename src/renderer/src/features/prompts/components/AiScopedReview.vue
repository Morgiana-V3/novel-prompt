<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ReviewGroup } from '../prompt-review'
import PromptReview from './PromptReview.vue'
import type { AiChange } from '@shared/prompts/types'
import AiExplanations from './AiExplanations.vue'
import { reviewExplanations } from '../review-explanations'
const props = defineProps<{ groups: ReviewGroup[]; changes?: AiChange[] }>()
const explanations = computed(() => reviewExplanations(props.groups, props.changes ?? []))
const active = ref('')
function navigateScope(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    return
  }
  const buttons = [
    ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
  ]
  let index = buttons.indexOf(event.target as HTMLButtonElement)
  if (event.key === 'Home') {
    index = 0
  } else if (event.key === 'End') {
    index = buttons.length - 1
  } else {
    index = (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
  }
  event.preventDefault()
  buttons[index]?.click()
  buttons[index]?.focus()
}
const scopes = computed(() =>
  props.groups.flatMap((group) =>
    group.fields.map((field) => ({
      key: `${group.key}/${field.key}`,
      group,
      field,
      label:
        group.key === 'global' || group.key === 'characters'
          ? field.label
          : `${group.label}${field.label === '提示词' ? '' : ` · ${field.label}`}`,
    })),
  ),
)
const selected = computed(() => scopes.value.find((s) => s.key === active.value) ?? scopes.value[0])
const visible = computed(() =>
  selected.value ? [{ ...selected.value.group, fields: [selected.value.field] }] : [],
)
watch(
  () => props.groups,
  () => {
    active.value = scopes.value[0]?.key || ''
  },
)
</script>
<template>
  <div class="scoped-review">
    <div
      class="review-scopes"
      role="tablist"
      aria-label="修改范围"
      @keydown="navigateScope"
    >
      <button
        v-for="scope in scopes"
        :key="scope.key"
        role="tab"
        :aria-selected="selected?.key === scope.key"
        :tabindex="selected?.key === scope.key ? 0 : -1"
        :class="{ active: selected?.key === scope.key }"
        @click="active = scope.key"
      >
        {{ scope.label }}
      </button>
    </div>
    <PromptReview
      :groups="visible"
      full-context
      flat
    >
      <template #actions="slotProps"
        ><slot
          name="actions"
          v-bind="slotProps"
      /></template>
      <template #adoption="slotProps"
        ><slot
          name="adoption"
          v-bind="slotProps"
      /></template>
      <template #group-adoption="slotProps"
        ><slot
          name="group-adoption"
          v-bind="slotProps"
      /></template>
    </PromptReview>
    <AiExplanations :changes="explanations.byField.get(selected?.key ?? '') ?? []" />
    <div
      v-if="explanations.remaining.length"
      class="other-explanations"
    >
      <span class="muted small">其他建议与说明</span>
      <AiExplanations :changes="explanations.remaining" />
    </div>
  </div>
</template>
<style scoped>
.review-scopes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 12px 0;
}

.review-scopes button {
  background: var(--bg);
  border: 1px solid var(--line2);
  border-radius: 20px;
  padding: 6px 10px;
  color: var(--text2);
  font-size: 12px;
}

.review-scopes button.active {
  border-color: var(--pink);
  color: var(--pink-deep);
  background: var(--pink-soft);
}
</style>
