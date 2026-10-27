import type {
  NaiFreeCheck,
  NaiGenParams,
  NaiGenRequest,
  NaiGenResult,
  NaiInpaintRequest,
  NaiSubscription,
  NaiVersion,
} from '../generation/types'
import type { ImageRecipe, NaiImage, SavedRecipe } from '../images/types'
import type {
  AiInpaintRequest,
  AiInpaintResult,
  AiOptimizeRequest,
  AiOptimizeResult,
  AiPreviewRequest,
  AiPreviewResult,
  AnalysisResult,
  InpaintDraft,
} from '../prompts/types'
import type { Settings } from '../settings/types'
import type { SkillConfigItem, SkillDoc, SkillEntry, SkillInput } from '../skills/types'
import type { DbStatus, SearchHit, SearchOptions, UpdateProgress } from '../tags/types'
import type { AiStep, NaiStep, TaskSnapshot } from '../tasks/model'
import type { UpdateInfo } from '../updates/types'
import type {
  PageAction,
  PageAgentIdentity,
  PageExecution,
  PageExternalReply,
  PageWorkspace,
  PageWorkspaceSummary,
} from '../workspace/model'
import type { DesktopCommand, DesktopReply, DesktopState } from './desktop'
import type { McpInfo } from './mcp'

export interface Api {
  publishDesktop: (state: DesktopState) => void
  replyDesktop: (reply: DesktopReply) => void
  onDesktopCommand: (cb: (command: DesktopCommand) => void) => () => void
  cancelFrontend: () => void
  onFrontendCancel: (cb: (id: string) => void) => () => void
  onGalleryChanged: (cb: () => void) => () => void
  onSkillsChanged: (cb: () => void) => () => void
  tasksList: () => Promise<TaskSnapshot>
  tasksCancel: (id: string) => Promise<void>
  tasksClear: () => Promise<void>
  onTasks: (cb: (snapshot: TaskSnapshot) => void) => () => void
  pagesList: () => Promise<PageWorkspaceSummary[]>
  pagesRemoved: () => Promise<{ token: string; title: string; removedAt: number }[]>
  pagesRestore: (token: string) => Promise<PageWorkspace>
  pagesRecoverImage: (
    id: string,
    revision: number,
    versionId: string,
  ) => Promise<PageWorkspace | null>
  recipesList: () => Promise<SavedRecipe[]>
  recipesCreate: (name: string) => Promise<SavedRecipe>
  recipesCreateConfig: (request: NaiGenRequest) => Promise<SavedRecipe>
  recipesCreateWorkspace: (id: string, versionId: string) => Promise<SavedRecipe>
  imagesCleanupStatus: () => Promise<{ pending: number; message: string }>
  imagesCleanupRetry: () => Promise<{ pending: number; message: string }>
  recipesUpdate: (
    id: string,
    patch: Pick<SavedRecipe, 'name' | 'note' | 'tags'>,
  ) => Promise<SavedRecipe>
  recipesDelete: (id: string) => Promise<void>
  naiRetain: (name: string) => Promise<NaiImage>
  naiRecipe: (name: string) => Promise<ImageRecipe | null>
  agentConnections: () => Promise<PageAgentIdentity[]>
  onAgentConnections: (cb: (agents: PageAgentIdentity[]) => void) => () => void
  pagesAgent: (
    id: string,
    revision: number,
    mode: 'internal' | 'external',
    actionId?: string,
  ) => Promise<PageWorkspace>
  pagesExternalReply: (
    id: string,
    revision: number,
    response: PageExternalReply,
    actionId: string,
  ) => Promise<PageWorkspace>
  pagesExternalCancel: (id: string, revision: number, actionId?: string) => Promise<PageWorkspace>
  pagesImport: (
    params: NaiGenParams,
    model: NaiVersion,
    draft: InpaintDraft,
  ) => Promise<PageWorkspace | null>
  pagesDelete: (id: string, revision: number) => Promise<void>
  pagesClearImage: (id: string, revision: number, versionId: string) => Promise<PageWorkspace>
  pagesCleanupRemovedImages: () => Promise<number>
  pagesRead: (id: string) => Promise<PageWorkspace>
  pagesCreate: (
    image: string | null,
    params: NaiGenParams,
    model: NaiVersion,
    draft: InpaintDraft,
  ) => Promise<PageWorkspace>
  pagesEdit: (id: string, revision: number, action: PageAction) => Promise<PageWorkspace>
  pagesChat: (
    id: string,
    revision: number,
    text: string,
    region: string | null,
    refs: string[],
    actionId?: string,
    discussionVersionId?: string,
  ) => Promise<PageWorkspace>
  pagesCancel: (id: string) => Promise<void>
  pagesGenerate: (
    id: string,
    revision: number,
    execution: PageExecution,
    actionId?: string,
  ) => Promise<PageWorkspace>
  setDarkTitlebar: (dark: boolean) => Promise<void>
  dbStatus: () => Promise<DbStatus>
  dbUpdate: () => Promise<DbStatus>
  aiTranslate: () => Promise<DbStatus>
  dbImplications: () => Promise<DbStatus>
  cancelTask: () => Promise<void>
  search: (opts: SearchOptions) => Promise<SearchHit[]>
  setZh: (name: string, zh: string) => Promise<void>
  analyze: (text: string) => Promise<AnalysisResult>
  getSettings: () => Promise<Settings>
  saveSettings: (patch: Partial<Settings>) => Promise<Settings>
  planInpaint: (req: AiInpaintRequest) => Promise<AiInpaintResult>
  cancelInpaintPlan: () => Promise<void>
  optimize: (req: AiOptimizeRequest) => Promise<AiOptimizeResult>
  preview: (req: AiPreviewRequest) => Promise<AiPreviewResult>
  skillsList: () => Promise<SkillConfigItem[]>
  skillsGet: (id: string) => Promise<SkillDoc | null>
  skillsCore: () => Promise<string>
  skillsSetConfig: (entries: SkillEntry[]) => Promise<SkillConfigItem[]>
  skillsCreate: (input: SkillInput) => Promise<SkillDoc>
  skillsUpdate: (id: string, patch: Partial<SkillInput>) => Promise<SkillDoc>
  skillsDelete: (id: string) => Promise<void>
  skillsDuplicate: (id: string) => Promise<SkillDoc>
  skillsImport: () => Promise<{ imported: string[]; errors: string[] }>
  skillsReveal: (id?: string) => Promise<void>
  copy: (text: string) => Promise<void>
  readClipboard: () => Promise<string>
  naiSubscription: () => Promise<NaiSubscription>
  naiFreeCheck: (
    params: NaiGenParams,
    version: NaiVersion,
    sub?: NaiSubscription,
  ) => Promise<NaiFreeCheck>
  naiGenerate: (req: NaiGenRequest) => Promise<NaiGenResult>
  naiInpaint: (req: NaiInpaintRequest) => Promise<NaiGenResult>
  naiCancel: () => Promise<void>
  naiList: () => Promise<NaiImage[]>
  naiReadImage: (name: string) => Promise<Uint8Array>
  naiSaveAs: (name: string) => Promise<boolean>
  naiCopyImage: (name: string) => Promise<boolean>
  naiReveal: (name?: string) => Promise<void>
  naiDelete: (name: string) => Promise<boolean>
  onNaiStep: (kind: NaiStep['kind'], cb: (text: string) => void) => () => void
  mcpInfo: () => Promise<McpInfo>
  checkUpdate: (force?: boolean) => Promise<UpdateInfo>
  updateState: () => Promise<UpdateInfo>
  onUpdate: (cb: (info: UpdateInfo) => void) => () => void
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  openUpdatePage: (url: string) => Promise<void>
  openWebUrl: (url: string) => Promise<void>
  onProgress: (cb: (progress: UpdateProgress) => void) => () => void
  onAiStep: (kind: AiStep['kind'], cb: (text: string) => void) => () => void
}

