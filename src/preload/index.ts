import { contextBridge, ipcRenderer } from 'electron'
import type {
  AiOptimizeRequest,
  AiOptimizeResult,
  AiPreviewRequest,
  AiPreviewResult,
  AnalysisResult,
  DbStatus,
  SearchHit,
  SearchOptions,
  Settings,
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
  openSkill: (name?: 'nai-prompt.md' | 'nai-preview.md'): Promise<string> => ipcRenderer.invoke('skill:open', name),
  copy: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),
  readClipboard: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),
  onProgress: (cb: (p: UpdateProgress) => void) => on('progress', cb),
  onAiStep: (cb: (s: string) => void) => on('ai:step', cb)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
