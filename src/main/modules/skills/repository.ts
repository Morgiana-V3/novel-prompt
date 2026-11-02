import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { SkillDoc, SkillInput, SkillModel, SkillScope } from '../../../shared/skills/types'
import { writeFileAtomic as writeFileSync } from '../../infrastructure/atomic-file'
import { BUILTINS, type Builtin, type BundledSkill } from './catalog'
import { bundledSkillPath, userSkillDir } from './paths'
import { parseFrontmatter, serialize, asScope, asModel } from './metadata'
import { readPackage, writePackage, recoverPackage } from './package-files'
export const builtinOf = (id: string) => BUILTINS.find((builtinSkill) => builtinSkill.id === id)
export const packageRoot = (id: string) => join(userSkillDir(), id)
export const userFile = (id: string) => {
  if (!validId(id)) {
    throw new Error('Skill 标识无效')
  }
  recoverPackage(packageRoot(id))
  return existsSync(join(packageRoot(id), 'SKILL.md'))
    ? join(packageRoot(id), 'SKILL.md')
    : join(userSkillDir(), `${id}.md`)
}
export const validId = (id: string) => /^[\w-]{1,64}$/.test(id)

export function readBundled(file: BundledSkill): string {
  try {
    return readFileSync(bundledSkillPath(file), 'utf8').replace(/\r\n/g, '\n').trim()
  } catch {
    return ''
  }
}

export function builtinDoc(builtinSkill: Builtin): SkillDoc {
  const file = bundledSkillPath(builtinSkill.file)
  const bundle = basename(file) === 'SKILL.md' ? readPackage(dirname(file)) : null
  const content = parseFrontmatter(bundle?.entry ?? readBundled(builtinSkill.file)).body
  let updatedAt = 0
  try {
    updatedAt = statSync(bundledSkillPath(builtinSkill.file)).mtimeMs
  } catch {
    /* ignore */
  }
  return {
    format: bundle ? 'directory' : 'file',
    resourceCount: bundle?.resources.length ?? 0,
    resources: bundle?.resources.map((resource) => ({
      ...resource,
      content:
        resource.kind === 'markdown' ? resource.content.replace(/\r\n/g, '\n') : resource.content,
    })),
    id: builtinSkill.id,
    name: builtinSkill.name,
    description: builtinSkill.description,
    scope: builtinSkill.scope,
    model: 'all',
    builtin: true,
    chars: content.length,
    updatedAt,
    content,
  }
}

export function userDoc(id: string): SkillDoc | null {
  if (!validId(id)) {
    return null
  }
  const file = userFile(id)
  if (!validId(id) || !existsSync(file)) {
    return null
  }
  const bundle = file.endsWith('SKILL.md') ? readPackage(packageRoot(id)) : null
  const { meta, body } = parseFrontmatter(bundle?.entry ?? readFileSync(file, 'utf8'))
  return {
    format: bundle ? 'directory' : 'file',
    resourceCount: bundle?.resources.length ?? 0,
    resources: bundle?.resources,
    id,
    name: meta.name?.trim() || id,
    description: meta.description?.trim() ?? '',
    scope: asScope(meta.scope, 'optimize'),
    model: asModel(meta.model),
    builtin: false,
    chars: body.length,
    updatedAt: statSync(file).mtimeMs,
    content: body,
  }
}

export function userIds(): string[] {
  try {
    for (const name of readdirSync(userSkillDir())) {
      const match = /^([\w-]{1,64})\.backup-[a-f0-9-]{36}$/.exec(name)
      if (match) {
        recoverPackage(packageRoot(match[1]))
      }
    }
    return readdirSync(userSkillDir())
      .filter(
        (filename) =>
          filename.toLowerCase().endsWith('.md') ||
          (validId(filename) && existsSync(join(packageRoot(filename), 'SKILL.md'))),
      )
      .map((filename) => (filename.endsWith('.md') ? filename.slice(0, -3) : filename))
      .filter(validId)
  } catch {
    return []
  }
}

export function allDocs(): SkillDoc[] {
  return [
    ...BUILTINS.map(builtinDoc),
    ...userIds()
      .map(userDoc)
      .filter((skill): skill is SkillDoc => !!skill),
  ]
}

export function newId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  const base = slug || 'skill'
  let id = base
  for (let i = 2; existsSync(userFile(id)) || existsSync(packageRoot(id)); i++) {
    id = `${base}-${i}`
  }
  return id
}

export function writeUser(
  id: string,
  metadata: { name: string; description: string; scope: SkillScope; model: SkillModel },
  body: string,
  resources?: SkillInput['resources'],
  format?: SkillInput['format'],
): SkillDoc {
  if (format === 'directory' || resources?.length || userFile(id).endsWith('SKILL.md')) {
    const previousFile = join(userSkillDir(), `${id}.md`)
    writePackage(packageRoot(id), serialize(metadata, body), resources ?? [])
    if (existsSync(previousFile)) {
      unlinkSync(previousFile)
    }
  } else {
    writeFileSync(userFile(id), serialize(metadata, body), 'utf8')
  }
  return userDoc(id)!
}
