<script setup lang="ts">
import { computed } from 'vue'
import { state, toast } from '../store'
import { vAutosize } from '../autosize'
import Icon from './Icon.vue'

withDefaults(defineProps<{ label?: string; hint?: string }>(), { label: '角色提示词', hint: '' })

const isV5 = computed(() => state.settings?.naiVersion === 'v5')
const maxChars = computed(() => (isV5.value ? 22 : 6))

function add() {
  if (state.characters.length >= maxChars.value) {
    toast(`${isV5.value ? 'V5' : 'V4.5'} 最多 ${maxChars.value} 个角色`)
    return
  }
  state.characters.push({ prompt: '', negative: '', position: '' })
  state.focus = { kind: 'char', index: state.characters.length - 1 }
}

function remove(i: number) {
  state.characters.splice(i, 1)
  if (state.focus.kind === 'char') state.focus = { kind: 'base' }
}
</script>

<template>
  <div class="field">
    <div class="field-head">
      <label class="field-label">{{ label }}<span class="muted" v-if="hint"> · {{ hint }}</span></label>
      <span class="group-count" v-if="state.characters.length">{{ state.characters.length }}</span>
      <button class="btn ghost small ml-auto" @click="add"><Icon name="plus" :size="14" />添加角色</button>
    </div>
    <div class="char-block" v-for="(c, i) in state.characters" :key="i">
      <div class="char-head">
        <span class="group-badge nl"><Icon name="user" :size="14" /></span>
        <h3>角色 {{ i + 1 }}</h3>
        <input class="input sm" v-model="c.position" spellcheck="false" :placeholder="isV5 ? '位置，如 画面左侧 / 0.3,0.5' : '位置，如 B3（可空）'" />
        <button class="icon-btn sm ml-auto" title="删除角色" @click="remove(i)"><Icon name="trash" :size="15" /></button>
      </div>
      <div class="composer short mini">
        <textarea
          v-autosize
          v-model="c.prompt"
          data-src="pos"
          spellcheck="false"
          placeholder="girl, silver hair, red eyes, ..."
          @focus="state.focus = { kind: 'char', index: i }"
        ></textarea>
      </div>
      <div class="composer short mini neg">
        <textarea
          v-autosize
          v-model="c.negative"
          data-src="neg"
          spellcheck="false"
          placeholder="角色负面（可空），如 glasses, animal ears"
          @focus="state.focus = { kind: 'char', index: i, neg: true }"
        ></textarea>
      </div>
    </div>
  </div>
</template>
