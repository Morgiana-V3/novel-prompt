import { requestConfirmation, replyConfirmation } from '../desktop/confirmations'
import { dialog, shell } from 'electron'
import { storageRoot } from '../../infrastructure/storage-root'
import { storageInfo, scheduleMigration, cancelMigration } from '../../modules/settings/storage'
import { listSnippets, saveSnippet, deleteSnippet } from '../../modules/prompts/snippets'
import type { Settings } from '../../../shared/settings/types'
import { getSettings, saveSettings } from '../../modules/settings/service'
import { testVision } from '../../modules/prompts/vision-test'
import type { IpcContext } from './context'
import { handle } from './handle'

export function registerSettingsIpc(_context: IpcContext): void {
  handle('confirmations:reply', (event, id, approved) =>
    replyConfirmation(event.sender, id, approved),
  )
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
  handle('ai:vision-test', (_e, provider) => testVision(provider))
  handle('settings:get', () => {
    return getSettings()
  })

  // Skill 配置只走 skills:* 接口，避免界面里旧的设置副本把它覆盖
  handle('settings:save', async (_e, patch: Partial<Settings>) => {
    const { skills: _s, skillsMigrated: _m, ...rest } = patch
    if (rest.agentFreeOnly === false && getSettings().agentFreeOnly !== false) {
      const accepted = await requestConfirmation(_e.sender, {
        title: '允许 Agent 付费操作',
        message: '允许 Agent 使用付费服务而不再逐次询问？',
        detail:
          '包括 AI 模型调用、生图与图片处理，以及后续接入的付费操作。费用和总额可能无法提前确定。可随时重新开启「Agent 仅允许免费操作」。',
        confirmLabel: '允许付费操作',
      })
      if (!accepted) {
        rest.agentFreeOnly = true
      }
    }
    return saveSettings(rest)
  })
}
