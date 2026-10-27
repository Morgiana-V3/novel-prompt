<script setup lang="ts">
import { reactive, ref, watch, computed, onMounted, nextTick } from 'vue'
import { state, saveSettings, refreshDb, toast, copy, checkUpdate } from '../store'
import Icon from '../components/Icon.vue'
import SkillManager from '../components/SkillManager.vue'
import UpdateAction from '../components/UpdateAction.vue'
import { updateLabel } from '../updates'
import type { McpInfo, ReasoningEffort } from '@shared/types'

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
const editableKeys = Object.keys(form) as (keyof typeof form)[]
const skillManager = ref<InstanceType<typeof SkillManager>>()
function prepareUpdate(): void {
  skillManager.value?.prepareUpdate()
  if (filled && state.settings && editableKeys.some(key => String(form[key]) !== String(state.settings![key])))
    throw new Error('设置有尚未保存的修改，请先保存设置再重启更新')
}
defineExpose({ prepareUpdate })
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
    const { naiVersion: _v, inpaintVision: _legacyVision, ...rest } = s
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

/* 从侧栏「管理 Skill」跳转过来时滚动到对应区块 */
watch(
  () => [state.tab, state.settingsAnchor] as const,
  ([tab, anchor]) => {
    if (tab !== 'settings' || !anchor) return
    nextTick(() => {
      document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      state.settingsAnchor = ''
    })
  },
  { immediate: true }
)

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

/* 开关类设置点了立即生效，和 MCP 开关保持一致；输入框类设置仍需点「保存」 */
async function setFreeOnly(v: boolean) {
  if (form.naiFreeOnly === v && state.settings?.naiFreeOnly === v) return
  form.naiFreeOnly = v
  await saveSettings({ naiFreeOnly: v })
  if (v) toast('已开启「只用免费额度」，不满足免费条件时不会提交')
  else toast('已允许消耗 Anlas，生成前请留意花费', { label: '撤销', run: () => void setFreeOnly(true) })
}
async function setEffort(v: ReasoningEffort) {
  form.reasoningEffort = v
  await saveSettings({ reasoningEffort: v })
  toast(`思考模式：${efforts.find((e) => e.v === v)?.label}，已保存`)
}

/* 各卡片的未保存修改：按钮旁标出，离开设置页时提醒 */
const differs = (...keys: (keyof typeof form)[]) =>
  !!state.settings && keys.some((k) => String(form[k]) !== String(state.settings![k]))
const dirty = computed(() => ({
  data: differs('minPostCount'),
  deepseek: differs('apiKey', 'baseUrl', 'model'),
  nai: differs('naiToken'),
  translate: differs('translateMinCount')
}))
const anyDirty = computed(() => Object.values(dirty.value).some(Boolean))
watch(
  () => state.tab,
  (tab, prev) => {
    if (prev === 'settings' && tab !== 'settings' && anyDirty.value)
      toast('设置里还有未保存的修改，尚未生效', { label: '立即保存', run: () => void save() })
  }
)
// TOML 字面量字符串（单引号）不处理反斜杠转义，适合 Windows 路径
const tomlStr = (s: string) => `'${s.replace(/'/g, "''")}'`
const mcpScope = ref('all')
const mcpEnv = computed(() => ({ ...mcp.value?.env, NOVELPROMPT_MCP_GROUPS: mcpScope.value }))

