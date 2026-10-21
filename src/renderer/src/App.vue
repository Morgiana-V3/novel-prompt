<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { state, refreshDb, saveSettings } from './store'
import CompareView from './views/CompareView.vue'
import SearchView from './views/SearchView.vue'
import AiView from './views/AiView.vue'
import SettingsView from './views/SettingsView.vue'
import Icon from './components/Icon.vue'
import Mascot from './components/Mascot.vue'
import type { IconName } from './components/icons'
import type { NaiVersion } from '@shared/types'

type Tab = typeof state.tab
const tabs: { key: Tab; label: string; icon: IconName; desc: string }[] = [
  { key: 'compare', label: '提示词比对', icon: 'compare', desc: '把提示词拆开，找出不存在的 tag' },
  { key: 'search', label: 'Tag 搜索', icon: 'search', desc: '中文、英文、拼音首字母都能搜' },
  { key: 'ai', label: 'AI 优化', icon: 'sparkle', desc: '让 AI 帮你挑 tag、排顺序' },
  { key: 'settings', label: '设置 / 数据', icon: 'sliders', desc: 'Danbooru 数据与 DeepSeek 配置' }
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
})

function setVersion(v: NaiVersion) {
  saveSettings({ naiVersion: v })
}
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <Mascot :mood="busy ? 'busy' : 'avatar'" :size="44" />
        <div>
          <div class="brand-name">Novel<b>Prompt</b></div>
          <div class="brand-sub">tag 小助手</div>
        </div>
      </div>

      <nav>
        <button
          v-for="t in tabs"
          :key="t.key"
          :class="['nav-item', { active: state.tab === t.key }]"
          @click="state.tab = t.key"
        >
          <Icon :name="t.icon" />
          <span class="nav-label">{{ t.label }}</span>
        </button>
      </nav>

      <div class="side-bottom">
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
        <SettingsView v-show="state.tab === 'settings'" />
      </div>
    </main>

    <transition name="toast">
      <div class="toast" v-if="state.toast">
        <Icon name="paw" :size="16" />
        {{ state.toast }}
      </div>
    </transition>
  </div>
</template>
