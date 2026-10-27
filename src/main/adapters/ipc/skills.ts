import { dialog, shell } from 'electron'
import type { SkillEntry, SkillInput } from '../../../shared/skills/types'
import { userSkillDir } from '../../infrastructure/paths'
import {
  coreText,
  createSkill,
  deleteSkill,
  duplicateSkill,
  getConfig,
  getSkill,
  importSkillFile,
  setConfig,
  skillFilePath,
  updateSkill,
} from '../../modules/skills/service'
import type { IpcContext } from './context'
import { handle } from './handle'

export function registerSkillsIpc(context: IpcContext): void {
  /* ---------- Skill ---------- */
  handle('skills:list', () => {
    return getConfig()
  })

  handle('skills:get', (_e, id: string) => {
    return getSkill(id)
  })

  handle('skills:core', () => {
    return coreText()
  })

  handle('skills:setConfig', (_e, entries: SkillEntry[]) => {
    return setConfig(entries)
  })

  handle('skills:create', (_e, input: SkillInput) => {
    return createSkill(input)
  })

  handle('skills:update', (_e, id: string, patch: Partial<SkillInput>) => {
    return updateSkill(id, patch)
  })

  handle('skills:delete', (_e, id: string) => {
    return deleteSkill(id)
  })

  handle('skills:duplicate', (_e, id: string) => {
    return duplicateSkill(id)
  })

  handle('skills:import', async () => {
    const win = context.getWindow()

    const openDialogResult = await dialog.showOpenDialog(win!, {
      title: '导入 Skill',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      properties: ['openFile', 'multiSelections'],
    })
    if (openDialogResult.canceled) {
      return { imported: [], errors: [] }
    }
    const imported: string[] = []
    const errors: string[] = []
    for (const path of openDialogResult.filePaths) {
      try {
        imported.push(importSkillFile(path).name)
      } catch (error) {
        errors.push(`${path}：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return { imported, errors }
  })

  handle('skills:reveal', (_e, id?: string) => {
    const path = id ? skillFilePath(id) : null
    if (path) {
      shell.showItemInFolder(path)
    } else {
      shell.openPath(userSkillDir()).catch((error) => console.error(error))
    }
  })
}
