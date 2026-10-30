import { dialog, shell } from 'electron'
import { taskIsActive } from '../../../shared/tasks/model'
import { createAppUpdater, UPDATE_REPO } from '../../modules/updates/service'
import type { IpcContext } from './context'
import { handle } from './handle'

export function registerUpdatesIpc(context: IpcContext): void {
  const { send, tasks } = context
  let reportDownload: ((message: string, current?: number, total?: number) => boolean) | undefined

  const updater = createAppUpdater(
    (info) => {
      send('update:state', info)
      if (info.stage === 'downloading') {
        reportDownload?.(`正在下载更新 · ${Math.round(info.percent ?? 0)}%`, info.percent, 100)
      }
    },
    () => tasks.snapshot().tasks.some(taskIsActive),
  )
  let checking: ReturnType<typeof updater.check> | undefined
  const check = (force: boolean) => {
    checking ??= tasks
      .run(
        'update-check',
        async ({ progress }) => {
          progress('正在检查新版本…')
          const result = await updater.check(force)
          if (result.error) {
            throw new Error(result.error)
          }
          progress(result.newer ? `发现新版本 ${result.latest}` : '当前已是最新版本')
          return result
        },
        { cancelMode: 'none' },
      )
      .finally(() => {
        checking = undefined
      })
    return checking
  }
  const updateTimer = setInterval(
    () => void check(true).catch((error) => console.error(error)),
    6 * 60 * 60 * 1000,
  )
  updateTimer.unref()
  handle('update:state', () => {
    return updater.snapshot()
  })

  handle('update:check', (_e, force?: boolean) => {
    return check(!!force)
  })

  handle('update:download', () => {
    return tasks.run(
      'update-download',
      async ({ progress }) => {
        reportDownload = progress
        try {
          await updater.download()
          const state = updater.snapshot()
          if (state.error) {
            throw new Error(state.error)
          }
          progress('更新已下载，可重启安装', 100, 100)
        } finally {
          reportDownload = undefined
        }
      },
      { cancelMode: 'none' },
    )
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
