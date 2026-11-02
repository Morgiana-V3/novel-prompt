import { existsSync, readFileSync, unlinkSync, rmSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { NaiVersion } from '../../../shared/generation/types'
import type {
  SkillConfigItem,
  SkillDoc,
  SkillEntry,
  SkillInput,
  SkillImportPreview,
  SkillMeta,
} from '../../../shared/skills/types'
import { getSettings, saveSettings } from '../settings/service'
import { DEFAULT_CONFIG, type SkillFeature } from './catalog'
import { bundledSkillPath } from './paths'
import { readPackage, writePackage } from './package-files'
import { parseFrontmatter, serialize, asScope, asModel } from './metadata'
import {
  builtinOf,
  builtinDoc,
  userDoc,
  userFile,
  validId,
  packageRoot,
  allDocs,
  readBundled,
  newId,
  writeUser,
} from './repository'
import { initializeUserSkills } from './initialization'
import { migrateLegacy } from './migrations'
import { composeSkillDocuments } from './composition'
export {
  BUILTIN_PROMPT,
  BUILTIN_PREVIEW,
  BUILTIN_INPAINT,
  SCOPE_LABEL,
  MODEL_LABEL,
  type SkillFeature,
} from './catalog'
export { parseFrontmatter } from './metadata'
const strip = ({ content: _c, resources: _resources, ...meta }: SkillDoc): SkillMeta => meta
export function getSkill(id: string): SkillDoc | null {
  initializeUserSkills()
  const builtinSkill = builtinOf(id)
  return builtinSkill ? builtinDoc(builtinSkill) : userDoc(id)
}

export function coreText(): string {
  return (
    readBundled('core.md') ||
    '# Skill 使用总则\n按下方启用的 Skill 工作；冲突时以 priority 数字小的为准。'
  )
}

/* ---------- 启用与优先级 ---------- */

/** 当前配置（含全部 Skill，按优先级排列）。旧配置里已删除的 Skill 自动去掉，新出现的按默认追加 */
export function getConfig(): SkillConfigItem[] {
  migrateLegacy()
  initializeUserSkills()
  const docs = allDocs()
  const byId = new Map(docs.map((skill) => [skill.id, skill]))
  const saved = getSettings().skills ?? DEFAULT_CONFIG
  const out: SkillConfigItem[] = []
  const seen = new Set<string>()
  for (const skillEntry of saved) {
    const skill = byId.get(skillEntry.id)
    if (!skill || seen.has(skillEntry.id)) {
      continue
    }
    seen.add(skillEntry.id)
    out.push({ ...strip(skill), enabled: !!skillEntry.enabled })
  }
  for (const skill2 of docs) {
    if (!seen.has(skill2.id)) {
      out.push({ ...strip(skill2), enabled: skill2.builtin })
    }
  }
  return out
}

function saveConfig(entries: SkillEntry[]): void {
  saveSettings({
    skills: entries.map((skillEntry) => ({ id: skillEntry.id, enabled: !!skillEntry.enabled })),
  })
}

/**
 * 设置启用与优先级：传入的顺序即优先级；未传入的 Skill 保持原来的启用状态，按原顺序排在后面。
 */
export function setConfig(entries: SkillEntry[]): SkillConfigItem[] {
  const current = getConfig()
  const known = new Set(current.map((skill) => skill.id))
  const listed = entries.filter(
    (skillEntry, i) =>
      known.has(skillEntry.id) &&
      entries.findIndex((skillEntry2) => skillEntry2.id === skillEntry.id) === i,
  )
  const listedIds = new Set(listed.map((skillEntry) => skillEntry.id))
  saveConfig([...listed, ...current.filter((skill) => !listedIds.has(skill.id))])
  return getConfig()
}

function insertConfig(id: string, enabled: boolean, index = 0): void {
  const cur: SkillEntry[] = getConfig()
    .filter((skill) => skill.id !== id)
    .map((skill) => ({ id: skill.id, enabled: skill.enabled }))
  cur.splice(Math.max(0, Math.min(index, cur.length)), 0, { id, enabled })
  saveConfig(cur)
}

/** 某个功能在当前模型下实际生效的 Skill（按优先级） */
export function activeSkills(feature: SkillFeature, version: NaiVersion): SkillDoc[] {
  return getConfig()
    .filter(
      (skill) =>
        skill.enabled &&
        (feature === 'workspace' || skill.scope === 'all' || skill.scope === feature) &&
        (skill.model === 'all' || skill.model === version),
    )
    .map((skill) => getSkill(skill.id))
    .filter((skill): skill is SkillDoc => !!skill)
}

function checkInput(name: string, content: string) {
  if (!name.trim()) {
    throw new Error('Skill 名称不能为空')
  }
  if (!content.trim()) {
    throw new Error('Skill 内容不能为空')
  }
}

/** 新建用户 Skill，默认启用并放在最高优先级 */
export function createSkill(
  input: SkillInput,
  opts: { enabled?: boolean; priority?: number } = {},
): SkillDoc {
  checkInput(input.name, input.content)
  const id = newId(input.name)
  const doc = writeUser(
    id,
    {
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
      scope: asScope(input.scope, 'optimize'),
      model: asModel(input.model),
    },
    input.content,
    input.resources,
    input.format,
  )
  insertConfig(id, opts.enabled ?? true, (opts.priority ?? 1) - 1)
  return doc
}

export function updateSkill(id: string, patch: Partial<SkillInput>): SkillDoc {
  if (builtinOf(id)) {
    throw new Error('内置 Skill 不能修改，可以先复制为自己的 Skill')
  }
  const cur = userDoc(id)
  if (!cur) {
    throw new Error(`找不到 Skill：${id}`)
  }
  const name = patch.name ?? cur.name
  const content = patch.content ?? cur.content
  checkInput(name, content)
  return writeUser(
    id,
    {
      name: name.trim(),
      description: (patch.description ?? cur.description).trim(),
      scope: asScope(patch.scope ?? cur.scope, cur.scope),
      model: asModel(patch.model ?? cur.model),
    },
    content,
    patch.resources ?? cur.resources,
    cur.format === 'directory' ? 'directory' : patch.format,
  )
}

export function deleteSkill(id: string): void {
  if (builtinOf(id)) {
    throw new Error('内置 Skill 不能删除，可以在启用设置里关闭')
  }
  const file = userFile(id)
  if (!validId(id) || !existsSync(file)) {
    throw new Error(`找不到 Skill：${id}`)
  }
  if (file.endsWith('SKILL.md')) {
    // validId above constrains deletion to one child of the managed Skill directory.
    rmSync(packageRoot(id), { recursive: true })
  } else {
    unlinkSync(file)
  }
  saveConfig(getConfig())
}

/** 复制为用户 Skill（内置的也可以），副本放在原 Skill 上方、默认不启用 */
export function duplicateSkill(id: string): SkillDoc {
  const src = getSkill(id)
  if (!src) {
    throw new Error(`找不到 Skill：${id}`)
  }
  const idx = getConfig().findIndex((skill) => skill.id === id)
  const doc = createSkill(
    {
      name: `${src.name.replace(/^内置 · /, '')}（我的副本）`,
      description: src.description,
      scope: src.scope,
      model: src.model,
      content: src.content,
      format: src.format,
      resources: src.resources,
    },
    { enabled: false, priority: idx + 1 },
  )
  return doc
}

export function previewSkillDirectory(path: string): SkillImportPreview {
  const bundle = readPackage(path)
  const { meta, body } = parseFrontmatter(bundle.entry)
  return {
    input: {
      name: meta.name?.trim() || basename(path),
      description: meta.description ?? '',
      scope: asScope(meta.scope, 'all'),
      model: asModel(meta.model),
      content: body,
      format: 'directory',
      resources: bundle.resources,
    },
    warnings: bundle.warnings,
  }
}

export function exportSkillDirectory(id: string, parent: string): string {
  const skill = getSkill(id)
  if (!skill) {
    throw new Error('Skill 不存在')
  }
  const target = join(parent, id.replace(':', '-'))
  if (existsSync(target)) {
    throw new Error('目标文件夹已存在，请选择其他位置，避免覆盖已有内容')
  }
  writePackage(target, serialize(skill, skill.content), skill.resources ?? [])
  return target
}

/** 导入 .md 文件：有 frontmatter 时读取 name / description / scope / model，否则用文件名作名称 */
export function importSkillFile(path: string, opts: { enabled?: boolean } = {}): SkillDoc {
  if (extname(path).toLowerCase() !== '.md') {
    throw new Error('只支持导入 .md 文件')
  }
  if (!existsSync(path)) {
    throw new Error(`文件不存在：${path}`)
  }
  const { meta, body } = parseFrontmatter(readFileSync(path, 'utf8'))
  return createSkill(
    {
      name: meta.name?.trim() || basename(path, extname(path)),
      description: meta.description ?? '',
      scope: asScope(meta.scope, 'optimize'),
      model: asModel(meta.model),
      content: body,
    },
    opts,
  )
}

export const skillFilePath = (id: string): string | null => {
  initializeUserSkills()
  const builtinSkill = builtinOf(id)
  if (builtinSkill) {
    return bundledSkillPath(builtinSkill.file)
  }
  return validId(id) && existsSync(userFile(id)) ? userFile(id) : null
}

export function composeSkills(feature: SkillFeature, version: NaiVersion) {
  return composeSkillDocuments(feature, version, activeSkills(feature, version), coreText())
}

export { userSkillDir } from './paths'
