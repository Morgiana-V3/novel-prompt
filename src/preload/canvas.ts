import { contextBridge } from 'electron'
import type { CanvasWindowApi } from '../shared/contracts/api'
import { applicationApi } from './api/application'
import { invoke } from './api/bridge'
import { imagesApi } from './api/images'
import { promptsApi } from './api/prompts'
import { tagsApi } from './api/tags'
import { workspaceApi } from './api/workspace'

const sharedApi = {
  copy: applicationApi.copy,
  getSettings: applicationApi.getSettings,
  naiImportReference: (source: Uint8Array | string) => invoke('nai:import-reference', source),
  naiList: () => invoke('nai:list'),
  naiSubscription: () => invoke('nai:subscription'),
  naiVibeStatuses: imagesApi.naiVibeStatuses,
  naiVibeEncode: imagesApi.naiVibeEncode,
  onAiStep: applicationApi.onAiStep,
  onSnippetsChanged: applicationApi.onSnippetsChanged,
  onTasks: applicationApi.onTasks,
  optimize: promptsApi.optimize,
  preview: promptsApi.preview,
  snippetsDelete: applicationApi.snippetsDelete,
  snippetsList: applicationApi.snippetsList,
  snippetsSave: applicationApi.snippetsSave,
  tagComplete: tagsApi.tagComplete,
  tasksCancel: (id: string) => invoke('tasks:cancel', id),
}

const canvasApi: CanvasWindowApi = {
  ...sharedApi,
  pagesCreate: workspaceApi.pagesCreate,
  pagesEdit: workspaceApi.pagesEdit,
  pagesGenerate: workspaceApi.pagesGenerate,
  pagesImageTool: workspaceApi.pagesImageTool,
  naiRecipe: (name) => invoke('nai:recipe', name),
  imagesImport: imagesApi.imagesImport,
  openProject: (tab) => invoke('canvas:project-open', tab),
  closeProject: (tab) => invoke('canvas:project-close', tab),
  saveProject: (tab, title, session, saveAs) =>
    invoke('canvas:project-save', tab, title, session, saveAs),
  favoriteImage: (id) => invoke('canvas:favorite-image', id),
  askCanvasAi: (req) => invoke('ai:canvas-ask', req),
  collectionsList: () => invoke('collections:list'),
  naiReadImage: (name) => invoke('nai:readImage', name),
  recipesList: () => invoke('recipes:list'),
  onGalleryChanged: applicationApi.onGalleryChanged,
  onFavoritesChanged: applicationApi.onFavoritesChanged,
  focusClassicWindow: () => invoke('window:focus-classic'),
  canvasWindowAction: (action) => invoke('window:canvas-action', action),
}

contextBridge.exposeInMainWorld('canvasApi', canvasApi)
// Shared prompt, snippet, and reference editors use this subset of the classic API.
contextBridge.exposeInMainWorld('api', sharedApi)
