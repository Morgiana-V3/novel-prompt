<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import type { TagInfo } from '@shared/tags/types'
import { CATEGORY_LABEL } from '@shared/tags/types'
import { CAT_CLASS } from '../state'
import { fmtCount } from '../../../shared/lib/format'
import { toast } from '../../../shared/lib/notifications'
import Icon from '../../../shared/ui/Icon.vue'

const props = defineProps<{
  tag: TagInfo
  editable?: boolean
  viaAlias?: string
  weight?: number
  prefix?: string
  index?: number
}>()
const emit = defineEmits<{ (eventName: 'click'): void; (eventName: 'updated'): void }>()

const savedTranslation = ref<{ name: string; text: string } | null>(null)
const displayedTranslation = computed(() =>
  savedTranslation.value?.name === props.tag.name ? savedTranslation.value.text : props.tag.zh,
)
const editing = ref(false)
const draft = ref('')
const input = ref<HTMLInputElement>()

/** 双击中文会先触发两次 click，这里在中文区域延迟单击，避免误触发「加入提示词」等动作 */
let clickTimer: ReturnType<typeof setTimeout> | undefined
function onClick(event2: MouseEvent) {
  if (editing.value) {
    return
  }
  const onZh = props.editable && (event2.target as HTMLElement).closest('.tag-zh')
  if (!onZh) {
    return emit('click')
  }
  if (event2.detail > 1) {
    return
  }
  clearTimeout(clickTimer)
  clickTimer = setTimeout(() => emit('click'), 260)
}
onBeforeUnmount(() => clearTimeout(clickTimer))

async function startEdit() {
  if (!props.editable) {
    return
  }
  clearTimeout(clickTimer)
  draft.value = displayedTranslation.value ?? ''
  editing.value = true
  await nextTick()
  input.value?.focus()
  input.value?.select()
}
async function commit() {
  if (!editing.value) {
    return
  }
  editing.value = false
  if (draft.value === (displayedTranslation.value ?? '')) {
    return
  }
  await window.api.setZh(props.tag.name, draft.value)
  savedTranslation.value = { name: props.tag.name, text: draft.value }
  toast('翻译已保存')
  emit('updated')
}
</script>

<template>
  <div
    :class="['tag-card', CAT_CLASS[tag.category]]"
    :style="{ '--i': Math.min(index ?? 0, 24) }"
    @click="onClick"
  >
    <div class="tag-top">
      <span
        class="tag-en"
        :title="(prefix ?? '') + tag.display"
      >
        <span
          v-if="prefix"
          class="tag-prefix"
          >{{ prefix }}</span
        >{{ tag.display }}
      </span>
      <span
        v-if="weight !== undefined && weight !== 1"
        :class="['tag-weight', { neg: weight < 1 }]"
        >×{{ weight }}</span
      >
      <span
        v-if="viaAlias"
        class="tag-via"
        :title="`通过别名「${viaAlias}」匹配`"
      >
        <Icon
          name="swap"
          :size="11"
          :stroke="2"
        /><span class="tag-via-text">{{ viaAlias }}</span>
      </span>
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
      <span
        v-else
        :class="['tag-zh', { none: !displayedTranslation }]"
        :title="displayedTranslation"
        @dblclick.stop="startEdit"
      >
        <span class="tag-zh-text">{{ displayedTranslation || '暂无翻译' }}</span>
        <button
          v-if="editable"
          class="edit-hint"
          title="编辑中文"
          @click.stop="startEdit"
        >
          <Icon
            name="edit"
            :size="12"
          />
        </button>
      </span>
      <span class="tag-cat">
        {{ CATEGORY_LABEL[tag.category]
        }}<template v-if="tag.count"> · {{ fmtCount(tag.count) }}</template
        ><template v-if="tag.versions && tag.versions.length < 2">
          · {{ tag.versions[0].toUpperCase() }}</template
        >
      </span>
    </div>
  </div>
</template>