export interface IpcContract {
  'tasks:list': {
    args: Parameters<Api['tasksList']>
    result: Awaited<ReturnType<Api['tasksList']>>
  }
  'tasks:cancel': {
    args: Parameters<Api['tasksCancel']>
    result: Awaited<ReturnType<Api['tasksCancel']>>
  }
  'tasks:clear': {
    args: Parameters<Api['tasksClear']>
    result: Awaited<ReturnType<Api['tasksClear']>>
  }
  'pages:list': {
    args: Parameters<Api['pagesList']>
    result: Awaited<ReturnType<Api['pagesList']>>
  }
  'pages:removed': {
    args: Parameters<Api['pagesRemoved']>
    result: Awaited<ReturnType<Api['pagesRemoved']>>
  }
  'pages:restore': {
    args: Parameters<Api['pagesRestore']>
    result: Awaited<ReturnType<Api['pagesRestore']>>
  }
  'pages:recover-image': {
    args: Parameters<Api['pagesRecoverImage']>
    result: Awaited<ReturnType<Api['pagesRecoverImage']>>
  }
  'recipes:list': {
    args: Parameters<Api['recipesList']>
    result: Awaited<ReturnType<Api['recipesList']>>
  }
  'recipes:create': {
    args: Parameters<Api['recipesCreate']>
    result: Awaited<ReturnType<Api['recipesCreate']>>
  }
  'recipes:config': {
    args: Parameters<Api['recipesCreateConfig']>
    result: Awaited<ReturnType<Api['recipesCreateConfig']>>
  }
  'recipes:workspace': {
    args: Parameters<Api['recipesCreateWorkspace']>
    result: Awaited<ReturnType<Api['recipesCreateWorkspace']>>
  }
  'images:cleanup-status': {
    args: Parameters<Api['imagesCleanupStatus']>
    result: Awaited<ReturnType<Api['imagesCleanupStatus']>>
  }
  'images:cleanup-retry': {
    args: Parameters<Api['imagesCleanupRetry']>
    result: Awaited<ReturnType<Api['imagesCleanupRetry']>>
  }
  'recipes:update': {
    args: Parameters<Api['recipesUpdate']>
    result: Awaited<ReturnType<Api['recipesUpdate']>>
  }
  'recipes:delete': {
    args: Parameters<Api['recipesDelete']>
    result: Awaited<ReturnType<Api['recipesDelete']>>
  }
  'nai:retain': {
    args: Parameters<Api['naiRetain']>
    result: Awaited<ReturnType<Api['naiRetain']>>
  }
  'nai:recipe': {
    args: Parameters<Api['naiRecipe']>
    result: Awaited<ReturnType<Api['naiRecipe']>>
  }
  'agents:list': {
    args: Parameters<Api['agentConnections']>
    result: Awaited<ReturnType<Api['agentConnections']>>
  }
  'pages:agent': {
    args: Parameters<Api['pagesAgent']>
    result: Awaited<ReturnType<Api['pagesAgent']>>
  }
  'pages:external-reply': {
    args: Parameters<Api['pagesExternalReply']>
    result: Awaited<ReturnType<Api['pagesExternalReply']>>
  }
  'pages:external-cancel': {
    args: Parameters<Api['pagesExternalCancel']>
    result: Awaited<ReturnType<Api['pagesExternalCancel']>>
  }
  'pages:import': {
    args: Parameters<Api['pagesImport']>
    result: Awaited<ReturnType<Api['pagesImport']>>
  }
  'pages:delete': {
    args: Parameters<Api['pagesDelete']>
    result: Awaited<ReturnType<Api['pagesDelete']>>
  }
  'pages:clear-image': {
    args: Parameters<Api['pagesClearImage']>
    result: Awaited<ReturnType<Api['pagesClearImage']>>
  }
  'pages:cleanup-removed-images': {
    args: Parameters<Api['pagesCleanupRemovedImages']>
    result: Awaited<ReturnType<Api['pagesCleanupRemovedImages']>>
  }
  'pages:read': {
    args: Parameters<Api['pagesRead']>
    result: Awaited<ReturnType<Api['pagesRead']>>
  }
  'pages:create': {
    args: Parameters<Api['pagesCreate']>
    result: Awaited<ReturnType<Api['pagesCreate']>>
  }
  'pages:edit': {
    args: Parameters<Api['pagesEdit']>
    result: Awaited<ReturnType<Api['pagesEdit']>>
  }
  'pages:chat': {
    args: Parameters<Api['pagesChat']>
    result: Awaited<ReturnType<Api['pagesChat']>>
  }
  'pages:cancel': {
    args: Parameters<Api['pagesCancel']>
    result: Awaited<ReturnType<Api['pagesCancel']>>
  }
  'pages:generate': {
    args: Parameters<Api['pagesGenerate']>
    result: Awaited<ReturnType<Api['pagesGenerate']>>
  }
  'window:dark-titlebar': {
    args: Parameters<Api['setDarkTitlebar']>
    result: Awaited<ReturnType<Api['setDarkTitlebar']>>
  }
  'db:status': { args: Parameters<Api['dbStatus']>; result: Awaited<ReturnType<Api['dbStatus']>> }
  'db:update': { args: Parameters<Api['dbUpdate']>; result: Awaited<ReturnType<Api['dbUpdate']>> }
  'db:aiTranslate': {
    args: Parameters<Api['aiTranslate']>
    result: Awaited<ReturnType<Api['aiTranslate']>>
  }
  'db:implications': {
    args: Parameters<Api['dbImplications']>
    result: Awaited<ReturnType<Api['dbImplications']>>
  }
  'task:cancel': {
    args: Parameters<Api['cancelTask']>
    result: Awaited<ReturnType<Api['cancelTask']>>
  }
  'tag:search': { args: Parameters<Api['search']>; result: Awaited<ReturnType<Api['search']>> }
  'tag:setZh': { args: Parameters<Api['setZh']>; result: Awaited<ReturnType<Api['setZh']>> }
  'prompt:analyze': {
    args: Parameters<Api['analyze']>
    result: Awaited<ReturnType<Api['analyze']>>
  }
  'settings:get': {
    args: Parameters<Api['getSettings']>
    result: Awaited<ReturnType<Api['getSettings']>>
  }
  'settings:save': {
    args: Parameters<Api['saveSettings']>
    result: Awaited<ReturnType<Api['saveSettings']>>
  }
  'ai:inpaint-plan': {
    args: Parameters<Api['planInpaint']>
    result: Awaited<ReturnType<Api['planInpaint']>>
  }
  'ai:inpaint-plan-cancel': {
    args: Parameters<Api['cancelInpaintPlan']>
    result: Awaited<ReturnType<Api['cancelInpaintPlan']>>
  }
  'ai:optimize': { args: Parameters<Api['optimize']>; result: Awaited<ReturnType<Api['optimize']>> }
  'ai:preview': { args: Parameters<Api['preview']>; result: Awaited<ReturnType<Api['preview']>> }
  'skills:list': {
    args: Parameters<Api['skillsList']>
    result: Awaited<ReturnType<Api['skillsList']>>
  }
  'skills:get': {
    args: Parameters<Api['skillsGet']>
    result: Awaited<ReturnType<Api['skillsGet']>>
  }
  'skills:core': {
    args: Parameters<Api['skillsCore']>
    result: Awaited<ReturnType<Api['skillsCore']>>
  }
  'skills:setConfig': {
    args: Parameters<Api['skillsSetConfig']>
    result: Awaited<ReturnType<Api['skillsSetConfig']>>
  }
  'skills:create': {
    args: Parameters<Api['skillsCreate']>
    result: Awaited<ReturnType<Api['skillsCreate']>>
  }
  'skills:update': {
    args: Parameters<Api['skillsUpdate']>
    result: Awaited<ReturnType<Api['skillsUpdate']>>
  }
  'skills:delete': {
    args: Parameters<Api['skillsDelete']>
    result: Awaited<ReturnType<Api['skillsDelete']>>
  }
  'skills:duplicate': {
    args: Parameters<Api['skillsDuplicate']>
    result: Awaited<ReturnType<Api['skillsDuplicate']>>
  }
  'skills:import': {
    args: Parameters<Api['skillsImport']>
    result: Awaited<ReturnType<Api['skillsImport']>>
  }
  'skills:reveal': {
    args: Parameters<Api['skillsReveal']>
    result: Awaited<ReturnType<Api['skillsReveal']>>
  }
  'clipboard:write': { args: Parameters<Api['copy']>; result: Awaited<ReturnType<Api['copy']>> }
  'clipboard:read': {
    args: Parameters<Api['readClipboard']>
    result: Awaited<ReturnType<Api['readClipboard']>>
  }
  'nai:subscription': {
    args: Parameters<Api['naiSubscription']>
    result: Awaited<ReturnType<Api['naiSubscription']>>
  }
  'nai:freeCheck': {
    args: Parameters<Api['naiFreeCheck']>
    result: Awaited<ReturnType<Api['naiFreeCheck']>>
  }
  'nai:generate': {
    args: Parameters<Api['naiGenerate']>
    result: Awaited<ReturnType<Api['naiGenerate']>>
  }
  'nai:inpaint': {
    args: Parameters<Api['naiInpaint']>
    result: Awaited<ReturnType<Api['naiInpaint']>>
  }
  'nai:cancel': {
    args: Parameters<Api['naiCancel']>
    result: Awaited<ReturnType<Api['naiCancel']>>
  }
  'nai:list': { args: Parameters<Api['naiList']>; result: Awaited<ReturnType<Api['naiList']>> }
  'nai:readImage': {
    args: Parameters<Api['naiReadImage']>
    result: Awaited<ReturnType<Api['naiReadImage']>>
  }
  'nai:saveAs': {
    args: Parameters<Api['naiSaveAs']>
    result: Awaited<ReturnType<Api['naiSaveAs']>>
  }
  'nai:copyImage': {
    args: Parameters<Api['naiCopyImage']>
    result: Awaited<ReturnType<Api['naiCopyImage']>>
  }
  'nai:reveal': {
    args: Parameters<Api['naiReveal']>
    result: Awaited<ReturnType<Api['naiReveal']>>
  }
  'nai:delete': {
    args: Parameters<Api['naiDelete']>
    result: Awaited<ReturnType<Api['naiDelete']>>
  }
  'mcp:info': { args: Parameters<Api['mcpInfo']>; result: Awaited<ReturnType<Api['mcpInfo']>> }
  'update:check': {
    args: Parameters<Api['checkUpdate']>
    result: Awaited<ReturnType<Api['checkUpdate']>>
  }
  'update:state': {
    args: Parameters<Api['updateState']>
    result: Awaited<ReturnType<Api['updateState']>>
  }
  'update:download': {
    args: Parameters<Api['downloadUpdate']>
    result: Awaited<ReturnType<Api['downloadUpdate']>>
  }
  'update:install': {
    args: Parameters<Api['installUpdate']>
    result: Awaited<ReturnType<Api['installUpdate']>>
  }
  'update:open': {
    args: Parameters<Api['openUpdatePage']>
    result: Awaited<ReturnType<Api['openUpdatePage']>>
  }
  'web:open': {
    args: Parameters<Api['openWebUrl']>
    result: Awaited<ReturnType<Api['openWebUrl']>>
  }
}

export interface RendererMessages {
  'desktop:state': Parameters<Api['publishDesktop']>
  'desktop:reply': Parameters<Api['replyDesktop']>
  'desktop:cancel-frontend': Parameters<Api['cancelFrontend']>
}

export interface AppEvents {
  'desktop:command': DesktopCommand
  'desktop:frontend-cancel': string
  'gallery:changed': null
  'skills:changed': null
  'tasks:changed': TaskSnapshot
  'agents:changed': PageAgentIdentity[]
  'nai:step': NaiStep
  'update:state': UpdateInfo
  progress: UpdateProgress
  'ai:step': AiStep
}

export type IpcActions = {
  [TChannel in keyof IpcContract]: (
    ...args: IpcContract[TChannel]['args']
  ) => IpcContract[TChannel]['result'] | Promise<IpcContract[TChannel]['result']>
}
