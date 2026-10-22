<script setup lang="ts">
import { reactive, ref, watch, computed, onMounted } from 'vue'
import { state, saveSettings, refreshDb, toast, copy } from '../store'
import Icon from '../components/Icon.vue'
import type { McpInfo, McpInstallTarget, ReasoningEffort } from '@shared/types'

const form = reactive({
  apiKey: '',
  baseUrl: '',
  model: '',
  reasoningEffort: 'low' as ReasoningEffort,
  minPostCount: 10,
  translateMinCount: 50,
  naiToken: '',
  naiFreeOnly: true,
  mcpAllowAi: false,
  mcpAllowGenerate: false
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

/* ---------- Agent 接入 ---------- */
const mcp = ref<McpInfo | null>(null)
const isPackaged = computed(() => !!mcp.value?.packaged)
async function loadMcp() {
  mcp.value = await window.api.mcpInfo()
}
onMounted(loadMcp)
watch(
  () => state.tab,
  (t) => t === 'settings' && loadMcp()
)
async function setMcp(key: 'mcpAllowAi' | 'mcpAllowGenerate', v: boolean) {
  form[key] = v
  await saveSettings({ [key]: v })
  toast(v ? '已开启，agent 下一次调用时生效' : '已关闭')
}
// TOML 字面量字符串（单引号）不处理反斜杠转义，适合 Windows 路径
const tomlStr = (s: string) => `'${s.replace(/'/g, "''")}'`

const INSTALL_ITEMS: { key: McpInstallTarget; label: string }[] = [
  { key: 'codexConfig', label: 'Codex MCP 配置' },
  { key: 'codexSkill', label: 'Codex Skill' },
  { key: 'claudeSkill', label: 'Claude Code Skill' }
]
const STATE_LABEL = {
  none: { text: '未安装', cls: '' },
  ok: { text: '已安装', cls: 'ok' },
  stale: { text: '需更新', cls: 'alias' }
} as const
const installing = ref(false)
async function install(targets: McpInstallTarget[]) {
  installing.value = true
  try {
    const r = await window.api.mcpInstall(targets)
    const bad = r.filter((x) => !x.ok)
    toast(bad.length ? `有 ${bad.length} 项失败：${bad[0].error}` : '已安装，重启 agent 后生效')
  } catch (e) {
    toast(String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''))
  } finally {
    installing.value = false
    await loadMcp()
  }
}
const openAgentSkill = () => window.api.mcpOpenSkill()
const codexConfig = computed(() => {
  const m = mcp.value
  if (!m) return ''
  const env = Object.entries(m.env).map(([k, v]) => `${k} = ${tomlStr(v)}`)
  return `[mcp_servers.novel-prompt]\ncommand = ${tomlStr(m.command)}\nargs = [${m.args.map(tomlStr).join(', ')}]\nenv = { ${env.join(', ')} }`
})
const jsonConfig = computed(() =>
  mcp.value
    ? JSON.stringify({ mcpServers: { 'novel-prompt': { command: mcp.value.command, args: mcp.value.args, env: mcp.value.env } } }, null, 2)
    : ''
)
const fmtLogTime = (t: number) => new Date(t).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
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

    <div class="card" style="--d: 120ms">
      <div class="card-head">
        <span class="card-icon blue"><Icon name="wand" /></span>
        <div>
          <h2>Agent 接入（MCP）</h2>
          <div class="card-desc">让 Codex、Claude Code、Cursor 等 agent 直接调用本软件的 tag 库、检查和生图。不需要打开本软件，agent 会在后台自动启动它</div>
        </div>
      </div>
      <div class="form-grid">
        <div class="form-field">
          <label>允许调用 DeepSeek</label>
          <div class="seg">
            <button :class="{ on: !form.mcpAllowAi }" @click="setMcp('mcpAllowAi', false)">关闭</button>
            <button :class="{ on: form.mcpAllowAi }" @click="setMcp('mcpAllowAi', true)">开启</button>
          </div>
          <span class="help">optimize_prompt / preview_prompt 会消耗你的 DeepSeek 额度。agent 本身就是大模型，一般不需要开</span>
        </div>
        <div class="form-field">
          <label>允许生图</label>
          <div class="seg">
            <button :class="{ on: !form.mcpAllowGenerate }" @click="setMcp('mcpAllowGenerate', false)">关闭</button>
            <button :class="{ on: form.mcpAllowGenerate }" @click="setMcp('mcpAllowGenerate', true)">开启</button>
          </div>
          <span class="help">generate_image 强制只用免费额度，且每次调用都要显式传 confirm: true</span>
        </div>
        <div class="form-field full" v-if="mcp?.portable">
          <div class="error-box"><Icon name="warn" :size="16" />便携版每次运行都会解压到临时目录，路径不固定，agent 无法稳定启动它。请改用安装版。</div>
        </div>
        <div class="form-field full" v-else>
          <label>一键安装</label>
          <div class="install-list">
            <div class="install-row" v-for="it in INSTALL_ITEMS" :key="it.key">
              <span :class="['pill', STATE_LABEL[mcp?.installed[it.key] ?? 'none'].cls]"><i></i>{{ STATE_LABEL[mcp?.installed[it.key] ?? 'none'].text }}</span>
              <div class="grow">
                <b>{{ it.label }}</b>
                <span class="muted small mono install-path">{{ mcp?.paths[it.key] }}</span>
              </div>
              <button class="btn small" :disabled="installing" @click="install([it.key])">
                {{ mcp?.installed[it.key] === 'ok' ? '重新安装' : '安装' }}
              </button>
            </div>
          </div>
          <div class="row">
            <button class="btn primary small" :disabled="installing" @click="install(['codexConfig', 'codexSkill', 'claudeSkill'])">
              <Icon name="download" :size="14" />全部安装
            </button>
            <button class="btn ghost small" @click="openAgentSkill"><Icon name="book" :size="14" />查看 Skill</button>
          </div>
          <span class="help">
            配置里的路径取自本软件当前的安装位置，安装或更换安装目录后点一次即可。写入 config.toml 前会备份为 config.toml.bak，只替换 novel-prompt 这一段。
            Skill 是给 agent 看的使用说明（工作流、工具参数、规则），装好后 agent 会在你提到 NovelAI 提示词时自动读取。
            {{ mcp && !isPackaged ? '当前是开发模式，配置指向本项目，需要先 npm run build。' : '' }}
          </span>
        </div>
        <details class="form-field full manual">
          <summary>手动配置</summary>
          <label>Codex（~/.codex/config.toml）</label>
          <div class="code-box">
            <pre>{{ codexConfig }}</pre>
            <button class="icon-btn sm" title="复制" @click="copy(codexConfig)"><Icon name="copy" :size="15" /></button>
          </div>
          <label>Claude Code / Cursor 等（mcpServers JSON）</label>
          <div class="code-box">
            <pre>{{ jsonConfig }}</pre>
            <button class="icon-btn sm" title="复制" @click="copy(jsonConfig)"><Icon name="copy" :size="15" /></button>
          </div>
          <span class="help">
            始终可用：prompt_guide、analyze_prompt、search_tags、validate_tags、related_tags、tag_wiki、nai_subscription、list_images、read_image_prompt。
            Claude Code 也可以用命令添加：claude mcp add-json novel-prompt '&lt;上面 novel-prompt 里的 JSON&gt;'
          </span>
        </details>
      </div>
      <div class="mcp-log">
        <div class="mcp-log-head">
          <b>最近调用</b>
          <button class="btn ghost small ml-auto" @click="loadMcp"><Icon name="swap" :size="13" />刷新</button>
        </div>
        <div v-if="mcp?.log.length" class="effect-list">
          <div class="effect-row" v-for="(l, i) in mcp.log" :key="l.at + '-' + i">
            <span :class="['pill', l.ok ? 'ok' : 'bad']">{{ l.ok ? '成功' : '失败' }}</span>
            <span class="where mono">{{ l.tool }}</span>
            <span class="grow">{{ l.summary }}</span>
            <span class="muted small">{{ fmtLogTime(l.at) }} · {{ l.ms }}ms</span>
          </div>
        </div>
        <div v-else class="muted small">还没有 agent 调用过</div>
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
