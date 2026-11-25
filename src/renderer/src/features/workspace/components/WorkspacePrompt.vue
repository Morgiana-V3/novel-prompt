<script setup lang="ts">
import { computed } from 'vue'
import type { NaiImage } from '@shared/images/types'
import type { NaiVersion } from '@shared/generation/types'
import type { PageEditorState } from '@shared/workspace/model'
import { copy } from '../../../shared/lib/notifications'
import { sectionText } from '../../prompts/public/import-export'
import { DEFAULT_GEN } from '../../generation/public'
import { DEFAULT_PARAMS } from '../../prompts/public/draft'
import { PromptEditor } from '../../prompts/public/components'
import VibeReferences from '../../generation/components/VibeReferences.vue'
import PreciseReferences from '../../generation/components/PreciseReferences.vue'
import GenerationParameters from '../../generation/components/GenerationParameters.vue'
import Icon from '../../../shared/ui/Icon.vue'
import WorkspaceRecord from './WorkspaceRecord.vue'
const props = defineProps<{
  editor: PageEditorState
  model: NaiVersion
  image: NaiImage | null
  initial?: boolean
  editable?: boolean
  disabled?: boolean
  sizeLocked?: boolean
}>()
const active = computed(() => props.editor)
const readOnly = computed(() => !props.editable || !!props.disabled)
const emit = defineEmits<{ changeEditor: [patch: Partial<PageEditorState>] }>()
function updateParams(patch: Partial<PageEditorState['params']>) {
  if (readOnly.value) {
    return
  }
  emit('changeEditor', { params: { ...props.editor.params, ...patch } })
}
function updateDraft(patch: Partial<PageEditorState['draft']>) {
  if (readOnly.value) {
    return
  }
  emit('changeEditor', { draft: { ...props.editor.draft, ...patch } })
}
const strength = computed({
  get: () => props.editor.strength,
  set: (value: number) => {
    if (!readOnly.value) {
      emit('changeEditor', { strength: value })
    }
  },
})
function resetDefaults() {
  if (readOnly.value) {
    return
  }
  const params = {
    ...props.editor.params,
    ...DEFAULT_GEN,
    ...DEFAULT_PARAMS,
    count: 1,
    qualityTags: false,
    ucPreset: 'none' as const,
  }
  if (props.sizeLocked) {
    params.width = props.editor.params.width
    params.height = props.editor.params.height
  }
  emit('changeEditor', { params, strength: 1 })
}
defineExpose({ copyPrompt: () => copy(sectionText(active.value.draft)) })
</script>
<template>
  <div
    class="workspace-prompt scroll"
    :data-editing="!!editable"
  >
    <WorkspaceRecord
      v-if="!editable"
      :editor="active"
      :model="model"
      :image="image"
      :initial="initial"
    />
    <div
      v-else
      class="workspace-config-body"
    >
      <PromptEditor
        :draft="active.draft"
        show-presets
        :preset-params="active.params"
        :model="model"
        :params="active.params"
        :image="image"
        :disabled="readOnly"
        :base-hint="editable ? '下一次生成使用的提示词' : '图片生成时保存的提示词'"
        @change-draft="updateDraft"
        @change-params="updateParams"
      />
      <div class="field-head gen-params-head">
        <label class="field-label">生成参数</label
        ><span class="muted small">{{ model.toUpperCase() }} Full</span
        ><button
          v-if="editable"
          class="btn ghost small ml-auto"
          :disabled="readOnly"
          title="恢复默认参数"
          @click="resetDefaults"
        >
          <Icon
            name="reset"
            :size="14"
          />恢复默认
        </button>
      </div>
      <PreciseReferences
        show-heading
        :images="active.params.preciseReferences ?? []"
        :count="active.params.count"
        :conflict="!!active.params.vibeReferences?.length"
        :model="model"
        :current="image"
        :disabled="readOnly"
        @change="updateParams({ preciseReferences: $event })"
      />
      <details
        v-if="model === 'v4.5' || active.params.vibeReferences?.length"
        class="workspace-vibe-details"
        :open="!!active.params.vibeReferences?.length"
      >
        <summary
          class="disclosure workspace-vibe-summary"
          title="相同图片和信息提取量可复用已编码的 Vibe。"
        >
          <Icon
            name="palette"
            :size="14"
          />
          <span>Vibe Transfer</span>
          <span
            v-if="active.params.vibeReferences?.length"
            class="pill"
            >{{ active.params.vibeReferences.length }}</span
          >
        </summary>
        <div class="workspace-vibe-body">
          <VibeReferences
            :entries="active.params.vibeReferences ?? []"
            :version="model"
            :current="image"
            :disabled="readOnly"
            :conflict="!!active.params.preciseReferences?.length"
            @change="updateParams({ vibeReferences: $event })"
          />
        </div>
      </details>
      <GenerationParameters
        :gen="active.params"
        :params="active.params"
        expanded-sizes
        prompt-presets-in-editor
        :disabled="readOnly"
        :size-locked="sizeLocked"
        @change-gen="updateParams"
        @change-params="updateParams"
      >
        <div class="param">
          <span class="side-label">局部重绘强度 · {{ active.strength }}</span
          ><input
            v-model.number="strength"
            class="range"
            aria-label="局部重绘强度"
            type="range"
            min="0.01"
            max="1"
            step="0.01"
            :disabled="readOnly"
          />
        </div>
      </GenerationParameters>
    </div>
  </div>
</template>
<style scoped>
.workspace-prompt {
  flex: 1;
  min-height: 0;
}

.workspace-config-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 12px 0 24px;
}

.workspace-config-body :deep(.field) {
  margin: 0;
}

.workspace-config-body :deep(textarea) {
  resize: none;
}

.workspace-config-body :deep(.gen-params) {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.workspace-config-body :deep(.gen-advanced) {
  background: var(--bg);
}

.workspace-vibe-details {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg);
  overflow: hidden;
  transition: border-color var(--dur-fast) var(--ease-out);
}

.workspace-vibe-details[open] {
  border-color: var(--line2);
}

.workspace-vibe-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
  transition: background-color var(--dur-fast) var(--ease-out);
}

.workspace-vibe-summary:hover {
  background: var(--panel);
}

.workspace-vibe-summary .icon {
  color: var(--pink-deep);
}

.workspace-vibe-summary .pill {
  margin-left: auto;
  background: var(--pink-soft);
  color: var(--pink-deep);
  font-weight: 600;
}

.workspace-vibe-body {
  padding: 2px 12px 12px;
  border-top: 1px solid var(--line);
}
</style>
