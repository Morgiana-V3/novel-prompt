import { ipcMain } from 'electron'
import { createGenerationActions } from '../../modules/generation/task-actions'
import { createPromptsActions } from '../../modules/prompts/task-actions'
import { createTagsActions } from '../../modules/tags/task-actions'
import { createTasksActions } from '../../modules/tasks/task-actions'
import { TaskManager } from '../../modules/tasks/task-manager'
import { agentConnections, onAgentConnectionsChanged } from '../../modules/workspace/agent-sessions'
import { createWorkspaceActions } from '../../modules/workspace/task-actions'
import { claimFrontend } from '../desktop/frontend-operations'

export function registerTaskIpc(
  send: (channel: string, payload: unknown) => void,
  tasks = new TaskManager((snapshot) => send('tasks:changed', snapshot)),
): TaskManager {
  const context = { tasks, send, claimFrontend }
  onAgentConnectionsChanged(() => send('agents:changed', agentConnections()))
  const actions = {
    ...createWorkspaceActions(context),
    ...createTagsActions(context),
    ...createPromptsActions(context),
    ...createGenerationActions(context),
    ...createTasksActions(context),
  }
  for (const [channel, action] of Object.entries(actions)) {
    // Each action is checked against IpcActions at definition; enumeration erases tuple correlation.
    const invoke = action as (...args: unknown[]) => unknown
    ipcMain.handle(channel, (_event, ...args: unknown[]) => invoke(...args))
  }
  return tasks
}
