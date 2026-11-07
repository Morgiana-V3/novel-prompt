import { pageEventMetadata, type PageEventMetadata } from '@shared/workspace/events'
import type { PageMessage } from '@shared/workspace/model'

export interface WorkspaceMessageEntry {
  message: PageMessage
  event: PageEventMetadata | null
  kind: 'message' | 'notice' | 'execution'
}

export interface WorkspaceActivityEntry {
  message: PageMessage
  event: PageEventMetadata
}

function belongsInActivity(event: PageEventMetadata): boolean {
  if (event.severity !== 'info') {
    return false
  }
  switch (event.type) {
    case 'proposal':
    case 'goal':
    case 'agent':
      return true
    case 'legacy':
      if (event.category === 'billing') {
        return event.billing?.status === 'known'
      }
      return ['proposal', 'goal', 'agent', 'version', 'state'].includes(event.category)
    default:
      return false
  }
}

/** Presentation only: preserve every stored message and never infer legacy execution ownership. */
export function workspaceConversationFeed(messages: PageMessage[]) {
  const timeline: WorkspaceMessageEntry[] = []
  const activity: WorkspaceActivityEntry[] = []
  for (const message of messages) {
    const event = pageEventMetadata(message)
    if (message.role !== 'event') {
      timeline.push({ message, event: null, kind: 'message' })
    } else if (
      event?.type === 'execution' ||
      (event?.type === 'legacy' && event.category === 'execution')
    ) {
      timeline.push({ message, event, kind: 'execution' })
    } else if (event && belongsInActivity(event)) {
      activity.push({ message, event })
    } else {
      timeline.push({ message, event, kind: 'notice' })
    }
  }
  return { timeline, activity }
}

export function workspaceActivityLabel(event: PageEventMetadata): string {
  if (event.type === 'proposal') {
    return { accepted: '已采纳方案', rejected: '未采纳方案', withdrawn: '已撤销采纳' }[
      event.decision
    ]
  }
  if (event.type === 'goal') {
    return '更新目标与保留要求'
  }
  if (event.type === 'agent') {
    return event.mode === 'external' ? '外部 Agent 接管' : '切换内置 AI'
  }
  if (event.type === 'legacy') {
    const labels = {
      billing: '费用记录',
      proposal: '方案决定',
      goal: '目标与保留要求',
      agent: 'Agent 变更',
      version: '蓝本变更',
      state: '工作台记录',
      execution: '执行记录',
      error: '异常记录',
    }
    return labels[event.category]
  }
  return '操作记录'
}
