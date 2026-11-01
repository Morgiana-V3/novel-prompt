import type { McpInfo } from '../../shared/contracts/mcp'
import type { Settings } from '../../shared/settings/types'
import type { UpdateProgress } from '../../shared/tags/types'
import type { AiStep, NaiStep, TaskSnapshot } from '../../shared/tasks/model'
import type { UpdateInfo } from '../../shared/updates/types'
import type { PageAgentIdentity } from '../../shared/workspace/model'
import { invoke, on } from './bridge'

import type { SnippetInput } from '../../shared/prompts/snippets'

export const applicationApi = {
  storageInfo: () => invoke('storage:info'),
  storageChoose: () => invoke('storage:choose'),
  storageSchedule: (path: string) => invoke('storage:schedule', path),
  storageCancel: () => invoke('storage:cancel'),
  storageOpen: () => invoke('storage:open'),
  snippetsList: () => invoke('snippets:list'),
  snippetsSave: (input: SnippetInput) => invoke('snippets:save', input),
  snippetsDelete: (id: string) => invoke('snippets:delete', id),
  onGalleryChanged: (cb: () => void) => on('gallery:changed', cb),
  onSkillsChanged: (cb: () => void) => on('skills:changed', cb),
  onTasks: (cb: (snapshot: TaskSnapshot) => void) => on('tasks:changed', cb),
  onAgentConnections: (cb: (agents: PageAgentIdentity[]) => void) => on('agents:changed', cb),
  setImagePreviewActive: (active: boolean): Promise<void> => invoke('window:image-preview', active),
  cancelTask: (): Promise<void> => invoke('task:cancel'),
  getSettings: (): Promise<Settings> => invoke('settings:get'),
  saveSettings: (patch: Partial<Settings>): Promise<Settings> => invoke('settings:save', patch),
  cancelInpaintPlan: (): Promise<void> => invoke('ai:inpaint-plan-cancel'),
  copy: (text: string): Promise<void> => invoke('clipboard:write', text),
  readClipboard: (): Promise<string> => invoke('clipboard:read'),
  onNaiStep: (kind: NaiStep['kind'], cb: (text: string) => void) =>
    on('nai:step', (event) => {
      if (event.kind === kind) {
        cb(event.step)
      }
    }),
  mcpInfo: (): Promise<McpInfo> => invoke('mcp:info'),
  checkUpdate: (force?: boolean): Promise<UpdateInfo> => invoke('update:check', force),
  updateState: (): Promise<UpdateInfo> => invoke('update:state'),
  onUpdate: (cb: (info: UpdateInfo) => void) => on('update:state', cb),
  downloadUpdate: (): Promise<void> => invoke('update:download'),
  installUpdate: (): Promise<void> => invoke('update:install'),
  openUpdatePage: (url: string): Promise<void> => invoke('update:open', url),
  openWebUrl: (url: string): Promise<void> => invoke('web:open', url),
  onProgress: (cb: (progress: UpdateProgress) => void) => on('progress', cb),
  onAiStep: (kind: AiStep['kind'], cb: (text: string) => void) =>
    on('ai:step', (event) => {
      if (event.kind === kind) {
        cb(event.step)
      }
    }),
}
