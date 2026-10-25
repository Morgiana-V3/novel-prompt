<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { state, refreshDb, loadSkills, saveSettings, importPrompt, cleanErr, toast, checkUpdate, dismissUpdate, receiveUpdate, flushWorkspace, applyWorkspace, type Tab } from './store'
import { APP_TABS, type DesktopCommand, type DesktopState, type FrontendRequest, type FrontendContext } from '@shared/desktop'
import { readPngPrompt } from '@shared/prompt-import'
import CompareView from './views/CompareView.vue'
import SearchView from './views/SearchView.vue'
import AiView from './views/AiView.vue'
import PreviewView from './views/PreviewView.vue'
import GenerateView from './views/GenerateView.vue'
import WorkspacesView from './views/WorkspacesView.vue'
import SettingsView from './views/SettingsView.vue'
import Icon from './components/Icon.vue'
import Mascot from './components/Mascot.vue'
import SkillPicker from './components/SkillPicker.vue'
import type { IconName } from './components/icons'
import type { NaiVersion } from '@shared/types'
import TaskCenter from './components/TaskCenter.vue'
import UpdateAction from './components/UpdateAction.vue'
import { prepareUpdateKey, updateLabel } from './updates'
import { connectTasks } from './tasks'

/** 按工作流排序：写 → 校验 → 优化 → 推测 → 出图；搜索与设置是工具 */
const tabs: { key: Tab; label: string; icon: IconName; desc: string; tool?: boolean }[] = [
  { key: 'compare', label: '提示词比对', icon: 'compare', desc: '逐段检查主提示词、角色和负面里有没有不存在的 tag' },
  { key: 'ai', label: 'AI 优化', icon: 'sparkle', desc: '让 AI 帮你挑 tag、排顺序，采用后写回当前提示词' },
  { key: 'preview', label: '画面推测', icon: 'eye', desc: '让 AI 猜猜当前提示词会画成什么样' },
  { key: 'generate', label: '生图预览', icon: 'image', desc: '用 NovelAI 接口直接出图看效果' },
  { key: 'workspace', label: 'AI 工作台', icon: 'chat', desc: '围绕一个目标持续讨论、生成和调整，保留每次尝试' },
  { key: 'search', label: 'Tag 搜索', icon: 'search', desc: '中文、英文、拼音首字母都能搜，单击加到最近编辑的输入框', tool: true },
  { key: 'settings', label: '设置 / 数据', icon: 'sliders', desc: 'Danbooru 数据、DeepSeek 与 NovelAI 配置', tool: true }
]
const current = computed(() => tabs.find((t) => t.key === state.tab)!)
let offTasks: (() => void) | undefined
let offUpdate: (() => void) | undefined
let offDesktop: (() => void) | undefined
let offSkills: (() => void) | undefined
let updateTimer: ReturnType<typeof setTimeout> | undefined
const workspaceView = ref<InstanceType<typeof WorkspacesView>>()
const settingsView = ref<InstanceType<typeof SettingsView>>()
const generateView = ref<InstanceType<typeof GenerateView>>()
const desktopSession = crypto.randomUUID()
const frontend = ref<DesktopState['frontend']>(null)
let frontendController: AbortController | null = null, frontendId = ''
let cancelledFrontendId = ''
let markDesktopReady: () => void
const desktopReady = new Promise<void>(resolve => { markDesktopReady = resolve })
let offFrontend: (() => void) | undefined
function stopFrontend() { frontendController?.abort(); window.api.cancelFrontend() }
let captureLease = '', captureStyle: HTMLStyleElement | null = null
let captureTimer: ReturnType<typeof setTimeout> | undefined
function endCapture(lease = captureLease) {
  if (lease !== captureLease) return
  clearTimeout(captureTimer); captureStyle?.remove(); captureStyle = null; captureLease = ''
}
async function prepareCapture(lease: string) {
  if (!lease || captureLease) throw new Error('截图准备尚未完成，请稍后重试')
  captureLease = lease
  const selector = 'input[type="password"], [data-mcp-private]'
  const privateElements = [...document.querySelectorAll(selector)].filter(el => el.getClientRects().length > 0)
  const redactedFields = privateElements.length
  const redactions = privateElements.flatMap(el => [el, ...el.querySelectorAll('*')]).flatMap(el => [...el.getClientRects()].map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height })))
  captureStyle = document.createElement('style'); captureStyle.id = 'np-mcp-capture-privacy'
  captureStyle.textContent = `${selector}, [data-mcp-private] * { visibility: hidden !important; }`
  document.head.append(captureStyle)
  const expiresAt = Date.now() + 10000
  captureTimer = setTimeout(() => endCapture(lease), 10000)
  try {
    await nextTick()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('界面尚未绘制，请显示窗口后重试')), 1500)
      requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve() }))
    })
    return { desktop: desktopSnapshot(), redactedFields, redactions, expiresAt,
      viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight, devicePixelRatio: window.devicePixelRatio } }
  } catch(e) { endCapture(lease); throw e }
}
let desktopRevision = 0, desktopKey = ''
function desktopSnapshot(): DesktopState {
  const blockers: string[] = []
  try { generateView.value?.prepareUpdate() } catch(e) { blockers.push(cleanErr(e)) }
  if (workspaceView.value?.isCreating()) blockers.push('正在新建工作台会话')
  const value = { tab: state.tab, draft: { base: state.prompt, negative: state.negative, characters: state.characters.map(c => ({ ...c })) },
    model: state.settings?.naiVersion ?? 'v5', image: state.currentImage ? { ...state.currentImage } : null,
    workspace: workspaceView.value?.desktopState() ?? null, blockers, frontend: frontend.value ? { ...frontend.value } : null }
  const key = JSON.stringify(value)
  if (key !== desktopKey) { desktopKey = key; desktopRevision++ }
  return { token: `${desktopSession}:${desktopRevision}`, ...value }
}
function publishDesktop() { window.api.publishDesktop(desktopSnapshot()) }
watch(() => JSON.stringify(desktopSnapshot()), publishDesktop, { flush: 'post' })
async function desktopCommand(command: DesktopCommand) {
  try {
    const a = command.args
    if (command.type !== 'snapshot') await desktopReady
    if (command.type === 'capture-prepare') {
      const result = await prepareCapture(String(a.lease))
      window.api.replyDesktop({ id: command.id, result }); return
    } else if (command.type === 'capture-end') endCapture(String(a.lease))
    else if (command.type === 'frontend') {
      const request = a as unknown as FrontendRequest
      if (request.actionId === cancelledFrontendId) throw new Error('前台操作已停止')
      if (frontendController) throw new Error('前台操作正在执行')
      if (request.expected_token && request.expected_token !== desktopSnapshot().token) throw new Error('界面内容已变化，请重新读取 get_app_state，未覆盖用户输入')
      generateView.value?.prepareUpdate()
      if (!workspaceView.value) throw new Error('工作台尚未就绪')
      const ctrl = new AbortController(); frontendController = ctrl; frontendId = request.actionId
      frontend.value = { label: request.label, stage: '准备操作…', status: 'running' }
      const context: FrontendContext = { actionId: request.actionId, signal: ctrl.signal, step: async message => {
        if (ctrl.signal.aborted) throw new Error('已停止，已保存的内容保留')
        frontend.value = { label: request.label, stage: message, status: 'running' }
        await nextTick(); publishDesktop()
        // Keep each UI transition visible before advancing to the next action.
        await new Promise(resolve => setTimeout(resolve, request.step_delay_ms ?? 300))
        if (ctrl.signal.aborted) throw new Error('已停止，已保存的内容保留')
      } }
      try {
        state.tab = 'workspace'
        await workspaceView.value.frontendAction(request, context)
        frontend.value = { label: request.label, stage: ctrl.signal.aborted ? '已停止，已完成的结果保留' : '已完成', status: ctrl.signal.aborted ? 'error' : 'completed' }
      } catch(e) { frontend.value = { label: request.label, stage: cleanErr(e), status: 'error' }; throw e }
      finally { frontendController = null; frontendId = '' }
    } else if (command.type === 'navigate') {
      if (!APP_TABS.includes(a.tab as Tab)) throw new Error('未知页面')
      generateView.value?.prepareUpdate()
      if (a.workspace_id) await workspaceView.value?.agentOpen(String(a.workspace_id))
      state.tab = a.tab as Tab
    } else if (command.type === 'apply-prompt') {
      generateView.value?.prepareUpdate()
      if (a.expected_token !== desktopSnapshot().token) throw new Error('界面内容已变化，请重新读取 get_app_state 后再提交，未覆盖用户输入')
      applyWorkspace(a.draft as DesktopState['draft'], 'Agent 修改前')
      flushWorkspace(); toast('Agent 已更新当前提示词，可从历史恢复')
    } else if (command.type === 'workspace-lock') await workspaceView.value?.beginRemote(String(a.id), String(a.lease))
    else if (command.type === 'workspace-release') await workspaceView.value?.endRemote(String(a.id), String(a.lease))
    else if (command.type === 'show-image') state.currentImage = a.image as DesktopState['image']
    await nextTick(); publishDesktop()
    window.api.replyDesktop({ id: command.id, result: desktopSnapshot() })
  } catch(e) { window.api.replyDesktop({ id: command.id, error: cleanErr(e) }) }
}
provide(prepareUpdateKey, async () => {
  await nextTick()
  settingsView.value?.prepareUpdate()
  generateView.value?.prepareUpdate()
  if (!(await workspaceView.value?.prepareUpdate())) throw new Error('请先保存或完成 AI 工作台中的编辑，再重启更新')
  flushWorkspace()
})
onBeforeUnmount(() => { offTasks?.(); offUpdate?.(); offDesktop?.(); offSkills?.(); offFrontend?.(); frontendController?.abort(); clearTimeout(updateTimer); endCapture() })

