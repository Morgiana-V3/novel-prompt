<script setup lang="ts">
import ConfirmDialog from '../shared/ui/ConfirmDialog.vue'
import type { ConfirmationRequest } from '@shared/contracts/confirmation'

import { reportError } from '../shared/lib/notifications'
import { promptState } from '../features/prompts/state'
import { imageState, setPreviewImage } from '../features/generation/public'
import { settingsState } from '../features/settings/state'
import { tagState } from '../features/tags/state'
import { shellState } from '../shared/state/shell'
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { refreshDb } from '../features/tags/state'
import { loadSkills } from '../features/skills/state'
import { saveSettings, checkUpdate, dismissUpdate, receiveUpdate } from '../features/settings/state'
import { importImagePrompt, flushWorkspace, applyWorkspace } from '../features/prompts/actions'
import { refreshFavorites } from '../features/favorites/public'
import { refreshSnippets } from '../features/prompts/snippets-state'
import {
  creationTabs,
  createTab,
  openTabForLoad,
  switchTab,
  tabSummaries,
  tabsBlocker,
} from '../features/creation/tabs'
import { cleanErr } from '../shared/lib/format'
import { toast, runToastAction } from '../shared/lib/notifications'
import { type Tab } from '../shared/state/shell'
import {
  APP_TABS,
  type DesktopCommand,
  type DesktopState,
  type FrontendRequest,
  type FrontendContext,
} from '@shared/contracts/desktop'
import { readPngPrompt } from '../features/prompts/png-import'
import CompareView from '../features/prompts/CompareView.vue'
import CreationLayout from '../features/creation/CreationLayout.vue'
import SearchView from '../features/tags/SearchView.vue'
import AiView from '../features/prompts/AiView.vue'
import PreviewView from '../features/prompts/PreviewView.vue'
import GenerateView from '../features/generation/GenerateView.vue'
import GalleryView from '../features/gallery/GalleryView.vue'
import FavoritesView from '../features/favorites/FavoritesView.vue'
import ReverseView from '../features/reverse/ReverseView.vue'
import SubscriptionStatus from '../features/generation/components/SubscriptionStatus.vue'
import WorkspacesView from '../features/workspace/WorkspacesView.vue'
import SettingsView from '../features/settings/SettingsView.vue'
import Icon from '../shared/ui/Icon.vue'
import Mascot from '../shared/ui/Mascot.vue'
import SkillPicker from '../features/skills/components/SkillPicker.vue'
import type { IconName } from '../shared/ui/icons'
import type { NaiVersion } from '@shared/generation/types'
import TaskCenter from './components/TaskCenter.vue'
import UpdateAction from '../features/settings/components/UpdateAction.vue'
import { prepareUpdateKey, updateLabel } from '../features/settings/updates'
import { connectTasks, taskState, cancelTask } from '../shared/state/tasks'
import { taskIsActive } from '@shared/tasks/model'

const confirmations = ref<ConfirmationRequest[]>([])
const confirmation = computed(() => confirmations.value[0])
const offConfirmations = window.api.onConfirmations((requests) => {
  confirmations.value = requests
})
onBeforeUnmount(offConfirmations)
function replyConfirmation(approved: boolean) {
  if (confirmation.value) {
    void window.api.replyConfirmation(confirmation.value.id, approved).catch(reportError)
  }
}

/**
 * 侧栏统一用四字「对象 + 动作」名称：先查词，再写提示词并试图，从图片反推，围绕一张图精修；
 * 图集、收藏、设置是工具。
 */
