import type { SkillModel, SkillScope } from '../../../shared/skills/types'
const SCOPES: SkillScope[] = ['optimize', 'preview', 'inpaint', 'all']
const MODELS: SkillModel[] = ['all', 'v4.5', 'v5']
const unquote = (text: string) => {
  const text2 = text.trim()
  return /^(['"]).*\1$/.test(text2) ? text2.slice(1, -1) : text2
}

/** 解析开头的 --- frontmatter（单行字段与常用折叠/多行说明） */
export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src)
  if (!match) {
    return { meta: {}, body: src.trim() }
  }
  const meta: Record<string, string> = {}
  const lines = match[1].split('\n')
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (kv) {
      let value = unquote(kv[2])
      if (/^[>|][-+]?$/.test(value)) {
        const folded = value.startsWith('>')
        const block: string[] = []
        while (
          index + 1 < lines.length &&
          (/^\s/.test(lines[index + 1]) || !lines[index + 1].trim())
        ) {
          block.push(lines[++index].trim())
        }
        value = block.join(folded ? ' ' : '\n').trim()
      }
      meta[kv[1].toLowerCase()] = value
    }
  }
  return { meta, body: src.slice(match[0].length).trim() }
}

export const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()
const yamlValue = (text: string) =>
  /^[\w\u4e00-\u9fff .·()（）\-—，、]*$/.test(text) && !/^\s|\s$/.test(text)
    ? text
    : JSON.stringify(text)

export function serialize(
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

export const asScope = (value: unknown, defaultScope: SkillScope): SkillScope =>
  SCOPES.includes(value as SkillScope) ? (value as SkillScope) : defaultScope
export const asModel = (value: unknown): SkillModel => {
  const text = String(value ?? '')
    .toLowerCase()
    .replace(/^v?4\.5$/, 'v4.5')
    .replace(/^v?5$/, 'v5')
  return MODELS.includes(text as SkillModel) ? (text as SkillModel) : 'all'
}
