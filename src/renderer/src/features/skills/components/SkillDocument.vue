<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue'
import type { SkillResource } from '@shared/skills/types'
import MarkdownText from '../../../shared/ui/MarkdownText.vue'
import { resolveSkillLink, skillImageUrl } from '../links'

const MarkdownEditor = defineAsyncComponent(() => import('../../../shared/ui/MarkdownEditor.vue'))
const props = defineProps<{ modelValue: string; resources: SkillResource[]; readonly?: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [text: string]
  'update:resources': [resources: SkillResource[]]
}>()
const selectedPath = ref('SKILL.md')
// Keep the last Markdown document mounted while browsing images, preserving undo history.
const sourcePath = ref('SKILL.md')
const mode = ref(props.readonly ? 'preview' : 'split')
const editorStarted = ref(!props.readonly)
const notice = ref('')
const preview = ref<HTMLDivElement>()
const selected = computed(() =>
  props.resources.find((resource) => resource.path === selectedPath.value),
)
const imageUrl = computed(() => skillImageUrl(selected.value))
const text = computed({
  get: () =>
    sourcePath.value === 'SKILL.md'
      ? props.modelValue
      : (props.resources.find((resource) => resource.path === sourcePath.value)?.content ?? ''),
  set: (content: string) => {
    if (props.readonly) {
      return
    }
    if (sourcePath.value === 'SKILL.md') {
      emit('update:modelValue', content)
    } else {
      emit(
        'update:resources',
        props.resources.map((resource) =>
          resource.path === sourcePath.value ? { ...resource, content } : resource,
        ),
      )
    }
  },
})
const modes = computed(() =>
  props.readonly
    ? [
        { value: 'preview', label: '预览' },
        { value: 'source', label: '源码' },
      ]
    : [
        { value: 'source', label: '编辑' },
        { value: 'preview', label: '预览' },
        { value: 'split', label: '分栏' },
      ],
)
watch(mode, (value) => {
  if (value !== 'preview') {
    editorStarted.value = true
  }
})
const documentOptions = computed(() => ({
  localLinks: true,
  resolveImage: (href: string) => {
    const target = resolveSkillLink(selectedPath.value, href)
    return skillImageUrl(
      props.resources.find(
        (resource) => target && resource.path.toLowerCase() === target.path.toLowerCase(),
      ),
    )
  },
}))

function select(path: string): void {
  selectedPath.value = path
  if (props.resources.find((resource) => resource.path === path)?.kind !== 'image') {
    sourcePath.value = path
  }
  notice.value = ''
}

async function openLink(href: string): Promise<void> {
  const target = resolveSkillLink(selectedPath.value, href)
  const path =
    target?.path.toLowerCase() === 'skill.md'
      ? 'SKILL.md'
      : props.resources.find(
          (resource) => resource.path.toLowerCase() === target?.path.toLowerCase(),
        )?.path
  if (!target || !path) {
    notice.value = `找不到包内文件：${href}`
    return
  }
  select(path)
  await nextTick()
  if (target.anchor) {
    const heading = [...(preview.value?.querySelectorAll('[id]') ?? [])].find(
      (element) => element.id === target.anchor,
    )
    if (heading) {
      heading.scrollIntoView({ block: 'start' })
    } else {
      notice.value = `已打开文件，但没有找到章节：${target.anchor}`
    }
  } else {
    preview.value?.scrollTo(0, 0)
  }
}

function add(): void {
  const path = prompt('参考资料相对路径，例如 references/角色处理.md')?.trim()
  if (!path) {
    return
  }
  if (
    !/\.md$/i.test(path) ||
    path.toLowerCase() === 'skill.md' ||
    !resolveSkillLink('SKILL.md', path) ||
    props.resources.some((resource) => resource.path.toLowerCase() === path.toLowerCase())
  ) {
    notice.value = '请输入不重复的包内 Markdown 相对路径'
    return
  }
  emit('update:resources', [
    ...props.resources,
    { path, kind: 'markdown', content: '# 参考资料\n' },
  ])
  select(path)
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
  if (
    path.toLowerCase() === 'skill.md' ||
    !resolveSkillLink('SKILL.md', path) ||
    props.resources.some((item) => item.path.toLowerCase() === path.toLowerCase())
  ) {
    notice.value = '请输入不重复的包内相对路径'
    return
  }
  emit(
    'update:resources',
    props.resources.map((item) => (item.path === resource.path ? { ...item, path } : item)),
  )
  select(path)
}