const tabs: { key: Tab; label: string; icon: IconName; desc: string; tool?: boolean }[] = [
  {
    key: 'search',
    label: '词库检索',
    icon: 'tag',
    desc: '检索本地 Danbooru 词库：中文、英文、拼音首字母都能搜，单击加到最近编辑的输入框',
  },
  {
    key: 'creation',
    label: '生图创作',
    icon: 'sparkle',
    desc: '在同一页编辑提示词，检查词条、智能优化、推测画面并生成图片',
  },
  {
    key: 'reverse',
    label: '图片反推',
    icon: 'search',
    desc: '从参考图在本机识别基础提示词与画师风格，不上传图片',
  },
  {
    key: 'workspace',
    label: '图片精修',
    icon: 'wand',
    desc: '围绕一张图持续讨论、局部重绘和修图，保留每个版本',
  },
  {
    key: 'gallery',
    label: '图集管理',
    icon: 'folder',
    desc: '按图集整理、查看和复用生成图片',
    tool: true,
  },
  {
    key: 'favorites',
    label: '收藏管理',
    icon: 'star',
    desc: '查看收藏图片与生成记录，按需载入提示词',
    tool: true,
  },
  {
    key: 'settings',
    label: '应用设置',
    icon: 'sliders',
    desc: '词库、AI 服务与软件设置',
    tool: true,
  },
]
const current = computed(() => tabs.find((tab) => tab.key === shellState.tab)!)
const creationPanel = ref<Tab>('compare')
const creationActive = computed(() => shellState.tab === 'creation')
/**
 * 词条检查、智能优化、画面推测、图片预览只在生图创作里提供。
 * 其他页面、任务中心或 MCP 仍可能跳到这些旧页签名称：统一转为生图创作的对应分页。
 */
const CREATION_PANELS: Tab[] = ['compare', 'ai', 'preview', 'generate']
watch(
  () => shellState.tab,
  (tab) => {
    if (CREATION_PANELS.includes(tab)) {
      creationPanel.value = tab
      shellState.tab = 'creation'
    }
  },
  { flush: 'sync', immediate: true },
)
function navigateCreation(tab: Tab) {
  shellState.tab = tab
}
const pageVisible = (tab: Tab) =>
  creationActive.value ? creationPanel.value === tab : shellState.tab === tab
const development = ref(false)
const cleanup = ref({ pending: 0, message: '' })
const cleanupBusy = ref(false)
async function retryCleanup() {
  cleanupBusy.value = true
  try {
    cleanup.value = await window.api.imagesCleanupRetry()
    if (!cleanup.value.message) {
      toast('上次运行的临时文件已清理')
    }
  } catch (error) {
    cleanup.value.message = `清理未完成：${cleanErr(error)}`
  } finally {
    cleanupBusy.value = false
  }
}
let offTasks: (() => void) | undefined
let offUpdate: (() => void) | undefined
let offDesktop: (() => void) | undefined
let offSkills: (() => void) | undefined
let offLibrary: (() => void)[] = []
let updateTimer: ReturnType<typeof setTimeout> | undefined
const workspaceView = ref<InstanceType<typeof WorkspacesView>>()
const settingsView = ref<InstanceType<typeof SettingsView>>()
const reverseView = ref<InstanceType<typeof ReverseView>>()
const generateView = ref<InstanceType<typeof GenerateView>>()
const contentEl = ref<HTMLElement>()

/** 侧栏选中项的白色高亮块：切换页面时滑到新位置，而不是瞬间跳过去 */
const navEl = ref<HTMLElement>()
const navMark = ref({ y: 0, height: 0, visible: false, animate: false })
function placeNavMark() {
  const active = navEl.value?.querySelector<HTMLElement>('.nav-item.active')
  if (!active) {
    navMark.value = { ...navMark.value, visible: false }
    return
  }
  navMark.value = {
    y: active.offsetTop,
    height: active.offsetHeight,
    visible: true,
    // 首次定位不播放滑动
    animate: navMark.value.visible,
  }
}
watch(() => shellState.tab, placeNavMark, { flush: 'post' })
let navObserver: ResizeObserver | undefined
onMounted(() => {
  placeNavMark()
  navObserver = new ResizeObserver(() => {
    navMark.value.animate = false
    placeNavMark()
  })
  if (navEl.value) {
    navObserver.observe(navEl.value)
  }
})
onBeforeUnmount(() => navObserver?.disconnect())

