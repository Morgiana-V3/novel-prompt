<script setup lang="ts">
import { computed, ref } from 'vue'
import { vAutosize } from '../autosize'
import type { InpaintDraft, NaiImage, NaiVersion } from '@shared/types'
import type { PageEditorState } from '@shared/page-workspace'
import { pageChanges } from '@shared/page-workspace'
import { changeLabel } from '@shared/inpaint-plan'
import { diffPrompt } from '../prompt-diff'
import { cleanErr, copy } from '../store'
import DiffChips from './DiffChips.vue'
import Icon from './Icon.vue'
import PositionEditor from './PositionEditor.vue'
import { MAX_CHARACTERS, parsePosition, isGridPosition } from '@shared/nai-presets'

const props = defineProps<{ editor: PageEditorState; model: NaiVersion; image: NaiImage | null; baseline?: InpaintDraft; hasImage: boolean; disabled: boolean; save: (editor: PageEditorState) => Promise<void> }>()
const emit = defineEmits<{ editing: [value: boolean] }>()
const positionIndex = ref<number | null>(null)
const invalidPosition = (p?: string) => !!p?.trim() && (!parsePosition(p) || props.model==='v4.5' && !isGridPosition(p))
const editing = ref(false), saving = ref(false), error = ref('')
const draft = ref<PageEditorState>(JSON.parse(JSON.stringify(props.editor)))
const changes = computed(() => props.baseline ? pageChanges(props.baseline, props.editor.draft) : [])
function begin() { draft.value = JSON.parse(JSON.stringify(props.editor)); editing.value = true; error.value = ''; emit('editing',true) }
function cancel() { editing.value=false; emit('editing',false) }
async function save() {
  saving.value=true; error.value=''
  try { const e=JSON.parse(JSON.stringify(draft.value)); if(e.params.seed==='')e.params.seed=null; await props.save(e); cancel() }
  catch(e) { error.value=cleanErr(e) } finally { saving.value=false }
}
const fullText = computed(() => JSON.stringify(props.editor.draft,null,2))
defineExpose({ begin, save, cancel, saving, copyPrompt: () => copy(fullText.value) })
</script>
<template>
  <div class="workspace-prompt scroll">
    <template v-if="!editing">
      <label>主提示词</label><pre>{{ editor.draft.base || '尚未填写，可先向 AI 描述目标' }}</pre>
      <label>负面提示词</label><pre>{{ editor.draft.negative || '（空）' }}</pre>
      <section v-for="(c,i) in editor.draft.characters" :key="i"><label>角色 {{ i+1 }} · 位置 {{ c.position || '自动' }}</label><pre>{{ c.prompt }}</pre><label>角色负面</label><pre>{{ c.negative || '（空）' }}</pre></section>
      <div class="prompt-params">{{ editor.params.width }} × {{ editor.params.height }} · {{ editor.params.steps }} 步 · Guidance {{ editor.params.scale }} · 种子 {{ editor.params.seed ?? '随机' }} · 重绘强度 {{ editor.strength }}</div>
      <details v-if="baseline"><summary>与当前图片生成时的提示词对比 · {{ changes.length }} 处</summary><p v-if="!changes.length" class="muted small">当前草稿与生成这张图片时一致。</p><div v-for="(c,i) in changes" :key="i" class="prompt-change"><b>{{ changeLabel(c) }}</b><DiffChips :diff="diffPrompt(c.before,c.after)" /><p v-if="c.reason">{{ c.reason }}</p></div></details>
    </template>
    <fieldset v-else :disabled="saving">
      <label>主提示词<textarea v-autosize class="input" v-model="draft.draft.base" rows="5" /></label><label>负面提示词<textarea v-autosize class="input" v-model="draft.draft.negative" rows="3" /></label>
      <div class="workspace-characters">
        <section v-for="(c,i) in draft.draft.characters" :key="i" class="char-block">
          <div class="char-head">
            <span class="group-badge nl"><Icon name="user" :size="14"/></span><h3>角色 {{ i+1 }}</h3>
            <input class="input sm" :class="{'pos-bad':invalidPosition(c.position)}" v-model="c.position" :placeholder="model==='v5'?'位置：自动 / 0.3,0.5':'位置：自动 / B3'" :title="invalidPosition(c.position)?'位置格式无效':''" :aria-label="`角色 ${i+1} 位置`" spellcheck="false">
            <button class="icon-btn sm" :aria-label="`编辑角色 ${i+1} 位置`" title="编辑位置" @click="positionIndex=i"><Icon name="frame" :size="15"/></button>
            <button class="icon-btn sm" :aria-label="`删除角色 ${i+1}`" title="删除角色" @click="draft.draft.characters.splice(i,1)"><Icon name="trash" :size="15"/></button>
          </div>
          <textarea v-autosize class="input" v-model="c.prompt" :aria-label="`角色 ${i+1} 提示词`" spellcheck="false"/>
          <textarea v-autosize class="input character-negative" v-model="c.negative" :aria-label="`角色 ${i+1} 负面`" placeholder="角色负面（可空）" spellcheck="false"/>
        </section>
      </div>
      <button class="btn ghost small" :disabled="draft.draft.characters.length>=MAX_CHARACTERS[model]" @click="draft.draft.characters.push({prompt:'',negative:'',position:''})"><Icon name="plus" :size="14"/>添加角色</button>
      <div class="prompt-param-form"><label>宽度<input class="input" type="number" min="64" step="64" :disabled="hasImage" v-model.number="draft.params.width"></label><label>高度<input class="input" type="number" min="64" step="64" :disabled="hasImage" v-model.number="draft.params.height"></label><label>步数<input class="input" type="number" min="1" max="50" v-model.number="draft.params.steps"></label><label>Guidance<input class="input" type="number" min="0" max="10" step="0.1" v-model.number="draft.params.scale"></label><label>种子<input class="input" type="number" min="0" max="4294967295" v-model.number="draft.params.seed" placeholder="随机"></label><label>局部重绘强度<input class="input" type="number" min="0.01" max="1" step="0.01" v-model.number="draft.strength"></label></div>
      <p v-if="error" class="error-box" role="alert">{{ error }}</p>
    </fieldset>
    <PositionEditor v-if="positionIndex!==null" :start="positionIndex" :characters="draft.draft.characters" :version="model" :params="draft.params" :image="image" @close="positionIndex=null"/>
  </div>
