<script setup lang="ts">
import { computed } from 'vue'
import { diffPrompt } from '../prompt-diff'
import type { ReviewGroup } from '../prompt-review'
import DiffChips from './DiffChips.vue'

const props = withDefaults(
  defineProps<{ groups: ReviewGroup[]; beforeLabel?: string; afterLabel?: string }>(),
  { beforeLabel: '修改前', afterLabel: '修改后' },
)
const statusLabels = { changed: '已修改', added: '新增角色', removed: '移除角色' }
const prepared = computed(() =>
  props.groups.map((group) => ({
    ...group,
    fields: group.fields.map((field) => ({
      ...field,
      diff: field.kind === 'prompt' ? diffPrompt(field.before, field.after) : null,
    })),
  })),
)
</script>

<template>
  <div class="prompt-review">
    <details
      v-for="group in prepared"
      :key="group.key"
      class="review-group"
      :data-group="group.key"
      open
    >
      <summary>
        <strong>{{ group.label }}</strong
        ><span
          class="review-status"
          :class="group.status"
          >{{ statusLabels[group.status] }}</span
        ><span class="review-fields">{{
          group.fields.map((field) => field.label).join(' · ')
        }}</span>
      </summary>
      <div class="review-body">
        <div
          v-for="field in group.fields"
          :key="field.key"
          class="review-field"
          :data-field="field.kind"
        >
          <div class="review-field-head">
            <slot
              name="control"
              :field="field"
              ><span>{{ field.label }}</span></slot
            >
            <slot
              name="actions"
              :field="field"
            />
          </div>
          <DiffChips
            v-if="field.diff"
            :diff="field.diff"
            :before-label="beforeLabel"
            :after-label="afterLabel"
            :before-text="field.before"
            :after-text="field.after"
          />
          <div
            v-else
            class="review-position"
          >
            <span class="review-old">{{ field.before }}</span
            ><span aria-label="变更为">→</span><span class="review-new">{{ field.after }}</span>
          </div>
          <p
            v-if="field.reason"
            class="review-reason"
          >
            {{ field.reason }}
          </p>
        </div>
        <p
          v-if="!group.fields.length"
          class="review-reason"
        >
          未填写提示词
        </p>
      </div>
    </details>
  </div>
</template>

<style scoped>
.prompt-review {
  min-width: 0;
}

.review-group {
  margin: 22px 0;
}

.review-group > summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
  cursor: pointer;
  list-style: none;
}

.review-group > summary::before {
  content: '›';
  color: var(--text2);
  transform: rotate(0);
  transition: transform var(--dur-fast);
}

.review-group[open] > summary::before {
  transform: rotate(90deg);
}

.review-group strong {
  font-size: 13px;
  font-weight: 650;
}

.review-status {
  border-radius: 5px;
  padding: 1px 6px;
  background: var(--pink-soft);
  color: var(--pink-deep);
  font-size: 10px;
}

.review-status.added {
  background: var(--ok-soft);
  color: var(--ok);
}

.review-status.removed {
  background: var(--bad-soft);
  color: var(--bad);
}

.review-fields {
  margin-left: auto;
  color: var(--text2);
  font-size: 11px;
}

.review-body {
  border: 1px solid var(--line);
  border-radius: 11px;
  background: var(--bg);
  overflow: hidden;
}

.review-field + .review-field {
  border-top: 1px solid var(--line);
}

.review-field-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
  font-weight: 500;
}

.review-position {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  padding: 12px 16px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.review-old,
.review-new {
  padding: 2px 6px;
  border-radius: 4px;
}

.review-old {
  background: var(--bad-soft);
  color: var(--bad);
}

.review-new {
  background: var(--ok-soft);
  color: var(--ok);
}

.review-reason {
  margin: 0;
  padding: 8px 14px 12px;
  font-size: 11px;
  color: var(--text2);
  white-space: pre-wrap;
}
</style>
