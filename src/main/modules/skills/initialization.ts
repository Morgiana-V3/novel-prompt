import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { getSettings, saveSettings } from '../settings/service'
import { BUNDLED_USER_SKILLS } from './catalog'
import { bundledUserSkillPath } from './paths'
import { readPackage } from './package-files'
import { parseFrontmatter, asScope, asModel } from './metadata'
import { userIds, userDoc, writeUser } from './repository'
export function initializeUserSkills(): void {
  const settings = getSettings()
  const initialized = new Set(settings.initializedUserSkills ?? [])
  let changed = false
  for (const id of BUNDLED_USER_SKILLS) {
    if (initialized.has(id)) {
      continue
    }
    if (!settings.deletedSkillTemplates?.includes(`template:${id}`)) {
      const file = bundledUserSkillPath(id)
      if (!existsSync(file)) {
        continue
      }
      const bundle = readPackage(dirname(file))
      const { meta, body } = parseFrontmatter(bundle.entry)
      const name = meta.name?.trim() || id
      const existing = userIds().some((userId) => {
        const doc = userDoc(userId)
        return userId === id || doc?.name === name || doc?.name.startsWith(`${name}（我的副本）`)
      })
      if (!existing) {
        writeUser(
          id,
          {
            name,
            description: meta.description?.trim() ?? '',
            scope: asScope(meta.scope, 'all'),
            model: asModel(meta.model),
          },
          body,
          bundle.resources,
          'directory',
        )
      }
    }
    initialized.add(id)
    changed = true
  }
  if (changed) {
    saveSettings({ initializedUserSkills: [...initialized] })
  }
}
