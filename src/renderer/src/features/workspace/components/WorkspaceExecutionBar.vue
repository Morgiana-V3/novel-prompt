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
  editingPrompt: boolean
  hasExecutionRegion: boolean
  progress: string
  generateTask?: AppTask
  collectionId?: string
}>()
const emit = defineEmits<{
  execution: [value: PageExecution]
  editConfig: []
  returnFromConfig: []
  generate: []
  preview: []
  cancel: [id: string]
  collection: [id: string]
}>()
const cost = computed(() =>
  estimateLabel(
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
  ),
)
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
    <span class="muted small pw-execution-summary"
      >{{ nextEditor.params.width }}×{{ nextEditor.params.height }} ·
      {{ nextEditor.params.steps }} 步 · {{ cost }}</span
    >
    <div class="pw-generation-actions">
      <button
        v-if="editingPrompt"
        class="btn pw-config-back"
        :disabled="!!operation || remoteBusy"
        title="保存下一版配置并返回"
        @click="emit('returnFromConfig')"
      >
        <Icon
          name="check"
          :size="16"
        />完成
      </button>
      <button
        v-else
        class="btn pw-config-edit"
        :disabled="busy"
        title="基于蓝本编辑下一次生成的提示词与参数；本版配置保持不变"
        @click="emit('editConfig')"
      >
        <Icon
          name="sliders"
          :size="16"
        />编辑下一版
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
        /><span
          >{{ generationLabel }}<small class="pw-compact-cost">{{ cost }}</small></span
        ><span
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

.pw-compact-cost {
  display: none;
  font-size: 10px;
  font-weight: 400;
  line-height: 1.2;
}

@media (width <= 1250px) {
  .pw-compact-cost {
    display: block;
  }

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

/* 窄屏时图集选择先收缩，执行方式保持可读 */
.pw-execution > :deep(.theme-select) {
  flex-shrink: 0;
  min-width: 140px;
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

@media (width <= 800px) {
  .pw-generation-actions {
    gap: 6px;
  }

  .pw-generation-actions .btn {
    padding: 0 10px;
  }
}
</style>
