<script setup lang="ts">
import { state, importPrompt } from '../store'
import { vAutosize } from '../autosize'
import { parsePromptText } from '@shared/prompt-import'
import CharacterEditor from './CharacterEditor.vue'

/** 当前提示词编辑器：主提示词 + 角色 + 负面，所有页面编辑的是同一份内容 */
withDefaults(
  defineProps<{
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

/** 粘贴分节文本 / NAI 元数据时，自动拆到主提示词、角色、负面三处 */
function onPaste(e: ClipboardEvent) {
  const r = parsePromptText(e.clipboardData?.getData('text/plain') ?? '')
  if (!r.structured) return
  e.preventDefault()
  importPrompt(r, '已自动拆分')
}
</script>

<template>
  <div class="field">
    <label class="field-label">{{ baseLabel }}<span class="muted" v-if="baseHint"> · {{ baseHint }}</span></label>
    <div class="composer short">
      <textarea
        v-autosize
        v-model="state.prompt"
        data-src="pos"
        spellcheck="false"
        placeholder="2girls, artist:xxx, outdoors, cherry blossoms, ..."
        @paste="onPaste"
        @focus="state.focus = { kind: 'base' }"
      ></textarea>
    </div>
  </div>

  <CharacterEditor :label="charLabel" :hint="charHint" />

  <div class="field">
    <label class="field-label">负面提示词（UC）<span class="muted" v-if="negHint"> · {{ negHint }}</span></label>
    <div class="composer short neg">
      <textarea
        v-autosize
        v-model="state.negative"
        data-src="neg"
        spellcheck="false"
        placeholder="lowres, worst quality, bad quality, ..."
        @focus="state.focus = { kind: 'negative' }"
      ></textarea>
    </div>
  </div>
</template>
