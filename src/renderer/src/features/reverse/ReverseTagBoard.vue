<script setup lang="ts">
/** 原有的语义分组保持不变；标签只读，不改动反推结果。 */
import { computed } from 'vue'
import { TAG_GROUPS, tagGroup } from './tag-groups'

const props = defineProps<{
  tags: string[]
  characterTags: string[]
}>()
const characters = computed(() => [...new Set(props.characterTags)])
const groups = computed(() => {
  const tags = [...new Set(props.tags)]
  return TAG_GROUPS.map((group) => ({
    ...group,
    tags: tags.filter((tag) => tagGroup(tag) === group.key),
  })).filter((group) => group.tags.length)
})
</script>

<template>
  <div
    class="tag-board"
    aria-label="画面标签分类"
  >
    <section
      v-if="characters.length"
      class="tag-group"
    >
      <h4>角色</h4>
      <div class="tag-chips">
        <span
          v-for="tag in characters"
          :key="tag"
          class="tag-chip character"
          :title="tag"
          >{{ tag }}</span
        >
      </div>
    </section>
    <section
      v-for="group in groups"
      :key="group.key"
      class="tag-group"
    >
      <h4>{{ group.label }}</h4>
      <div class="tag-chips">
        <span
          v-for="tag in group.tags"
          :key="tag"
          class="tag-chip"
          :title="tag"
          >{{ tag }}</span
        >
      </div>
    </section>
  </div>
</template>

<style scoped>
.tag-board {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
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
  user-select: text;
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

.tag-chip.character {
  border-color: var(--pink-line);
  color: var(--pink-deep);
  background: var(--pink-soft);
}
</style>
