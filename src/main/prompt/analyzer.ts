import type { AnalysisResult, AnalyzedToken, NaiVersion, PromptToken } from '../../shared/types'
import { tagStore } from '../tagdb/store'
import { parsePrompt } from './parser'

const SENTENCE_PUNCT = /[.!?。！？]/

function isNatural(core: string): boolean {
  const words = core.split(/\s+/).filter(Boolean)
  return words.length >= 4 || SENTENCE_PUNCT.test(core) || /[\u3040-\u30ff\u4e00-\u9fff]/.test(core)
}

const FULLWIDTH_SEP = /[，、；]/

/** 「text. Text: …」这类写法里句号只是结束符，词本身仍是 tag */
function lookupCore(core: string) {
  const r = tagStore.lookup(core)
  if (r.tag || r.aliasOf || !/[.。]$/.test(core) || core.split(/\s+/).length >= 4) return r
  return tagStore.lookup(core.replace(/[.。]+$/, ''))
}

function analyzeToken(t: PromptToken, version: NaiVersion): AnalyzedToken {
  if (t.kind === 'text') {
    const warning =
      !t.prefix && version === 'v4.5' ? 'V4.5 不会自动识别引号文字，请写成 Text: 块并放在提示词末尾' : undefined
    return { ...t, status: 'text', warning }
  }
  if (t.kind === 'natural') return { ...t, status: 'natural' }

  const { tag, aliasOf } = lookupCore(t.core)
  if (tag) {
    const res: AnalyzedToken = { ...t, status: 'valid', tag }
    if (t.prefix === 'artist:' && tag.category !== 1) res.warning = '该 tag 不是画师 tag，去掉 artist: 前缀'
    if (t.prefix !== 'artist:' && tag.category === 1) res.warning = '画师 tag 建议写成 artist:名字'
    if (tag.versions && !tag.versions.includes(version)) res.warning = `NAI ${tag.versions.join('/')} 专用 tag，当前版本可能无效`
    return res
  }
  if (aliasOf) return { ...t, status: 'alias', aliasOf }

  if (t.kind === 'tag' && isNatural(t.core)) return { ...t, status: 'natural' }
  const res: AnalyzedToken = { ...t, status: 'unknown', suggestions: tagStore.suggest(t.core) }
  if (FULLWIDTH_SEP.test(t.core)) res.warning = '含全角逗号 / 顿号：提示词只按半角逗号「,」分隔 tag，这里会被当成一整个词'
  return res
}

export function analyzePrompt(input: string, version: NaiVersion): AnalysisResult {
  const tokens = parsePrompt(input).map((t) => analyzeToken(t, version))
  const count = (s: AnalyzedToken['status']) => tokens.filter((t) => t.status === s).length
  return {
    tokens,
    stats: {
      total: tokens.length,
      valid: count('valid'),
      alias: count('alias'),
      unknown: count('unknown'),
      natural: count('natural'),
      text: count('text')
    }
  }
}
