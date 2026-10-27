import { contextBridge } from 'electron'
import type { Api } from '../shared/contracts/api'
import { applicationApi } from './api/application'
import { desktopApi } from './api/desktop'
import { generationApi } from './api/generation'
import { imagesApi } from './api/images'
import { promptsApi } from './api/prompts'
import { skillsApi } from './api/skills'
import { tagsApi } from './api/tags'
import { tasksApi } from './api/tasks'
import { workspaceApi } from './api/workspace'

const api: Api = {
  ...desktopApi,
  ...applicationApi,
  ...tasksApi,
  ...workspaceApi,
  ...imagesApi,
  ...generationApi,
  ...tagsApi,
  ...promptsApi,
  ...skillsApi,
}

contextBridge.exposeInMainWorld('api', api)
