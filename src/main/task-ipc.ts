import { ipcMain } from 'electron'
import { TaskManager } from './tasks'
import type { AiOptimizeRequest, AiPreviewRequest, AiInpaintRequest, NaiGenRequest, NaiInpaintRequest, UpdateProgress } from '../shared/types'
import type { PageExecution, PageExternalReply } from '../shared/page-workspace'
import { tagStore } from './tagdb/store'
import { updateImplications, updateTagDatabase, Cancelled } from './tagdb/fetcher'
import { getSettings } from './settings'
import { aiTranslate } from './ai/translator'
import { optimizePrompt } from './ai/optimizer'
import { previewPrompt } from './ai/previewer'
import { planInpaint } from './ai/inpaint-planner'
import { discussPage, renderPage } from './ai/page-collaborator'
import { pageLocks, readPage, queueExternalRequest, setPageAgent, replyExternalRequest, cancelExternalRequest } from './page-workspaces'
import { agentConnections, onAgentConnectionsChanged } from './agent-sessions'
import { generateImages } from './nai/client'
import { claimFrontend } from './frontend-operations'

export function registerTaskIpc(send: (channel: string, payload: unknown) => void): TaskManager {
  ipcMain.handle('agents:list', () => agentConnections())
  onAgentConnectionsChanged(() => send('agents:changed', agentConnections()))
  ipcMain.handle('pages:agent', (_, id: string, revision: number, mode: 'internal' | 'external', actionId?: string) => {
    const front = claimFrontend(actionId, 'agent', id)
    return setPageAgent(id, revision, mode, front?.agent)
  })
  ipcMain.handle('pages:external-reply', (_, id: string, revision: number, response: PageExternalReply, actionId: string) => {
    const front = claimFrontend(actionId, 'reply', id)
    if (!front) throw new Error('请通过已连接的外部 Agent 提交回复')
    return replyExternalRequest(id, revision, response, front.agent)
  })
  ipcMain.handle('pages:external-cancel', (_, id: string, revision: number, actionId?: string) => {
    const front = claimFrontend(actionId, 'external-cancel', id)
    return cancelExternalRequest(id, revision, front?.agent)
  })
  const tasks = new TaskManager(snapshot => send('tasks:changed', snapshot))
  ipcMain.handle('tasks:list', () => tasks.snapshot())
  ipcMain.handle('tasks:cancel', (_, id: string) => tasks.cancel(id))
  ipcMain.handle('tasks:clear', () => tasks.clearFinished())
  // The legacy settings button only owns database work, never an AI request on another page.
  ipcMain.handle('task:cancel', () => tasks.cancelResource('database'))

  const database = (kind: 'db-update' | 'db-translate' | 'db-implications', work: (report: (p: UpdateProgress) => void, signal: AbortSignal) => Promise<void>) =>
    tasks.run(kind, async ({ signal, progress }) => {
      const report = (p: UpdateProgress) => { progress(p.message, p.current, p.total); send('progress', p) }
      try {
        await work(report, signal)
        if (signal.aborted) report({ stage: 'done', message: '已取消，已保存的数据保留' })
        return tagStore.status()
      } catch (e) {
        if (signal.aborted || e instanceof Cancelled) report({ stage: 'done', message: '已取消，已保存的数据保留' })
        else report({ stage: 'error', message: String(e instanceof Error ? e.message : e) })
        throw e
      }
    }, { resource: 'database' })

  ipcMain.handle('db:update', () => database('db-update', async (report, signal) => {
    await updateTagDatabase(getSettings().minPostCount, report, signal)
    report({ stage: 'index', message: '正在构建索引…' }); tagStore.load()
    report({ stage: 'done', message: '数据更新完成' })
  }))
  ipcMain.handle('db:aiTranslate', () => database('db-translate', async (report, signal) => {
    try { await aiTranslate(getSettings().translateMinCount, report, signal) }
    finally { tagStore.refreshTranslations() }
  }))
  ipcMain.handle('db:implications', () => database('db-implications', async (report, signal) => {
    const count = await updateImplications(tagStore.names(), report, signal)
    tagStore.loadImplications()
    report({ stage: 'done', message: `包含关系下载完成，共 ${count.toLocaleString()} 条` })
  }))

  ipcMain.handle('ai:optimize', (_, req: AiOptimizeRequest) => tasks.run('optimize', ({ id, signal, progress }) =>
    optimizePrompt(req, step => { if (progress(step)) send('ai:step', { id, kind: 'optimize', step }) }, signal)))
  ipcMain.handle('ai:preview', (_, req: AiPreviewRequest) => tasks.run('preview', ({ id, signal, progress }) =>
    previewPrompt(req, step => { if (progress(step)) send('ai:step', { id, kind: 'preview', step }) }, signal)))
  ipcMain.handle('ai:inpaint-plan', (_, req: AiInpaintRequest) => tasks.run('inpaint-plan', async ({ signal, progress }) => {
    progress('正在分析图片与区域批注…')
    const result = await planInpaint(req, signal); progress('分析完成'); return result
  }))
  ipcMain.handle('ai:inpaint-plan-cancel', () => tasks.cancelKey('inpaint-plan'))

  const generate = (kind: 'generate' | 'inpaint', req: NaiGenRequest | NaiInpaintRequest) =>
    tasks.run(kind, async ({ id, signal, progress }) => {
      const result = await generateImages(req, step => {
        progress(step); send('nai:step', { id, kind, step })
      }, () => signal.aborted)
      // A single-image request may finish without checking cancellation again. Tell the
      // renderer's multi-region queue to stop as well, while preserving this image.
      if (signal.aborted) result.stopped ??= '已停止，已完成的图片已保留'
      return result
    }, { resource: 'generation', cancelMode: 'after-current' })
  ipcMain.handle('nai:generate', (_, req: NaiGenRequest) => generate('generate', req))
  ipcMain.handle('nai:inpaint', (_, req: NaiInpaintRequest) => {
    if (!req?.inpaint) throw new Error('缺少原图或遮罩')
    return generate('inpaint', req)
  })
  // Do not abort an in-flight image request: wait for its saved result before stopping the batch.
  ipcMain.handle('nai:cancel', () => tasks.cancelResource('generation'))
  ipcMain.handle('pages:chat', (_, id: string, revision: number, text: string, region: string | null, refs: string[], actionId?: string) => {
    const front = claimFrontend(actionId, 'send', id)
    if (readPage(id).agentMode === 'external') return queueExternalRequest(id, revision, text, region, refs)
    if (front && (!getSettings().mcpAllowAi || !getSettings().apiKey)) throw new Error('Agent AI 权限已关闭或未配置')
    return tasks.run('page-chat', async ({ id: taskId, progress }) => {
      const cancel = () => tasks.cancel(taskId)
      front?.signal.addEventListener('abort', cancel, { once: true })
      try {
        progress('正在分析会话上下文…'); front?.report('正在分析会话上下文…')
        const result = await discussPage(id, revision, text, region, refs); progress('讨论完成'); return result
      } finally { front?.signal.removeEventListener('abort', cancel) }
    }, { key: `page-chat:${id}`, targetId: id, onCancel: () => pageLocks.get(id)?.abort(), ...(front ? { origin: 'agent', label: front.label } : {}) })
  })
  ipcMain.handle('pages:cancel', (_, id: string) => tasks.cancelKey(`page-chat:${id}`))
  ipcMain.handle('pages:generate', (_, id: string, revision: number, execution: PageExecution, actionId?: string) => {
    const front = claimFrontend(actionId, 'generate', id)
    if (front && (!getSettings().mcpAllowGenerate || !getSettings().naiToken)) throw new Error('Agent 生图权限已关闭或未配置')
    return tasks.run('page-generate', async ({ id: taskId, signal, progress }) => {
      const cancel = () => tasks.cancel(taskId)
      front?.signal.addEventListener('abort', cancel, { once: true })
      try {
        const result = await renderPage(id, revision, execution, step => {
        progress(step); front?.report(step); send('nai:step', { id: taskId, kind: 'page-generate', step })
        }, () => signal.aborted, front ? { freeOnly: true } : {})
        send('gallery:changed', null)
        return result
      }
      finally { front?.signal.removeEventListener('abort', cancel) }
    }, { resource: 'generation', targetId: id, cancelMode: 'after-current', ...(front ? { origin: 'agent', label: front.label } : {}) })
  })
  return tasks
}
