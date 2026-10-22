import type { AnalyzedToken, EvidenceInfo, PreviewIssue, TagInfo } from '../../shared/types'
import { CATEGORY_LABEL } from '../../shared/types'
import { tagStore } from '../tagdb/store'
import {
  fmtItem,
  relatedTags,
  tagWiki,
  tendenciesOf,
  traitsOf,
  type Lookup,
  type Related,
  type RelatedItem,
  type Wiki
} from '../tagdb/knowledge'

/**
 * 评判依据收集：把「模型学到了什么」的客观数据先查出来，再交给 AI 引用。
 * - 包含关系（本地）：判定冗余
 * - 共现（在线 + 缓存）：角色默认外观、画师 / 作品倾向，并据此发现与角色设定冲突的写法
 */

export interface EvSection {
  label: string
  tokens: AnalyzedToken[]
  negative: boolean
}

export interface Evidence {
  /** 写进 AI 用户消息的数据块，没有任何数据时为空字符串 */
  block: string
  /** 程序根据数据直接判定的问题 */
  issues: PreviewIssue[]
  info: EvidenceInfo
}

const LIMITS: Record<number, number> = { 4: 6, 1: 6, 3: 3 }
const SUBJECT_LABEL: Record<number, string> = { 4: '角色', 1: '画师', 3: '作品' }

const tagOf = (t: AnalyzedToken): TagInfo | undefined => t.tag ?? t.aliasOf
const disp = (name: string) => tagStore.get(name)?.display ?? name.replace(/_/g, ' ')

/* ---------- 颜色属性：用来发现「角色默认发色 / 瞳色」与提示词冲突 ---------- */
const COLOR = '(?:light_|dark_)?(?:aqua|black|blonde|blue|brown|green|grey|orange|pink|purple|red|silver|white|yellow)'
const ATTRS = [
  { key: 'hair', label: '发色', re: new RegExp(`^${COLOR}_hair$`) },
  { key: 'eyes', label: '瞳色', re: new RegExp(`^${COLOR}_eyes$`) }
]

function positiveNames(s: EvSection): string[] {
  return s.tokens.filter((t) => t.weight > 0 && tagOf(t)).map((t) => tagOf(t)!.name)
}

function redundancyIssues(sections: EvSection[]): { issues: PreviewIssue[]; lines: string[] } {
  const issues: PreviewIssue[] = []
  const lines: string[] = []
  for (const s of sections) {
    for (const [a, c] of tagStore.redundantPairs(positiveNames(s))) {
      const text = `${disp(a)} 已包含 ${disp(c)}，${disp(c)} 可以删除`
      issues.push({ kind: 'redundant', where: s.label, text, basis: 'data' })
      lines.push(`- [${s.label}] ${text}`)
    }
  }
  return { issues, lines }
}

interface Subject {
  name: string
  category: number
  where: string[]
}

function collectSubjects(sections: EvSection[]): Subject[] {
  const map = new Map<string, Subject>()
  for (const s of sections) {
    if (s.negative) continue
    for (const t of s.tokens) {
      const tag = tagOf(t)
      if (!tag || t.weight <= 0 || !(tag.category in LIMITS)) continue
      const sub = map.get(tag.name) ?? { name: tag.name, category: tag.category, where: [] }
      if (!sub.where.includes(s.label)) sub.where.push(s.label)
      map.set(tag.name, sub)
    }
  }
  const out: Subject[] = []
  for (const cat of [4, 1, 3]) out.push(...[...map.values()].filter((x) => x.category === cat).slice(0, LIMITS[cat]))
  return out
}

/** 角色默认发色 / 瞳色与提示词中写的不一致 */
function traitConflicts(sub: Subject, traits: RelatedItem[], sections: EvSection[]): PreviewIssue[] {
  const issues: PreviewIssue[] = []
  for (const where of sub.where) {
    // 角色写在角色提示词里时，主提示词里的特征同样会作用到它身上
    const scope = sections.filter((s) => !s.negative && (s.label === where || (where !== '主提示词' && s.label === '主提示词')))
    const written = new Set(scope.flatMap(positiveNames))
    for (const attr of ATTRS) {
      // 出现率够高、且是该角色的显著特征（远高于全站平均），才视为「默认」
      const def = traits.find((x) => attr.re.test(x.name) && x.freq >= 0.3 && x.lift >= 5)
      if (!def || written.has(def.name)) continue
      const others = [...written].filter((n) => attr.re.test(n))
      if (!others.length) continue
      issues.push({
        kind: 'trait',
        where,
        basis: 'data',
        text: `${disp(sub.name)} 在 Danbooru 上 ${Math.round(def.freq * 100)}% 的图是 ${def.display}，这里写了 ${others.map(disp).join(' / ')}，会和角色默认${attr.label}互相拉扯；若是刻意换色，建议给新${attr.label}加权，并在负面排除 ${def.display}`
      })
    }
  }
  return issues
}