</template>
<style scoped>
.workspace-prompt{flex:1;min-height:0;padding:4px 0 20px;user-select:text}.workspace-prompt>.row{flex-wrap:wrap}.workspace-prompt h3{font-size:14px}.workspace-prompt label{display:block;font-size:12px;font-weight:600;margin:16px 0 8px}.workspace-prompt pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.9 var(--mono);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:14px;margin:0}.workspace-prompt section{margin-top:18px;padding-top:12px;border-top:1px solid var(--line)}.workspace-prompt textarea{display:block;width:100%;min-height:96px;margin-top:8px;line-height:1.8;font-family:var(--mono);font-size:12px;resize:none}.workspace-prompt fieldset{border:0;padding:0;margin:0;min-width:0}.workspace-prompt fieldset section>.input{margin:8px 0}.prompt-params{margin:20px 0;font-size:12px;color:var(--text2);line-height:1.8}.workspace-prompt details{border-top:1px solid var(--line);padding:16px 0;font-size:12px}.workspace-prompt summary{cursor:pointer}.prompt-change{margin-top:16px}.prompt-change b{font-size:11px}.prompt-change p{color:var(--muted)}.prompt-param-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 12px}.prompt-param-form input{width:100%;margin-top:8px}
.workspace-characters .char-block{padding:12px;border:1px solid var(--line);gap:10px;margin:14px 0}.workspace-characters .char-head{gap:8px;flex-wrap:wrap}.workspace-characters .char-head h3{font-size:13px}.workspace-characters .char-head .input{max-width:none;min-width:90px}.workspace-characters .char-head .icon-btn{flex-shrink:0}.workspace-characters textarea.input{margin:0;font-weight:400}.workspace-characters textarea.character-negative{min-height:64px}.prompt-change :deep(.diff-row){padding:0;margin:8px 0}.prompt-change :deep(.diff-prose){margin:8px 0}
</style>
