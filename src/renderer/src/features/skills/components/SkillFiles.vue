<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SkillResource } from '@shared/skills/types'

const props = defineProps<{ modelValue: SkillResource[]; readonly?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [resources: SkillResource[]] }>()
const selectedPath = ref(
  props.modelValue.find((resource) => resource.kind === 'markdown')?.path ??
    props.modelValue[0]?.path ??
    '',
)
const selected = computed(() =>
  props.modelValue.find((resource) => resource.path === selectedPath.value),
)
const imageUrl = computed(() => {
  if (selected.value?.kind !== 'image') {
    return ''
  }
  const extension = selected.value.path.split('.').pop()?.toLowerCase()
  return `data:image/${extension === 'jpg' ? 'jpeg' : extension};base64,${selected.value.content}`
})
function edit(event: Event): void {
  const content = (event.target as HTMLTextAreaElement).value
  emit(
    'update:modelValue',
    props.modelValue.map((resource) =>
      resource.path === selectedPath.value ? { ...resource, content } : resource,
    ),
  )
}
function add(): void {
  const path = prompt('参考资料相对路径，例如 references/角色处理.md')?.trim()
  if (!path) {
    return
  }
  if (
    !/\.md$/i.test(path) ||
    props.modelValue.some((resource) => resource.path.toLowerCase() === path.toLowerCase())
  ) {
    alert('请输入不重复的 Markdown 文件路径')
    return
  }
  emit('update:modelValue', [
    ...props.modelValue,
    { path, kind: 'markdown', content: '# 参考资料\n' },
  ])
  selectedPath.value = path
}
function rename(): void {
  const resource = selected.value
  if (!resource) {
    return
  }
  const path = prompt('新的相对路径。请同步修改入口和参考资料中的链接。', resource.path)?.trim()
  if (!path || path === resource.path) {
    return
  }
  if (props.modelValue.some((item) => item.path.toLowerCase() === path.toLowerCase())) {
    alert('该路径已经存在')
    return
  }
  emit(
    'update:modelValue',
    props.modelValue.map((item) => (item.path === resource.path ? { ...item, path } : item)),
  )
  selectedPath.value = path
}
function remove(): void {
  if (
    !selected.value ||
    !confirm(`删除 ${selectedPath.value}？请同步处理引用此文件的链接。保存后生效。`)
  ) {
    return
  }
  emit(
    'update:modelValue',
    props.modelValue.filter((resource) => resource.path !== selectedPath.value),
  )
  selectedPath.value = ''
}
</script>

<template>
  <div class="skill-files">
    <div class="row">
      <select
        v-model="selectedPath"
        class="input"
        aria-label="参考资料文件"
      >
        <option value="">选择参考资料（{{ modelValue.length }} 个）</option>
        <option
          v-for="resource in modelValue"
          :key="resource.path"
          :value="resource.path"
        >
          {{ resource.path }}
        </option>
      </select>
      <template v-if="!readonly">
        <button
          class="btn small"
          @click="add"
        >
          新增参考
        </button>
        <button
          class="btn small"
          :disabled="!selected"
          @click="rename"
        >
          重命名
        </button>
        <button
          class="btn small"
          :disabled="!selected"
          @click="remove"
        >
          删除文件
        </button>
      </template>
    </div>
    <textarea
      v-if="selected?.kind === 'markdown'"
      :value="selected.content"
      :readonly="readonly"
      class="input skill-resource-text"
      spellcheck="false"
      aria-label="参考资料正文"
      @input="edit"
    ></textarea>
    <img
      v-else-if="selected?.kind === 'image'"
      :src="imageUrl"
      :alt="selected.path"
      class="skill-resource-image"
    />
    <p
      v-else
      class="muted small"
    >
      参考资料按入口中的条件读取。图片用于管理和预览，不会自动发送给 AI。
    </p>
  </div>
</template>

<style scoped>
.skill-files {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.skill-files select {
  flex: 1;
  min-width: 120px;
}

.skill-resource-text {
  flex: 1;
  min-height: 160px;
  resize: none;
  font-family: var(--mono);
}

.skill-resource-image {
  min-height: 0;
  max-width: 100%;
  flex: 1;
  object-fit: contain;
}
</style>
