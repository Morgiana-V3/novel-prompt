<script setup lang="ts">
import { computed } from 'vue'
import type { NaiImage } from '@shared/images/types'
import type { NaiVersion } from '@shared/generation/types'
import type { PageEditorState } from '@shared/workspace/model'
import { copy } from '../../../shared/lib/notifications'
import { sectionText } from '../../prompts/actions'
import { DEFAULT_GEN } from '../../generation/state'
import { DEFAULT_PARAMS } from '../../prompts/state'
import PromptEditor from '../../prompts/components/PromptEditor.vue'
import GenerationParameters from '../../generation/components/GenerationParameters.vue'
import Icon from '../../../shared/ui/Icon.vue'
const props = defineProps<{
  editor: PageEditorState
  model: NaiVersion
  image: NaiImage | null
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
    <div class="workspace-config-body">
      <PromptEditor
        :draft="active.draft"
        :model="model"
        :params="active.params"
        :image="image"
        :disabled="readOnly"
        :base-hint="editable ? '下一次生成使用的提示词' : '图片生成时保存的提示词'"
        char-hint="点「编辑位置」可在画布上拖动角色"
        @change-draft="updateDraft"
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
      <GenerationParameters
        :gen="active.params"
        :params="active.params"
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
  user-select: text;
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
</style>
