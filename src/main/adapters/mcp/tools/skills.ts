import {
  coreText,
  createSkill,
  deleteSkill,
  duplicateSkill,
  getConfig,
  getSkill,
  importSkillFile,
  MODEL_LABEL,
  SCOPE_LABEL,
  setConfig,
  updateSkill,
} from '../../../modules/skills/service'
import { json, num, READ_ONLY, str } from '../tool-input'
import type { McpTool } from '../types'

/* ---------- Skill 管理 ---------- */

export const SKILL_FIELDS = {
  name: { type: 'string', description: 'Skill 名称' },
  description: {
    type: 'string',
    description: '一句话说明这份 Skill 管什么（会出现在给 AI 的 Skill 清单里）',
  },
  scope: {
    type: 'string',
    enum: ['optimize', 'preview', 'inpaint', 'all'],
    description:
      '作用于哪个功能：optimize = AI 优化 / 描述转提示词（也是 prompt_guide 的内容），preview = 画面推测，inpaint = 局部重绘，all = 全部功能',
  },
  model: {
    type: 'string',
    enum: ['all', 'v4.5', 'v5'],
    description: '适用模型，默认 all；正文里也可以用【V4.5】/【V5】标注版本专用的内容',
  },
  content: { type: 'string', description: 'Skill 正文（Markdown，不含 frontmatter）' },
}

export const skillLine = (skill: ReturnType<typeof getConfig>[number], i: number) => ({
  priority: i + 1,
  id: skill.id,
  name: skill.name,
  enabled: skill.enabled,
  builtin: skill.builtin,
  scope: `${skill.scope}（${SCOPE_LABEL[skill.scope]}）`,
  model: `${skill.model}（${MODEL_LABEL[skill.model]}）`,
  description: skill.description,
  chars: skill.chars,
})

export const skillList = () => json(getConfig().map(skillLine))

