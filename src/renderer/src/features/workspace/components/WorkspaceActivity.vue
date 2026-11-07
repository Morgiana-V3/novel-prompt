<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { PageVersion } from '@shared/workspace/model'
import { workspaceActivityLabel, type WorkspaceActivityEntry } from '../conversation-feed'

const props = defineProps<{
  entries: WorkspaceActivityEntry[]
  versions: PageVersion[]
  editingPrompt: boolean
  label: (id: string) => string
  time: (at: number) => string
}>()
const emit = defineEmits<{ view: [id: string]; message: [id: string] }>()
const details = ref<HTMLDetailsElement>()
const isOpen = ref(false)
const versionIds = computed(() => new Set(props.versions.map((version) => version.id)))
const latest = computed(() => props.entries.at(-1))

function toggle(event: Event) {
  isOpen.value = (event.currentTarget as HTMLDetailsElement).open
}

async function showMessage(id: string): Promise<HTMLElement | null> {
  if (!props.entries.some((entry) => entry.message.id === id) || !details.value) {
    return null
  }
  isOpen.value = true
  details.value.open = true
  await nextTick()
  const messageElement = document.getElementById(`workspace-message-${id}`)
  return messageElement && details.value?.contains(messageElement) ? messageElement : null
}

defineExpose({ showMessage })
</script>

<template>
  <details
    v-if="entries.length"
    ref="details"
    class="pw-activity"
    @toggle="toggle"
  >
    <summary class="disclosure">
      <span>操作记录 · {{ entries.length }}</span>
      <small v-if="latest">最近：{{ workspaceActivityLabel(latest.event) }}</small>
    </summary>
    <ol v-if="isOpen">
      <li
        v-for="entry in entries"
        :id="`workspace-message-${entry.message.id}`"
        :key="entry.message.id"
        tabindex="-1"
      >
        <div class="pw-activity-meta">
          <b>{{ workspaceActivityLabel(entry.event) }}</b>
          <time>{{ time(entry.message.createdAt) }}</time>
        </div>
        <p>{{ entry.message.text }}</p>
        <div class="pw-activity-links">
          <button
            v-if="versionIds.has(entry.message.versionId)"
            :disabled="editingPrompt"
            @click="emit('view', entry.message.versionId)"
          >
            {{ label(entry.message.versionId) }}
          </button>
          <button
            v-if="entry.event.type === 'proposal'"
            @click="emit('message', entry.event.messageId)"
          >
            查看方案
          </button>
        </div>
      </li>
    </ol>
  </details>
</template>

<style scoped>
.pw-activity {
  margin: 16px 0;
  padding: 10px 12px;
  font-size: 11px;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--line2);
  border-radius: 9px;
  overflow-wrap: anywhere;
}

.pw-activity summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  cursor: pointer;
}

.pw-activity summary small {
  font-size: 10px;
}

.pw-activity ol {
  display: grid;
  gap: 12px;
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
}

.pw-activity li {
  min-width: 0;
  padding-left: 9px;
  border-left: 2px solid var(--line2);
}

.pw-activity li:focus-visible {
  outline: 1px solid var(--pink-line);
  outline-offset: 4px;
}

.pw-activity-meta,
.pw-activity-links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.pw-activity-meta time {
  margin-left: auto;
  font-size: 10px;
}

.pw-activity p {
  margin: 4px 0;
  white-space: pre-wrap;
  color: var(--text2);
}

.pw-activity-links button {
  font-size: 10px;
  color: var(--pink-deep);
}
</style>