function remove(): void {
  if (
    !selected.value ||
    !confirm(`删除 ${selectedPath.value}？请同步处理引用此文件的链接。保存后生效。`)
  ) {
    return
  }
  emit(
    'update:resources',
    props.resources.filter((resource) => resource.path !== selectedPath.value),
  )
  select('SKILL.md')
}
</script>

<template>
  <div class="skill-document">
    <aside
      class="skill-document-files"
      aria-label="Skill 文件列表"
    >
      <button
        class="skill-document-file"
        :class="{ selected: selectedPath === 'SKILL.md' }"
        @click="select('SKILL.md')"
      >
        SKILL.md<span>入口</span>
      </button>
      <button
        v-for="resource in resources"
        :key="resource.path"
        class="skill-document-file"
        :class="{ selected: selectedPath === resource.path }"
        :title="resource.path"
        @click="select(resource.path)"
      >
        {{ resource.path }}
      </button>
      <button
        v-if="!readonly"
        class="btn ghost small"
        @click="add"
      >
        ＋ 新增参考
      </button>
    </aside>
    <section class="skill-document-main">
      <div class="skill-document-toolbar">
        <span
          class="skill-document-path"
          :title="selectedPath"
          >{{ selectedPath }}</span
        >
        <div
          v-if="!imageUrl"
          class="seg"
          aria-label="Markdown 显示模式"
        >
          <button
            v-for="item in modes"
            :key="item.value"
            :class="{ on: mode === item.value }"
            :aria-pressed="mode === item.value"
            @click="mode = item.value"
          >
            {{ item.label }}
          </button>
        </div>
        <template v-if="selected && !readonly">
          <button
            class="btn ghost small"
            @click="rename"
          >
            重命名
          </button>
          <button
            class="btn ghost small"
            @click="remove"
          >
            删除
          </button>
        </template>
      </div>
      <p
        v-if="notice"
        class="skill-document-notice"
        role="status"
      >
        {{ notice }}
      </p>
      <div
        class="skill-document-panes"
        :class="{ split: mode === 'split' && !imageUrl }"
      >
        <MarkdownEditor
          v-if="editorStarted"
          v-show="mode !== 'preview' && !imageUrl"
          v-model="text"
          :document-path="sourcePath"
          :readonly="readonly"
        />
        <div
          v-show="mode !== 'source' || imageUrl"
          ref="preview"
          class="skill-document-preview"
        >
          <img
            v-if="imageUrl"
            :src="imageUrl"
            :alt="selectedPath"
            class="skill-document-image"
          />
          <MarkdownText
            v-else
            :text="text"
            :document-options="documentOptions"
            @local-link="openLink"
          />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.skill-document {
  container-type: inline-size;
  display: flex;
  flex: 1;
  min-height: 180px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 10px;
}

.skill-document-files {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 160px;
  flex-shrink: 0;
  padding: 8px;
  overflow: auto;
  border-right: 1px solid var(--line);
  background: var(--panel);
}

.skill-document-file {
  padding: 8px;
  border-radius: 6px;
  text-align: left;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.skill-document-file span {
  display: block;
  margin-top: 3px;
  font-size: 10px;
  color: var(--muted);
}

.skill-document-file.selected {
  background: var(--pink-soft);
  color: var(--pink-deep);
}

.skill-document-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.skill-document-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--line);
}

.skill-document-path {
  flex: 1;
  min-width: 50px;
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
}

.skill-document-panes {
  display: grid;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  grid-template-columns: minmax(0, 1fr);
}

.skill-document-panes.split {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.skill-document-preview {
  min-width: 0;
  overflow: auto;
  padding: 18px;
  font-size: 13px;
  background: var(--bg);
}

.split .skill-document-preview {
  border-left: 1px solid var(--line);
}

.skill-document-preview :deep(h1) {
  font-size: 1.5em;
}

.skill-document-preview :deep(h2) {
  font-size: 1.25em;
}

.skill-document-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.skill-document-notice {
  margin: 0;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text2);
  background: var(--panel);
}

@container (max-width: 650px) {
  .skill-document-files {
    width: 120px;
  }

  .skill-document-panes.split {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: repeat(2, minmax(0, 1fr));
  }

  .split .skill-document-preview {
    border-top: 1px solid var(--line);
    border-left: 0;
  }
}
</style>
