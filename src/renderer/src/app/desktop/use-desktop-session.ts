import { nextTick, onBeforeUnmount, watch } from 'vue'
import {
  APP_TABS,
  type DesktopCommand,
  type DesktopState,
  type FrontendRequest,
} from '@shared/contracts/desktop'
import { shellState, type Tab } from '../../shared/state/shell'
import { cleanErr } from '../../shared/lib/format'
import { toast, reportError } from '../../shared/lib/notifications'
import { setPreviewImage } from '../../features/generation/public'
import { applyWorkspace } from '../../features/prompts/public/editing'
import { flushWorkspace } from '../../features/prompts/public/import-export'
import {
  creationTabs,
  createTab,
  openTabForLoad,
  switchTab,
  tabsBlocker,
} from '../../features/creation/public/navigation'
import type { DesktopHost } from './types'
import { createDesktopSnapshot } from './snapshot'
import { useCapturePrivacy } from './use-capture-privacy'
import { useFrontendActions } from './use-frontend-actions'

/** Connects host IPC to existing view actions; no parallel editor or generation state. */
export function useDesktopSession(host: DesktopHost) {
  const { confirmation, workspaceView, generateView } = host
  const actions = useFrontendActions(
    host,
    () => desktopSnapshot(),
    () => publishDesktop(),
  )
  const { frontend, runFrontend, connectFrontend } = actions
  const desktopSnapshot = createDesktopSnapshot(host, frontend)
  const { prepareCapture, endCapture } = useCapturePrivacy(desktopSnapshot)
  let offDesktop: (() => void) | undefined
  let markDesktopReady!: () => void
  const desktopReady = new Promise<void>((resolve) => {
    markDesktopReady = resolve
  })
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
        await runFrontend(argumentsRecord as unknown as FrontendRequest)
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
  function connectDesktop() {
    let commands = Promise.resolve()
    connectFrontend()
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
  }
  onBeforeUnmount(() => offDesktop?.())
  return { ...actions, connectDesktop, markDesktopReady }
}
