import { contextBridge, ipcRenderer } from 'electron'
import type {
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
  naiCancel: (): Promise<void> => ipcRenderer.invoke('nai:cancel'),
  naiList: (): Promise<NaiImage[]> => ipcRenderer.invoke('nai:list'),
  naiReadImage: (name: string): Promise<Uint8Array> => ipcRenderer.invoke('nai:readImage', name),
  naiSaveAs: (name: string): Promise<boolean> => ipcRenderer.invoke('nai:saveAs', name),
  naiCopyImage: (name: string): Promise<boolean> => ipcRenderer.invoke('nai:copyImage', name),
  naiReveal: (name?: string): Promise<void> => ipcRenderer.invoke('nai:reveal', name),
  naiDelete: (name: string): Promise<boolean> => ipcRenderer.invoke('nai:delete', name),
  onNaiStep: (cb: (s: string) => void) => on('nai:step', cb),
  mcpInfo: (): Promise<McpInfo> => ipcRenderer.invoke('mcp:info'),
  checkUpdate: (force?: boolean): Promise<UpdateInfo> => ipcRenderer.invoke('update:check', force),
  openUpdatePage: (url: string): Promise<void> => ipcRenderer.invoke('update:open', url),
  onProgress: (cb: (p: UpdateProgress) => void) => on('progress', cb),
  onAiStep: (cb: (s: string) => void) => on('ai:step', cb)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