function subjectBlock(sub: Subject, r: Related): string {
  const label = SUBJECT_LABEL[sub.category]
  const items = sub.category === 4 ? traitsOf(r) : tendenciesOf(r)
  const head = `### ${label} ${r.display}（${r.postCount.toLocaleString()} 张图）· 出现在：${sub.where.join('、')}`
  if (!items.length) return `${head}\n（没有足够明显的特征数据）`
  const title = sub.category === 4 ? '默认外观（在该角色的图中的出现率）' : `常见元素（在该${label}的图中的出现率，均明显高于全站平均）`
  return `${head}\n${title}：${items.map(fmtItem).join(', ')}`
}

export async function gatherEvidence(
  sections: EvSection[],
  onStep: (s: string) => void,
  signal?: AbortSignal
): Promise<Evidence> {
  const info: EvidenceInfo = { related: [], wiki: [], failed: [], implications: tagStore.hasImplications }
  const redundancy = redundancyIssues(sections)
  const issues = [...redundancy.issues]
  const parts: string[] = []

  const subjects = collectSubjects(sections)
  if (subjects.length) {
    onStep(`查询 Danbooru 统计：${subjects.map((s) => disp(s.name)).join(', ')}`)
    const { results, failed } = await relatedTags(
      subjects.map((s) => s.name),
      signal
    )
    info.failed = failed.map(disp)
    for (const sub of subjects) {
      const r = results.get(sub.name)
      if (!r) continue
      info.related.push(r.display)
      parts.push(subjectBlock(sub, r))
      if (sub.category === 4) issues.push(...traitConflicts(sub, traitsOf(r, 30), sections))
    }
  }

  if (redundancy.lines.length) parts.push(`### 包含关系（本地数据）\n${redundancy.lines.join('\n')}`)
  if (!info.implications) parts.push('（本地没有包含关系数据，冗余判断只能依靠经验）')
  if (info.failed.length)
    parts.push(`（以下 tag 联网获取统计数据失败：${info.failed.join(', ')}。相关判断只能依靠经验，basis 不能标为 data，置信度应降低）`)

  const block = parts.length
    ? `## Danbooru 统计数据（NAI 的训练数据来源；引用这里的内容时 basis 标为 data）\n${parts.join('\n\n')}`
    : ''
  if (info.related.length) onStep(`已获取 ${info.related.length} 个 tag 的统计数据`)
  else if (info.failed.length) onStep('Danbooru 统计数据获取失败，将仅依据规则和经验判断')
  return { block, issues, info }
}

/* ---------- 给 AI 调用的工具输出 ---------- */

export function formatRelatedTool(lookup: Lookup<Related>): string {
  const out: string[] = []
  for (const [name, r] of lookup.results) {
    if (lookup.failed.includes(name)) {
      out.push(`## ${disp(name)}\n（网络不可用，未获取到数据）`)
      continue
    }
    if (!r) {
      out.push(`## ${disp(name)}\n（Danbooru 上没有这个 tag 的数据）`)
      continue
    }
    const cat = CATEGORY_LABEL[r.category as 0] ?? r.category
    const items = r.category === 4 ? traitsOf(r) : r.category === 0 ? r.items.filter((x) => x.lift >= 1.5).slice(0, 16) : tendenciesOf(r)
    out.push(
      `## ${r.display} [${cat}|${r.postCount}]\n${
        items.length ? `常同时出现（出现率，倍数=相对全站平均）：${items.map((x) => `${fmtItem(x)} ×${x.lift}`).join(', ')}` : '（没有明显的共现特征）'
      }`
    )
  }
  return out.join('\n') || '（没有可查询的 tag）'
}

export function formatWikiTool(lookup: Lookup<Wiki>): string {
  const out: string[] = []
  for (const [name, w] of lookup.results) {
    if (lookup.failed.includes(name)) out.push(`## ${disp(name)}\n（网络不可用，未获取到释义）`)
    else if (!w) out.push(`## ${disp(name)}\n（没有 wiki 释义）`)
    else out.push(`## ${disp(name)}\n${w.text}${w.otherNames.length ? `\n其他名称：${w.otherNames.join(', ')}` : ''}`)
  }
  return out.join('\n') || '（没有可查询的 tag）'
}

export { relatedTags, tagWiki }