const codexConfig = computed(() => {
  const m = mcp.value
  if (!m) return ''
  const env = Object.entries(mcpEnv.value).map(([k, v]) => `${k} = ${tomlStr(v)}`)
  return `[mcp_servers.${m.serverName ?? 'novel-prompt'}]\ncommand = ${tomlStr(m.command)}\nargs = [${m.args.map(tomlStr).join(', ')}]\nenv = { ${env.join(', ')} }`
})
const launchJson = computed(() =>
  mcp.value ? JSON.stringify({ command: mcp.value.command, args: mcp.value.args, env: mcpEnv.value }, null, 2) : ''
)
const jsonConfig = computed(() =>
  mcp.value
    ? JSON.stringify({ mcpServers: { [mcp.value.serverName ?? 'novel-prompt']: { command: mcp.value.command, args: mcp.value.args, env: mcpEnv.value } } }, null, 2)
    : ''
)
const agentPrompt = computed(() =>
  mcp.value
    ? [
        '帮我把 NovelPrompt 完整配置成你的 MCP 服务：',
        `- 服务名 ${mcp.value.serverName ?? 'novel-prompt'}，传输方式 stdio，启动参数如下（路径原样使用）：`,
        launchJson.value,
        `- 写进你自己的 MCP 配置文件（用户级），改之前先把原文件备份为 .bak，只新增或覆盖 ${mcp.value.serverName ?? 'novel-prompt'} 这一项，其他配置不要动。`,
        '- 配置完成后重新连接 MCP；若客户端不支持重连则重启客户端。连接后调用 agent_guide 和 get_app_state 核对功能、运行环境及连接状态；写提示词前再读取相关规则。'
      ].join('\n')
    : ''
)
/* ---------- 版本与更新 ---------- */
const checking = ref(false)
const versionText = computed(() => updateLabel(state.update))
const updateSub = computed(() => {
  const u = state.update
  if (!u) return ''
  if (u.error) return `更新失败：${u.error}`
  if (u.manualReason) return u.manualReason
  const at = u.checkedAt ? new Date(u.checkedAt).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
  const parts = [`当前 v${u.current}`, at && `检查于 ${at}`]
  return parts.filter(Boolean).join(' · ')
})
async function runCheck() {
  checking.value = true
  await checkUpdate(true)
  checking.value = false
  toast(state.update?.error ? '检查失败，可能是网络问题' : state.update?.newer ? `发现新版本 ${state.update.latest}` : '已是最新版本')
}

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
          <span class="help">只收录引用数 ≥ 该值的 tag。10 ≈ 15 万条，1 ≈ 50 万条（更慢）。点「下载 / 更新」时自动保存</span>
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
          <div class="card-desc">用于 AI 优化、翻译和局部重绘分析，支持 OpenAI 兼容接口</div>
        </div>
      </div>
      <div class="form-grid">
        <div class="form-field full">
          <label>API Key</label>
          <input class="input" type="password" data-mcp-private v-model="form.apiKey" placeholder="sk-..." />
        </div>
        <div class="form-field">
          <label>Base URL</label>
          <input class="input" v-model="form.baseUrl" />
        </div>
        <div class="form-field">
          <label>模型</label>
          <input class="input" v-model="form.model" />
          <span class="help">默认 deepseek-flash，支持工具调用与图片理解；局部重绘直接复用此模型，无需额外配置。其他模型使用「图片 + 批注」时需支持图片输入。</span>
        </div>
        <div class="form-field full">
          <label>思考模式</label>
          <div class="seg">
            <button v-for="e in efforts" :key="e.v" :class="{ on: form.reasoningEffort === e.v }" @click="setEffort(e.v)">
              {{ e.label }}
            </button>
          </div>
          <span class="help">只影响 AI 优化：思考越深，tag 挑得越准，但也越慢。批量翻译固定关闭思考。点选后立即生效</span>
        </div>
      </div>
      <div class="row">
        <button class="btn primary" @click="save()"><Icon name="check" :size="16" />保存</button>
        <span v-if="dirty.deepseek" class="pill alias"><i></i>有未保存的修改</span>
      </div>
    </div>

    <SkillManager ref="skillManager" />

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
          <input class="input" type="password" data-mcp-private v-model="form.naiToken" placeholder="pst-..." autocomplete="off" />
          <span class="help">在 NovelAI 网页「设置 → Account → Get Persistent API Token」获取。只保存在本机，只用于请求头</span>
        </div>
        <div class="form-field full">
          <label>只用免费额度</label>
          <div class="seg">
            <button :class="{ on: form.naiFreeOnly }" @click="setFreeOnly(true)">开启（推荐）</button>
            <button :class="{ on: !form.naiFreeOnly }" @click="setFreeOnly(false)">允许消耗 Anlas</button>
          </div>
          <span class="help">
            点选后立即生效。开启后：生成前检查 Opus 会员、免费额度、尺寸（≤ 1024×1024 像素）和步数（≤ 28），不满足就不提交；每张生成后核对 Anlas，发现扣除立即停止。这是调用端的检查，不是服务端保证
          </span>
        </div>
      </div>
      <div class="row">
        <button class="btn primary" @click="save()"><Icon name="check" :size="16" />保存</button>
        <button class="btn" :disabled="!form.naiToken" @click="testNai"><Icon name="key" :size="15" />保存并测试连接</button>
        <span v-if="dirty.nai" class="pill alias"><i></i>Token 未保存</span>
        <span class="muted small" v-if="naiInfo">{{ naiInfo }}</span>
      </div>
    </div>

    <div class="card" style="--d: 120ms">
      <div class="card-head">
        <span class="card-icon blue"><Icon name="wand" /></span>
        <div>
          <h2>Agent 接入（MCP）</h2>
          <div class="card-desc">同一套 MCP 支持后台处理与前台可视化操作，由 Agent 按你的要求选择。</div>
        </div>
      </div>
      <div class="form-grid">
        <div v-if="mcp?.runtime" class="form-field full"><label>当前环境：{{ mcp.runtime.mode === 'development' ? '开发版' : '安装版' }}</label><span class="help">数据目录：{{ mcp.runtime.dataPath }}</span><span class="help">程序目录：{{ mcp.runtime.appPath }}</span><span class="help">下面的 MCP 配置连接此环境。开发版与安装版的数据分别保存。</span></div>
        <div class="form-field full"><label>两种操作方式</label><span class="help">后台模式：查词、检查、处理提示词和图片，可在无窗口时运行。前台模式：打开工作台，填写并提交讨论、展示建议、绘制区域批注、采纳和生成；每一步都在软件界面中显示，可随时停止。告诉 Agent「这次使用前台可视化模式」即可，无需另配服务。</span></div>
        <div class="form-field">
          <label>允许调用 DeepSeek</label>
          <div class="seg">
            <button :class="{ on: !form.mcpAllowAi }" @click="setMcp('mcpAllowAi', false)">关闭</button>
            <button :class="{ on: form.mcpAllowAi }" @click="setMcp('mcpAllowAi', true)">开启</button>
          </div>
          <span class="help">允许 Agent 使用已配置的 AI 服务，包括前台工作台讨论、优化和画面推测，会消耗对应服务额度。仅填写输入、查看或绘制区域无需开启。</span>
        </div>
        <div class="form-field">
          <label>允许生图</label>
          <div class="seg">
            <button :class="{ on: !form.mcpAllowGenerate }" @click="setMcp('mcpAllowGenerate', false)">关闭</button>
            <button :class="{ on: form.mcpAllowGenerate }" @click="setMcp('mcpAllowGenerate', true)">开启</button>
          </div>
          <span class="help">前台与后台生图、重绘均检查免费条件，并要求 Agent 取得你的生成授权。</span>
        </div>
        <div class="form-field full" v-if="mcp?.portable">
          <div class="error-box"><Icon name="warn" :size="16" />便携版每次运行都会解压到临时目录，路径不固定，agent 无法稳定启动它。请改用安装版。</div>
        </div>
        <div class="form-field full" v-if="!mcp?.portable">
          <label>接入范围</label>
          <select v-model="mcpScope">
            <option value="all">全部功能</option>
            <option value="workspace,frontend,images,skills,tags">工作台创作</option>
            <option value="workspace,images,skills,tags">后台创作</option>
            <option value="tags,skills">标签与提示词</option>
            <option value="core">按需加载</option>
          </select>
          <span class="help">所选功能在首次连接时即可使用，范围越小，Agent 需要读取的工具说明越少。选择后复制下方新配置并重新连接。“按需加载”适合支持动态刷新工具的客户端。</span>
        </div>
        <details class="form-field full manual" v-if="!mcp?.portable">
          <summary>Agent 自动配置</summary>
          <span class="help">把下面这段话发给你正在用的 agent（Codex、Claude Code、Cursor 等），它会自己把 MCP 写进它的配置：</span>
          <div class="code-box">
            <pre>{{ agentPrompt }}</pre>
            <button class="icon-btn sm" title="复制" @click="copy(agentPrompt)"><Icon name="copy" :size="15" /></button>
          </div>
          <span class="help">
            配置里的路径取自本软件当前的安装位置，更换安装目录后需要重新配置。
            {{ mcp && !isPackaged ? '当前是开发模式，配置指向本项目，需要先 npm run build。' : '' }}
          </span>
        </details>
        <details class="form-field full manual" v-if="!mcp?.portable">
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
            服务名 novel-prompt，传输方式 stdio。其他 agent 按各自格式填写同样的 command / args / env 即可，改完需完全重启 agent。
            接入范围只决定 Agent 首次看到哪些工具，不替代上方 AI 与生图权限。
          </span>
        </details>
        <div class="form-field full">
          <div class="row">
            <button class="btn ghost small" @click="state.skillPanel = true"><Icon name="layers" :size="14" />Skill 启用与优先级</button>
          </div>
          <span class="help">agent 通过 prompt_guide 读取的规范，就是侧栏「Skill」里为 AI 优化启用的 Skill（按优先级），改完下一次读取即生效。agent 也可以用 Skill 管理工具直接增删改 Skill。</span>
        </div>
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
          <span class="help">只翻译引用数 ≥ 该值的 tag，越小越多、越贵。点「开始 AI 翻译」时自动保存</span>
        </div>
      </div>
      <div class="row">
        <button class="btn primary" :disabled="running" @click="translate"><Icon name="sparkle" :size="16" />开始 AI 翻译</button>
      </div>
    </div>

    <div class="card" style="--d: 160ms">
      <div class="card-head">
        <span class="card-icon"><Icon name="download" /></span>
        <div>
          <h2>版本与更新</h2>
          <div class="card-desc">安装版启动时及每 6 小时检查更新，发现新版后后台下载。准备好后点击「重启并更新」，已保存的数据会保留。</div>
        </div>
      </div>
      <div class="form-grid">
        <div class="form-field full">
          <div class="update-line">
            <span class="pill" :class="state.update?.newer ? 'alias' : 'ok'"><i></i>{{ versionText }}</span>
            <span class="muted small grow">{{ updateSub }}</span>
            <button class="btn small" :disabled="checking || ['checking', 'downloading', 'ready', 'installing'].includes(state.update?.stage ?? '')" @click="runCheck">
              <Icon name="swap" :size="13" />{{ checking ? '检查中' : '检查更新' }}
            </button>
            <UpdateAction />
          </div>
          <pre v-if="state.update?.newer && state.update.notes" class="release-notes">{{ state.update.notes }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>
