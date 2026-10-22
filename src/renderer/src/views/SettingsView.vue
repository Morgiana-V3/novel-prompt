<script setup lang="ts">
import { reactive, ref, watch, computed } from 'vue'
import { state, saveSettings, refreshDb, toast } from '../store'
import Icon from '../components/Icon.vue'
import type { ReasoningEffort } from '@shared/types'

const form = reactive({
  apiKey: '',
  baseUrl: '',
  model: '',
  reasoningEffort: 'low' as ReasoningEffort,
  minPostCount: 10,
  translateMinCount: 50,
  naiToken: '',
  naiFreeOnly: true
})
const efforts: { v: ReasoningEffort; label: string }[] = [
  { v: 'off', label: '关闭' },
  { v: 'low', label: '低' },
  { v: 'high', label: '高' },
  { v: 'max', label: '最高' }
]

// 只在首次拿到设置时填充表单；之后侧边栏切换版本等操作也会刷新 state.settings，
// 若每次都覆盖会把用户尚未保存的输入（如刚填的 API Key）冲掉
let filled = false
watch(
  () => state.settings,
  (s) => {
    if (!s || filled) return
    const { naiVersion: _v, ...rest } = s
    Object.assign(form, rest)
    filled = true
  },
  { immediate: true }
)

const running = computed(() => !!state.progress && !['done', 'error'].includes(state.progress.stage))
const percent = computed(() => {
  const p = state.progress
  return p?.total ? Math.min(100, ((p.current ?? 0) / p.total) * 100) : 0
})

const cancel = () => window.api.cancelTask()
const openSkill = () => window.api.openSkill()

const naiInfo = ref('')
async function testNai() {
  await save(true)
  naiInfo.value = '查询中…'
  try {
    const s = await window.api.naiSubscription()
    const anlas = s.anlasFixed !== undefined || s.anlasPurchased !== undefined ? (s.anlasFixed ?? 0) + (s.anlasPurchased ?? 0) : undefined
    naiInfo.value = [
      s.active ? (s.tier === 3 ? 'Opus 会员' : `会员等级 ${s.tier ?? '未知'}`) : '没有有效订阅',
      anlas !== undefined && `Anlas ${anlas.toLocaleString()}`,
      s.usagePercent !== undefined && `V5 免费额度约 ${s.usagePercent}%`
    ]
      .filter(Boolean)
      .join(' · ')
  } catch (e) {
    naiInfo.value = String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')
  }
}

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

async function updateImplications() {
  state.progress = { stage: 'implications', message: '开始下载包含关系…' }
  try {
    await window.api.dbImplications()
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
          <div class="card-desc">安装包已内置一份 tag 和中文翻译；点「更新」后会下载到本机用户目录，覆盖内置的数据</div>
        </div>
      </div>

      <div class="tiles" v-if="state.db">
        <div class="tile"><div class="tile-num">{{ state.db.tagCount.toLocaleString() }}</div><div class="tile-label">Tag</div></div>
        <div class="tile"><div class="tile-num">{{ state.db.aliasCount.toLocaleString() }}</div><div class="tile-label">别名</div></div>
        <div class="tile">
          <div :class="['tile-num', { muted: !state.db.implicationCount }]">{{ state.db.implicationCount ? state.db.implicationCount.toLocaleString() : '未下载' }}</div>
          <div class="tile-label">包含关系</div>
        </div>
        <div class="tile"><div class="tile-num">{{ state.db.zhCount.toLocaleString() }}</div><div class="tile-label">已有中文</div></div>
        <div class="tile"><div class="tile-num">{{ state.db.minCount ?? '—' }}</div><div class="tile-label">收录阈值</div></div>
        <div class="tile">
          <div class="tile-num sm">{{ state.db.fetchedAt ? new Date(state.db.fetchedAt).toLocaleDateString() : '—' }}</div>
          <div class="tile-label">{{ state.db.source === 'user' ? '自行更新' : '内置数据' }}</div>
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
        <button class="btn" :disabled="running || !state.db?.loaded" @click="updateImplications" title="只下载包含关系，不重新下载 tag，约 1 分钟">
          <Icon name="swap" :size="15" />{{ state.db?.implicationCount ? '更新包含关系' : '下载包含关系' }}
        </button>
        <button class="btn ghost" v-if="running" @click="cancel"><Icon name="stop" :size="15" />取消</button>
      </div>
      <span class="help">
        包含关系用于判断冗余（如 white thighhighs 已包含 thighhighs）。AI 优化和画面推测还会联网查 Danbooru 的共现统计（角色默认外观、画师倾向），查过的结果会缓存 30 天，离线时自动降级。
      </span>

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

    <div class="card" style="--d: 105ms">
      <div class="card-head">
        <span class="card-icon"><Icon name="image" /></span>
        <div>
          <h2>NovelAI</h2>
          <div class="card-desc">用于「生图预览」，直接调用 NovelAI 图像接口出图</div>
        </div>
      </div>
      <div class="form-grid">
        <div class="form-field full">
          <label>Persistent API Token</label>
          <input class="input" type="password" v-model="form.naiToken" placeholder="pst-..." autocomplete="off" />
          <span class="help">在 NovelAI 网页「设置 → Account → Get Persistent API Token」获取。只保存在本机，只用于请求头</span>
        </div>
        <div class="form-field full">
          <label>只用免费额度</label>
          <div class="seg">
            <button :class="{ on: form.naiFreeOnly }" @click="form.naiFreeOnly = true">开启（推荐）</button>
            <button :class="{ on: !form.naiFreeOnly }" @click="form.naiFreeOnly = false">允许消耗 Anlas</button>
          </div>
          <span class="help">
            开启后：生成前检查 Opus 会员、免费额度、尺寸（≤ 1024×1024 像素）和步数（≤ 28），不满足就不提交；每张生成后核对 Anlas，发现扣除立即停止。这是调用端的检查，不是服务端保证
          </span>
        </div>
      </div>
      <div class="row">
        <button class="btn primary" @click="save()"><Icon name="check" :size="16" />保存</button>
        <button class="btn" :disabled="!form.naiToken" @click="testNai"><Icon name="key" :size="15" />保存并测试连接</button>
        <span class="muted small" v-if="naiInfo">{{ naiInfo }}</span>
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
