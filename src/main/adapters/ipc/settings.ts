import { dialog, shell } from 'electron'
import { storageRoot } from '../../infrastructure/storage-root'
import { storageInfo, scheduleMigration, cancelMigration } from '../../modules/settings/storage'
import { listSnippets, saveSnippet, deleteSnippet } from '../../modules/prompts/snippets'
import type { Settings } from '../../../shared/settings/types'
import { getSettings, saveSettings } from '../../modules/settings/service'
import type { IpcContext } from './context'
import { handle } from './handle'

export function registerSettingsIpc(_context: IpcContext): void {
  handle('storage:info', storageInfo)
  handle('storage:choose', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择新的数据目录（空文件夹）',
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  handle('storage:schedule', (_e, path) => scheduleMigration(path))
  handle('storage:cancel', cancelMigration)
  handle('storage:open', async () => {
    const error = await shell.openPath(storageRoot())
    if (error) {
      throw new Error(error)
    }
  })
  handle('snippets:list', listSnippets)
  handle('snippets:save', (_e, input) => saveSnippet(input))
  handle('snippets:delete', (_e, id) => deleteSnippet(id))
  handle('settings:get', () => {
    return getSettings()
  })

  // Skill 配置只走 skills:* 接口，避免界面里旧的设置副本把它覆盖
  handle('settings:save', (_e, patch: Partial<Settings>) => {
    const { skills: _s, skillsMigrated: _m, ...rest } = patch
    return saveSettings(rest)
  })
}
