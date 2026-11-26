import { computed, nextTick, onBeforeUnmount, provide, ref, watch } from 'vue'
import type {
  CreationInpaintReceipt,
  DesktopState,
  FrontendRequest,
  FrontendContext,
} from '@shared/contracts/desktop'
import { shellState } from '../../shared/state/shell'
import { taskState } from '../../shared/state/tasks'
import { taskIsActive } from '@shared/tasks/model'
import { cleanErr } from '../../shared/lib/format'
import type { DesktopHost } from './types'
import { validImg2Img } from '@shared/generation/types'
import { setCreationImg2Img } from '../../features/generation/public'
import { loadFavoriteConfiguration } from '../../features/favorites/public'
import { toast } from '../../shared/lib/notifications'

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
  function requireCreationView() {
    if (workspaceView.value?.isCreating()) {
      throw new Error('请先完成图片精修项目的新建')
    }
    if (workspaceView.value?.desktopState()?.editing) {
      throw new Error('请先保存或完成图片精修中的编辑')
    }
    const view = generateView.value
    if (!view) {
      throw new Error('生图创作页面尚未就绪')
    }
    return view
  }
  async function runCreationConfig(request: FrontendRequest, context: FrontendContext) {
    const view = requireCreationView()
    if (request.creation_config_action === 'load') {
      const favorite = (await window.api.recipesList()).find(
        (item) => item.id === request.favorite_id,
      )
      if (!favorite) {
        throw new Error('收藏不存在，请重新调用 list_favorites')
      }
      shellState.tab = 'favorites'
      await context.step('核对素材并载入收藏配置…')
      if (
        !(await loadFavoriteConfiguration(favorite, {
          keepSeed: request.keep_seed,
          canLoad: () => !context.signal.aborted,
        }))
      ) {
        throw new Error('未载入配置，请检查创作标签状态')
      }
      if (favorite.img2img) {
        await nextTick()
        view.openReferenceTab('img2img')
      }
      return
    }
    shellState.tab = 'generate'
    if (request.creation_config_action === 'save') {
      await context.step('收藏当前创作配置…')
      await view.saveCurrentConfig()
      return
    }
    if (request.creation_config_action !== 'set_img2img' || !request.image) {
      throw new Error('缺少图生图底图')
    }
    await context.step('载入图生图底图…')
    const img2img = {
      imageName: await window.api.naiImportReference(request.image.name),
      strength: request.strength,
      noise: request.noise,
    }
    if (!validImg2Img(img2img)) {
      throw new Error('图生图重绘强度或额外噪声无效')
    }
    if (context.signal.aborted) {
      throw new Error('已停止，原底图保留')
    }
    setCreationImg2Img(img2img)
    await nextTick()
    view.openReferenceTab('img2img')
  }
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
    let inpaintReceipt: CreationInpaintReceipt | undefined
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
      } else if (request.action === 'creation-config') {
        await runCreationConfig(request, context)
      } else if (request.action === 'creation-inpaint') {
        const view = requireCreationView()
        shellState.tab = 'generate'
        await nextTick()
        inpaintReceipt = await view.frontendInpaint(request, context)
      } else {
        shellState.tab = 'workspace'
        await workspaceView.value.frontendAction(request, context)
      }
      let stage = ctrl.signal.aborted ? '已停止，已完成的结果保留' : '已完成'
      if (inpaintReceipt) {
        if (ctrl.signal.aborted) {
          inpaintReceipt.stopped ??= '已停止，已保存的重绘结果保留'
        }
        stage = '局部重绘已保存'
        if (inpaintReceipt.billing.status === 'unknown') {
          stage += '，Anlas 变化未知，请核对费用'
        }
        if (inpaintReceipt.stopped) {
          stage += `。${inpaintReceipt.stopped}`
        }
        if (inpaintReceipt.billing.status === 'unknown' || inpaintReceipt.stopped) {
          toast(stage)
        }
      }
      frontend.value = {
        label: request.label,
        stage,
        status: ctrl.signal.aborted ? 'error' : 'completed',
      }
      return inpaintReceipt
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