onMounted(async () => {
  offTasks = connectTasks()
  offSkills = window.api.onSkillsChanged(() => { void loadSkills().catch(e => toast(cleanErr(e))) })
  let commands = Promise.resolve()
  offFrontend = window.api.onFrontendCancel(id => { cancelledFrontendId = id; if (id === frontendId) frontendController?.abort() })
  offDesktop = window.api.onDesktopCommand(command => {
    if (['snapshot', 'capture-prepare', 'capture-end', 'workspace-release'].includes(command.type)) void desktopCommand(command)
    else commands = commands.then(() => desktopCommand(command))
  })
  publishDesktop()
  offUpdate = window.api.onUpdate(receiveUpdate)
  void window.api.updateState().then(receiveUpdate).catch(() => {})
  state.settings = await window.api.getSettings()
  await refreshDb()
  window.api.onProgress((p) => {
    state.progress = p
    if (p.stage === 'done' || p.stage === 'error') refreshDb()
  })
  if (!state.db?.loaded) state.tab = 'settings'
  markDesktopReady()
  // 启动后再查；检查与下载都在后台，不影响编辑。
  updateTimer = setTimeout(() => void checkUpdate(), 3000)
})


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
    <aside class="sidebar" :inert="frontend?.status === 'running'">
      <div class="brand">
        <Mascot mood="avatar" :size="46" class="brand-avatar" />
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
            <b>{{ updateLabel(state.update) }}</b>
          </div>
          <div class="update-actions">
            <UpdateAction />
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
        <div class="topbar-title" :key="current.key" :title="current.desc">
          <Icon :name="current.icon" :size="17" />
          {{ current.label }}
        </div>
        <TaskCenter />
      </header>
      <div v-if="frontend" class="frontend-status" role="status" aria-live="polite">
        <span><b>Agent 前台 · {{ frontend.label }}</b> {{ frontend.stage }}</span>
        <button v-if="frontend.status === 'running'" class="btn small" @click="stopFrontend">停止操作</button>
        <button v-else class="btn ghost small" @click="frontend=null">收起</button>
      </div>
      <div class="content" :inert="frontend?.status === 'running'">
        <CompareView v-show="state.tab === 'compare'" />
        <SearchView v-show="state.tab === 'search'" />
        <AiView v-show="state.tab === 'ai'" />
        <PreviewView v-show="state.tab === 'preview'" />
        <GenerateView ref="generateView" v-show="state.tab === 'generate'" />
        <WorkspacesView ref="workspaceView" v-show="state.tab === 'workspace'" />
        <SettingsView ref="settingsView" v-show="state.tab === 'settings'" />
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

<style scoped>
.frontend-status{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:9px 20px;border-bottom:1px solid var(--pink-line);background:var(--panel);font-size:12px}.frontend-status b{margin-right:12px}
</style>
