<script setup lang="ts">
import { computed } from 'vue'
import { regionIds } from '@shared/workspace/regions'
import type { PageExecution, PageVersion, PageEditorState } from '@shared/workspace/model'
import type { AppTask } from '@shared/tasks/model'
import ThemeSelect from '../../../shared/ui/ThemeSelect.vue'
import Icon from '../../../shared/ui/Icon.vue'
const props = defineProps<{
  current: PageVersion
  selectedRegionIds: string[]
  execution: PageExecution
  nextEditor: PageEditorState
  operation: string
  remoteBusy: boolean
  busy: boolean
  editingPrompt: boolean
  hasExecutionRegion: boolean
  progress: string
  generateTask?: AppTask
}>()
const emit = defineEmits<{
  execution: [value: PageExecution]
  editConfig: []
  returnFromConfig: []
  generate: []
  preview: []
  cancel: [id: string]
}>()
const executionIds = computed(() => regionIds(props.execution))
const executionChoice = computed(() => {
  if (props.execution.kind === 'generate') {
    return 'generate'
  }
  return executionIds.value.length > 1 ? 'merged-current' : props.execution.regionId
})
const options = computed(() => [
  { value: 'generate', label: '按提示词生图' },
  ...(executionIds.value.length > 1
    ? [{ value: 'merged-current', label: `合并重绘 · ${executionIds.value.length} 个区域` }]
    : []),
  ...(props.selectedRegionIds.length > 1
    ? [
        {
          value: 'merged-selection',
          label: `使用本轮 ${props.selectedRegionIds.length} 个区域`,
          disabled: !props.current.image || props.current.image.missing,
        },
      ]
    : []),
  ...props.current.editor.regions.map((region) => ({
    value: region.id,
    label: '局部重绘 · ' + region.label,
    disabled: !props.current.image || props.current.image.missing,
  })),
])
function chooseExecution(id: string | null) {
  if (id === 'merged-current') {
    return
  }
  if (id === 'generate') {
    emit('execution', { kind: 'generate', regionId: null })
    return
  }
  const ids = id ? [id] : []
  if (id === 'merged-selection') {
    ids.splice(0, ids.length, ...props.selectedRegionIds)
  }
  emit('execution', { kind: 'inpaint', regionId: ids[0] ?? null, regionIds: ids })
}
const generationLabel = computed(() => {
  if (props.operation === 'generate') {
    return '生成中…'
  }
  if (props.execution.kind === 'generate') {
    return '生成图片'
  }
  return '执行重绘'
})
</script>

<template>
  <div
    class="pw-execution"
    aria-label="下一次生成"
    :title="'基于 ' + current.label + ' 的下一版配置'"
  >
    <ThemeSelect
      :model-value="executionChoice"
      :disabled="!!operation || remoteBusy"
      :options="options"
      aria-label="生成方式"
      @update:model-value="chooseExecution"
    />
    <button
      v-if="execution.kind === 'inpaint'"
      class="btn ghost small"
      :disabled="busy"
      @click="emit('preview')"
    >
      查看范围
    </button>
    <span class="muted small pw-execution-summary"
      >{{ nextEditor.params.width }}×{{ nextEditor.params.height }} ·
      {{ nextEditor.params.steps }} 步</span
    >
    <div class="pw-generation-actions">
      <button
        v-if="editingPrompt"
        class="btn pw-config-back"
        :disabled="!!operation || remoteBusy"
        @click="emit('returnFromConfig')"
      >
        <Icon
          name="arrow"
          class="pw-back-arrow"
          :size="16"
        />返回查看
      </button>
      <button
        v-else
        class="btn pw-config-edit"
        :disabled="busy"
        @click="emit('editConfig')"
      >
        <Icon
          name="sliders"
          :size="16"
        />编辑配置
      </button>
      <button
        class="btn accent pw-generate"
        :disabled="
          !!operation ||
          remoteBusy ||
          (!nextEditor.draft.base.trim() &&
            !nextEditor.draft.characters.some((c) => c.prompt.trim())) ||
          (execution.kind === 'inpaint' && !hasExecutionRegion)
        "
        @click="emit('generate')"
      >
        <Icon
          name="wand"
          :size="16"
        />{{ generationLabel
        }}<span
          v-if="operation !== 'generate' && nextEditor.params.count > 1"
          class="pw-generation-count"
          >{{ nextEditor.params.count }}</span
        >
      </button>
    </div>
    <div
      v-if="operation === 'generate'"
      class="row pw-run-progress"
      role="status"
    >
      <Icon
        name="paw"
        :size="13"
        class="spin-slow"
      /><span class="muted small grow">{{ progress || '正在执行…' }}</span
      ><button
        v-if="generateTask"
        class="btn small ghost"
        :disabled="generateTask.status === 'cancelling'"
        @click="emit('cancel', generateTask.id)"
      >
        {{ generateTask.status === 'cancelling' ? '完成后停止' : '停止' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.pw-execution > .row:last-child {
  margin-top: 10px;
}

.pw-execution > .row + .row {
  margin-top: 8px;
}

.pw-execution p {
  font-size: 11px;
  color: var(--text2);
  line-height: 1.7;
  margin: 8px 0;
}

.pw-execution > .row {
  gap: 10px;
  flex-wrap: nowrap;
  min-height: 34px;
}

.pw-execution b {
  font-size: 12px;
  white-space: nowrap;
}

.pw-execution-bottom > .btn {
  flex-shrink: 0;
  white-space: nowrap;
}

.pw-execution {
  border-top: 1px solid var(--line);
  flex-shrink: 0;
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 64px;
  min-height: 64px;
  padding: 10px 0;
}

.pw-execution > .btn {
  flex-shrink: 0;
  white-space: nowrap;
}

.pw-execution-summary {
  white-space: nowrap;
}

.pw-run-progress {
  position: absolute;
  inset: 0;
  background: var(--panel);
  padding: 14px 0;
  z-index: 1;
  margin: 0 !important;
}

@media (width <= 1250px) {
  .pw-execution-summary {
    display: none;
  }

  .pw-execution {
    gap: 6px;
  }

  .pw-execution > .btn {
    padding-left: 10px;
    padding-right: 10px;
  }
}

.pw-back-arrow {
  transform: rotate(180deg);
}

.pw-generation-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}

.pw-generation-count {
  font-size: 11px;
  border-left: 1px solid #ffffff60;
  padding-left: 7px;
}

.pw-execution :deep(.theme-select) {
  flex: 0 1 auto;
  max-width: 210px;
  width: auto;
  min-width: 0;
  height: 36px;
  min-height: 36px;
  border-radius: 11px;
  font-size: 12px;
  padding: 0 12px;
  box-shadow: none;
}

@media (width <= 800px) {
  .pw-generation-actions {
    gap: 6px;
  }

  .pw-generation-actions .btn {
    padding: 0 10px;
  }
}
</style>
