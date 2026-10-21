<script setup lang="ts">
import { reactive, watch, computed } from 'vue'
import { state, saveSettings, refreshDb, toast } from '../store'
import Icon from '../components/Icon.vue'
import type { ReasoningEffort } from '@shared/types'

const form = reactive({
  apiKey: '',
  baseUrl: '',
  model: '',
  reasoningEffort: 'low' as ReasoningEffort,
  minPostCount: 10,
  translateMinCount: 50
})
const efforts: { v: ReasoningEffort; label: string }[] = [
  { v: 'off', label: '关闭' },
  { v: 'low', label: '低' },
  { v: 'high', label: '高' },
  { v: 'max', label: '最高' }
]

watch(
  () => state.settings,
  (s) => s && Object.assign(form, s),
  { immediate: true }
)

const running = computed(() => !!state.progress && !['done', 'error'].includes(state.progress.stage))
const percent = computed(() => {
  const p = state.progress
  return p?.total ? Math.min(100, ((p.current ?? 0) / p.total) * 100) : 0
})

const cancel = () => window.api.cancelTask()
const openSkill = () => window.api.openSkill()

async function save(silent = false) {
  await saveSettings({ ...form, minPostCount: Number(form.minPostCount), translateMinCount: Number(form.translateMinCount) })
  if (!silent) toast('设置已保存')
}

async function update() {
  await save(true)
  state.progress = { stage: 'tags', message: '开始下载…' }
  try {
    await window.api.dbUpdate()
  } catch {
    /* 错误通过 progress 显示 */
  }
  await refreshDb()
}

async function translate() {
  await save(true)
  if (!form.apiKey) return toast('请先填写 API Key')
  state.progress = { stage: 'ai-translate', message: '准备翻译…' }
  try {
    await window.api.aiTranslate()
  } catch {
    /* 同上 */
  }
  await refreshDb()
}
</script>

<template>
  <div class="view settings">
    <div class="card" style="--d: 0ms">
      <div class="card-head">
        <span class="card-icon"><Icon name="tag" /></span>
        <div>
          <h2>Danbooru 数据</h2>
          <div class="card-desc">tag、别名和社区中文翻译，都保存在本地</div>
        </div>
      </div>

      <div class="tiles" v-if="state.db">
        <div class="tile"><div class="tile-num">{{ state.db.tagCount.toLocaleString() }}</div><div class="tile-label">Tag</div></div>
        <div class="tile"><div class="tile-num">{{ state.db.aliasCount.toLocaleString() }}</div><div class="tile-label">别名</div></div>
        <div class="tile"><div class="tile-num">{{ state.db.zhCount.toLocaleString() }}</div><div class="tile-label">已有中文</div></div>
        <div class="tile"><div class="tile-num">{{ state.db.minCount ?? '—' }}</div><div class="tile-label">收录阈值</div></div>
        <div class="tile">
          <div class="tile-num sm">{{ state.db.fetchedAt ? new Date(state.db.fetchedAt).toLocaleDateString() : '—' }}</div>
          <div class="tile-label">更新时间</div>
        </div>
      </div>

      <div class="form-grid">
        <div class="form-field">
          <label>最小引用数</label>
          <input class="input" type="number" v-model="form.minPostCount" min="1" />
          <span class="help">只收录引用数 ≥ 该值的 tag。10 ≈ 15 万条，1 ≈ 50 万条（更慢）</span>
        </div>
      </div>

      <div class="row">
        <button class="btn primary" :disabled="running" @click="update"><Icon name="download" :size="16" />下载 / 更新 tag 数据</button>
        <button class="btn ghost" v-if="running" @click="cancel"><Icon name="stop" :size="15" />取消</button>
      </div>

      <div class="progress" v-if="state.progress">
        <div :class="['progress-msg', { bad: state.progress.stage === 'error', ok: state.progress.stage === 'done' }]">
          <Icon v-if="state.progress.stage === 'done'" name="check" :size="15" :stroke="2.2" />
          <Icon v-else-if="state.progress.stage === 'error'" name="warn" :size="15" />
          <Icon v-else name="paw" :size="15" class="spin-slow" />
          {{ state.progress.message }}
        </div>
        <div v-if="running" :class="['bar', { indeterminate: !state.progress.total }]">
          <div class="bar-in" :style="state.progress.total ? { width: percent + '%' } : {}"></div>
        </div>
      </div>
    </div>

    <div class="card" style="--d: 70ms">
      <div class="card-head">
        <span class="card-icon blue"><Icon name="key" /></span>
        <div>
          <h2>DeepSeek</h2>
          <div class="card-desc">用于 AI 优化和翻译，任何 OpenAI 兼容接口都能用</div>
        </div>
      </div>
      <div class="form-grid">
        <div class="form-field full">
          <label>API Key</label>
          <input class="input" type="password" v-model="form.apiKey" placeholder="sk-..." />
        </div>
        <div class="form-field">
          <label>Base URL</label>
          <input class="input" v-model="form.baseUrl" />
        </div>
        <div class="form-field">
          <label>模型</label>
          <input class="input" v-model="form.model" />
          <span class="help">默认 deepseek-flash（DeepSeek-V4.1-Flash，支持工具调用）</span>
        </div>
        <div class="form-field full">
          <label>思考模式</label>
          <div class="seg">
            <button v-for="e in efforts" :key="e.v" :class="{ on: form.reasoningEffort === e.v }" @click="form.reasoningEffort = e.v">
              {{ e.label }}
            </button>
          </div>
          <span class="help">只影响 AI 优化：思考越深，tag 挑得越准，但也越慢。批量翻译固定关闭思考</span>
        </div>
      </div>
      <div class="row">
        <button class="btn primary" @click="save()"><Icon name="check" :size="16" />保存</button>
        <button class="btn" @click="openSkill"><Icon name="book" :size="16" />编辑 Skill 文档</button>
      </div>
    </div>

    <div class="card" style="--d: 140ms">
      <div class="card-head">
        <span class="card-icon green"><Icon name="translate" /></span>
        <div>
          <h2>AI 补全中文翻译</h2>
          <div class="card-desc">社区词库没覆盖的 tag 交给 DeepSeek 翻译（画师 tag 不翻译），手动编辑的翻译优先级最高</div>
        </div>
      </div>
      <div class="form-grid">
        <div class="form-field">
          <label>最小引用数</label>
          <input class="input" type="number" v-model="form.translateMinCount" min="1" />
          <span class="help">只翻译引用数 ≥ 该值的 tag，越小越多、越贵</span>
        </div>
      </div>
      <div class="row">
        <button class="btn primary" :disabled="running" @click="translate"><Icon name="sparkle" :size="16" />开始 AI 翻译</button>
      </div>
    </div>
  </div>
</template>