/** toast 默认贴底居中；当前页面底部有操作栏（data-toast-avoid）时抬到栏上方，避免盖住生成等按钮 */
const toastBottom = ref(28)
watch(
  () => shellState.toast,
  (text) => {
    // 在 toast 渲染前量好底栏位置，避免先出现在底部再跳上去
    if (!text) {
      return
    }
    let bottom = 28
    for (const bar of document.querySelectorAll<HTMLElement>('[data-toast-avoid]')) {
      const rect = bar.getBoundingClientRect()
      if (rect.height && rect.bottom >= window.innerHeight - 4) {
        bottom = Math.max(bottom, Math.round(window.innerHeight - rect.top + 12))
      }
    }
    toastBottom.value = bottom
  },
  { flush: 'pre' },
)

/**
 * 视图用 v-show 切换，重新显示时其中所有 CSS 进场动画都会重播（卡片依次弹出等）。
 * 切换页面只保留视图自身的淡入（view-in），其余有限次的进场动画直接结束；
 * 之后新出现的元素（新结果、新列表项）仍按原样播放进场动画。
 */
watch(
  () => shellState.tab,
  () => {
    for (const animation of contentEl.value?.getAnimations({ subtree: true }) ?? []) {
      if (
        animation instanceof CSSAnimation &&
        animation.animationName !== 'view-in' &&
        animation.effect?.getComputedTiming().iterations !== Infinity
      ) {
        animation.finish()
      }
    }
  },
  { flush: 'post' },
)
const desktopSession = crypto.randomUUID()
const frontend = ref<DesktopState['frontend']>(null)
const agentTask = computed(() =>
  taskState.tasks.find((task) => task.origin === 'agent' && taskIsActive(task)),
)
const agentOperating = computed(() => frontend.value?.status === 'running' || !!agentTask.value)
const agentStage = computed(() =>
  frontend.value?.status === 'running' ? frontend.value.stage : (agentTask.value?.message ?? ''),
)
const showAgentResult = ref(false)
let agentResultTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => frontend.value?.status,
  (status) => {
    clearTimeout(agentResultTimer)
    showAgentResult.value = status === 'completed'
    if (showAgentResult.value) {
      agentResultTimer = setTimeout(() => {
        showAgentResult.value = false
      }, 4000)
    }
  },
)
onBeforeUnmount(() => clearTimeout(agentResultTimer))
let frontendController: AbortController | null = null
let frontendId = ''
let cancelledFrontendId = ''
let markDesktopReady: () => void
const desktopReady = new Promise<void>((resolve) => {
  markDesktopReady = resolve
})
let offFrontend: (() => void) | undefined
function stopFrontend() {
  frontendController?.abort()
  window.api.cancelFrontend()
}
provide('frontend-control', { state: frontend, stop: stopFrontend })
let captureLease = ''
let captureStyle: HTMLStyleElement | null = null
let captureTimer: ReturnType<typeof setTimeout> | undefined
function endCapture(lease = captureLease) {
  if (lease !== captureLease) {
    return
  }
  clearTimeout(captureTimer)
  captureStyle?.remove()
  captureStyle = null
  captureLease = ''
}
async function prepareCapture(lease: string) {
  if (!lease || captureLease) {
    throw new Error('截图准备尚未完成，请稍后重试')
  }
  captureLease = lease
  const selector = 'input[type="password"], [data-mcp-private]'
  const privateElements = [...document.querySelectorAll(selector)].filter(
    (el) => el.getClientRects().length > 0,
  )
  const redactedFields = privateElements.length
  const redactions = privateElements
    .flatMap((el) => [el, ...el.querySelectorAll('*')])
    .flatMap((el) =>
      [...el.getClientRects()].map((bounds) => ({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      })),
    )
  captureStyle = document.createElement('style')
  captureStyle.id = 'np-mcp-capture-privacy'
  captureStyle.textContent = `${selector}, [data-mcp-private] * { visibility: hidden !important; }`
  document.head.append(captureStyle)
  const expiresAt = Date.now() + 10000
  captureTimer = setTimeout(() => endCapture(lease), 10000)
  try {
    await nextTick()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('界面尚未绘制，请显示窗口后重试')), 1500)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          clearTimeout(timer)
          resolve()
        }),
      )
    })
    return {
      desktop: desktopSnapshot(),
      redactedFields,
      redactions,
      expiresAt,
      viewport: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
    }
  } catch (error) {
    endCapture(lease)
    throw error
  }
}
let desktopRevision = 0
let desktopKey = ''
function desktopSnapshot(): DesktopState {
  const blockers: string[] = []
  if (confirmation.value) {
    blockers.push('等待用户确认付费授权')
  }
  try {
    generateView.value?.prepareUpdate()
  } catch (error) {
    blockers.push(cleanErr(error))
  }
  if (workspaceView.value?.isCreating()) {
    blockers.push('正在新建图片精修项目')
  }
  const value = {
    tab: shellState.tab,
    creationPanel: creationPanel.value,
    draft: {
      base: promptState.prompt,
      negative: promptState.negative,
      characters: promptState.characters.map((character) => ({ ...character })),
    },
    creationTabs: tabSummaries(),
    model: settingsState.settings?.naiVersion ?? 'v5',
    image: imageState.currentImage ? { ...imageState.currentImage } : null,
    workspace: workspaceView.value?.desktopState() ?? null,
    blockers,
    frontend: frontend.value ? { ...frontend.value } : null,
  }
  const key = JSON.stringify(value)
  if (key !== desktopKey) {
    desktopKey = key
    desktopRevision++
  }
  return { token: `${desktopSession}:${desktopRevision}`, ...value }
}
function publishDesktop() {
  window.api.publishDesktop(desktopSnapshot())
}
watch(() => JSON.stringify(desktopSnapshot()), publishDesktop, { flush: 'post' })
async function desktopCommand(command: DesktopCommand) {
  try {
    const argumentsRecord = command.args
    if (command.type !== 'snapshot') {
      await desktopReady
    }
    if (
      confirmation.value &&
      !['snapshot', 'capture-prepare', 'capture-end', 'workspace-release'].includes(command.type)
    ) {
      throw new Error('等待用户确认付费授权，Agent 不能代替用户操作')
    }
    if (command.type === 'capture-prepare') {
      const result = await prepareCapture(String(argumentsRecord.lease))
      window.api.replyDesktop({ id: command.id, result })
      return
    }
    if (command.type === 'capture-end') {
      endCapture(String(argumentsRecord.lease))
    } else if (command.type === 'frontend') {
      const request = argumentsRecord as unknown as FrontendRequest
      if (request.actionId === cancelledFrontendId) {
        throw new Error('前台操作已停止')
      }
      if (frontendController) {
        throw new Error('前台操作正在执行')
      }
      if (request.expected_token && request.expected_token !== desktopSnapshot().token) {
        throw new Error('界面内容已变化，请重新读取 get_app_state，未覆盖用户输入')
      }
      generateView.value?.prepareUpdate()
      if (!workspaceView.value) {
        throw new Error('工作台尚未就绪')
      }
      const ctrl = new AbortController()
      frontendController = ctrl
      frontendId = request.actionId
      frontend.value = { label: request.label, stage: '准备操作…', status: 'running' }
      const context: FrontendContext = {
        actionId: request.actionId,
        agentSession: request.agent_session,
        signal: ctrl.signal,
        step: async (message) => {
          if (ctrl.signal.aborted) {
            throw new Error('已停止，已保存的内容保留')
          }
          frontend.value = { label: request.label, stage: message, status: 'running' }
          await nextTick()
          publishDesktop()
          // Keep each UI transition visible before advancing to the next action.
          await new Promise((resolve) => setTimeout(resolve, request.step_delay_ms ?? 300))
          if (ctrl.signal.aborted) {
            throw new Error('已停止，已保存的内容保留')
          }
        },
      }
      try {
        shellState.tab = 'workspace'
        await workspaceView.value.frontendAction(request, context)
        frontend.value = {
          label: request.label,
          stage: ctrl.signal.aborted ? '已停止，已完成的结果保留' : '已完成',
          status: ctrl.signal.aborted ? 'error' : 'completed',
        }
      } catch (error) {
        frontend.value = { label: request.label, stage: cleanErr(error), status: 'error' }
        throw error
      } finally {
        frontendController = null
        frontendId = ''
      }
    } else if (command.type === 'navigate') {
      if (!APP_TABS.includes(argumentsRecord.tab as Tab)) {
        throw new Error('未知页面')
      }
      generateView.value?.prepareUpdate()
      if (argumentsRecord.workspace_id) {
        await workspaceView.value?.agentOpen(String(argumentsRecord.workspace_id))
      }
      const tabId = argumentsRecord.creation_tab_id
      if (tabId !== undefined) {
        if (!creationTabs.list.some((tab) => tab.id === tabId)) {
          throw new Error('标签不存在，请重新读取 get_app_state 的 creationTabs')
        }
        const reason = tabsBlocker()
        if (reason && tabId !== creationTabs.activeId) {
          throw new Error(`${reason}，暂时不能切换标签`)
        }
        switchTab(String(tabId))
      }
      shellState.tab = argumentsRecord.tab as Tab
    } else if (command.type === 'apply-prompt') {
      generateView.value?.prepareUpdate()
      if (argumentsRecord.expected_token !== desktopSnapshot().token) {
        throw new Error('界面内容已变化，请重新读取 get_app_state 后再提交，未覆盖用户输入')
      }
      // target=new_tab：按「载入配置」规则承接（当前标签为空则直接用，否则新开）；
      // target=fresh_tab：总是新开标签。都不覆盖用户正在编辑的标签
      const target = argumentsRecord.target ?? 'current'
      const title = typeof argumentsRecord.tab_title === 'string' ? argumentsRecord.tab_title : ''
      if (target !== 'current') {
        const reason = tabsBlocker()
        if (reason) {
          throw new Error(`${reason}，暂时不能新开标签`)
        }
        const opened = target === 'fresh_tab' ? createTab(title) : openTabForLoad(title)
        if (!opened) {
          throw new Error('无法新开标签：已达 10 个上限，请先让用户关闭不用的标签')
        }
      }
      applyWorkspace(argumentsRecord.draft as DesktopState['draft'], 'Agent 修改前')
      flushWorkspace()
      toast(
        target === 'current'
          ? 'Agent 已更新当前提示词，可从历史恢复'
          : 'Agent 已在标签中写入提示词，原标签未改动',
      )
    } else if (command.type === 'workspace-lock') {
      await workspaceView.value?.beginRemote(
        String(argumentsRecord.id),
        String(argumentsRecord.lease),
      )
    } else if (command.type === 'workspace-release') {
      await workspaceView.value?.endRemote(
        String(argumentsRecord.id),
        String(argumentsRecord.lease),
      )
    } else if (command.type === 'show-image') {
      setPreviewImage(argumentsRecord.image as DesktopState['image'])
    }
    await nextTick()
    publishDesktop()
    window.api.replyDesktop({ id: command.id, result: desktopSnapshot() })
  } catch (error2) {
    window.api.replyDesktop({ id: command.id, error: cleanErr(error2) })
  }
}
provide(prepareUpdateKey, async () => {
  await nextTick()
  reverseView.value?.prepareUpdate()
  settingsView.value?.prepareUpdate()
  generateView.value?.prepareUpdate()
  if (!(await workspaceView.value?.prepareUpdate())) {
    throw new Error('请先保存或完成图片精修中的编辑，再重启更新')
  }
  flushWorkspace()
})
onBeforeUnmount(() => {
  offTasks?.()
  offUpdate?.()
  offDesktop?.()
  offSkills?.()
  offLibrary.forEach((off) => off())
  offFrontend?.()
  frontendController?.abort()
  clearTimeout(updateTimer)
  endCapture()
})

