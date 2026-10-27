<script setup lang="ts">
import { promptState } from '../state'
import { computed } from 'vue'
import type { InpaintDraft } from '@shared/prompts/types'
import type { NaiVersion } from '@shared/generation/types'
import type { NaiImage } from '@shared/images/types'
import { importPrompt } from '../actions'
import { vAutosize } from '../../../shared/lib/autosize'
import { parsePromptText } from '@shared/prompts/import'
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
    draft: undefined,
    model: undefined,
    params: undefined,
    image: null,
    baseLabel: '主提示词',
    baseHint: '各页面共用，粘贴分节文本会自动拆分',
    charLabel: '角色提示词',
    charHint: '',
    negHint: '',
  },
)

const emit = defineEmits<{ changeDraft: [patch: Partial<InpaintDraft>] }>()
const base = computed({
  get: () => props.draft?.base ?? promptState.prompt,
  set: (text) => {
    if (props.draft) {
      emit('changeDraft', { base: text })
    } else {
      promptState.prompt = text
    }
  },
})
const negative = computed({
  get: () => props.draft?.negative ?? promptState.negative,
  set: (text) => {
    if (props.draft) {
      emit('changeDraft', { negative: text })
    } else {
      promptState.negative = text
    }
  },
})
/** 粘贴分节文本 / NAI 元数据时，自动拆到主提示词、角色、负面三处 */
function onPaste(event2: ClipboardEvent) {
  if (props.disabled) {
    return
  }
  const importedPrompt = parsePromptText(event2.clipboardData?.getData('text/plain') ?? '')
  if (!importedPrompt.structured) {
    return
  }
  event2.preventDefault()
  if (props.draft) {
    emit('changeDraft', {
      base: importedPrompt.base,
      negative: importedPrompt.negative,
      characters: importedPrompt.characters.map((character) => ({ ...character })),
    })
  } else {
    importPrompt(importedPrompt, '已自动拆分')
  }
}
</script>

<template>
  <div class="field">
    <label
      class="field-label"
      :title="baseHint"
      >{{ baseLabel }}</label
    >
    <div class="composer short">
      <textarea
        v-model="base"
        v-autosize
        :readonly="disabled"
        aria-label="主提示词"
        data-src="pos"
        spellcheck="false"
        :placeholder="
          disabled ? '未设置主提示词' : '2girls, artist:xxx, outdoors, cherry blossoms, ...'
        "
        @paste="onPaste"
        @focus="!draft && (promptState.focus = { kind: 'base' })"
      ></textarea>
    </div>
  </div>

  <div class="field">
    <label
      class="field-label"
      :title="negHint"
      >负面提示词（UC）</label
    >
    <div class="composer short neg">
      <textarea
        v-model="negative"
        v-autosize
        :readonly="disabled"
        aria-label="负面提示词"
        data-src="neg"
        spellcheck="false"
        :placeholder="disabled ? '未设置负面提示词' : 'lowres, worst quality, bad quality, ...'"
        @focus="!draft && (promptState.focus = { kind: 'negative' })"
      ></textarea>
    </div>
  </div>

  <CharacterEditor
    :label="charLabel"
    :hint="charHint"
    :characters="draft?.characters"
    :model="model"
    :params="params"
    :image="image"
    :disabled="disabled"
  />
</template>
