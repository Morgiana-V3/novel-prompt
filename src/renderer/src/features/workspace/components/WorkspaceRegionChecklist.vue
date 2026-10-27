<script setup lang="ts">
import type { PageRegion } from '@shared/workspace/model'

defineProps<{ regions: PageRegion[]; disabled: boolean }>()
const selected = defineModel<string[]>({ required: true })
const emit = defineEmits<{ locate: [id: string]; change: [] }>()
</script>

<template>
  <details
    class="pw-region-checklist"
    open
  >
    <summary>
      本轮修改清单 <span>{{ selected.length }} / {{ regions.length }}</span>
    </summary>
    <div class="pw-region-list scroll">
      <div
        v-for="region in regions"
        :key="region.id"
        class="pw-region-item"
      >
        <label>
          <input
            v-model="selected"
            type="checkbox"
            :value="region.id"
            :disabled="disabled"
            :aria-label="'本轮修改区域 ' + region.label"
            @change="emit('change')"
          />
          <span
            ><b>区域 {{ region.label }}</b
            ><span class="pw-region-instruction">{{
              region.instruction || '未填写区域要求，可在下方补充'
            }}</span></span
          >
        </label>
        <button
          class="btn ghost small"
          :disabled="disabled"
          :aria-label="'定位区域 ' + region.label"
          @click="emit('locate', region.id)"
        >
          定位
        </button>
      </div>
    </div>
    <p class="muted small">
      {{
        selected.length
          ? '一起讨论勾选区域；共同要求在下方补充。'
          : '未勾选区域，本轮仅讨论整体要求。'
      }}
    </p>
  </details>
</template>

<style scoped>
.pw-region-checklist {
  padding: 10px;
  margin-bottom: 8px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
}

.pw-region-checklist summary {
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}

.pw-region-checklist summary span {
  margin-left: 8px;
  color: var(--muted);
}

.pw-region-list {
  max-height: 165px;
  margin-top: 8px;
}

.pw-region-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 0;
}

.pw-region-item + .pw-region-item {
  border-top: 1px solid var(--line);
}

.pw-region-item label {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
  font-size: 11px;
}

.pw-region-instruction {
  display: block;
  margin-top: 3px;
  color: var(--text2);
  overflow-wrap: anywhere;
}

.pw-region-checklist p {
  margin: 6px 0 0;
}
</style>