onMounted(async () => {
  void window.api
    .mcpInfo()
    .then((info) => {
      development.value = info?.runtime?.mode === 'development'
    })
    .catch(() => {})
  void window.api
    .imagesCleanupStatus()
    .then((value) => {
      cleanup.value = value
    })
    .catch(() => {})
  offTasks = connectTasks()
  offSkills = window.api.onSkillsChanged(() => {
    void loadSkills().catch((candidate) => toast(cleanErr(candidate)))
  })
  // Agent 改了收藏或提示词片段时刷新，星标与片段库保持一致
  offLibrary = [
    window.api.onFavoritesChanged(() => {
      void refreshFavorites().catch((candidate) => toast(cleanErr(candidate)))
    }),
    window.api.onSnippetsChanged(() => {
      void refreshSnippets().catch((candidate) => toast(cleanErr(candidate)))
    }),
  ]
  let commands = Promise.resolve()
  offFrontend = window.api.onFrontendCancel((id) => {
    cancelledFrontendId = id
    if (id === frontendId) {
      frontendController?.abort()
    }
  })
  offDesktop = window.api.onDesktopCommand((command) => {
    if (
      ['snapshot', 'capture-prepare', 'capture-end', 'workspace-release'].includes(command.type)
    ) {
      void desktopCommand(command).catch(reportError)
    } else {
      commands = commands.then(() => desktopCommand(command))
    }
  })
  publishDesktop()
  offUpdate = window.api.onUpdate(receiveUpdate)
  void window.api
    .updateState()
    .then(receiveUpdate)
    .catch(() => {})
  settingsState.settings = await window.api.getSettings()
  await refreshDb()
  window.api.onProgress((progress) => {
    tagState.progress = progress
    if (progress.stage === 'done' || progress.stage === 'error') {
      refreshDb().catch(reportError)
    }
  })
  if (!tagState.db?.loaded) {
    shellState.tab = 'settings'
  }
  markDesktopReady()
  // 启动后再查；检查与下载都在后台，不影响编辑。
  updateTimer = setTimeout(() => void checkUpdate().catch(reportError), 3000)
})

