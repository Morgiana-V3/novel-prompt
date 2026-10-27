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

export function createPromptsActions(context: TaskContext) {
  const { tasks, send } = context

  return {
    'ai:optimize': (req: AiOptimizeRequest) =>
      tasks.run('optimize', ({ id, signal, progress }) =>
        optimizePrompt(
          req,
          (step) => {
            if (progress(step)) {
              send('ai:step', { id, kind: 'optimize', step })
            }
          },
          signal,
        ),
      ),
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
