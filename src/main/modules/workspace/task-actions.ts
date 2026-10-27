import type { IpcActions } from '../../../shared/contracts/api'
import type { PageExecution, PageExternalReply } from '../../../shared/workspace/model'
import { getSettings } from '../settings/service'
import type { TaskContext } from '../tasks/context'
import { agentConnections } from './agent-sessions'
import { discussPage } from './discussion'
import { renderPage } from './execution'
import {
  cancelExternalRequest,
  queueExternalRequest,
  replyExternalRequest,
  setPageAgent,
} from './external-collaboration'
import { pageLocks } from './locks'
import { readPage } from './repository'

export function createWorkspaceActions(context: TaskContext) {
  const { tasks, send, claimFrontend } = context

  return {
    'agents:list': () => agentConnections(),
    'pages:agent': (
      id: string,
      revision: number,
      mode: 'internal' | 'external',
      actionId?: string,
    ) => {
      const front = claimFrontend(actionId, 'agent', id)
      return setPageAgent(id, revision, mode, front?.agent)
    },
    'pages:external-reply': (
      id: string,
      revision: number,
      response: PageExternalReply,
      actionId: string,
    ) => {
      const front = claimFrontend(actionId, 'reply', id)
      if (!front) {
        throw new Error('请通过已连接的外部 Agent 提交回复')
      }
      return replyExternalRequest(id, revision, response, front.agent)
    },
    'pages:external-cancel': (id: string, revision: number, actionId?: string) => {
      const front = claimFrontend(actionId, 'external-cancel', id)
      return cancelExternalRequest(id, revision, front?.agent)
    },
    'pages:chat': (
      id: string,
      revision: number,
      text: string,
      region: string | string[] | null,
      refs: string[],
      actionId?: string,
      discussionVersionId?: string,
    ) => {
      const front = claimFrontend(actionId, 'send', id)
      if (readPage(id).agentMode === 'external') {
        return queueExternalRequest(id, revision, text, region, refs, discussionVersionId)
      }
      if (front && (!getSettings().mcpAllowAi || !getSettings().apiKey)) {
        throw new Error('Agent AI 权限已关闭或未配置')
      }
      return tasks.run(
        'page-chat',
        async ({ id: taskId, progress }) => {
          const cancel = () => tasks.cancel(taskId)
          front?.signal.addEventListener('abort', cancel, { once: true })
          try {
            progress('正在分析会话上下文…')
            front?.report('正在分析会话上下文…')
            const result = await discussPage(id, revision, text, region, refs, discussionVersionId)
            progress('讨论完成')
            return result
          } finally {
            front?.signal.removeEventListener('abort', cancel)
          }
        },
        {
          key: `page-chat:${id}`,
          targetId: id,
          onCancel: () => pageLocks.get(id)?.abort(),
          ...(front ? { origin: 'agent', label: front.label } : {}),
        },
      )
    },
    'pages:cancel': (id: string) => tasks.cancelKey(`page-chat:${id}`),
    'pages:generate': (
      id: string,
      revision: number,
      execution: PageExecution,
      actionId?: string,
    ) => {
      const front = claimFrontend(actionId, 'generate', id)
      if (front && (!getSettings().mcpAllowGenerate || !getSettings().naiToken)) {
        throw new Error('Agent 生图权限已关闭或未配置')
      }
      return tasks.run(
        'page-generate',
        async ({ id: taskId, signal, progress }) => {
          const cancel = () => tasks.cancel(taskId)
          front?.signal.addEventListener('abort', cancel, { once: true })
          try {
            const result = await renderPage(
              id,
              revision,
              execution,
              (step) => {
                progress(step)
                front?.report(step)
                send('nai:step', { id: taskId, kind: 'page-generate', step })
              },
              () => signal.aborted,
              front ? { freeOnly: true } : {},
            )
            send('gallery:changed', null)
            return result
          } finally {
            front?.signal.removeEventListener('abort', cancel)
          }
        },
        {
          resource: 'generation',
          targetId: id,
          cancelMode: 'after-current',
          ...(front ? { origin: 'agent', label: front.label } : {}),
        },
      )
    },
  } satisfies Partial<IpcActions>
}
