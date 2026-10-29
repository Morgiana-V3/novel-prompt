<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ReverseResult } from '@shared/reverse/types'
import type { CharDraft } from '../prompts/state'

const props = defineProps<{
  result?: ReverseResult
  cropped: boolean
  busy: boolean
  generalThreshold: number
}>()
const threshold = defineModel<number>('threshold', { required: true })
const base = defineModel<string>('base', { required: true })
const characters = defineModel<CharDraft[]>('characters', { required: true })
const emit = defineEmits<{ adopt: [] }>()
const draft = ref('')
const target = ref('base')
const candidates = computed(() =>
  (props.result?.characters ?? []).filter((tag) => tag.score >= threshold.value),
)
watch(
  () => props.result,
  () => {
    draft.value = ''
  },
)
watch(
  () => characters.value.length,
  (length) => {
    if (target.value !== 'base' && target.value !== 'new' && Number(target.value) >= length) {
      target.value = 'base'
    }
  },
)
function append(text: string, value: string) {
  return [
    ...new Set([...text.split(', '), ...value.split(', ')].map((v) => v.trim()).filter(Boolean)),
  ].join(', ')
}
function appearance() {
  draft.value = append(
    draft.value,
    (props.result?.tags ?? [])
      .filter(
        (tag) =>
          tag.score >= props.generalThreshold && !/^(?:\d+(?:girls?|boys?)|solo)$/.test(tag.name),
      )
      .map((tag) => tag.name)
      .join(', '),
  )
}
function remove(index: number) {
  characters.value = characters.value.filter((_, i) => i !== index)
  target.value = 'base'
}
function apply() {
  if (!draft.value.trim() || props.busy) {
    return
  }
  if (target.value === 'base') {
    base.value = append(base.value, draft.value)
  } else if (target.value === 'new') {
    if (characters.value.length >= 6) {
      return
    }
    characters.value = [
      ...characters.value,
      { prompt: draft.value.trim(), negative: '', position: '' },
    ]
  } else {
    const index = Number(target.value)
    characters.value = characters.value.map((role, i) =>
      i === index ? { ...role, prompt: append(role.prompt, draft.value) } : role,
    )
  }
  draft.value = ''
}
</script>

<template>
  <section
    class="reverse-characters"
    aria-label="角色识别结果"
  >
    <header>
      <strong
        >{{ cropped ? '选区角色候选' : '全图角色候选' }} ·
        <span v-if="result?.characterModel">{{
          result.characterModel === 'pixai' ? 'PixAI' : 'WD'
        }}</span></strong
      >
      <label
        >阈值<input
          v-model.number="threshold"
          aria-label="角色标签阈值"
          type="number"
          min="0.05"
          max="1"
          step="0.05"
          :disabled="busy"
      /></label>
    </header>
    <div class="character-candidates">
      <button
        v-for="tag in candidates"
        :key="tag.name"
        class="btn small"
        :disabled="busy"
        :title="`选用 ${tag.name}`"
        @click="draft = tag.name"
      >
        {{ tag.name }} <small>{{ tag.score.toFixed(3) }}</small>
      </button>
      <p v-if="!candidates.length">
        {{
          result?.characterModel ? '没有达到阈值的角色候选' : '启用内容 / 角色或 PixAI 角色后识别'
        }}
      </p>
    </div>
    <div class="character-draft">
      <label for="reverse-character-draft">选用标签</label>
      <button
        v-if="cropped && result?.tags.length"
        class="btn small"
        :disabled="busy"
        @click="appearance"
      >
        加入局部外观标签
      </button>
      <textarea
        id="reverse-character-draft"
        v-model="draft"
        rows="3"
        :disabled="busy"
        placeholder="点击角色候选，或直接输入角色与外观标签"
        spellcheck="false"
      />
      <select
        v-model="target"
        aria-label="角色标签加入位置"
        :disabled="busy"
      >
        <option value="base">主提示词</option>
        <option
          v-for="(_, index) in characters"
          :key="index"
          :value="String(index)"
        >
          角色 {{ index + 1 }}
        </option>
        <option
          value="new"
          :disabled="characters.length >= 6"
        >
          新建角色
        </option>
      </select>
      <button
        class="btn small"
        :disabled="busy || !draft.trim() || (target === 'new' && characters.length >= 6)"
        @click="apply"
      >
        加入
      </button>
    </div>
    <div class="character-assigned">
      <label for="reverse-character-base">加入主提示词的角色标签</label>
      <textarea
        id="reverse-character-base"
        v-model="base"
        rows="2"
        :disabled="busy"
        spellcheck="false"
      />
      <div
        v-for="(role, index) in characters"
        :key="index"
        class="character-role"
      >
        <label :for="`reverse-role-${index}`">角色 {{ index + 1 }}</label>
        <button
          class="btn small"
          :aria-label="`移除角色 ${index + 1}`"
          :disabled="busy"
          @click="remove(index)"
        >
          移除
        </button>
        <textarea
          :id="`reverse-role-${index}`"
          v-model="role.prompt"
          :aria-label="`反推角色 ${index + 1} 提示词`"
          rows="2"
          :disabled="busy"
          spellcheck="false"
        />
      </div>
    </div>
    <footer>
      <span>{{
        characters.length ? `已分配 ${characters.length} 个角色` : '角色身份需自行确认'
      }}</span>
      <button
        class="btn small primary"
        :disabled="busy || (!base.trim() && !characters.some((role) => role.prompt.trim()))"
        @click="emit('adopt')"
      >
        写入提示词
      </button>
    </footer>
  </section>
</template>

<style scoped>
.reverse-characters {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--line2);
  border-radius: 8px;
  background: var(--bg);
  overflow: hidden;
}

header,
footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  font-size: 12px;
  flex-shrink: 0;
}

header {
  border-bottom: 1px solid var(--line);
}

header label {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

input {
  width: 65px;
}

input,
select,
textarea {
  color: var(--text);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 5px;
}

textarea {
  width: 100%;
  resize: vertical;
  font: 12px/1.6 var(--mono);
}

.character-candidates {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 12px;
  max-height: 160px;
  overflow: auto;
  flex-shrink: 0;
}

.character-candidates small,
p,
footer span {
  color: var(--text2);
  font-size: 11px;
}

.character-draft {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 0 12px 12px;
  font-size: 12px;
}

.character-draft > label {
  flex: 1;
}

.character-assigned {
  flex: 1;
  overflow: auto;
  min-height: 65px;
  padding: 12px;
  border-top: 1px solid var(--line);
  font-size: 12px;
}

.character-role {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
}

.character-role label {
  flex: 1;
}

footer {
  border-top: 1px solid var(--line);
  justify-content: space-between;
}
</style>
