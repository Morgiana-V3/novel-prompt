import type { IpcActions } from '../../../shared/contracts/api'
import type { NaiGenRequest, NaiInpaintRequest } from '../../../shared/generation/types'
import type { TaskContext } from '../tasks/context'
import { generateImages } from './service'

export function createGenerationActions(context: TaskContext) {
  const { tasks, send } = context

  const generate = (kind: 'generate' | 'inpaint', req: NaiGenRequest | NaiInpaintRequest) =>
    tasks.run(
      kind,
      async ({ id, signal, progress }) => {
        const result = await generateImages(
          req,
          (step) => {
            progress(step)
            send('nai:step', { id, kind, step })
          },
          () => signal.aborted,
        )
        // A single-image request may finish without checking cancellation again. Tell the
        // renderer's multi-region queue to stop as well, while preserving this image.
        if (signal.aborted) {
          result.stopped ??= '已停止，已完成的图片已保留'
        }
        return result
      },
      { resource: 'generation', cancelMode: 'after-current' },
    )
  return {
    'nai:generate': (req: NaiGenRequest) => generate('generate', req),
    'nai:inpaint': (req: NaiInpaintRequest) => {
      if (!req?.inpaint) {
        throw new Error('缺少原图或遮罩')
      }
      return generate('inpaint', req)
    },
    'nai:cancel': () => tasks.cancelResource('generation'),
  } satisfies Partial<IpcActions>
}
