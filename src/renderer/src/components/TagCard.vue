<script setup lang="ts">
import { nextTick, ref } from 'vue'
import type { TagInfo } from '@shared/types'
import { CATEGORY_LABEL } from '@shared/types'
import { CAT_CLASS, fmtCount, toast } from '../store'
import Icon from './Icon.vue'

const props = defineProps<{
  tag: TagInfo
  editable?: boolean
  viaAlias?: string
  weight?: number
  prefix?: string
  index?: number
}>()
const emit = defineEmits<{ (e: 'click'): void; (e: 'updated'): void }>()

const editing = ref(false)
const draft = ref('')
const input = ref<HTMLInputElement>()

async function startEdit() {
  if (!props.editable) return
  draft.value = props.tag.zh ?? ''
  editing.value = true
  await nextTick()
  input.value?.focus()
  input.value?.select()
}
async function commit() {
  if (!editing.value) return
  editing.value = false
  if (draft.value === (props.tag.zh ?? '')) return
  await window.api.setZh(props.tag.name, draft.value)
  props.tag.zh = draft.value || undefined
  toast('翻译已保存')
  emit('updated')
}
</script>

<template>
  <div
    :class="['tag-card', CAT_CLASS[tag.category]]"
    :style="{ '--i': Math.min(index ?? 0, 24) }"
    @click="emit('click')"
  >
    <div class="tag-top">
      <span class="tag-en" :title="tag.display">
        <span v-if="prefix" class="tag-prefix">{{ prefix }}</span>{{ tag.display }}
      </span>
      <span v-if="weight !== undefined && weight !== 1" :class="['tag-weight', { neg: weight < 1 }]">×{{ weight }}</span>
    </div>
    <div class="tag-bottom">
      <input
        v-if="editing"
        ref="input"
        v-model="draft"
        class="zh-input"
        placeholder="输入中文翻译"
        @click.stop
        @keydown.enter="commit"
        @keydown.esc="editing = false"
        @blur="commit"
      />
      <span v-else :class="['tag-zh', { none: !tag.zh }]" @dblclick.stop="startEdit">
        {{ tag.zh || '暂无翻译' }}
        <button v-if="editable" class="edit-hint" title="编辑中文" @click.stop="startEdit">
          <Icon name="edit" :size="12" />
        </button>
      </span>
      <span class="tag-cat">
        {{ CATEGORY_LABEL[tag.category] }}<template v-if="tag.count"> · {{ fmtCount(tag.count) }}</template
        ><template v-if="tag.versions && tag.versions.length < 2"> · {{ tag.versions[0].toUpperCase() }}</template>
      </span>
    </div>
    <div v-if="viaAlias" class="tag-alias">别名：{{ viaAlias }}</div>
  </div>
</template>
