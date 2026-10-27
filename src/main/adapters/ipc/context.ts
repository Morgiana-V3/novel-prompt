import type { BrowserWindow } from 'electron'
import type { TaskManager } from '../../modules/tasks/task-manager'

export interface IpcContext {
  getWindow: () => BrowserWindow | null
  send: (channel: string, payload: unknown) => void
  notifyAppChanged: () => void
  runtimeInfo: () => { mode: 'installed' | 'development'; dataPath: string; appPath: string }
  runtimeData: string
  bridgeProfile: string
  tasks: TaskManager
}
