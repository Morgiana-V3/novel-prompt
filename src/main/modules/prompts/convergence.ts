import type { NaiVersion } from '../../../shared/generation/types'
import type {
  AiChange,
  AiCharacter,
  AiOptimizeRequest,
  AiOptimizeResult,
  AiVerdict,
} from '../../../shared/prompts/types'
import { analyzePrompt } from './analyzer'

/**
 * 优化收敛：避免「全部采纳后再优化又大改」的无底洞。
 * AI 给出 verdict，程序再按可校验的事实收紧：
 * - AI 判定 converged 却改了提示词 → 保持原样；
 * - 只调换顺序 / 改格式（概念集合不变）且处于收敛阶段 → 保持原样；
 * - 上一轮输出已被全部采纳、没有新要求 → 只接受 rule / data 依据的硬修改，其余转为可选建议。
 */

interface PromptTexts {
  positive: string
  negative: string
  characters: AiCharacter[]
}

const normText = (text: string | undefined) =>
  (text ?? '')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()

function sameTexts(left: PromptTexts, right: PromptTexts): boolean {
  const characters = (texts: PromptTexts) =>
    texts.characters
      .filter((character) => character.prompt?.trim())
      .map((character) => [
        normText(character.prompt),
        normText(character.negative),
        (character.position ?? '').trim(),
      ])
  return (
    normText(left.positive) === normText(right.positive) &&
    normText(left.negative) === normText(right.negative) &&
    JSON.stringify(characters(left)) === JSON.stringify(characters(right))
  )
}

/** 概念集合（忽略顺序、空格、下划线、别名）；用来识别只调换顺序或格式的改写 */
function conceptKey(texts: PromptTexts, version: NaiVersion): string {
  const keys = (text: string | undefined) =>
    analyzePrompt(text ?? '', version)
      .tokens.map((token) => {
        const tag = token.tag ?? token.aliasOf
        const core = tag ? tag.name : token.core.toLowerCase().replace(/_/g, ' ').trim()
        return `${token.prefix ?? ''}${core}@${token.weight}`
      })
      .sort()
  return JSON.stringify([
    keys(texts.positive),
    keys(texts.negative),
    texts.characters
      .filter((character) => character.prompt?.trim())
      .map((character) => [
        keys(character.prompt),
        keys(character.negative),
        (character.position ?? '').trim(),
      ]),
  ])
}

const inputTexts = (req: AiOptimizeRequest): PromptTexts => ({
  positive: req.prompt ?? '',
  negative: req.negative ?? '',
  characters: (req.characters ?? []).filter((character) => character.prompt?.trim()),
})

/** 当前提示词就是上一轮的输出，且用户没有提出新的要求 */
export function adoptedPreviousRound(req: AiOptimizeRequest): boolean {
  const previous = req.previous
  if (
    !previous ||
    req.mode !== 'optimize' ||
    typeof previous.positive !== 'string' ||
    !Array.isArray(previous.characters)
  ) {
    return false
  }
  const instruction = String(req.instruction ?? '').trim()
  const sameInstruction = !instruction || instruction === String(previous.instruction ?? '').trim()
  return sameInstruction && sameTexts(inputTexts(req), previous)
}

export function parseVerdict(raw: unknown): AiVerdict | undefined {
  if (raw === 'converged' || raw === 'changes') {
    return raw
  }
  return undefined
}

/** 把会改动提示词的说明降级为可选建议（提示词保持原样，但建议仍可查看） */
function asOptional(changes: AiChange[], prefix: string): AiChange[] {
  return changes.map((change) => {
    if (change.scope === 'optional') {
      return change
    }
    const { characterIndex: _index, characterSide: _side, characterField: _field, ...rest } = change
    return { ...rest, scope: 'optional', text: `${prefix}${change.text}` }
  })
}

function keepInput(
  req: AiOptimizeRequest,
  result: AiOptimizeResult,
  note: string,
  reason: string,
  prefix: string,
): AiOptimizeResult {
  const input = inputTexts(req)
  return {
    ...result,
    positive: input.positive,
    negative: input.negative,
    characters: input.characters.map((character) => ({ ...character })),
    changes: asOptional(result.changes, prefix),
    verdict: 'converged',
    verdictReason: reason,
    stabilized: [...(result.stabilized ?? []), note],
  }
}

export function stabilizeResult(
  req: AiOptimizeRequest,
  result: AiOptimizeResult,
): AiOptimizeResult {
  if (req.mode !== 'optimize') {
    return { ...result, verdict: result.verdict ?? 'changes' }
  }
  const input = inputTexts(req)
  const differs = !sameTexts(input, result)
  const verdictReason = result.verdictReason?.trim() ?? ''
  if (!differs) {
    return {
      ...result,
      verdict: 'converged',
      verdictReason: verdictReason || '当前提示词没有需要修正的问题，保持原样。',
    }
  }
  if (result.verdict === 'converged') {
    return keepInput(
      req,
      result,
      'AI 判定已达标，但输出里带有细微改写；为保持稳定已恢复为原提示词。',
      verdictReason || '当前提示词已达标，无需继续优化。',
      '（未应用）',
    )
  }
  const converging = adoptedPreviousRound(req)
  if (converging && conceptKey(input, req.version) === conceptKey(result, req.version)) {
    return keepInput(
      req,
      result,
      '本轮只调换了词条顺序或格式，内容与上一轮一致，未应用。',
      '上一轮的修改已全部采纳，本轮没有发现新的实质问题。',
      '（仅顺序/格式，未应用）',
    )
  }
  if (converging) {
    const hard = result.changes.some(
      (change) =>
        change.scope !== 'optional' && (change.basis === 'rule' || change.basis === 'data'),
    )
    if (!hard) {
      return keepInput(
        req,
        result,
        '上一轮修改已全部采纳且没有新的要求；本轮只有经验或偏好类的再调整，已转为可选建议，提示词保持不变。',
        '上一轮的修改已全部采纳，没有发现可被规则或数据证实的新问题。',
        '（可选）',
      )
    }
  }
  return {
    ...result,
    verdict: 'changes',
    verdictReason: verdictReason || '发现需要修正的问题，已给出修改。',
  }
}
