import { dialog, shell } from 'electron'
import { taskIsActive } from '../../../shared/tasks/model'
import { createAppUpdater, UPDATE_REPO } from '../../modules/updates/service'
import type { IpcContext } from './context'
import { handle } from './handle'

export function registerUpdatesIpc(context: IpcContext): void {
  const { send, tasks } = context

  const updater = createAppUpdater(
    (info) => send('update:state', info),
    () => tasks.snapshot().tasks.some(taskIsActive),
  )
  const updateTimer = setInterval(
    () => void updater.check(true).catch((error) => console.error(error)),
    6 * 60 * 60 * 1000,
  )
  updateTimer.unref()
  handle('update:state', () => {
    return updater.snapshot()
  })

  handle('update:check', (_e, force?: boolean) => {
    return updater.check(!!force)
  })

  handle('update:download', () => {
    return updater.download()
  })

  handle('update:install', async () => {
    const win = context.getWindow()

    if (!win || updater.snapshot().stage !== 'ready') {
      throw new Error('更新尚未准备好')
    }
    if (tasks.snapshot().tasks.some(taskIsActive)) {
      throw new Error('还有任务正在运行，请等任务结束后再更新')
    }
    const result = await dialog.showMessageBox(win, {
      type: 'question',
      title: '重启并更新',
      message: `安装 NovelPrompt ${updater.snapshot().latest}？`,
      detail: '应用将关闭并在更新后重新打开。已保存的设置、提示词、会话和图库会保留。',
      buttons: ['稍后', '重启并更新'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (result.response === 1) {
      updater.install()
    }
  })

  // 只允许打开本仓库的 release 页，避免渲染进程被注入后借 shell 打开任意地址
  handle('update:open', (_e, url: string) => {
    return shell.openExternal(
      /^https:\/\/github\.com\/Morgiana-V3\/novel-prompt\/releases(?:[/?#]|$)/.test(url)
        ? url
        : `https://github.com/${UPDATE_REPO}/releases/latest`,
    )
  })
}
