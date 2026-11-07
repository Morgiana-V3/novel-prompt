<script setup lang="ts">
import { estimateGeneration, estimateLabel } from '@shared/generation/pricing'
import type { NaiVersion } from '@shared/generation/types'
import { subscriptionState } from '../../generation/subscription'
import { computed } from 'vue'
import { regionIds } from '@shared/workspace/regions'
import type { PageExecution, PageVersion, PageEditorState } from '@shared/workspace/model'
import type { AppTask } from '@shared/tasks/model'
import ThemeSelect from '../../../shared/ui/ThemeSelect.vue'
import CollectionPicker from '../../gallery/CollectionPicker.vue'
import { DEFAULT_COLLECTION } from '@shared/images/collections'
import Icon from '../../../shared/ui/Icon.vue'
const props = defineProps<{
  model: NaiVersion
  current: PageVersion
  selectedRegionIds: string[]
  execution: PageExecution
  nextEditor: PageEditorState
  operation: string
  remoteBusy: boolean
  busy: boolean
  hasExecutionRegion: boolean
  progress: string
  generateTask?: AppTask
  collectionId?: string
}>()
const emit = defineEmits<{
  execution: [value: PageExecution]
  generate: []
  preview: []
  cancel: [id: string]
  collection: [id: string]
}>()
const estimate = computed(() =>
  estimateGeneration(
    {
      params: props.nextEditor.params,
      version: props.model,
      ...(props.execution.kind === 'inpaint'
        ? { inpaint: { strength: props.nextEditor.strength } }
        : {}),
    },
    subscriptionState.error ? undefined : subscriptionState.subscription,
  ),
)
const cost = computed(() => estimateLabel(estimate.value))
const isFree = computed(() => estimate.value?.maximum === 0)
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
const generationLabel = computed(() =>
  props.execution.kind === 'generate' ? '生成图片' : '执行重绘',
)
/* 尺寸、步数属于配置，只在悬停时提示；横条上只留预计消耗标签（与生图创作底栏一致） */
const generateTitle = computed(() => {
  const { width, height, steps } = props.nextEditor.params
  return `${width}×${height} · ${steps} 步 · ${cost.value}`
})
const hasPrompt = computed(
  () =>
    !!props.nextEditor.draft.base.trim() ||
    props.nextEditor.draft.characters.some((character) => !!character.prompt.trim()),
)
const canGenerate = computed(() => {
  if (props.operation || props.remoteBusy || !hasPrompt.value) {
    return false
  }
  return props.execution.kind !== 'inpaint' || props.hasExecutionRegion
})

/* 生成中：同一位置换成停止按钮；详细进度统一在右上角任务队列，这里只放进 title */
const isGenerating = computed(() => props.operation === 'generate')
const isCancelling = computed(() => props.generateTask?.status === 'cancelling')
const stopLabel = computed(() => {
  if (!props.generateTask) {
    return '准备中…'
  }
  return isCancelling.value ? '完成后停止' : '停止生成'
})
const stopTitle = computed(() => {
  const progressText = props.progress || '正在执行'
  return [progressText, '详细进度见右上角任务队列'].join('\n')
})
function stopGeneration() {
  if (props.generateTask) {
    emit('cancel', props.generateTask.id)
  }
}
</script>

<template>
  <div
    class="pw-execution"
    data-toast-avoid
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
    <CollectionPicker
      class="pw-collection"
      :model-value="collectionId ?? DEFAULT_COLLECTION"
      :disabled="!!operation || remoteBusy"
      title="本项目生成和修图的图片存入的图集（之后生成的图片生效）"
      @update:model-value="emit('collection', $event)"
    />
    <div class="pw-generation-actions">
      <span
        class="pw-fee"
        :class="{ free: isFree }"
        :title="generateTitle"
        >{{ cost }}</span
      >
      <button
        v-if="isGenerating"
        class="btn pw-generate pw-stop"
        data-running
        :disabled="!generateTask || isCancelling"
        :title="stopTitle"
        :aria-label="stopLabel"
        @click="stopGeneration"
      >
        <Icon
          name="stop"
          :size="15"
        /><span>{{ stopLabel }}</span>
      </button>
      <button
        v-else
        class="btn accent pw-generate"
        :disabled="!canGenerate"
        :title="generateTitle"
        @click="emit('generate')"
      >
        <Icon
          name="generate"
          :size="15"
        /><span>{{ generationLabel }}</span
        ><span
          v-if="nextEditor.params.count > 1"
          class="pw-generation-count"
          >{{ nextEditor.params.count }}</span
        >
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 与生图创作底栏同一套尺寸：30～34px 控件、8px 圆角、费用小标签、单行主按钮 */
.pw-execution {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 6px;
  height: 52px;
  min-height: 52px;
  padding: 8px 0;
  border-top: 1px solid var(--line);
}

.pw-execution > .btn {
  flex-shrink: 0;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 12px;
  white-space: nowrap;
}

.pw-execution :deep(.theme-select) {
  flex: 0 1 auto;
  width: auto;
  min-width: 0;
  max-width: 200px;
  height: 30px;
  min-height: 30px;
  padding: 0 10px;
  gap: 4px;
  border-radius: 8px;
  font-size: 12px;
  box-shadow: none;
}

/* 窄屏时图集选择先收缩，执行方式保持可读 */
.pw-execution > :deep(.theme-select) {
  flex-shrink: 0;
  min-width: 132px;
}

.pw-execution .pw-collection {
  flex: 0 3 140px;
  min-width: 84px;
}

.pw-execution .pw-collection :deep(.theme-select) {
  width: 100%;
  max-width: none;
}

.pw-execution .pw-collection :deep(.theme-select > span) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pw-generation-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8px;
  margin-left: auto;
}

.pw-fee {
  padding: 3px 6px;
  border-radius: 5px;
  font-size: 10.5px;
  white-space: nowrap;
  color: var(--text2);
  background: var(--panel);
  font-variant-numeric: tabular-nums;
  cursor: help;
}

.pw-fee.free {
  color: var(--ok);
  background: var(--ok-soft);
}

.pw-generate {
  justify-content: center;
  gap: 7px;
  min-width: 104px;
  height: 34px;
  min-height: 34px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 13px;
  box-shadow: none;
}

.pw-stop {
  border-color: var(--pink-line);
  color: var(--pink-deep);
  background: var(--bg);
  animation: fade-in var(--dur-base) var(--ease-out);
}

.pw-stop:not(:disabled):hover {
  background: var(--pink-soft);
}

.pw-generation-count {
  padding-left: 7px;
  border-left: 1px solid #ffffff60;
  font-size: 11px;
}

@media (width <= 900px) {
  .pw-fee {
    display: none;
  }
}
</style>
