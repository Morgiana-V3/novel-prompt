import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { NaiVersion } from '../../../shared/generation/types'
import type {
  SkillConfigItem,
  SkillDoc,
  SkillEntry,
  SkillInput,
  SkillMeta,
  SkillModel,
  SkillScope,
} from '../../../shared/skills/types'
import type { PageSkillSection, PageSkillSnapshot } from '../../../shared/workspace/model'
import { writeFileAtomic as writeFileSync } from '../../infrastructure/atomic-file'
import {
  KNOWN_DEFAULTS,
  bundledSkillPath,
  fingerprint,
  legacySkillDir,
  userSkillDir,
  type BundledSkill,
} from '../../infrastructure/paths'
import { getSettings, saveSettings } from '../settings/service'

/**
 * Skill 体系：
 * - core.md：固定的使用总则（如何使用启用的 Skill、优先级怎么取舍），始终生效，不可关闭
 * - 内置 Skill：随安装包发布，只读；可以关闭或复制为用户 Skill 再改
 * - 用户 Skill：userData/skills/user/*.md，frontmatter 记录名称、说明、作用范围、适用模型
 * 启用状态与优先级存在 settings.skills（数组顺序 = 优先级）。
 */

export type SkillFeature = 'optimize' | 'preview' | 'inpaint' | 'workspace'

interface Builtin {
  id: string
  file: BundledSkill
  name: string
  description: string
  scope: SkillScope
}

export const BUILTIN_PROMPT = 'builtin:prompt'
export const BUILTIN_PREVIEW = 'builtin:preview'
export const BUILTIN_INPAINT = 'builtin:inpaint'

const BUILTINS: Builtin[] = [
  {
    id: BUILTIN_INPAINT,
    file: 'nai-inpaint.md',
    name: '内置 · 局部重绘优化',
    description: '将选区批注转换为最小提示词修改；保留身份和无关特征，识别冲突，输出逐区域修改依据',
    scope: 'inpaint',
  },
  {
    id: BUILTIN_PROMPT,
    file: 'nai-prompt.md',
    name: '内置 · 提示词编排',
    description:
      '本软件的 NovelAI 提示词规范：语法与权重、编排顺序、角色提示词与互动、NAI 专用 tag、负面、评判依据',
    scope: 'optimize',
  },
  {
    id: BUILTIN_PREVIEW,
    file: 'nai-preview.md',
    name: '内置 · 画面推测',
    description: '根据提示词推测成图效果、指出风险',
    scope: 'preview',
  },
]

const DEFAULT_CONFIG: SkillEntry[] = BUILTINS.map((builtinSkill) => ({
  id: builtinSkill.id,
  enabled: true,
}))

const SCOPES: SkillScope[] = ['optimize', 'preview', 'inpaint', 'all']
const MODELS: SkillModel[] = ['all', 'v4.5', 'v5']
export const SCOPE_LABEL: Record<SkillScope, string> = {
  optimize: 'AI 优化',
  preview: '画面推测',
  inpaint: '局部重绘',
  all: '全部功能',
}
export const MODEL_LABEL: Record<SkillModel, string> = { all: '通用', 'v4.5': 'V4.5', v5: 'V5' }

/* ---------- frontmatter ---------- */

const unquote = (text: string) => {
  const text2 = text.trim()
  return /^(['"]).*\1$/.test(text2) ? text2.slice(1, -1) : text2
}

/** 解析开头的 --- frontmatter（只支持单行 key: value） */
export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src)
  if (!match) {
    return { meta: {}, body: src.trim() }
  }
  const meta: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (kv) {
      meta[kv[1].toLowerCase()] = unquote(kv[2])
    }
  }
  return { meta, body: src.slice(match[0].length).trim() }
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()
const yamlValue = (text: string) =>
  /^[\w\u4e00-\u9fff .·()（）\-—，、]*$/.test(text) && !/^\s|\s$/.test(text)
    ? text
    : JSON.stringify(text)

function serialize(
  metadata: { name: string; description: string; scope: SkillScope; model: SkillModel },
  body: string,
): string {
  return [
    '---',
    `name: ${yamlValue(oneLine(metadata.name))}`,
    `description: ${yamlValue(oneLine(metadata.description))}`,
    `scope: ${metadata.scope}`,
    `model: ${metadata.model}`,
    '---',
    '',
    body.trim(),
    '',
  ].join('\n')
}

const asScope = (value: unknown, defaultScope: SkillScope): SkillScope =>
  SCOPES.includes(value as SkillScope) ? (value as SkillScope) : defaultScope
const asModel = (value: unknown): SkillModel => {
  const text = String(value ?? '')
    .toLowerCase()
    .replace(/^v?4\.5$/, 'v4.5')
    .replace(/^v?5$/, 'v5')
  return MODELS.includes(text as SkillModel) ? (text as SkillModel) : 'all'
}

/* ---------- 读取 ---------- */

const builtinOf = (id: string) => BUILTINS.find((builtinSkill) => builtinSkill.id === id)
const userFile = (id: string) => join(userSkillDir(), `${id}.md`)
const validId = (id: string) => /^[\w-]{1,64}$/.test(id)

