<script setup lang="ts">
import { deleteSelectedToken } from '../prompt-keyboard'
import SnippetButton from './SnippetButton.vue'
import { promptState } from '../state'
import { settingsState } from '../../settings/state'
import type { AiCharacter } from '@shared/prompts/types'
import type { NaiImage } from '@shared/images/types'
import type { NaiVersion } from '@shared/generation/types'
import { computed, onBeforeUnmount, ref } from 'vue'
import { parsePosition } from '@shared/generation/presets'
import { toast } from '../../../shared/lib/notifications'
import { removeCharacter } from '../actions'
import { vAutosize } from '../../../shared/lib/autosize'
import { vTagComplete } from '../tag-complete'
import Icon from '../../../shared/ui/Icon.vue'
import PositionEditor from './PositionEditor.vue'
import { detachLeaving, identityKey } from '../../../shared/lib/list-motion'

const props = withDefaults(
  defineProps<{
    label?: string
    hint?: string
    characters?: AiCharacter[]
    model?: NaiVersion
    params?: { width: number; height: number }
    image?: NaiImage | null
    disabled?: boolean
  }>(),
  {
    label: '角色提示词',
    hint: '',
    characters: undefined,
    model: undefined,
    params: undefined,
    // 保留 undefined，让位置编辑器读取当前图片预览。
    image: undefined,
  },
)

const isV5 = computed(() => (props.model ?? settingsState.settings?.naiVersion) === 'v5')
const chars = computed(() => props.characters ?? promptState.characters)
const maxChars = computed(() => (isV5.value ? 22 : 6))

/** 位置编辑器：null = 关闭，数字 = 打开并选中该角色 */
const posEditing = ref<number | null>(null)
const badPos = (path?: string) => !!path?.trim() && !parsePosition(path)

function add() {
  if (chars.value.length >= maxChars.value) {
    toast(`${isV5.value ? 'V5' : 'V4.5'} 最多 ${maxChars.value} 个角色`)
    return
  }
  chars.value.push({ prompt: '', negative: '', position: '' })
  if (!props.characters) {
    promptState.focus = { kind: 'char', index: chars.value.length - 1 }
  }
}

/**
 * 只在点击删除时播放离场与补位动画；导入、切换标签等整体替换时直接换内容，
 * 避免一批旧卡片叠在新卡片上淡出。
 */
const animateList = ref(false)
let animateTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(animateTimer))
function remove(i: number) {
  animateList.value = true
  clearTimeout(animateTimer)
  animateTimer = setTimeout(() => (animateList.value = false), 400)
  if (!props.characters) {
    return removeCharacter(i)
  }
  const owner = props.characters
  const [removed] = owner.splice(i, 1)
  if (removed) {
    toast(`已删除角色 ${i + 1}（尚未保存）`, {
      label: '撤销',
      run: () => {
        if (props.characters !== owner || props.disabled) {
          return toast('编辑已结束，无法撤销')
        }
        owner.splice(Math.min(i, owner.length), 0, removed)
      },
    })
  }
}
</script>

<template>
  <div class="field char-field">
    <div class="field-head">
      <label
        class="field-label"
        :title="hint"
        >{{ label }}</label
      >
      <span
        v-if="chars.length"
        class="group-count"
        >{{ chars.length }}</span
      >
      <button
        v-if="chars.length"
        :disabled="disabled"
        class="btn ghost small ml-auto"
        @click="posEditing = 0"
      >
        <Icon
          name="position"
          :size="14"
        />编辑位置
      </button>
      <button
        :disabled="disabled"
        :class="['btn ghost small', { 'ml-auto': !chars.length }]"
        @click="add"
      >
        <Icon
          name="plus"
          :size="14"
        />添加角色
      </button>
    </div>
    <TransitionGroup
      name="list"
      :css="animateList"
      @before-leave="detachLeaving"
    >
      <div
        v-for="(character, indexItem) in chars"
        :key="identityKey(character)"
        class="char-block"
      >
        <div class="char-head">
          <span class="group-badge nl"
            ><Icon
              name="user"
              :size="14"
          /></span>
          <h3>角色 {{ indexItem + 1 }}</h3>
          <input
            v-model="character.position"
            :class="['input sm', { 'pos-bad': badPos(character.position) }]"
            :readonly="disabled"
            spellcheck="false"
            :placeholder="isV5 ? '位置，如 0.3,0.5 或 B3（可空）' : '位置，如 B3（可空）'"
            :title="badPos(character.position) ? '这个写法无法解析，生图时会被忽略' : ''"
          />
          <button
            :disabled="disabled"
            class="icon-btn sm"
            title="编辑角色位置"
            @click="posEditing = indexItem"
          >
            <Icon
              name="position"
              :size="15"
            />
          </button>
          <button
            :disabled="disabled"
            class="icon-btn sm ml-auto"
            title="删除角色"
            @click="remove(indexItem)"
          >
            <Icon
              name="trash"
              :size="15"
            />
          </button>
        </div>
        <div class="composer short mini">
          <SnippetButton :disabled="disabled" />
          <textarea
            v-model="character.prompt"
            v-autosize
            v-tag-complete
            :readonly="disabled"
            data-src="pos"
            spellcheck="false"
            placeholder="输入角色提示词"
            @keydown="deleteSelectedToken"
            @focus="!characters && (promptState.focus = { kind: 'char', index: indexItem })"
          ></textarea>
        </div>
        <div class="composer short mini neg">
          <SnippetButton :disabled="disabled" />
          <textarea
            v-model="character.negative"
            v-autosize
            v-tag-complete
            :readonly="disabled"
            data-src="neg"
            spellcheck="false"
            placeholder="输入角色负面提示词（可选）"
            @keydown="deleteSelectedToken"
            @focus="
              !characters && (promptState.focus = { kind: 'char', index: indexItem, neg: true })
            "
          ></textarea>
        </div>
      </div>
    </TransitionGroup>
  </div>
  <PositionEditor
    v-if="posEditing !== null"
    :start="posEditing"
    :characters="characters"
    :version="model"
    :params="params"
    :image="image"
    @close="posEditing = null"
  />
</template>

<style scoped>
/* 删除角色时离场卡片按容器定位 */
.char-field {
  position: relative;
}
</style>
