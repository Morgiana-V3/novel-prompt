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
  handle('reverse:status', (_event, models) => service.status(reverseModels(models)))
  handle('reverse:install', async (_event, models) => {
    const selected = reverseModels(models)
    service
      .install(undefined, selected)
      .catch((error) => console.error('Local models:', String(error)))
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
      service
        .install(result.filePaths, selected)
        .catch((error) => console.error('Local models:', String(error)))
    }
    return service.status()
  })
  handle('reverse:cancel', () => service.cancel())
  handle('reverse:remove', (_event, models) => service.remove(reverseModels(models)))
  handle('reverse:analyze', (_event, bytes, models) =>
    service.analyze(bytes, workerPath, reverseModels(models)),
  )
  handle('reverse:score', async (_event, reference, name) => {
    styleSimilarity(reference, reference)
    const path = libraryImagePath(name)
    if (!path) {
      throw new Error('候选图片已不存在')
    }
    const result = await service.analyze(new Uint8Array(await readFile(path)), workerPath, ['k3'])
    if (!result.style) {
      throw new Error('模型没有输出风格特征，请修复 K3 模型')
    }
    return styleSimilarity(reference, result.style)
  })
}
