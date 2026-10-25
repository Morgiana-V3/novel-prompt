import { randomUUID } from 'node:crypto'
import type { TaskKind } from '../../shared/tasks'
import type { TaskManager } from '../tasks'
import type { DesktopBridge } from '../desktop'
import type { McpSessionOptions } from './server'
import { listImages } from '../nai/client'

export function agentExecutor(tasks: TaskManager, desktop: DesktopBridge, send: (channel: string, value: unknown) => void): NonNullable<McpSessionOptions['execute']> {
  const kinds: Record<string, TaskKind> = { optimize_prompt: 'optimize', preview_prompt: 'preview', plan_inpaint: 'inpaint-plan',
    generate_image: 'generate', inpaint_image: 'inpaint', generate_workspace: 'page-generate', analyze_prompt: 'agent' }
  return async (tool, args, signal, report) => {
    if (signal.aborted) throw new Error('已取消')
    // Frontend actions invoke the renderer's existing task handlers. Registering a
    // second outer task here would duplicate task ownership and generation locks.
    if (tool.name.startsWith('ui_')) return tool.run(args, signal, report)
    if (tool.name === 'cancel_task' || tool.name === 'get_app_state' || tool.name === 'list_tasks' || tool.annotations?.readOnlyHint && !kinds[tool.name]) return tool.run(args, signal, report)
    const kind = kinds[tool.name] ?? 'agent', generation = ['generate', 'inpaint', 'page-generate'].includes(kind)
    return tasks.run(kind, async ctx => {
      const cancel = () => tasks.cancel(ctx.id)
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) cancel()
      const progress = (message: string, current?: number, total?: number) => { ctx.progress(message, current, total); report(message, current, total) }
      progress(tool.title ?? tool.name)
      try {
        if (ctx.signal.aborted) throw new Error('已取消')
        const result = await tool.run(args, ctx.signal, progress)
        if (generation) {
          send('gallery:changed', null)
          if (desktop.connected() && !desktop.state?.blockers.length && typeof result === 'string') {
            try {
              const output = JSON.parse(result), name = output.images?.at(-1)?.name ?? output.image?.name
              const image = name ? listImages().find(i => i.name === name) : null
              if (image) await desktop.request('show-image', { image })
            } catch { /* A saved result must not be reported as a failed generation because its UI closed. */ }
          }
        }
        if (tool.name.includes('skill')) send('skills:changed', null)
        return result
      } finally { signal.removeEventListener('abort', cancel) }
    }, { key: kind === 'agent' ? randomUUID() : kind, resource: generation ? 'generation' : undefined,
      cancelMode: generation ? 'after-current' : 'abort', origin: 'agent', label: tool.title ?? tool.name, targetId: typeof args.id === 'string' ? args.id : undefined })
  }
}
