import type { Settings } from '../../../shared/settings/types'
import { getSettings, saveSettings } from '../../modules/settings/service'
import type { IpcContext } from './context'
import { handle } from './handle'

export function registerSettingsIpc(_context: IpcContext): void {
  handle('settings:get', () => {
    return getSettings()
  })

  // Skill 配置只走 skills:* 接口，避免界面里旧的设置副本把它覆盖
  handle('settings:save', (_e, patch: Partial<Settings>) => {
    const { skills: _s, skillsMigrated: _m, ...rest } = patch
    return saveSettings(rest)
  })
}
