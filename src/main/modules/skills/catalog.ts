import { createHash } from 'node:crypto'
import type { SkillEntry, SkillModel, SkillScope } from '../../../shared/skills/types'
export type SkillFeature = 'optimize' | 'preview' | 'inpaint' | 'workspace'

/** 随安装包发布的使用总则、提示词编排、画面推测与局部重绘规则。 */
export const BUNDLED_SKILLS = [
  'core.md',
  'nai-prompt.md',
  'nai-preview.md',
  'nai-inpaint.md',
] as const
export type BundledSkill = (typeof BUNDLED_SKILLS)[number]

export const BUNDLED_USER_SKILLS = ['nai-manga-prompt-design'] as const
export type BundledUserSkill = (typeof BUNDLED_USER_SKILLS)[number]

export interface Builtin {
  id: string
  file: BundledSkill
  name: string
  description: string
  scope: SkillScope
}

export const BUILTIN_PROMPT = 'builtin:prompt'
export const BUILTIN_PREVIEW = 'builtin:preview'
export const BUILTIN_INPAINT = 'builtin:inpaint'

export const BUILTINS: Builtin[] = [
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

export const DEFAULT_CONFIG: SkillEntry[] = BUILTINS.map((builtinSkill) => ({
  id: builtinSkill.id,
  enabled: true,
}))

export const SCOPE_LABEL: Record<SkillScope, string> = {
  optimize: '智能优化',
  preview: '画面推测',
  inpaint: '局部重绘',
  all: '全部功能',
}
export const MODEL_LABEL: Record<SkillModel, string> = { all: '通用', 'v4.5': 'V4.5', v5: 'V5' }

/**
 * 历史版本里随安装包发布过的 skill 内容指纹（换行统一为 \n 后 sha256 的前 16 位）。
 * 迁移时用来判断旧副本是不是「没改过的默认版」：是就丢弃，否则转成一份用户 Skill。
 */
export const KNOWN_DEFAULTS: Record<'nai-prompt.md' | 'nai-preview.md', string[]> = {
  'nai-prompt.md': [
    '21f8661e8a634288',
    'a08684a449026b80',
    'bc996c88eb5cd654',
    'bb5958b1e8e40872',
    '8974f19147708d36',
    '2db7ee1a2f3bfeb5',
  ],
  'nai-preview.md': ['60de9340e6b762c0', '5ec7316b05f7cffd', '8e7316a442c036bd'],
}

export const fingerprint = (text: string) =>
  createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16)
