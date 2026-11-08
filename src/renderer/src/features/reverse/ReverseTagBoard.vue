<script setup lang="ts">
/**
 * 识别结果的标签板：识别出的标签按类别排好、默认全部使用，
 * 识别错的、不想要的点一下划掉（再点恢复）；完整文本收在「编辑文本」里，只作兜底微调。
 * 数据仍是原来的两段文字：画面内容（content）和主提示词里的角色标签（characterText）。
 */
import { computed, ref } from 'vue'
import { SnippetButton } from '../prompts/public/components'
import Icon from '../../shared/ui/Icon.vue'
import { TAG_GROUPS, tagGroup, type TagGroup } from './tag-groups'

const props = defineProps<{
  /** 达到阈值的画面标签（按分数排序） */
  tags: string[]
  /** 达到阈值的角色候选 */
  characterTags: string[]
  busy: boolean
}>()
const content = defineModel<string>('content', { required: true })
const characterText = defineModel<string>('characterText', { required: true })
const editing = ref(false)

function split(text: string) {
  return text
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}
function unique(values: string[]) {
  return [...new Set(values)]
}
const contentTokens = computed(() => new Set(split(content.value)))
const characterTokens = computed(() => new Set(split(characterText.value)))

interface Chip {
  name: string
  on: boolean
  manual: boolean
}
const characterChips = computed<Chip[]>(() => {
  const recognized = new Set(props.characterTags)
  return unique([...props.characterTags, ...characterTokens.value]).map((name) => ({
    name,
    on: characterTokens.value.has(name),
    manual: !recognized.has(name),
  }))
})
const groups = computed(() => {
  const recognized = new Set(props.tags)
  const chips: Chip[] = unique([...props.tags, ...contentTokens.value]).map((name) => ({
    name,
    on: contentTokens.value.has(name),
    manual: !recognized.has(name),
  }))
  const byGroup = new Map<TagGroup, Chip[]>()
  for (const chip of chips) {
    const key = tagGroup(chip.name)
    byGroup.set(key, [...(byGroup.get(key) ?? []), chip])
  }
  return TAG_GROUPS.filter((group) => byGroup.has(group.key)).map((group) => ({
    ...group,
    chips: byGroup.get(group.key)!,
  }))
})
const usedCount = computed(() => contentTokens.value.size + characterTokens.value.size)
const totalCount = computed(
  () =>
    characterChips.value.length + groups.value.reduce((sum, group) => sum + group.chips.length, 0),
)

function toggle(text: string, name: string, on: boolean) {
  const tokens = split(text)
  return (on ? tokens.filter((token) => token !== name) : [...tokens, name]).join(', ')
}
function toggleContent(chip: Chip) {
  if (!props.busy) {
    content.value = toggle(content.value, chip.name, chip.on)
  }
}
function toggleCharacter(chip: Chip) {
  if (!props.busy) {
    characterText.value = toggle(characterText.value, chip.name, chip.on)
  }
}
function toggleEditing() {
  editing.value = !editing.value
}
</script>

<template>
  <div class="tag-board">
    <p class="tag-board-hint">
      <span class="tag-board-count">已用 {{ usedCount }} / {{ totalCount }}</span>
      <button
        class="tag-board-edit"
        :class="{ on: editing }"
        :aria-expanded="editing"
        title="以文本方式查看和微调画面内容"
        @click="toggleEditing"
      >
        <Icon
          name="edit"
          :size="12"
        />编辑文本
      </button>
    </p>
    <section
      v-if="characterChips.length"
      class="tag-group"
    >
      <h4>角色</h4>
      <div class="tag-chips">
        <button
          v-for="chip in characterChips"
          :key="chip.name"
          class="tag-chip character"
          :class="{ off: !chip.on, manual: chip.manual }"
          :disabled="busy"
          :aria-pressed="chip.on"
          :title="chip.on ? '点击划掉' : '点击恢复'"
          @click="toggleCharacter(chip)"
        >
          {{ chip.name }}
        </button>
      </div>
    </section>
    <section
      v-for="group in groups"
      :key="group.key"
      class="tag-group"
    >
      <h4>{{ group.label }}</h4>
      <div class="tag-chips">
        <button
          v-for="chip in group.chips"
          :key="chip.name"
          class="tag-chip"
          :class="{ off: !chip.on, manual: chip.manual }"
          :disabled="busy"
          :aria-pressed="chip.on"
          :title="chip.on ? '点击划掉' : '点击恢复'"
          @click="toggleContent(chip)"
        >
          {{ chip.name }}
        </button>
      </div>
    </section>
    <div
      v-if="editing"
      class="tag-board-text"
    >
      <SnippetButton :disabled="busy" />
      <textarea
        id="reverse-content"
        v-model="content"
        :disabled="busy"
        rows="3"
        placeholder="画面内容标签"
        spellcheck="false"
      />
    </div>
  </div>
</template>

<style scoped>
.tag-board {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

.tag-board-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--muted);
  font-size: 11px;
}

.tag-board-count {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.tag-group {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}

.tag-group h4 {
  margin: 0;
  padding-top: 5px;
  color: var(--text2);
  font-size: 11.5px;
  font-weight: 600;
}

.tag-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  min-width: 0;
}

.tag-chip {
  max-width: 100%;
  height: 26px;
  padding: 0 10px;
  overflow: hidden;
  border: 1px solid var(--line2);
  border-radius: 999px;
  color: var(--text);
  background: var(--bg);
  font: 11.5px/24px var(--mono);
  text-overflow: ellipsis;
  white-space: nowrap;
  transition:
    color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    opacity var(--dur-fast) var(--ease-out);
}

.tag-chip:hover:not(:disabled) {
  border-color: var(--pink-line);
}

.tag-chip.character {
  border-color: var(--pink-line);
  color: var(--pink-deep);
  background: var(--pink-soft);
}

/* 手动补充的标签用虚线边框区分 */
.tag-chip.manual {
  border-style: dashed;
}

/* 划掉的标签：变灰加删除线，仍留在原位可恢复 */
.tag-chip.off {
  border-color: var(--line);
  color: var(--muted);
  background: var(--panel);
  text-decoration: line-through;
  opacity: 0.75;
}

.tag-board-edit {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  border-radius: 8px;
  color: var(--muted);
  font-size: 11.5px;
  transition:
    color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out);
}

.tag-board-edit:hover,
.tag-board-edit.on {
  color: var(--pink-deep);
  background: var(--pink-soft);
}

.tag-board-text textarea {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--text);
  background: var(--bg);
  font: 12px/1.7 var(--mono);
  resize: none;
  field-sizing: content;
  overflow: hidden;
  user-select: text;
}
</style>
