<script setup lang="ts">
import { computed, ref } from 'vue'
import { parsePosition } from '@shared/nai-presets'
import { state, toast, removeCharacter } from '../store'
import { vAutosize } from '../autosize'
import Icon from './Icon.vue'
import PositionEditor from './PositionEditor.vue'

withDefaults(defineProps<{ label?: string; hint?: string }>(), { label: '角色提示词', hint: '' })

const isV5 = computed(() => state.settings?.naiVersion === 'v5')
const maxChars = computed(() => (isV5.value ? 22 : 6))

/** 位置编辑器：null = 关闭，数字 = 打开并选中该角色 */
const posEditing = ref<number | null>(null)
const badPos = (p: string) => !!p.trim() && !parsePosition(p)

function add() {
  if (state.characters.length >= maxChars.value) {
    toast(`${isV5.value ? 'V5' : 'V4.5'} 最多 ${maxChars.value} 个角色`)
    return
  }
  state.characters.push({ prompt: '', negative: '', position: '' })
  state.focus = { kind: 'char', index: state.characters.length - 1 }
}

const remove = removeCharacter
</script>

<template>
  <div class="field">
    <div class="field-head">
      <label class="field-label" :title="hint">{{ label }}</label>
      <span class="group-count" v-if="state.characters.length">{{ state.characters.length }}</span>
      <button v-if="state.characters.length" class="btn ghost small ml-auto" title="在画布上拖动各角色的位置" @click="posEditing = 0">
        <Icon name="frame" :size="14" />编辑位置
      </button>
      <button :class="['btn ghost small', { 'ml-auto': !state.characters.length }]" @click="add"><Icon name="plus" :size="14" />添加角色</button>
    </div>
    <div class="char-block" v-for="(c, i) in state.characters" :key="i">
      <div class="char-head">
        <span class="group-badge nl"><Icon name="user" :size="14" /></span>
        <h3>角色 {{ i + 1 }}</h3>
        <input
          :class="['input sm', { 'pos-bad': badPos(c.position) }]"
          v-model="c.position"
          spellcheck="false"
          :placeholder="isV5 ? '位置，如 0.3,0.5 或 B3（可空）' : '位置，如 B3（可空）'"
          :title="badPos(c.position) ? '这个写法无法解析，生图时会被忽略' : ''"
        />
        <button class="icon-btn sm" title="在画布上拖动位置" @click="posEditing = i"><Icon name="frame" :size="15" /></button>
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
  <PositionEditor v-if="posEditing !== null" :start="posEditing" @close="posEditing = null" />
</template>
