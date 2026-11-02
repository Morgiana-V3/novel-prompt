import { CATEGORY_LABEL } from '../../../shared/tags/types'
import type { ToolDef } from '../../providers/chat/client'
import { tagStore } from '../tags/store'
import { formatRelatedTool, formatWikiTool, relatedTags, tagWiki } from './evidence'
const TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'search_tags',
      description:
        '在本地 Danbooru tag 库中搜索候选 tag。支持英文关键词或中文。一次可以查询多个概念，每个概念返回按热度排序的候选。',
      parameters: {
        type: 'object',
        properties: {
          queries: {
            type: 'array',
            items: { type: 'string' },
            description: '要查询的概念列表，如 ["双马尾","red eyes","school uniform"]',
          },
          category: {
            type: 'string',
            enum: ['any', 'general', 'artist', 'copyright', 'character', 'meta'],
            description: '限定分类，默认 any',
          },
        },
        required: ['queries'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'validate_tags',
      description:
        '校验一组 tag 是否存在于 Danbooru，返回 存在/别名(会给出标准写法)/不存在(给出候选)。',
      parameters: {
        type: 'object',
        properties: { tags: { type: 'array', items: { type: 'string' } } },
        required: ['tags'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'related_tags',
      description:
        '查询 Danbooru 共现统计：在带有该 tag 的图中，哪些通用 tag 经常同时出现、出现率多少。用途：确认角色的默认外观（只写与默认不同的部分）、了解画师/作品会把画面带向哪里、判断一组 tag 是否常见搭配。需要联网，一次最多 6 个。',
      parameters: {
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '标准 tag 名，如 ["hatsune miku","wlop"]（画师不带 artist: 前缀）',
          },
        },
        required: ['tags'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tag_wiki',
      description:
        '查询 tag 在 Danbooru wiki 上的官方释义。用途：几个候选意思相近、拿不准哪个才符合用户描述时（如 jitome 与 empty eyes、cowboy shot 拍到哪里），先读释义再挑。需要联网，一次最多 8 个。',
      parameters: {
        type: 'object',
        properties: { tags: { type: 'array', items: { type: 'string' } } },
        required: ['tags'],
      },
    },
  },
]

const CAT_MAP: Record<string, number[] | undefined> = {
  any: undefined,
  general: [0, 100],
  artist: [1],
  copyright: [3],
  character: [4],
  meta: [5, 100],
}

function fmtTag(tag: { display: string; category: number; count: number; zh?: string }): string {
  return `${tag.display} [${CATEGORY_LABEL[tag.category as 0] ?? tag.category}|${tag.count}${tag.zh ? '|' + tag.zh : ''}]`
}

const cleanTag = (raw: string) =>
  raw
    .trim()
    .replace(/^artist:\s*/i, '')
    .replace(/^(source|target|mutual)#\s*/i, '')
    .replace(/^-?\d+(\.\d+)?::\s*|\s*::$/g, '')
    .replace(/[{}[\]]/g, '')
    .trim()

/** 批量输入超过单次上限时截断，并在结果里写明未处理的项 */
function capped(items: string[], max: number): { items: string[]; note: string } {
  if (items.length <= max) {
    return { items, note: '' }
  }
  const rest = items.slice(max)
  return {
    items: items.slice(0, max),
    note: `\n\n（⚠ 共传入 ${items.length} 项，超过单次上限 ${max}，只处理了前 ${max} 项；未处理：${rest.join(', ')}。请分批再查）`,
  }
}

/** 工具调用中查过的统计数据，汇总到结果里展示 */
export interface ToolLog {
  related: Set<string>
  wiki: Set<string>
  failed: Set<string>
}

export async function runTool(
  name: string,
  argsJson: string,
  log: ToolLog,
  signal?: AbortSignal,
): Promise<string> {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(argsJson || '{}')
  } catch {
    return '参数不是合法 JSON'
  }
  const list = (text: string) =>
    (Array.isArray(args[text]) ? (args[text] as unknown[]) : []).filter(
      (value): value is string => typeof value === 'string',
    )
  const input = list(name === 'search_tags' ? 'queries' : 'tags')
  if (!input.length) {
    return `（没有传入要查询的内容：${name === 'search_tags' ? 'queries' : 'tags'} 为空）`
  }
  if (name === 'search_tags') {
    const cats = CAT_MAP[(args.category as string) ?? 'any'] as never
    const { items, note } = capped(input, 20)
    return (
      items
        .map((text) => {
          const hits = text.trim()
            ? tagStore.search({ query: text, categories: cats, limit: 8 })
            : []
          const resolveValue = () => {
            if (hits.length) {
              return hits
                .map(
                  (searchHit) =>
                    '- ' +
                    fmtTag(searchHit) +
                    (searchHit.viaAlias ? ` (别名 ${searchHit.viaAlias})` : ''),
                )
                .join('\n')
            }
            return '- (无结果，换个说法或用英文再试)' as const
          }
          return `## ${text}\n${resolveValue()}`
        })
        .join('\n') + note
    )
  }
  if (name === 'validate_tags') {
    const { items, note } = capped(input, 80)
    return (
      items
        .map((raw) => {
          const core = cleanTag(raw)
          const { tag, aliasOf } = tagStore.lookup(core)
          if (tag) {
            return `✓ ${raw}`
          }
          if (aliasOf) {
            return `↪ ${raw} → 请改用 ${aliasOf.display}`
          }
          const sug = tagStore.suggest(core, 4)
          return `✗ ${raw} 不存在${sug.length ? '，候选：' + sug.map((tag2) => tag2.display).join(' / ') : ''}`
        })
        .join('\n') + note
    )
  }
  if (name === 'related_tags') {
    const { items, note } = capped(input, 6)
    const lookupResult = await relatedTags(items.map(cleanTag), signal)
    for (const [n, v] of lookupResult.results) {
      if (v && !lookupResult.failed.includes(n)) {
        log.related.add(v.display)
      }
    }
    lookupResult.failed.forEach((filename) => log.failed.add(filename.replace(/_/g, ' ')))
    return formatRelatedTool(lookupResult) + note
  }
  if (name === 'tag_wiki') {
    const { items, note } = capped(input, 8)
    const lookupResult = await tagWiki(items.map(cleanTag), signal)
    for (const [n, v] of lookupResult.results) {
      if (v) {
        log.wiki.add(n.replace(/_/g, ' '))
      }
    }
    lookupResult.failed.forEach((filename) => log.failed.add(filename.replace(/_/g, ' ')))
    return formatWikiTool(lookupResult) + note
  }
  return `未知工具 ${name}`
}

/** 对外（MCP）复用本地 tag 工具：search_tags / validate_tags / related_tags / tag_wiki */
export function tagTool(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  return runTool(
    name,
    JSON.stringify(args),
    { related: new Set(), wiki: new Set(), failed: new Set() },
    signal,
  )
}

export const TAG_TOOL_DEFS = TOOLS
