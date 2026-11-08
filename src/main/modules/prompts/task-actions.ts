import type { IpcActions } from '../../../shared/contracts/api'
import type {
  AiInpaintRequest,
  AiOptimizeRequest,
  AiPreviewRequest,
} from '../../../shared/prompts/types'
import type { TaskContext } from '../tasks/context'
import { planInpaint } from './inpaint-planner'
import { optimizePrompt } from './optimizer'
import { previewPrompt } from './previewer'
import { getSettings } from '../settings/service'

export function createPromptsActions(context: TaskContext) {
  const { tasks, send } = context

  return {
    'ai:optimize': (req: AiOptimizeRequest, actionId?: string) => {
      const front = context.claimFrontend(actionId, 'reverse-compose', '')
      if (front && (!getSettings().mcpAllowAi || !req.referenceImage)) {
        throw new Error('Agent 识图权限已关闭或缺少参考图')
      }
      return tasks.run(
        'optimize',
        async ({ id, signal, progress }) => {
          const cancel = () => tasks.cancel(id)
          front?.signal.addEventListener('abort', cancel, { once: true })
          try {
            return await optimizePrompt(
              req,
              (step) => {
                front?.report(step)
                if (progress(step)) {
                  send('ai:step', { id, kind: 'optimize', step })
                }
              },
              signal,
            )
          } finally {
            front?.signal.removeEventListener('abort', cancel)
          }
        },
        front ? { origin: 'agent', label: front.label } : {},
      )
    },
    'ai:preview': (req: AiPreviewRequest) =>
      tasks.run('preview', ({ id, signal, progress }) =>
        previewPrompt(
          req,
          (step) => {
            if (progress(step)) {
              send('ai:step', { id, kind: 'preview', step })
            }
          },
          signal,
        ),
      ),
    'ai:inpaint-plan': (req: AiInpaintRequest) =>
      tasks.run('inpaint-plan', async ({ signal, progress }) => {
        progress('正在分析图片与区域批注…')
        const result = await planInpaint(req, signal)
        progress('分析完成')
        return result
      }),
    'ai:inpaint-plan-cancel': () => tasks.cancelKey('inpaint-plan'),
  } satisfies Partial<IpcActions>
}
