import type { FrontendAction } from '../../../shared/contracts/desktop'
import type { PageAgentIdentity } from '../../../shared/workspace/model'
import type { TaskManager } from './task-manager'

export interface TaskContext {
  tasks: TaskManager
  send: (channel: string, payload: unknown) => void
  claimFrontend: (
    actionId: string | undefined,
    action: FrontendAction,
    workspaceId: string,
  ) => {
    signal: AbortSignal
    report: (message: string, current?: number, total?: number) => void
    label: string
    agent: PageAgentIdentity | undefined
  } | null
}
