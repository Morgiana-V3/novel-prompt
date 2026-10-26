<script setup lang="ts">
import { computed } from 'vue'
import type { InpaintDraft, NaiVersion, NaiImage } from '@shared/types'
import { state, importPrompt } from '../store'
import { vAutosize } from '../autosize'
import { parsePromptText } from '@shared/prompt-import'
import CharacterEditor from './CharacterEditor.vue'

/** 统一表单顺序：主提示词 → 负面（UC）→ 角色；项目传入独立草稿，其他页面使用共享内容。 */
const props = withDefaults(
  defineProps<{
    draft?: InpaintDraft
    model?: NaiVersion
    params?: { width: number; height: number }
    image?: NaiImage | null
    disabled?: boolean
    baseLabel?: string
    baseHint?: string
    charLabel?: string
    charHint?: string
    negHint?: string
  }>(),
  {
    baseLabel: '主提示词',
    baseHint: '各页面共用，粘贴分节文本会自动拆分',
    charLabel: '角色提示词',
    charHint: '',
    negHint: ''
  }
)

const base = computed({ get: () => props.draft?.base ?? state.prompt, set: v => { if (props.draft) props.draft.base=v; else state.prompt=v } })
const negative = computed({ get: () => props.draft?.negative ?? state.negative, set: v => { if (props.draft) props.draft.negative=v; else state.negative=v } })
/** 粘贴分节文本 / NAI 元数据时，自动拆到主提示词、角色、负面三处 */
function onPaste(e: ClipboardEvent) {
  if (props.disabled) return
  const r = parsePromptText(e.clipboardData?.getData('text/plain') ?? '')
  if (!r.structured) return
  e.preventDefault()
  if (props.draft) { props.draft.base=r.base; props.draft.negative=r.negative; props.draft.characters=r.characters.map(c=>({...c})) }
  else importPrompt(r, '已自动拆分')
}
</script>

<template>
  <div class="field">
    <label class="field-label" :title="baseHint">{{ baseLabel }}</label>
    <div class="composer short">
      <textarea
        v-autosize
        v-model="base" :readonly="disabled" aria-label="主提示词"
        data-src="pos"
        spellcheck="false"
        :placeholder="disabled ? '未设置主提示词' : '2girls, artist:xxx, outdoors, cherry blossoms, ...'"
        @paste="onPaste"
        @focus="!draft && (state.focus = { kind: 'base' })"
      ></textarea>
    </div>
  </div>

  <div class="field">
    <label class="field-label" :title="negHint">负面提示词（UC）</label>
    <div class="composer short neg">
      <textarea
        v-autosize
        v-model="negative" :readonly="disabled" aria-label="负面提示词"
        data-src="neg"
        spellcheck="false"
        :placeholder="disabled ? '未设置负面提示词' : 'lowres, worst quality, bad quality, ...'"
        @focus="!draft && (state.focus = { kind: 'negative' })"
      ></textarea>
    </div>
  </div>

  <CharacterEditor :label="charLabel" :hint="charHint" :characters="draft?.characters" :model="model" :params="params" :image="image" :disabled="disabled" />
</template>
