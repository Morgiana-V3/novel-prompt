import { computed, nextTick, onBeforeUnmount, provide, ref, watch } from 'vue'
import type { DesktopState, FrontendRequest, FrontendContext } from '@shared/contracts/desktop'
import { shellState } from '../../shared/state/shell'
import { taskState } from '../../shared/state/tasks'
import { taskIsActive } from '@shared/tasks/model'
import { cleanErr } from '../../shared/lib/format'
import type { DesktopHost } from './types'

/** Serial visible actions retain ownership, cancellation and their user-facing progress. */
export function useFrontendActions(
  host: DesktopHost,
  desktopSnapshot: () => DesktopState,
  publishDesktop: () => void,
) {
  const { workspaceView, generateView, aiView } = host
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
  let offFrontend: (() => void) | undefined
  function stopFrontend() {
    frontendController?.abort()
    window.api.cancelFrontend()
  }
  provide('frontend-control', { state: frontend, stop: stopFrontend })
  async function runFrontend(request: FrontendRequest) {
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
      if (request.action.startsWith('reverse-')) {
        if (workspaceView.value.desktopState()?.editing) {
          throw new Error('请先保存或完成图片精修中的编辑')
        }
        shellState.tab = 'reverse'
        await nextTick()
        if (!host.reverseView.value) {
          throw new Error('图片反推页面尚未就绪')
        }
        await host.reverseView.value.frontendAction(request, context)
      } else if (request.action.startsWith('creation-ai-')) {
        if (workspaceView.value.desktopState()?.editing) {
          throw new Error('请先保存或完成图片精修中的编辑')
        }
        shellState.tab = 'ai'
        await nextTick()
        if (!aiView.value) {
          throw new Error('智能优化页面尚未就绪')
        }
        await aiView.value.frontendAction(request, context)
      } else {
        shellState.tab = 'workspace'
        await workspaceView.value.frontendAction(request, context)
      }
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
  }
  function connectFrontend() {
    offFrontend = window.api.onFrontendCancel((id) => {
      cancelledFrontendId = id
      if (id === frontendId) {
        frontendController?.abort()
      }
    })
  }
  onBeforeUnmount(() => {
    offFrontend?.()
    frontendController?.abort()
  })
  return {
    frontend,
    agentTask,
    agentOperating,
    agentStage,
    showAgentResult,
    stopFrontend,
    runFrontend,
    connectFrontend,
  }
}
