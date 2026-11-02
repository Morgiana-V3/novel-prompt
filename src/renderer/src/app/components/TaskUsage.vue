<script setup lang="ts">
import type { TokenUsage } from '@shared/statistics/model'
defineProps<{ usage: TokenUsage }>()
const n = (value: number) => value.toLocaleString('zh-CN')
</script>
<template>
  <details class="task-usage-details">
    <summary>AI 用量</summary>
    <div class="task-usage">
      <span v-if="usage.reported || usage.total"
        ><b>{{ n(usage.total) }}</b> Token · 输入 {{ n(usage.input) }} / 输出
        {{ n(usage.output) }}</span
      >
      <span v-if="usage.cacheReported">缓存命中 {{ n(usage.cached) }}</span>
      <span v-if="usage.reasoning">思考 {{ n(usage.reasoning) }}（含在输出中）</span>
      <span v-if="usage.requests > usage.reported"
        >{{ usage.requests - usage.reported }} 次请求用量未完整返回</span
      >
      <span>{{ usage.requests }} 次接口请求</span>
    </div>
  </details>
</template>
<style scoped>
.task-usage-details {
  margin: 8px 0;
  font-size: 12px;
}

.task-usage-details summary {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  color: var(--text2);
  list-style: none;
}

.task-usage-details summary::-webkit-details-marker {
  display: none;
}

/* 与全站一致的细箭头，展开时转向下 */
.task-usage-details summary::before {
  content: '';
  width: 5px;
  height: 5px;
  margin-left: 1px;
  border-right: 1.5px solid currentcolor;
  border-bottom: 1.5px solid currentcolor;
  transform: rotate(-45deg);
  transition: transform var(--dur-base) var(--ease-out);
}

.task-usage-details[open] > summary::before {
  transform: rotate(45deg);
}

.task-usage {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  color: var(--text2);
  font-size: 10px;
  padding: 6px 0;
  font-variant-numeric: tabular-nums;
}

.task-usage b {
  color: var(--text);
}
</style>