const switchingVersion = ref(false)
async function setVersion(modelVersion: NaiVersion) {
  if (switchingVersion.value || settingsState.settings?.naiVersion === modelVersion) {
    return
  }
  switchingVersion.value = true
  try {
    await saveSettings({ naiVersion: modelVersion })
    toast(`已切换至 NovelAI ${modelVersion.toUpperCase()}`)
  } catch (error) {
    reportError(error)
  } finally {
    switchingVersion.value = false
  }
}

/* ---------- 拖入原图，读取提示词与生成参数 ---------- */
const dragDepth = ref(0)
const hasFile = (event2: DragEvent) => !!event2.dataTransfer?.types.includes('Files')
function onDragEnter(event2: DragEvent) {
  if (shellState.tab === 'reverse') {
    return
  }
  if (hasFile(event2)) {
    dragDepth.value++
  }
}
function onDragOver(event2: DragEvent) {
  // 必须阻止默认行为，否则 Electron 会直接打开图片
  if (hasFile(event2)) {
    event2.preventDefault()
  }
}
function onDragLeave(event2: DragEvent) {
  if (hasFile(event2)) {
    dragDepth.value = Math.max(0, dragDepth.value - 1)
  }
}
async function onDrop(event2: DragEvent) {
  if (shellState.tab === 'reverse') {
    event2.preventDefault()
    dragDepth.value = 0
    return
  }
  if (!hasFile(event2)) {
    return
  }
  event2.preventDefault()
  dragDepth.value = 0
  const file = event2.dataTransfer?.files?.[0]
  if (!file) {
    return
  }
  try {
    const imported = await readPngPrompt(file)
    // 拖入原图等同「载入配置」：当前标签有内容时新开标签承接
    if (openTabForLoad()) {
      await importImagePrompt(imported, '已读取原图')
    }
  } catch (err) {
    toast(cleanErr(err))
  }
}
</script>

