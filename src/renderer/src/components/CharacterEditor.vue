<script setup lang="ts">
import type { AiCharacter, NaiImage, NaiVersion } from '@shared/types'
import { computed, ref } from 'vue'
import { parsePosition } from '@shared/nai-presets'
import { state, toast, removeCharacter } from '../store'
import { vAutosize } from '../autosize'
import Icon from './Icon.vue'
import PositionEditor from './PositionEditor.vue'

const props = withDefaults(defineProps<{ label?: string; hint?: string; characters?: AiCharacter[]; model?: NaiVersion; params?: {width:number;height:number}; image?: NaiImage|null; disabled?: boolean }>(), { label: '角色提示词', hint: '' })

const isV5 = computed(() => (props.model ?? state.settings?.naiVersion) === 'v5')
const chars = computed(() => props.characters ?? state.characters)
const maxChars = computed(() => (isV5.value ? 22 : 6))

/** 位置编辑器：null = 关闭，数字 = 打开并选中该角色 */
const posEditing = ref<number | null>(null)
const badPos = (p?: string) => !!p?.trim() && !parsePosition(p)

function add() {
  if (chars.value.length >= maxChars.value) {
    toast(`${isV5.value ? 'V5' : 'V4.5'} 最多 ${maxChars.value} 个角色`)
    return
  }
  chars.value.push({ prompt: '', negative: '', position: '' })
  if (!props.characters) state.focus = { kind: 'char', index: chars.value.length - 1 }
}

function remove(i: number) {
  if (!props.characters) return removeCharacter(i)
  const owner=props.characters, [removed]=owner.splice(i,1)
  if (removed) toast(`已删除角色 ${i+1}（尚未保存）`, {label:'撤销',run:()=>{
    if (props.characters!==owner || props.disabled) return toast('编辑已结束，无法撤销')
    owner.splice(Math.min(i,owner.length),0,removed)
  }})
}
</script>

<template>
  <div class="field">
    <div class="field-head">
      <label class="field-label" :title="hint">{{ label }}</label>
      <span class="group-count" v-if="chars.length">{{ chars.length }}</span>
      <button :disabled="disabled" v-if="chars.length" class="btn ghost small ml-auto" title="在画布上拖动各角色的位置" @click="posEditing = 0">
        <Icon name="frame" :size="14" />编辑位置
      </button>
      <button :disabled="disabled" :class="['btn ghost small', { 'ml-auto': !chars.length }]" @click="add"><Icon name="plus" :size="14" />添加角色</button>
    </div>
    <div class="char-block" v-for="(c, i) in chars" :key="i">
      <div class="char-head">
        <span class="group-badge nl"><Icon name="user" :size="14" /></span>
        <h3>角色 {{ i + 1 }}</h3>
        <input
          :class="['input sm', { 'pos-bad': badPos(c.position) }]"
          v-model="c.position" :readonly="disabled"
          spellcheck="false"
          :placeholder="isV5 ? '位置，如 0.3,0.5 或 B3（可空）' : '位置，如 B3（可空）'"
          :title="badPos(c.position) ? '这个写法无法解析，生图时会被忽略' : ''"
        />
        <button :disabled="disabled" class="icon-btn sm" title="在画布上拖动位置" @click="posEditing = i"><Icon name="frame" :size="15" /></button>
        <button :disabled="disabled" class="icon-btn sm ml-auto" title="删除角色" @click="remove(i)"><Icon name="trash" :size="15" /></button>
      </div>
      <div class="composer short mini">
        <textarea
          v-autosize
          v-model="c.prompt" :readonly="disabled"
          data-src="pos"
          spellcheck="false"
          placeholder="girl, silver hair, red eyes, ..."
          @focus="!characters && (state.focus = { kind: 'char', index: i })"
        ></textarea>
      </div>
      <div class="composer short mini neg">
        <textarea
          v-autosize
          v-model="c.negative" :readonly="disabled"
          data-src="neg"
          spellcheck="false"
          placeholder="角色负面（可空），如 glasses, animal ears"
          @focus="!characters && (state.focus = { kind: 'char', index: i, neg: true })"
        ></textarea>
      </div>
    </div>
  </div>
  <PositionEditor v-if="posEditing !== null" :start="posEditing" :characters="characters" :version="model" :params="params" :image="image" @close="posEditing = null" />
</template>
