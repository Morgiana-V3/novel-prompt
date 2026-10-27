/* ---------- Skill ---------- */

/** 作用范围：optimize = AI 优化 / 描述转提示词，preview = 画面推测，inpaint = 局部重绘批注优化 */
export type SkillScope = 'optimize' | 'preview' | 'inpaint' | 'all'

/** 适用模型 */
export type SkillModel = 'all' | 'v4.5' | 'v5'

export interface SkillEntry {
  id: string
  enabled: boolean
}

export interface SkillMeta {
  /** 内置为 builtin:xxx，用户 Skill 为文件名（不含 .md） */
  id: string
  name: string
  description: string
  scope: SkillScope
  model: SkillModel
  builtin: boolean
  /** 正文字数 */
  chars: number
  updatedAt: number
}

export interface SkillDoc extends SkillMeta {
  /** 正文（不含 frontmatter） */
  content: string
}

/** 启用状态与优先级，按优先级排列；包含全部 Skill */
export interface SkillConfigItem extends SkillMeta {
  enabled: boolean
}

export interface SkillInput {
  name: string
  description?: string
  scope?: SkillScope
  model?: SkillModel
  content: string
}
