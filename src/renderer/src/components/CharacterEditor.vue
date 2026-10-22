<script setup lang="ts">
import { computed } from 'vue'
import { state, toast, type CharDraft } from '../store'
import { vAutosize } from '../autosize'
import Icon from './Icon.vue'

const props = withDefaults(defineProps<{ list: CharDraft[]; label?: string; hint?: string }>(), {
  label: '角色提示词',
  hint: ''
})

const isV5 = computed(() => state.settings?.naiVersion === 'v5')
const maxChars = computed(() => (isV5.value ? 22 : 6))

function add() {
  if (props.list.length >= maxChars.value) {
    toast(`${isV5.value ? 'V5' : 'V4.5'} 最多 ${maxChars.value} 个角色`)
    return
  }
  props.list.push({ prompt: '', negative: '', position: '' })
}
</script>

<template>
  <div class="field">
    <div class="field-head">
      <label class="field-label">{{ label }}<span class="muted" v-if="hint"> · {{ hint }}</span></label>
      <span class="group-count" v-if="list.length">{{ list.length }}</span>
      <button class="btn ghost small ml-auto" @click="add"><Icon name="plus" :size="14" />添加角色</button>
    </div>
    <div class="char-block" v-for="(c, i) in list" :key="i">
      <div class="char-head">
        <span class="group-badge nl"><Icon name="user" :size="14" /></span>
        <h3>角色 {{ i + 1 }}</h3>
        <input class="input sm" v-model="c.position" spellcheck="false" :placeholder="isV5 ? '位置，如 画面左侧' : '位置，如 B3（可空）'" />
        <button class="icon-btn sm ml-auto" title="删除角色" @click="list.splice(i, 1)"><Icon name="trash" :size="15" /></button>
      </div>
      <div class="composer short mini">
        <textarea v-autosize v-model="c.prompt" data-src="pos" spellcheck="false" placeholder="girl, silver hair, red eyes, ..."></textarea>
      </div>
      <div class="composer short mini neg">
        <textarea v-autosize v-model="c.negative" data-src="neg" spellcheck="false" placeholder="角色负面（可空），如 glasses, animal ears"></textarea>
      </div>
    </div>
  </div>
</template>
