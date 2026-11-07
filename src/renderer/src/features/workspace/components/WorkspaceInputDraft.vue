<script setup lang="ts">
import { computed, ref } from 'vue'
import type { NaiGenParams, NaiVersion } from '@shared/generation/types'
import type { InpaintDraft } from '@shared/prompts/types'
import { recordParameters } from '../record-parameters'

const props = defineProps<{
  title: string
  draft: InpaintDraft
  params: NaiGenParams
  model?: NaiVersion
  strength?: number
  expanded?: boolean
}>()
const isOpen = ref(!!props.expanded)
const parameters = computed(() => recordParameters(props.params, props.model))

function toggle(event: Event) {
  isOpen.value = (event.currentTarget as HTMLDetailsElement).open
}
</script>

<template>
  <details
    class="pw-input-draft"
    :open="expanded"
    @toggle="toggle"
  >
    <summary class="disclosure">{{ title }}</summary>
    <div
      v-if="isOpen"
      class="pw-input-draft-body"
    >
      <b>主提示词</b>
      <pre>{{ draft.base || '（空）' }}</pre>
      <b>负面提示词</b>
      <pre>{{ draft.negative || '（空）' }}</pre>
      <p v-if="!draft.characters.length">角色：无</p>
      <section
        v-for="(character, index) in draft.characters"
        :key="index"
      >
        <b>角色 {{ index + 1 }}</b>
        <pre>{{ character.prompt || '（空）' }}</pre>
        <span>角色负面</span>
        <pre>{{ character.negative ?? '（未指定）' }}</pre>
        <span>位置</span>
        <pre>{{ character.position || '自动' }}</pre>
      </section>
      <dl>
        <template
          v-for="[label, value] in parameters"
          :key="label"
        >
          <dt>{{ label }}</dt>
          <dd>{{ value }}</dd>
        </template>
        <template v-if="strength !== undefined">
          <dt>重绘强度</dt>
          <dd>{{ strength }}</dd>
        </template>
      </dl>
    </div>
  </details>
</template>

<style scoped>
.pw-input-draft {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text2);
  overflow-wrap: anywhere;
}

.pw-input-draft summary {
  cursor: pointer;
}

.pw-input-draft-body {
  display: grid;
  gap: 5px;
  min-width: 0;
  margin-top: 8px;
}

.pw-input-draft-body pre {
  max-height: 240px;
  margin: 0 0 6px;
  padding: 7px 9px;
  overflow: auto;
  font: inherit;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--bg);
  border: 1px solid var(--line2);
  border-radius: 6px;
}

.pw-input-draft-body p {
  margin: 0;
}

.pw-input-draft-body dl {
  display: grid;
  grid-template-columns: minmax(70px, auto) minmax(0, 1fr);
  gap: 3px 10px;
  margin: 4px 0 0;
}

.pw-input-draft-body dt {
  color: var(--muted);
}

.pw-input-draft-body dd {
  margin: 0;
}
</style>
