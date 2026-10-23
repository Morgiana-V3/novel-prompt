<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { state, refreshDb, saveSettings, importPrompt, cleanErr, toast, checkUpdate, dismissUpdate, type Tab } from './store'
import { readPngPrompt } from '@shared/prompt-import'
import CompareView from './views/CompareView.vue'
import SearchView from './views/SearchView.vue'
import AiView from './views/AiView.vue'
import PreviewView from './views/PreviewView.vue'
import GenerateView from './views/GenerateView.vue'
import SettingsView from './views/SettingsView.vue'
import Icon from './components/Icon.vue'
import Mascot from './components/Mascot.vue'
import SkillPicker from './components/SkillPicker.vue'
import type { IconName } from './components/icons'
import type { NaiVersion } from '@shared/types'

/** 按工作流排序：写 → 校验 → 优化 → 推测 → 出图；搜索与设置是工具 */
const tabs: { key: Tab; label: string; icon: IconName; desc: string; tool?: boolean }[] = [
  { key: 'compare', label: '提示词比对', icon: 'compare', desc: '逐段检查主提示词、角色和负面里有没有不存在的 tag' },
  { key: 'ai', label: 'AI 优化', icon: 'sparkle', desc: '让 AI 帮你挑 tag、排顺序，采用后写回当前提示词' },
  { key: 'preview', label: '画面推测', icon: 'eye', desc: '让 AI 猜猜当前提示词会画成什么样' },
  { key: 'generate', label: '生图预览', icon: 'image', desc: '用 NovelAI 接口直接出图看效果' },
  { key: 'search', label: 'Tag 搜索', icon: 'search', desc: '中文、英文、拼音首字母都能搜，单击加到最近编辑的输入框', tool: true },
  { key: 'settings', label: '设置 / 数据', icon: 'sliders', desc: 'Danbooru 数据、DeepSeek 与 NovelAI 配置', tool: true }
]
const current = computed(() => tabs.find((t) => t.key === state.tab)!)
const busy = computed(() => !!state.progress && !['done', 'error'].includes(state.progress.stage))

onMounted(async () => {
  state.settings = await window.api.getSettings()
  await refreshDb()
  window.api.onProgress((p) => {
    state.progress = p
    if (p.stage === 'done' || p.stage === 'error') refreshDb()
  })
  if (!state.db?.loaded) state.tab = 'settings'
  // 启动 3 秒后再查，不拖慢启动；有 24 小时缓存，失败静默
  setTimeout(() => void checkUpdate(), 3000)
})

const openUpdate = () => window.api.openUpdatePage(state.update?.url ?? '')

function setVersion(v: NaiVersion) {
  saveSettings({ naiVersion: v })
}

/* ---------- 把 NovelAI 原图拖进窗口任意位置，读取里面的提示词 ---------- */
const dragDepth = ref(0)
const hasFile = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
function onDragEnter(e: DragEvent) {
  if (hasFile(e)) dragDepth.value++
}
function onDragOver(e: DragEvent) {
  // 必须阻止默认行为，否则 Electron 会直接打开图片
  if (hasFile(e)) e.preventDefault()
}
function onDragLeave(e: DragEvent) {
  if (hasFile(e)) dragDepth.value = Math.max(0, dragDepth.value - 1)
}
async function onDrop(e: DragEvent) {
  if (!hasFile(e)) return
  e.preventDefault()
  dragDepth.value = 0
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  try {
    importPrompt(await readPngPrompt(file), '已读取原图')
  } catch (err) {
    toast(cleanErr(err))
  }
}
</script>

<template>
  <div class="layout" @dragenter="onDragEnter" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <aside class="sidebar">
      <div class="brand">
        <Mascot :mood="busy ? 'busy' : 'avatar'" :size="46" class="brand-avatar" />
        <div>
          <div class="brand-name">Novel<b>Prompt</b></div>
          <div class="brand-sub">tag 小助手</div>
        </div>
      </div>

      <nav>
        <template v-for="(t, i) in tabs" :key="t.key">
          <div v-if="t.tool && !tabs[i - 1]?.tool" class="nav-sep"></div>
          <button :class="['nav-item', { active: state.tab === t.key }]" @click="state.tab = t.key">
            <Icon :name="t.icon" />
            <span class="nav-label">{{ t.label }}</span>
          </button>
        </template>
      </nav>

      <div class="side-bottom">
        <div v-if="state.update?.newer && !state.updateDismissed" class="update-card">
          <div class="update-head">
            <Icon name="download" :size="14" />
            <b>发现新版本 {{ state.update.latest }}</b>
          </div>
          <div class="update-actions">
            <button class="btn accent small" @click="openUpdate">去下载</button>
            <button class="btn ghost small" @click="dismissUpdate">忽略</button>
          </div>
        </div>
        <SkillPicker v-if="state.settings" />
        <div v-if="state.settings">
          <div class="side-label">目标模型</div>
          <div class="seg block">
            <button :class="{ on: state.settings.naiVersion === 'v4.5' }" @click="setVersion('v4.5')">V4.5</button>
            <button :class="{ on: state.settings.naiVersion === 'v5' }" @click="setVersion('v5')">V5</button>
          </div>
        </div>
        <div class="db-card" v-if="state.db">
          <div class="db-status">
            <span :class="['status-dot', { off: !state.db.loaded }]"></span>
            {{ state.db.loaded ? 'tag 库已就绪' : '尚未下载 tag 库' }}
          </div>
          <template v-if="state.db.loaded">
            <div class="db-row"><span>Tag</span><b>{{ state.db.tagCount.toLocaleString() }}</b></div>
            <div class="db-row"><span>别名</span><b>{{ state.db.aliasCount.toLocaleString() }}</b></div>
            <div class="db-row"><span>中文</span><b>{{ state.db.zhCount.toLocaleString() }}</b></div>
          </template>
          <button v-else class="btn small accent" @click="state.tab = 'settings'">
            <Icon name="download" :size="14" />去下载
          </button>
        </div>
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div class="topbar-title" :key="current.key">
          <Icon :name="current.icon" :size="17" />
          {{ current.label }}
        </div>
        <span class="topbar-desc">{{ current.desc }}</span>
      </header>
      <div class="content">
        <CompareView v-show="state.tab === 'compare'" />
        <SearchView v-show="state.tab === 'search'" />
        <AiView v-show="state.tab === 'ai'" />
        <PreviewView v-show="state.tab === 'preview'" />
        <GenerateView v-show="state.tab === 'generate'" />
        <SettingsView v-show="state.tab === 'settings'" />
      </div>
    </main>

    <transition name="fade">
      <div class="drop-overlay" v-if="dragDepth > 0">
        <div class="drop-card">
          <Icon name="image" :size="30" />
          <b>松手读取原图里的提示词</b>
          <span>会替换当前提示词，原来的内容自动存进历史</span>
        </div>
      </div>
    </transition>

    <transition name="toast">
      <div class="toast" v-if="state.toast">
        <Icon name="paw" :size="16" />
        {{ state.toast }}
      </div>
    </transition>
  </div>
</template>