<template>
  <ConfirmDialog
    v-if="confirmation"
    :key="confirmation.id"
    :title="confirmation.title"
    :message="
      confirmation.cost
        ? confirmation.message
        : [confirmation.message, confirmation.detail].filter(Boolean).join('\n\n')
    "
    :cost="confirmation.cost"
    :confirm-label="confirmation.confirmLabel"
    @confirm="replyConfirmation(true)"
    @cancel="replyConfirmation(false)"
  />
  <div
    class="layout"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <aside
      class="sidebar"
      :inert="frontend?.status === 'running'"
    >
      <div class="brand">
        <Mascot
          mood="avatar"
          :size="46"
          class="brand-avatar"
        />
        <div>
          <div class="brand-name">Novel<b>Prompt</b></div>
          <div class="brand-sub">{{ development ? '开发版 · 独立数据' : 'tag 小助手' }}</div>
        </div>
      </div>

      <nav
        ref="navEl"
        :class="{ sliding: navMark.visible }"
      >
        <span
          class="nav-mark"
          :class="{ animate: navMark.animate }"
          :style="{
            opacity: navMark.visible ? 1 : 0,
            transform: `translateY(${navMark.y}px)`,
            height: `${navMark.height}px`,
          }"
          aria-hidden="true"
        ></span>
        <template
          v-for="(t, index) in tabs"
          :key="t.key"
        >
          <div
            v-if="t.tool && !tabs[index - 1]?.tool"
            class="nav-sep"
          ></div>
          <button
            :class="['nav-item', { active: shellState.tab === t.key }]"
            @click="shellState.tab = t.key"
          >
            <Icon :name="t.icon" />
            <span class="nav-label">{{ t.label }}</span>
          </button>
        </template>
      </nav>

      <div class="side-bottom">
        <div
          v-if="settingsState.update?.newer && !settingsState.updateDismissed"
          class="update-card"
        >
          <div class="update-head">
            <Icon
              name="download"
              :size="14"
            />
            <b>{{ updateLabel(settingsState.update) }}</b>
          </div>
          <div class="update-actions">
            <UpdateAction />
            <button
              class="btn ghost small"
              @click="dismissUpdate"
            >
              忽略
            </button>
          </div>
        </div>
        <SkillPicker v-if="settingsState.settings" />
        <div v-if="settingsState.settings">
          <div class="side-label">目标模型</div>
          <div class="seg block">
            <button
              :class="{ on: settingsState.settings.naiVersion === 'v4.5' }"
              :disabled="switchingVersion"
              @click="setVersion('v4.5')"
            >
              V4.5
            </button>
            <button
              :class="{ on: settingsState.settings.naiVersion === 'v5' }"
              :disabled="switchingVersion"
              @click="setVersion('v5')"
            >
              V5
            </button>
          </div>
        </div>
        <SubscriptionStatus v-if="settingsState.settings" />
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div class="topbar-title">
          <Icon
            :name="current.icon"
            :size="17"
          />
          {{ current.label }}
        </div>
        <div
          class="agent-status-slot"
          aria-live="polite"
        >
          <div
            v-if="agentOperating"
            class="agent-operating"
            role="status"
            :title="agentStage"
          >
            <Icon
              name="sparkle"
              :size="14"
              class="spin-slow"
            /><b>外部 Agent 正在操作</b><span>{{ agentStage }}</span
            ><button
              class="btn ghost small"
              @click="
                frontend?.status === 'running'
                  ? stopFrontend()
                  : agentTask && cancelTask(agentTask.id)
              "
            >
              停止
            </button>
          </div>
          <details
            v-else-if="frontend?.status === 'error'"
            class="agent-error"
          >
            <summary class="disclosure">Agent 操作未完成</summary>
            <div role="alert">
              {{ frontend.stage
              }}<button
                class="btn ghost small"
                @click="frontend = null"
              >
                关闭
              </button>
            </div>
          </details>
          <span
            v-else-if="showAgentResult"
            class="muted small"
            role="status"
            >Agent 操作已完成</span
          >
        </div>
        <TaskCenter />
      </header>
      <div
        v-if="cleanup.message"
        class="frontend-status"
        role="status"
      >
        <span>{{ cleanup.message }} 本次新生成的临时图片会保留到退出。</span
        ><button
          class="btn small"
          :disabled="cleanupBusy"
          @click="retryCleanup"
        >
          {{ cleanupBusy ? '正在清理' : '重试清理' }}
        </button>
      </div>
      <div
        ref="contentEl"
        class="content"
        :inert="frontend?.status === 'running'"
      >
        <CreationLayout
          :active="creationActive"
          :panel="creationPanel"
          @navigate="navigateCreation"
        >
          <CompareView v-show="pageVisible('compare')" />
          <AiView v-show="pageVisible('ai')" />
          <PreviewView v-show="pageVisible('preview')" />
          <GenerateView
            v-show="pageVisible('generate')"
            ref="generateView"
          />
        </CreationLayout>
        <ReverseView
          v-show="shellState.tab === 'reverse'"
          ref="reverseView"
        />
        <SearchView v-show="shellState.tab === 'search'" />
        <WorkspacesView
          v-show="shellState.tab === 'workspace'"
          ref="workspaceView"
        />
        <GalleryView v-if="shellState.tab === 'gallery'" />
        <FavoritesView v-show="shellState.tab === 'favorites'" />
        <SettingsView
          v-show="shellState.tab === 'settings'"
          ref="settingsView"
        />
      </div>
    </main>

    <transition name="fade">
      <div
        v-if="dragDepth > 0"
        class="drop-overlay"
      >
        <div class="drop-card">
          <Icon
            name="image"
            :size="30"
          />
          <b>松手加载图片配置</b>
          <span>读取提示词和生成参数，可撤销</span>
        </div>
      </div>
    </transition>

    <transition name="toast">
      <div
        v-if="shellState.toast"
        class="toast"
        :style="{ bottom: `${toastBottom}px` }"
        role="status"
        aria-live="polite"
      >
        <Icon
          name="paw"
          :size="16"
        />
        <span>{{ shellState.toast }}</span>
        <button
          v-if="shellState.toastAction"
          class="toast-action"
          @click="runToastAction"
        >
          {{ shellState.toastAction.label }}
        </button>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.agent-status-slot {
  margin-left: auto;
  min-width: 0;
  max-width: 470px;
  -webkit-app-region: no-drag;
}

.agent-operating {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--pink-deep);
  min-width: 0;
}

.agent-operating b {
  white-space: nowrap;
  font-weight: 500;
}

.agent-operating > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  max-width: 180px;
}

.agent-operating button {
  flex-shrink: 0;
}

.agent-error {
  position: relative;
  font-size: 12px;
  color: var(--bad);
}

.agent-error summary {
  cursor: pointer;
}

.agent-error > div {
  position: absolute;
  right: 0;
  top: 28px;
  z-index: 100;
  width: 300px;
  padding: 16px;
  line-height: 1.8;
  overflow-wrap: anywhere;
  border: 1px solid var(--pink-line);
  border-radius: 12px;
  background: var(--bg);
  box-shadow: 0 8px 24px #0002;
}

.agent-error button {
  display: block;
  margin-left: auto;
}

@media (width <= 1200px) {
  .agent-operating > span {
    display: none;
  }
}

.frontend-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 9px 20px;
  border-bottom: 1px solid var(--pink-line);
  background: var(--panel);
  font-size: 12px;
}

.frontend-status b {
  margin-right: 12px;
}
</style>
