import type { DesktopState } from '../../../shared/contracts/desktop'
import type { PageWorkspace } from '../../../shared/workspace/model'
import { agentIsConnected, currentAgent } from '../../modules/workspace/agent-sessions'

/** Read-only recovery evidence. Never restores ownership or commits a draft. */
export function connectionState(
  workspace: Pick<
    PageWorkspace,
    'id' | 'revision' | 'agentMode' | 'externalAgent' | 'currentVersionId' | 'execution'
  > | null,
  desktop: DesktopState | null,
) {
  const agent = currentAgent()
  const ownership = (owner: string | null | undefined) => {
    if (!owner) {
      return 'unclaimed' as const
    }
    if (owner === agent?.sessionId) {
      return 'self' as const
    }
    if (agentIsConnected(owner)) {
      return 'other' as const
    }
    return 'disconnected' as const
  }
  const visible = workspace && desktop?.workspace?.id === workspace.id ? desktop.workspace : null
  const config = visible?.config
  const resolveEditorOwner = () => {
    if (config?.open) {
      if (config.owner) {
        return ownership(config.owner)
      }
      return 'user' as const
    }
    return 'none' as const
  }
  const editorOwner = resolveEditorOwner()
  const assigned = workspace?.externalAgent?.sessionId
  const agentOwnership = ownership(assigned)
  const needsTakeover =
    !!workspace && (workspace.agentMode !== 'external' || agentOwnership !== 'self')
  const nextActions: { tool: string; arguments: Record<string, unknown>; reason: string }[] = []
  if (workspace) {
    if (config?.open && editorOwner === 'disconnected') {
      nextActions.push({
        tool: 'ui_edit_workspace_config',
        arguments: { id: workspace.id, expected_token: desktop!.token, config_action: 'resume' },
        reason: '先核对 desktop.workspace.config 中保留的草稿；显式接续后才可保存或取消。',
      })
    } else if (!config?.open && !visible?.editing && needsTakeover && agentOwnership !== 'other') {
      nextActions.push({
        tool: 'set_workspace_agent',
        arguments: { id: workspace.id, revision: workspace.revision, mode: 'external' },
        reason: '重新接管会话后读取待处理需求；不会自动回复或生成。',
      })
    } else if (!config?.open && !visible?.editing) {
      nextActions.push({
        tool: 'get_workspace_context',
        arguments: { id: workspace.id },
        reason:
          agentOwnership === 'other'
            ? '其他 Agent 仍在线，本连接只能先读取；须等原连接解除或断开后再接管。'
            : '读取当前需求，确认讨论对象与实际修改目标。',
      })
    }
  }
  return {
    sessionId: agent?.sessionId ?? null,
    connected: !!agent && agentIsConnected(agent.sessionId),
    workspace: workspace
      ? {
          id: workspace.id,
          revision: workspace.revision,
          mode: workspace.agentMode ?? 'internal',
          agentOwnership,
          needsTakeover,
          editor: {
            open: !!config?.open,
            ownership: editorOwner,
            dirty: config?.dirty ?? false,
            canResume: editorOwner === 'disconnected',
          },
          adoptedVersionId: workspace.currentVersionId,
          viewedVersionId: visible?.viewedVersionId ?? null,
          execution: { ...workspace.execution, sourceVersionId: workspace.currentVersionId },
        }
      : null,
    nextActions,
    recovery:
      '断线恢复只恢复传输，不重放业务请求、不自动接管或保存。对结果不确定的操作，先用原 operation_id 查询 get_operation。',
  }
}