export function skillTools(): McpTool[] {
  const WRITE = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  }
  return [
    {
      name: 'list_skills',
      title: 'Skill 列表',
      description:
        '列出全部 Skill（内置 + 用户），按优先级排列（priority 1 最高），含启用状态、作用范围、适用模型、字数。软件内置 AI 与 prompt_guide 只使用 enabled 为 true 且范围、模型匹配的 Skill。',
      inputSchema: { type: 'object', properties: {} },
      annotations: READ_ONLY,
      run: async () => skillList(),
    },
    {
      name: 'get_skill',
      title: '读取 Skill',
      description:
        '读取一份 Skill 的元信息和正文。id 来自 list_skills；传 core 读取固定的「Skill 使用总则」。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          resource: {
            type: 'string',
            description:
              '包内 Markdown 相对路径；工作台讨论请使用 get_workspace_context 的 skills_ids 读取冻结版本',
          },
        },
        required: ['id'],
      },
      annotations: READ_ONLY,
      run: async (argumentsRecord) => {
        if (str(argumentsRecord.id) === 'core') {
          return coreText()
        }
        const skill = getSkill(str(argumentsRecord.id))
        if (!skill) {
          throw new Error(`找不到 Skill：${str(argumentsRecord.id)}`)
        }
        if (argumentsRecord.resource) {
          const resource = skill.resources?.find(
            (item) => item.path === str(argumentsRecord.resource),
          )
          if (!resource || resource.kind !== 'markdown') {
            throw new Error('未找到 Markdown 参考资料；图片仅支持在应用中预览')
          }
          return json({ id: skill.id, path: resource.path, content: resource.content })
        }
        return json({
          ...skill,
          resources: skill.resources?.map(({ path, kind }) => ({ path, kind })),
        })
      },
    },
    {
      name: 'create_skill',
      title: '新建 / 导入 Skill',
      description:
        '新建一份用户 Skill。三种来源任选其一：直接传 name + content；传 path 导入本机 .md 文件（frontmatter 里的 name / description / scope / model 会被读取）；传 duplicate_from 复制一份已有 Skill（含内置）。新建与导入默认启用并放在最高优先级，复制默认不启用、放在原 Skill 上方；可用 enabled / priority 覆盖。',
      inputSchema: {
        type: 'object',
        properties: {
          ...SKILL_FIELDS,
          path: { type: 'string', description: '要导入的 .md 文件绝对路径' },
          duplicate_from: { type: 'string', description: '要复制的 Skill id' },
          enabled: { type: 'boolean' },
          priority: { type: 'integer', description: '放到第几位（1 = 最高）' },
        },
      },
      annotations: WRITE,
      run: async (argumentsRecord) => {
        let doc
        if (str(argumentsRecord.duplicate_from)) {
          doc = duplicateSkill(str(argumentsRecord.duplicate_from))
          const patch = {
            name: str(argumentsRecord.name) || undefined,
            description: str(argumentsRecord.description) || undefined,
            content: str(argumentsRecord.content) || undefined,
          }
          if (
            patch.name ||
            patch.description ||
            patch.content ||
            argumentsRecord.scope ||
            argumentsRecord.model
          ) {
            doc = updateSkill(doc.id, {
              ...patch,
              scope: argumentsRecord.scope as never,
              model: argumentsRecord.model as never,
            })
          }
        } else if (str(argumentsRecord.path)) {
          doc = importSkillFile(str(argumentsRecord.path))
        } else {
          doc = createSkill({
            name: str(argumentsRecord.name),
            description: str(argumentsRecord.description),
            scope: argumentsRecord.scope as never,
            model: argumentsRecord.model as never,
            content: str(argumentsRecord.content),
          })
        }
        if (
          typeof argumentsRecord.enabled === 'boolean' ||
          argumentsRecord.priority !== undefined
        ) {
          const list = getConfig().filter((skill) => skill.id !== doc.id)
          const self = getConfig().find((skill) => skill.id === doc.id)!
          const at =
            argumentsRecord.priority === undefined
              ? getConfig().findIndex((skill) => skill.id === doc.id)
              : Math.round(num(argumentsRecord.priority, 1, 1, 999)) - 1
          list.splice(Math.max(0, Math.min(at, list.length)), 0, {
            ...self,
            enabled:
              typeof argumentsRecord.enabled === 'boolean' ? argumentsRecord.enabled : self.enabled,
          })
          setConfig(list)
        }
        return json({
          id: doc.id,
          name: doc.name,
          outcome: 'created',
          items: JSON.parse(skillList()),
        })
      },
    },
    {
      name: 'update_skill',
      title: '修改 Skill',
      description:
        '修改一份用户 Skill 的名称、说明、作用范围、适用模型或正文（只传要改的字段）。内置 Skill 不能修改，可以先用 create_skill 的 duplicate_from 复制。',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, ...SKILL_FIELDS },
        required: ['id'],
      },
      annotations: { ...WRITE, idempotentHint: true },
      run: async (argumentsRecord) => {
        const doc = updateSkill(str(argumentsRecord.id), {
          name: typeof argumentsRecord.name === 'string' ? argumentsRecord.name : undefined,
          description:
            typeof argumentsRecord.description === 'string'
              ? argumentsRecord.description
              : undefined,
          scope: argumentsRecord.scope as never,
          model: argumentsRecord.model as never,
          content:
            typeof argumentsRecord.content === 'string' ? argumentsRecord.content : undefined,
        })
        return json({ id: doc.id, name: doc.name, chars: doc.chars, outcome: 'updated' })
      },
    },
    {
      name: 'delete_skill',
      title: '删除 Skill',
      description:
        '删除一份用户 Skill（文件一并删除，不可恢复）。内置 Skill 不能删除，只能在 set_skill_config 里关闭。',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
      run: async (argumentsRecord) => {
        const skill = getSkill(str(argumentsRecord.id))
        deleteSkill(str(argumentsRecord.id))
        return json({
          id: str(argumentsRecord.id),
          name: skill?.name,
          outcome: 'deleted',
          items: JSON.parse(skillList()),
        })
      },
    },
    {
      name: 'set_skill_config',
      title: '启用与优先级',
      description:
        '设置 Skill 的启用状态与优先级。传入全部 Skill 时，数组顺序即新的优先级（第 1 个最高）；只传其中几份时，只修改它们的启用状态，顺序不变。',
      inputSchema: {
        type: 'object',
        properties: {
          skills: {
            type: 'array',
            items: {
              type: 'object',
              properties: { id: { type: 'string' }, enabled: { type: 'boolean' } },
              required: ['id', 'enabled'],
            },
          },
        },
        required: ['skills'],
      },
      annotations: { ...WRITE, idempotentHint: true },
      run: async (argumentsRecord) => {
        const list = (
          Array.isArray(argumentsRecord.skills)
            ? (argumentsRecord.skills as Record<string, unknown>[])
            : []
        ).map((record) => ({ id: str(record?.id), enabled: record?.enabled === true }))
        const current = getConfig()
        const known = new Set(current.map((skill) => skill.id))
        const unknown = list.map((skillSetting) => skillSetting.id).filter((id) => !known.has(id))
        if (unknown.length) {
          throw new Error(`找不到这些 Skill：${unknown.join(', ')}（用 list_skills 查看 id）`)
        }
        const full = known.size === new Set(list.map((skillSetting) => skillSetting.id)).size
        if (full) {
          setConfig(list)
        } else {
          const patch = new Map(list.map((skillSetting) => [skillSetting.id, skillSetting.enabled]))
          setConfig(
            current.map((skill) => ({
              id: skill.id,
              enabled: patch.get(skill.id) ?? skill.enabled,
            })),
          )
        }
        return json({ outcome: 'updated', items: JSON.parse(skillList()) })
      },
    },
  ]
}
