import { app, dialog, net } from 'electron'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { reverseModels } from '../../../shared/reverse/types'
import { styleSimilarity } from '../../../shared/reverse/candidates'
import { libraryImagePath } from '../../modules/images/library'
import { ReverseService } from '../../modules/reverse/service'
import type { IpcContext } from './context'
import { handle } from './handle'

export function registerReverseIpc(
  context: IpcContext,
  workerPath = join(__dirname, 'reverse-worker.js'),
): void {
  const service = new ReverseService(
    join(app.getPath('userData'), 'models', 'reverse-v1'),
    undefined,
    net.fetch.bind(net),
  )
  app.on('before-quit', () => service.cancel())
  const trackRecognition = <T>(
    kind: 'reverse-analyze' | 'reverse-score',
    work: (signal: AbortSignal, report: (message: string) => void) => Promise<T>,
  ) =>
    context.tasks.run(
      kind,
      async ({ signal, progress }) => {
        signal.throwIfAborted()
        const result = await work(signal, (message) => progress(message))
        progress(kind === 'reverse-score' ? '风格比较完成' : '图片识别完成')
        return result
      },
      { resource: 'reverse', onCancel: () => service.cancel() },
    )
  handle('reverse:status', (_event, models) => service.status(reverseModels(models)))
  const install = (selected: ReturnType<typeof reverseModels>, paths?: string[]) =>
    context.tasks.run(
      'reverse-install',
      async ({ progress }) => {
        const report = () => progress(service.message || '正在准备模型…', service.completedBytes)
        const timer = setInterval(report, 300)
        try {
          await service.install(paths, selected)
          if (service.phase === 'error') {
            throw new Error(service.message)
          }
          report()
        } finally {
          clearInterval(timer)
        }
      },
      { resource: 'reverse', onCancel: () => service.cancel() },
    )
  handle('reverse:install', async (_event, models) => {
    const selected = reverseModels(models)
    install(selected).catch((error) => console.error('Local models:', String(error)))
    return service.status()
  })
  handle('reverse:import', async (_event, models) => {
    const selected = reverseModels(models)
    const win = context.getWindow()
    if (!win || service.busy) {
      return service.status()
    }
    const result = await dialog.showOpenDialog(win, {
      title: '选择已下载的模型、标签与许可文件（可多选）',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '本地模型文件', extensions: ['onnx', 'json', 'csv', 'md'] }],
    })
    if (!result.canceled) {
      install(selected, result.filePaths).catch((error) =>
        console.error('Local models:', String(error)),
      )
    }
    return service.status()
  })
  handle('reverse:cancel', () => {
    context.tasks.cancelResource('reverse')
    service.cancel()
  })
  handle('reverse:remove', (_event, models) =>
    context.tasks.run(
      'reverse-remove',
      async ({ progress }) => {
        progress('正在删除本地模型文件…')
        await service.remove(reverseModels(models))
        progress('已删除本地模型')
      },
      { resource: 'reverse', cancelMode: 'none' },
    ),
  )
  handle('reverse:analyze', (_event, bytes, models) =>
    trackRecognition('reverse-analyze', (_signal, report) =>
      service.analyze(bytes, workerPath, reverseModels(models), report),
    ),
  )
  handle('reverse:score', async (_event, reference, name) => {
    styleSimilarity(reference, reference)
    const path = libraryImagePath(name)
    if (!path) {
      throw new Error('候选图片已不存在')
    }
    return trackRecognition('reverse-score', async (signal, report) => {
      const bytes = new Uint8Array(await readFile(path))
      signal.throwIfAborted()
      const result = await service.analyze(bytes, workerPath, ['k3'], report)
      if (!result.style) {
        throw new Error('模型没有输出风格特征，请修复 K3 模型')
      }
      return styleSimilarity(reference, result.style)
    })
  })
}
