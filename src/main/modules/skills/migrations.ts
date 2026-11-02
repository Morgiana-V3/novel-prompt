import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SkillEntry } from '../../../shared/skills/types'
import { getSettings, saveSettings } from '../settings/service'
import {
  KNOWN_DEFAULTS,
  DEFAULT_CONFIG,
  BUILTIN_PROMPT,
  BUILTIN_PREVIEW,
  fingerprint,
} from './catalog'
import { legacySkillDir, bundledSkillPath } from './paths'
import { builtinOf, newId, writeUser } from './repository'
export function migrateLegacy(): void {
  const settings = getSettings()
  if (settings.skillsMigrated) {
    return
  }
  saveSettings({ skillsMigrated: true })
  const dir = legacySkillDir()
  let state: Record<string, string> = {}
  try {
    state = JSON.parse(readFileSync(join(dir, '.bundled.json'), 'utf8'))
  } catch {
    /* 没有记录 */
  }
  const config: SkillEntry[] = [...(settings.skills ?? DEFAULT_CONFIG)]
  const pairs: [keyof typeof KNOWN_DEFAULTS, string, string][] = [
    ['nai-prompt.md', BUILTIN_PROMPT, '我的修改版 · 提示词编排'],
    ['nai-preview.md', BUILTIN_PREVIEW, '我的修改版 · 画面推测'],
  ]
  let changed = false
  for (const [file, builtinId, name] of pairs) {
    const path = join(dir, file)
    if (!existsSync(path)) {
      continue
    }
    try {
      const text = readFileSync(path, 'utf8')
      const fp = fingerprint(text)
      let latest = ''
      try {
        latest = fingerprint(readFileSync(bundledSkillPath(file), 'utf8'))
      } catch {
        /* ignore */
      }
      const pristine = KNOWN_DEFAULTS[file].includes(fp) || state[file] === fp || fp === latest
      if (pristine) {
        continue
      }
      const builtinSkill = builtinOf(builtinId)!
      const id = newId(file.replace(/\.md$/, '-migrated'))
      writeUser(
        id,
        {
          name: `${name}（迁移）`,
          description: `升级前你修改过的${builtinSkill.name.replace('内置 · ', '')}规范，已自动迁移`,
          scope: builtinSkill.scope,
          model: 'all',
        },
        text,
      )
      const at = config.findIndex((skillEntry) => skillEntry.id === builtinId)
      if (at >= 0) {
        config[at] = { id: builtinId, enabled: false }
      }
      config.splice(Math.max(0, at), 0, { id, enabled: true })
      changed = true
    } catch {
      /* 迁移失败不影响使用 */
    }
  }
  if (changed) {
    saveSettings({ skills: config.map((entry) => ({ id: entry.id, enabled: !!entry.enabled })) })
  }
}
