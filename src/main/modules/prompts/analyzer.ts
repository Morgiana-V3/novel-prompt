import type { NaiVersion } from '../../../shared/generation/types'
import type { AnalysisResult, AnalyzedToken, PromptToken } from '../../../shared/prompts/types'
import { tagStore } from '../tags/store'
import { parsePrompt } from './parser'

const SENTENCE_PUNCT = /[.!?。！？]/

function isNatural(core: string): boolean {
  const words = core.split(/\s+/).filter(Boolean)
  return words.length >= 4 || SENTENCE_PUNCT.test(core) || /[\u3040-\u30ff\u4e00-\u9fff]/.test(core)
}

const FULLWIDTH_SEP = /[，、；]/

/** 「text. Text: …」这类写法里句号只是结束符，词本身仍是 tag */
function lookupCore(core: string) {
  const lookup = tagStore.lookup(core)
  if (lookup.tag || lookup.aliasOf || !/[.。]$/.test(core) || core.split(/\s+/).length >= 4) {
    return lookup
  }
  return tagStore.lookup(core.replace(/[.。]+$/, ''))
}

function analyzeToken(promptToken: PromptToken, version: NaiVersion): AnalyzedToken {
  if (promptToken.kind === 'text') {
    const warning =
      !promptToken.prefix && version === 'v4.5'
        ? 'V4.5 不会自动识别引号文字，请写成 Text: 块并放在提示词末尾'
        : undefined
    return { ...promptToken, status: 'text', warning }
  }
  if (promptToken.kind === 'natural') {
    return { ...promptToken, status: 'natural' }
  }

  const { tag, aliasOf } = lookupCore(promptToken.core)
  if (tag) {
    const res: AnalyzedToken = { ...promptToken, status: 'valid', tag }
    if (promptToken.prefix === 'artist:' && tag.category !== 1) {
      res.warning = '该 tag 不是画师 tag，去掉 artist: 前缀'
    }
    if (promptToken.prefix !== 'artist:' && tag.category === 1) {
      res.warning = '画师 tag 建议写成 artist:名字'
    }
    if (tag.versions && !tag.versions.includes(version)) {
      res.warning = `NAI ${tag.versions.join('/')} 专用 tag，当前版本可能无效`
    }
    return res
  }
  if (aliasOf) {
    return { ...promptToken, status: 'alias', aliasOf }
  }

  if (promptToken.kind === 'tag' && isNatural(promptToken.core)) {
    return { ...promptToken, status: 'natural' }
  }
  const res: AnalyzedToken = {
    ...promptToken,
    status: 'unknown',
    suggestions: tagStore.suggest(promptToken.core),
  }
  if (FULLWIDTH_SEP.test(promptToken.core)) {
    res.warning = '含全角逗号 / 顿号：提示词只按半角逗号「,」分隔 tag，这里会被当成一整个词'
  }
  return res
}

export function analyzePrompt(input: string, version: NaiVersion): AnalysisResult {
  const tokens = parsePrompt(input).map((promptToken) => analyzeToken(promptToken, version))
  const count = (status2: AnalyzedToken['status']) =>
    tokens.filter((analyzedToken) => analyzedToken.status === status2).length
  return {
    tokens,
    stats: {
      total: tokens.length,
      valid: count('valid'),
      alias: count('alias'),
      unknown: count('unknown'),
      natural: count('natural'),
      text: count('text'),
    },
  }
}
