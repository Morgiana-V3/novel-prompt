import type { PageAgentIdentity, PageWorkspace } from '@shared/workspace/model'
import type { Ref } from 'vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { settingsState } from '../settings/state'
export function useAgentState(work: Ref<PageWorkspace>) {
  const connections = ref<PageAgentIdentity[]>([])

  const external = computed(() => work.value.agentMode === 'external')

  const agentConnected = computed(() =>
    connections.value.some((agent) => agent.sessionId === work.value.externalAgent?.sessionId),
  )

  const pendingRequest = computed(() =>
    work.value.messages.find((message) => message.externalRequest?.status === 'pending'),
  )

  const agentActivity = computed(() =>
    pendingRequest.value
      ? connections.value
          .find((agent) => agent.sessionId === work.value.externalAgent?.sessionId)
          ?.activity?.find(
            (activity) =>
              activity.workspaceId === work.value.id &&
              activity.requestId === pendingRequest.value!.id,
          )
      : undefined,
  )

  const agentStatus = computed(() => {
    if (!agentConnected.value) {
      if (work.value.externalAgent) {
        return '连接已断开' as const
      }
      return '等待连接' as const
    }
    if (agentActivity.value) {
      return 'Agent 正在处理' as const
    }
    if (pendingRequest.value) {
      return '等待 Agent 处理' as const
    }
    return '已连接 · 待命' as const
  })

  const agentLabel = computed(() =>
    external.value
      ? (work.value.externalAgent?.name ?? '外部 Agent')
      : settingsState.settings?.model || '内置 AI',
  )
  let unsubscribe: (() => void) | undefined
  let alive = true
  onMounted(() => {
    unsubscribe = window.api.onAgentConnections((agents) => {
      connections.value = agents
    })
    void window.api
      .agentConnections()
      .then((agents) => {
        if (alive) {
          connections.value = agents
        }
      })
      .catch((error) => {
        console.warn('Unable to read agent connections; waiting for live events', error)
      })
  })
  onBeforeUnmount(() => {
    alive = false
    unsubscribe?.()
  })
  return {
    connections,
    external,
    agentConnected,
    pendingRequest,
    agentActivity,
    agentStatus,
    agentLabel,
  }
}
