<script setup lang="ts">
import type { AppTask } from '@shared/tasks/model'
defineProps<{ task: AppTask }>()
const elapsed = (at: number, start: number) => `${Math.max(0, Math.floor((at - start) / 1000))}s`
</script>

<template>
  <details
    v-if="task.steps?.length"
    class="task-steps"
  >
    <summary>执行记录 · {{ task.steps.length }}</summary>
    <p
      v-if="task.stepsOmitted"
      class="muted small"
    >
      较早的 {{ task.stepsOmitted }} 条已省略
    </p>
    <ol class="scroll">
      <li
        v-for="(step, index) in task.steps"
        :key="index"
      >
        <time>{{ elapsed(step.at, task.startedAt) }}</time>
        <span
          >{{ step.message }}<small v-if="step.count > 1"> ×{{ step.count }}</small></span
        >
      </li>
    </ol>
  </details>
</template>

<style scoped>
.task-steps {
  margin: 8px 0;
  font-size: 12px;
}

.task-steps summary {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  color: var(--text2);
  list-style: none;
}

.task-steps summary::-webkit-details-marker {
  display: none;
}

/* 与全站一致的细箭头，展开时转向下 */
.task-steps summary::before {
  content: '';
  width: 5px;
  height: 5px;
  margin-left: 1px;
  border-right: 1.5px solid currentcolor;
  border-bottom: 1.5px solid currentcolor;
  transform: rotate(-45deg);
  transition: transform var(--dur-base) var(--ease-out);
}

.task-steps[open] > summary::before {
  transform: rotate(45deg);
}

.task-steps ol {
  max-height: 240px;
  list-style: none;
  padding: 0;
  margin: 10px 0;
}

.task-steps li {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 8px;
  padding: 5px 0;
  overflow-wrap: anywhere;
}

.task-steps time,
.task-steps small {
  color: var(--text2);
  font-size: 10px;
}
</style>
