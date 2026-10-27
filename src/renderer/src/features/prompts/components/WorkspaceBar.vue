<script setup lang="ts">
import { promptState } from '../state'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { toast, copy } from '../../../shared/lib/notifications'
import {
  importPrompt,
  clearWorkspace,
  restoreHistory,
  undoWorkspace,
  sectionText,
} from '../actions'
import { cleanErr } from '../../../shared/lib/format'
import { readPngPrompt } from '../png-import'
import { parsePromptText } from '@shared/prompts/import'
import Icon from '../../../shared/ui/Icon.vue'

/** 当前提示词的工具条：概况 + 导入 / 历史 / 复制 / 清空。各页面共用同一份提示词 */
const count = (text: string) => text.split(/[,\n]/).filter((text2) => text2.trim()).length
const chars = computed(
  () => promptState.characters.filter((character) => character.prompt.trim()).length,
)
const summary = computed(() => {
  const parts = [`主 ${count(promptState.prompt)}`]
  if (chars.value) {
    parts.push(`${chars.value} 个角色`)
  }
  parts.push(`负面 ${count(promptState.negative)}`)
  return parts.join(' · ')
})

const fileInput = ref<HTMLInputElement>()
const open = ref(false)
const root = ref<HTMLElement>()

async function pasteClipboard() {
  const text = await window.api.readClipboard()
  if (!text.trim()) {
    return toast('剪贴板里没有文字')
  }
  importPrompt(parsePromptText(text), '已导入')
}

async function onFilePicked(event2: Event) {
  const input = event2.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) {
    return
  }
  try {
    importPrompt(await readPngPrompt(file), '已读取原图')
  } catch (error) {
    toast(cleanErr(error))
  }
}

function pick(i: number) {
  restoreHistory(i)
  open.value = false
}

function onDocClick(event2: MouseEvent) {
  if (open.value && root.value && !root.value.contains(event2.target as Node)) {
    open.value = false
  }
}
onMounted(() => document.addEventListener('mousedown', onDocClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick))

const fmt = (t: number) =>
  new Date(t).toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
const preview = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 60) || '（空）'
</script>

<template>
  <div
    ref="root"
    class="work-bar"
  >
    <span class="group-badge pink"
      ><Icon
        name="paste"
        :size="15"
    /></span>
    <div class="work-text">
      <b title="各页面共用，可拖入 NovelAI 原图">当前提示词</b>
      <span>{{ summary }}</span>
    </div>
    <div class="actions">
      <button
        class="btn small primary"
        title="从剪贴板导入分节文本或元数据"
        @click="pasteClipboard"
      >
        <Icon
          name="paste"
          :size="14"
        />粘贴
      </button>
      <button
        class="icon-btn sm"
        title="读取 NovelAI 原图"
        @click="fileInput?.click()"
      >
        <Icon
          name="image"
          :size="15"
        />
      </button>
      <button
        :class="['icon-btn sm', { on: open }]"
        title="历史版本"
        @click="open = !open"
      >
        <Icon
          name="book"
          :size="15"
        />
      </button>
      <button
        class="icon-btn sm"
        title="复制全部（分节文本）"
        @click="
          copy(
            sectionText({
              base: promptState.prompt,
              negative: promptState.negative,
              characters: promptState.characters,
            }),
          )
        "
      >
        <Icon
          name="copy"
          :size="15"
        />
      </button>
      <button
        class="icon-btn sm"
        title="清空（可在历史里找回）"
        @click="clearWorkspace"
      >
        <Icon
          name="trash"
          :size="15"
        />
      </button>
    </div>
    <input
      ref="fileInput"
      type="file"
      accept="image/png"
      hidden
      @change="onFilePicked"
    />

    <transition name="pop-menu">
      <div
        v-if="open"
        class="history-menu"
      >
        <div class="history-head">
          <b>历史版本</b>
          <span class="muted small">整体替换前会自动保存，最多 30 条</span>
          <button
            class="btn ghost small ml-auto"
            :disabled="!promptState.history.length"
            @click="(undoWorkspace(), (open = false))"
          >
            <Icon
              name="swap"
              :size="13"
            />撤销上一次
          </button>
        </div>
        <div
          v-if="promptState.history.length"
          class="history-list"
        >
          <button
            v-for="(h, index) in promptState.history"
            :key="h.at + '-' + index"
            class="history-item"
            @click="pick(index)"
          >
            <span class="history-meta">
              <span class="pill">{{ h.label }}</span>
              <span class="muted small">{{ fmt(h.at) }}</span>
              <span
                v-if="h.characters.length"
                class="muted small"
                >{{ h.characters.length }} 个角色</span
              >
            </span>
            <span class="history-preview">{{ preview(h.base) }}</span>
          </button>
        </div>
        <div
          v-else
          class="muted small history-empty"
        >
          还没有历史版本。导入、采用 AI 结果、清空之前都会自动存一份
        </div>
      </div>
    </transition>
  </div>
</template>
