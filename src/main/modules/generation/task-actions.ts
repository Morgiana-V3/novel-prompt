import type { IpcActions } from '../../../shared/contracts/api'
import type {
  NaiGenRequest,
  NaiImg2ImgRequest,
  NaiInpaintRequest,
} from '../../../shared/generation/types'
import type { TaskContext } from '../tasks/context'
import { getSettings } from '../settings/service'
import { generateImages } from './service'

export function createGenerationActions(context: TaskContext) {
  const { tasks, send, claimFrontend } = context

  const generate = (
    kind: 'generate' | 'inpaint',
    req: NaiGenRequest | NaiImg2ImgRequest | NaiInpaintRequest,
    front: ReturnType<TaskContext['claimFrontend']> = null,
  ) =>
    tasks.run(
      kind,
      async ({ id, signal, progress }) => {
        const cancel = () => tasks.cancel(id)
        front?.signal.addEventListener('abort', cancel, { once: true })
        try {
          const result = await generateImages(
            req,
            (step) => {
              progress(step)
              front?.report(step)
              send('nai:step', { id, kind, step })
            },
            () => signal.aborted,
          )
          // The current image may finish after cancellation. Preserve it and stop the queue.
          if (signal.aborted) {
            result.stopped ??= '已停止，已完成的图片已保留'
          }
          // 新图片已写入图库：通知常驻的图集管理等视图刷新（与删除、MCP 生图一致）
          if (result.images.length) {
            send('gallery:changed', null)
          }
          return result
        } finally {
          front?.signal.removeEventListener('abort', cancel)
        }
      },
      {
        resource: 'generation',
        cancelMode: 'after-current',
        ...(front ? { origin: 'agent', label: front.label } : {}),
      },
    )
  return {
    'nai:generate': (req: NaiGenRequest | NaiImg2ImgRequest) => generate('generate', req),
    'nai:inpaint': (req: NaiInpaintRequest, actionId?: string) => {
      if (!req?.inpaint) {
        throw new Error('缺少原图或遮罩')
      }
      const front = claimFrontend(actionId, 'creation-inpaint', '')
      if (front && (!getSettings().mcpAllowGenerate || !getSettings().naiToken)) {
        throw new Error('Agent 生图权限已关闭或未配置')
      }
      return generate('inpaint', req, front)
    },
    'nai:cancel': () => tasks.cancelResource('generation'),
  } satisfies Partial<IpcActions>
}
