import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopCommand, DesktopReply, DesktopState } from '../shared/desktop'
import type { AiStep, NaiStep, TaskSnapshot } from '../shared/tasks'
import type { PageExecution, PageAction, PageWorkspace, PageWorkspaceSummary, PageExternalReply, PageAgentIdentity } from '../shared/page-workspace'
import type { InpaintDraft, ImageRecipe, SavedRecipe } from '../shared/types'
import type {
  AiInpaintRequest,
  AiInpaintResult,
  AiOptimizeRequest,
  AiOptimizeResult,
  AiPreviewRequest,
  AiPreviewResult,
  AnalysisResult,
  DbStatus,
  McpInfo,
  NaiFreeCheck,
  NaiGenParams,
  NaiGenRequest,
  NaiGenResult,
  NaiImage,
  NaiInpaintRequest,
  NaiSubscription,
  NaiVersion,
  SearchHit,
  SearchOptions,
  Settings,
  SkillConfigItem,
  SkillDoc,
  SkillEntry,
  SkillInput,
  UpdateInfo,
  UpdateProgress
} from '../shared/types'

const on = <T>(channel: string, cb: (p: T) => void) => {
  const listener = (_: unknown, p: T) => cb(p)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  publishDesktop: (state: DesktopState): void => ipcRenderer.send('desktop:state', state),
  replyDesktop: (reply: DesktopReply): void => ipcRenderer.send('desktop:reply', reply),
  onDesktopCommand: (cb: (command: DesktopCommand) => void) => on('desktop:command', cb),
  cancelFrontend: (): void => ipcRenderer.send('desktop:cancel-frontend'),
  onFrontendCancel: (cb: (id: string) => void) => on('desktop:frontend-cancel', cb),
  onGalleryChanged: (cb: () => void) => on('gallery:changed', cb),
  onSkillsChanged: (cb: () => void) => on('skills:changed', cb),
  tasksList: (): Promise<TaskSnapshot> => ipcRenderer.invoke('tasks:list'),
  tasksCancel: (id: string): Promise<void> => ipcRenderer.invoke('tasks:cancel', id),
  tasksClear: (): Promise<void> => ipcRenderer.invoke('tasks:clear'),
  onTasks: (cb: (snapshot: TaskSnapshot) => void) => on('tasks:changed', cb),
  pagesList: (): Promise<PageWorkspaceSummary[]> => ipcRenderer.invoke('pages:list'),
  pagesRemoved: (): Promise<{ token: string; title: string; removedAt: number }[]> => ipcRenderer.invoke('pages:removed'),
  pagesRestore: (token: string): Promise<PageWorkspace> => ipcRenderer.invoke('pages:restore', token),
  pagesRecoverImage: (id: string, revision: number, versionId: string): Promise<PageWorkspace | null> => ipcRenderer.invoke('pages:recover-image', id, revision, versionId),
  recipesList: (): Promise<SavedRecipe[]> => ipcRenderer.invoke('recipes:list'),
  recipesCreate: (name: string): Promise<SavedRecipe> => ipcRenderer.invoke('recipes:create', name),
  recipesCreateConfig: (request: import('../shared/types').NaiGenRequest): Promise<SavedRecipe> => ipcRenderer.invoke('recipes:config', request),
  recipesCreateWorkspace: (id: string, versionId: string): Promise<SavedRecipe> => ipcRenderer.invoke('recipes:workspace', id, versionId),
  imagesCleanupStatus: (): Promise<{pending: number; message: string}> => ipcRenderer.invoke('images:cleanup-status'),
  imagesCleanupRetry: (): Promise<{pending: number; message: string}> => ipcRenderer.invoke('images:cleanup-retry'),
  recipesUpdate: (id: string, patch: Pick<SavedRecipe, 'name' | 'note' | 'tags'>): Promise<SavedRecipe> => ipcRenderer.invoke('recipes:update', id, patch),
  recipesDelete: (id: string): Promise<void> => ipcRenderer.invoke('recipes:delete', id),
  naiRetain: (name: string): Promise<NaiImage> => ipcRenderer.invoke('nai:retain', name),
  naiRecipe: (name: string): Promise<ImageRecipe | null> => ipcRenderer.invoke('nai:recipe', name),
  agentConnections: (): Promise<PageAgentIdentity[]> => ipcRenderer.invoke('agents:list'),
  onAgentConnections: (cb: (agents: PageAgentIdentity[]) => void) => on('agents:changed', cb),
  pagesAgent: (id: string, revision: number, mode: 'internal' | 'external', actionId?: string): Promise<PageWorkspace> => ipcRenderer.invoke('pages:agent', id, revision, mode, actionId),
  pagesExternalReply: (id: string, revision: number, response: PageExternalReply, actionId: string): Promise<PageWorkspace> => ipcRenderer.invoke('pages:external-reply', id, revision, response, actionId),
  pagesExternalCancel: (id: string, revision: number, actionId?: string): Promise<PageWorkspace> => ipcRenderer.invoke('pages:external-cancel', id, revision, actionId),
  pagesImport: (params: NaiGenParams, model: NaiVersion, draft: InpaintDraft): Promise<PageWorkspace | null> => ipcRenderer.invoke('pages:import', params, model, draft),
  pagesDelete: (id: string, revision: number): Promise<void> => ipcRenderer.invoke('pages:delete', id, revision),
  pagesRead: (id: string): Promise<PageWorkspace> => ipcRenderer.invoke('pages:read', id),
  pagesCreate: (image: string | null, params: NaiGenParams, model: NaiVersion, draft: InpaintDraft): Promise<PageWorkspace> => ipcRenderer.invoke('pages:create', image, params, model, draft),
  pagesEdit: (id: string, revision: number, action: PageAction): Promise<PageWorkspace> => ipcRenderer.invoke('pages:edit', id, revision, action),
  pagesChat: (id: string, revision: number, text: string, region: string | null, refs: string[], actionId?: string): Promise<PageWorkspace> => ipcRenderer.invoke('pages:chat', id, revision, text, region, refs, actionId),
  pagesCancel: (id: string): Promise<void> => ipcRenderer.invoke('pages:cancel', id),
  pagesGenerate: (id: string, revision: number, execution: PageExecution, actionId?: string): Promise<PageWorkspace> => ipcRenderer.invoke('pages:generate', id, revision, execution, actionId),
  setDarkTitlebar: (dark: boolean): Promise<void> => ipcRenderer.invoke('window:dark-titlebar', dark),
  dbStatus: (): Promise<DbStatus> => ipcRenderer.invoke('db:status'),
  dbUpdate: (): Promise<DbStatus> => ipcRenderer.invoke('db:update'),
  aiTranslate: (): Promise<DbStatus> => ipcRenderer.invoke('db:aiTranslate'),
  dbImplications: (): Promise<DbStatus> => ipcRenderer.invoke('db:implications'),
  cancelTask: (): Promise<void> => ipcRenderer.invoke('task:cancel'),
  search: (opts: SearchOptions): Promise<SearchHit[]> => ipcRenderer.invoke('tag:search', opts),
  setZh: (name: string, zh: string): Promise<void> => ipcRenderer.invoke('tag:setZh', name, zh),
  analyze: (text: string): Promise<AnalysisResult> => ipcRenderer.invoke('prompt:analyze', text),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:save', patch),
  planInpaint: (req: AiInpaintRequest): Promise<AiInpaintResult> => ipcRenderer.invoke('ai:inpaint-plan', req),
  cancelInpaintPlan: (): Promise<void> => ipcRenderer.invoke('ai:inpaint-plan-cancel'),
  optimize: (req: AiOptimizeRequest): Promise<AiOptimizeResult> => ipcRenderer.invoke('ai:optimize', req),
  preview: (req: AiPreviewRequest): Promise<AiPreviewResult> => ipcRenderer.invoke('ai:preview', req),
  skillsList: (): Promise<SkillConfigItem[]> => ipcRenderer.invoke('skills:list'),
  skillsGet: (id: string): Promise<SkillDoc | null> => ipcRenderer.invoke('skills:get', id),
  skillsCore: (): Promise<string> => ipcRenderer.invoke('skills:core'),
  skillsSetConfig: (entries: SkillEntry[]): Promise<SkillConfigItem[]> => ipcRenderer.invoke('skills:setConfig', entries),
  skillsCreate: (input: SkillInput): Promise<SkillDoc> => ipcRenderer.invoke('skills:create', input),
  skillsUpdate: (id: string, patch: Partial<SkillInput>): Promise<SkillDoc> => ipcRenderer.invoke('skills:update', id, patch),
  skillsDelete: (id: string): Promise<void> => ipcRenderer.invoke('skills:delete', id),
  skillsDuplicate: (id: string): Promise<SkillDoc> => ipcRenderer.invoke('skills:duplicate', id),
  skillsImport: (): Promise<{ imported: string[]; errors: string[] }> => ipcRenderer.invoke('skills:import'),
  skillsReveal: (id?: string): Promise<void> => ipcRenderer.invoke('skills:reveal', id),
  copy: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),
  readClipboard: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),
  naiSubscription: (): Promise<NaiSubscription> => ipcRenderer.invoke('nai:subscription'),
  naiFreeCheck: (params: NaiGenParams, version: NaiVersion, sub?: NaiSubscription): Promise<NaiFreeCheck> =>
    ipcRenderer.invoke('nai:freeCheck', params, version, sub),
  naiGenerate: (req: NaiGenRequest): Promise<NaiGenResult> => ipcRenderer.invoke('nai:generate', req),
  naiInpaint: (req: NaiInpaintRequest): Promise<NaiGenResult> => ipcRenderer.invoke('nai:inpaint', req),
  naiCancel: (): Promise<void> => ipcRenderer.invoke('nai:cancel'),
  naiList: (): Promise<NaiImage[]> => ipcRenderer.invoke('nai:list'),
  naiReadImage: (name: string): Promise<Uint8Array> => ipcRenderer.invoke('nai:readImage', name),
  naiSaveAs: (name: string): Promise<boolean> => ipcRenderer.invoke('nai:saveAs', name),
  naiCopyImage: (name: string): Promise<boolean> => ipcRenderer.invoke('nai:copyImage', name),
  naiReveal: (name?: string): Promise<void> => ipcRenderer.invoke('nai:reveal', name),
  naiDelete: (name: string): Promise<boolean> => ipcRenderer.invoke('nai:delete', name),
  onNaiStep: (kind: NaiStep['kind'], cb: (s: string) => void) => on<NaiStep>('nai:step', event => {
    if (event.kind === kind) cb(event.step)
  }),
  mcpInfo: (): Promise<McpInfo> => ipcRenderer.invoke('mcp:info'),
  checkUpdate: (force?: boolean): Promise<UpdateInfo> => ipcRenderer.invoke('update:check', force),
  updateState: (): Promise<UpdateInfo> => ipcRenderer.invoke('update:state'),
  onUpdate: (cb: (info: UpdateInfo) => void) => on('update:state', cb),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke('update:download'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  openUpdatePage: (url: string): Promise<void> => ipcRenderer.invoke('update:open', url),
  openWebUrl: (url: string): Promise<void> => ipcRenderer.invoke('web:open', url),
  onProgress: (cb: (p: UpdateProgress) => void) => on('progress', cb),
  onAiStep: (kind: AiStep['kind'], cb: (s: string) => void) => on<AiStep>('ai:step', event => {
    if (event.kind === kind) cb(event.step)
  })
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