function readBundled(file: BundledSkill): string {
  try {
    return readFileSync(bundledSkillPath(file), 'utf8').replace(/\r\n/g, '\n').trim()
  } catch {
    return ''
  }
}

function builtinDoc(builtinSkill: Builtin): SkillDoc {
  const content = parseFrontmatter(readBundled(builtinSkill.file)).body
  let updatedAt = 0
  try {
    updatedAt = statSync(bundledSkillPath(builtinSkill.file)).mtimeMs
  } catch {
    /* ignore */
  }
  return {
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

function userDoc(id: string): SkillDoc | null {
  const file = userFile(id)
  if (!validId(id) || !existsSync(file)) {
    return null
  }
  const { meta, body } = parseFrontmatter(readFileSync(file, 'utf8'))
  return {
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

const strip = ({ content: _c, ...meta }: SkillDoc): SkillMeta => meta

function userIds(): string[] {
  try {
    return readdirSync(userSkillDir())
      .filter((filename) => filename.toLowerCase().endsWith('.md'))
      .map((filename) => filename.slice(0, -3))
      .filter(validId)
  } catch {
    return []
  }
}

export function getSkill(id: string): SkillDoc | null {
  const builtinSkill = builtinOf(id)
  return builtinSkill ? builtinDoc(builtinSkill) : userDoc(id)
}

function allDocs(): SkillDoc[] {
  return [
    ...BUILTINS.map(builtinDoc),
    ...userIds()
      .map(userDoc)
      .filter((skill): skill is SkillDoc => !!skill),
  ]
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

export const isActive = (id: string, feature: SkillFeature, version: NaiVersion) =>
  activeSkills(feature, version).some((skill) => skill.id === id)

/* ---------- 增删改 ---------- */

function newId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  const base = slug || 'skill'
  let id = base
  for (let i = 2; existsSync(userFile(id)); i++) {
    id = `${base}-${i}`
  }
  return id
}

function writeUser(
  id: string,
  metadata: { name: string; description: string; scope: SkillScope; model: SkillModel },
  body: string,
): SkillDoc {
  writeFileSync(userFile(id), serialize(metadata, body), 'utf8')
  return userDoc(id)!
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
  unlinkSync(file)
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
    },
    { enabled: false, priority: idx + 1 },
  )
  return doc
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
  const builtinSkill = builtinOf(id)
  if (builtinSkill) {
    return bundledSkillPath(builtinSkill.file)
  }
  return validId(id) && existsSync(userFile(id)) ? userFile(id) : null
}

/* ---------- 组装系统提示词 ---------- */

const FEATURE_LABEL: Record<SkillFeature, string> = {
  optimize: 'AI 优化 / 描述转提示词',
  preview: '画面推测',
  inpaint: '局部重绘优化',
  workspace: 'AI 工作台（按任务选择适用规则）',
}

/**
 * 组装「总则 + 启用的 Skill 清单 + 按优先级排列的正文」。
 * 调用方在后面追加程序约定（输出格式等）。
 */
export function composeSkills(
  feature: SkillFeature,
  version: NaiVersion,
): { text: string; skills: SkillDoc[]; snapshot: PageSkillSnapshot } {
  const skills = activeSkills(feature, version)
  const modelName = version === 'v5' ? 'V5' : 'V4.5'
  const table = skills.length
    ? [
        '| 优先级 | 名称 | 说明 | 适用模型 |',
        '|---|---|---|---|',
        ...skills.map(
          (skill, i) =>
            `| ${i + 1} | ${skill.name} | ${oneLine(skill.description) || '—'} | ${MODEL_LABEL[skill.model]} |`,
        ),
      ].join('\n')
    : '（本次没有启用任何 Skill：按你对 NovelAI 与 Danbooru 的通用知识工作）'
  const hash = (text: string) => createHash('sha256').update(text).digest('hex')
  const core = coreText()
  let text =
    core +
    `\n\n---\n# 已启用的 Skill\n功能：${FEATURE_LABEL[feature]}；目标模型：${modelName}。\n\n${table}`
  const sections: PageSkillSection[] = [
    {
      id: 'builtin:core',
      name: 'Skill 使用总则',
      description: '必读的选择、优先级和引用规则',
      scope: 'core',
      model: 'all',
      priority: 0,
      start: 0,
      end: core.length,
      digest: hash(core),
    },
  ]
  for (const [i, s] of skills.entries()) {
    text += `\n\n<skill priority="${i + 1}" scope="${s.scope}" name="${s.name.replace(/"/g, "'")}">\n`
    const start = text.length
    text += s.content
    sections.push({
      id: s.id,
      name: s.name,
      description: s.description,
      scope: s.scope,
      model: s.model,
      priority: i + 1,
      start,
      end: text.length,
      digest: hash(s.content),
    })
    text += '\n</skill>'
  }
  return { text, skills, snapshot: { text, digest: hash(text), sections } }
}

/* ---------- 旧版迁移 ---------- */

/**
 * 旧版本把内置 skill 复制到 userData/skills 下让用户直接改。升级后内置 Skill 只读，
 * 用户改过的副本转成一份用户 Skill，启用并替代对应的内置 Skill，保证升级后行为不变。
 */
function migrateLegacy(): void {
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
    saveConfig(config)
  }
}
