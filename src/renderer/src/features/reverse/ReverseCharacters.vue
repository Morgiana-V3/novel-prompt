<script setup lang="ts">
/**
 * 角色卡片：只在多人图（或已自动建好角色）时出现在识别结果里。
 * 能认出名字的角色识别后自动建好；认不出时框选一个人物，识别后自动新建角色或补进同名角色。
 * 这里只负责查看、微调和删除，不提供手动新建或主提示词角色输入。
 */
import { SnippetButton } from '../prompts/public/components'
import { type CharDraft } from '../prompts/public/draft'
import Icon from '../../shared/ui/Icon.vue'

const props = defineProps<{
  busy: boolean
  cropping: boolean
}>()
const emit = defineEmits<{ crop: [] }>()
const threshold = defineModel<number>('threshold', { required: true })
const characters = defineModel<CharDraft[]>('characters', { required: true })

function startCrop() {
  emit('crop')
}
function remove(index: number) {
  if (!props.busy) {
    characters.value = characters.value.filter((_, i) => i !== index)
  }
}
</script>

<template>
  <section
    class="reverse-characters"
    aria-label="角色"
  >
    <header>
      <strong>角色</strong>
      <small v-if="characters.length">{{ characters.length }} 个</small>
      <label title="框选识别时角色候选的最低分数"
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

    <TransitionGroup
      tag="div"
      name="list"
      class="character-list list-motion"
    >
      <div
        v-for="(role, index) in characters"
        :key="index"
        class="character-block"
      >
        <label :for="`reverse-role-${index}`">角色 {{ index + 1 }}</label>
        <button
          class="icon-btn sm"
          :aria-label="`移除角色 ${index + 1}`"
          title="移除这个角色"
          :disabled="busy"
          @click="remove(index)"
        >
          <Icon
            name="trash"
            :size="13"
          />
        </button>
        <SnippetButton :disabled="busy" />
        <textarea
          :id="`reverse-role-${index}`"
          v-model="role.prompt"
          :aria-label="`反推角色 ${index + 1} 提示词`"
          rows="1"
          :disabled="busy"
          spellcheck="false"
        />
      </div>
    </TransitionGroup>

    <div class="character-split">
      <span v-if="!characters.length">检测到多个人物</span>
      <button
        class="btn small"
        title="在参考图上框住一个人，识别后自动建成角色并填好外观；同名角色会补进已有角色"
        :class="{ primary: !characters.length }"
        :disabled="busy || cropping || characters.length >= 6"
        @click="startCrop"
      >
        <Icon
          name="select"
          :size="13"
        />{{ cropping ? '在参考图上框选…' : '框选人物' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.reverse-characters {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding-bottom: 12px;
  border: 1px solid var(--line2);
  border-radius: 8px;
  background: var(--bg);
  overflow: hidden;
}

header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
  white-space: nowrap;
}

header small {
  color: var(--muted);
}

header label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  color: var(--text2);
}

header input,
textarea {
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--line2);
  border-radius: 8px;
  padding: 6px 8px;
  outline: none;
  transition: border-color var(--dur-base) var(--ease-out);
}

header input {
  width: 64px;
  height: 28px;
}

header input:focus,
textarea:focus {
  border-color: var(--pink-line);
}

textarea:disabled {
  background: var(--panel);
  color: var(--muted);
}

.character-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 12px;
}

.character-list:empty {
  display: none;
}

.character-block {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px 10px 10px;
  border: 1px solid var(--pink-line);
  border-radius: 10px;
}

.character-block label {
  flex: 1;
  font-size: 12px;
  font-weight: 600;
}

textarea {
  width: 100%;
  resize: none;
  field-sizing: content;
  overflow: hidden;
  font: 12px/1.6 var(--mono);
  user-select: text;
}

.character-split {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 12px;
}

.character-split span {
  color: var(--text2);
  font-size: 12px;
}

.character-split .btn:first-child {
  margin-left: 0;
}

.character-split .btn {
  flex-shrink: 0;
  gap: 5px;
}
</style>
