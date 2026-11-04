import { createHash } from 'node:crypto'
import type { NaiVersion } from '../../../shared/generation/types'
import type { SkillDoc } from '../../../shared/skills/types'
import type { PageSkillSection, PageSkillSnapshot } from '../../../shared/workspace/model'
import { MODEL_LABEL, type SkillFeature } from './catalog'
import { oneLine } from './metadata'
const FEATURE_LABEL: Record<SkillFeature, string> = {
  optimize: '智能优化 / 描述转提示词',
  preview: '画面推测',
  inpaint: '局部重绘优化',
  workspace: 'AI 工作台（按任务选择适用规则）',
}

/**
 * 组装「总则 + 启用的 Skill 清单 + 按优先级排列的正文」。
 * 调用方在后面追加程序约定（输出格式等）。
 */
export function composeSkillDocuments(
  feature: SkillFeature,
  version: NaiVersion,
  skills: SkillDoc[],
  core: string,
): { text: string; skills: SkillDoc[]; snapshot: PageSkillSnapshot } {
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
    const references = (s.resources ?? []).filter((resource) => resource.kind === 'markdown')
    const entry =
      s.content +
      (references.length
        ? '\n\n按需参考资料（按入口中的条件读取，不自动加载）：\n' +
          references
            .map((resource) => `- ${resource.path}（读取标识：${s.id}/${resource.path}）`)
            .join('\n') +
          '\n内置 AI 使用 read_skill_reference(id)；外部工作台 Agent 使用 get_workspace_context 的 skills_ids 补读本轮冻结资料；非工作台场景使用 get_skill(id=Skill标识, resource=相对路径) 读取当前资料。'
        : '')
    text += entry
    sections.push({
      id: s.id,
      name: s.name,
      description: s.description,
      scope: s.scope,
      model: s.model,
      priority: i + 1,
      start,
      end: text.length,
      digest: hash(entry),
    })
    text += '\n</skill>'
  }
  const entryText = text
  for (const [index, skill] of skills.entries()) {
    for (const resource of skill.resources ?? []) {
      if (resource.kind !== 'markdown') {
        continue
      }
      text += '\n'
      const start = text.length
      text += resource.content
      sections.push({
        id: `${skill.id}/${resource.path}`,
        skillId: skill.id,
        resourcePath: resource.path,
        name: `${skill.name} / ${resource.path}`,
        description: '按入口说明按需读取的参考资料',
        scope: skill.scope,
        model: skill.model,
        priority: index + 1,
        start,
        end: text.length,
        digest: hash(resource.content),
      })
    }
  }
  return { text: entryText, skills, snapshot: { text, digest: hash(text), sections } }
}
