<script setup lang="ts">
import { computed } from 'vue'
import type { NaiImage, NaiVersion } from '@shared/types'
import type { PageEditorState } from '@shared/page-workspace'
import { copy, sectionText, DEFAULT_GEN, DEFAULT_PARAMS } from '../store'
import PromptEditor from './PromptEditor.vue'
import GenerationParameters from './GenerationParameters.vue'
import Icon from './Icon.vue'
const props = defineProps<{ editor: PageEditorState; model: NaiVersion; image: NaiImage | null; editable?: boolean; disabled?: boolean; sizeLocked?: boolean }>()
const active=computed(()=>props.editor)
const readOnly=computed(()=>!props.editable || !!props.disabled)
function resetDefaults() {
  if(readOnly.value)return
  const {width,height}=props.editor.params
  Object.assign(props.editor.params, DEFAULT_GEN, DEFAULT_PARAMS, {count:1,qualityTags:false,ucPreset:'none'})
  if(props.sizeLocked)Object.assign(props.editor.params,{width,height})
  props.editor.strength=1
}
defineExpose({copyPrompt:()=>copy(sectionText(active.value.draft))})
</script>
<template>
  <div class="workspace-prompt scroll" :data-editing="!!editable">
    <div class="workspace-config-body">
      <PromptEditor :draft="active.draft" :model="model" :params="active.params" :image="image" :disabled="readOnly" :base-hint="editable ? '下一次生成使用的提示词' : '图片生成时保存的提示词'" char-hint="点「编辑位置」可在画布上拖动角色" />
      <div class="field-head gen-params-head"><label class="field-label">生成参数</label><span class="muted small">{{ model.toUpperCase() }} Full</span><button v-if="editable" class="btn ghost small ml-auto" :disabled="readOnly" title="恢复默认参数" @click="resetDefaults"><Icon name="reset" :size="14"/>恢复默认</button></div>
      <GenerationParameters :gen="active.params" :params="active.params" :disabled="readOnly" :size-locked="sizeLocked">
        <div class="param"><span class="side-label">局部重绘强度 · {{ active.strength }}</span><input class="range" aria-label="局部重绘强度" type="range" min="0.01" max="1" step="0.01" :disabled="readOnly" v-model.number="active.strength" /></div>
      </GenerationParameters>
    </div>
  </div>
</template>
<style scoped>
.workspace-prompt{flex:1;min-height:0;user-select:text}.workspace-config-body{display:flex;flex-direction:column;gap:18px;padding:12px 0 24px}.workspace-config-body :deep(.field){margin:0}.workspace-config-body :deep(textarea){resize:none}.workspace-config-body :deep(.gen-params){grid-template-columns:repeat(2,minmax(0,1fr))}.workspace-config-body :deep(.gen-advanced){background:var(--bg)}
</style>
