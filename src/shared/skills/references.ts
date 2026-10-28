import type { SkillResource } from './types'

/** Report local Markdown links that cannot be resolved inside this package. */
export function missingSkillLinks(entry: string, resources: SkillResource[]): string[] {
  const known = new Set(['skill.md', ...resources.map((resource) => resource.path.toLowerCase())])
  const warnings: string[] = []
  for (const file of [
    { path: 'SKILL.md', content: entry },
    ...resources.filter((resource) => resource.kind === 'markdown'),
  ]) {
    for (const match of file.content.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const link = match[1].replace(/^<|>$/g, '').split('#')[0]
      if (!link || /^[a-z][a-z0-9+.-]*:/i.test(link)) {
        continue
      }
      let decoded: string
      try {
        decoded = decodeURIComponent(link)
      } catch {
        warnings.push(`${file.path}：链接编码无效 ${link}`)
        continue
      }
      const segments = file.path.split('/').slice(0, -1)
      for (const segment of decoded.split('/')) {
        if (segment === '..' && segments.length && segments.at(-1) !== '..') {
          segments.pop()
        } else if (segment !== '.') {
          segments.push(segment)
        }
      }
      if (!known.has(segments.join('/').toLowerCase())) {
        warnings.push(`${file.path}：找不到本地引用 ${link}`)
      }
    }
  }
  return [...new Set(warnings)]
}
