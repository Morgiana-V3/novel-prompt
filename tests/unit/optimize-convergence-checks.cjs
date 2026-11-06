const assert = require('node:assert/strict')
require('../support/register-typescript.cjs')
const {
  adoptedPreviousRound,
  stabilizeResult,
  reviewKey,
  canReuseReview,
} = require('../../src/main/modules/prompts/convergence.ts')

const base = {
  mode: 'optimize',
  prompt: 'silver hair, blue eyes, smile',
  negative: 'lowres',
  characters: [{ prompt: 'girl, twintails', position: 'B3', negative: '' }],
  instruction: '',
  version: 'v4.5',
}
const output = (patch = {}) => ({
  positive: base.prompt,
  negative: base.negative,
  characters: base.characters.map((character) => ({ ...character })),
  notes: '',
  changes: [],
  invalid: [],
  dropped: [],
  fidelity: [],
  evidence: { related: [], wiki: [], failed: [], implications: false },
  ...patch,
})
const previous = {
  positive: base.prompt,
  negative: base.negative,
  characters: base.characters,
  instruction: '',
  changes: [{ scope: 'positive', text: 'red hair → silver hair', basis: 'rule' }],
}

// 1. 输出与输入一致：判定已收敛
let result = stabilizeResult(base, output({ verdict: 'changes' }))
assert.equal(result.verdict, 'converged')

// 2. AI 判定 converged 却改了措辞：恢复原样，改动降级为可选
result = stabilizeResult(
  base,
  output({
    verdict: 'converged',
    positive: 'silver hair, blue eyes, gentle smile',
    changes: [{ scope: 'positive', text: 'smile → gentle smile', basis: 'taste', evidence: '' }],
  }),
)
assert.equal(result.positive, base.prompt)
assert.equal(result.changes[0].scope, 'optional')
assert.equal(result.stabilized.length, 1)

// 3. 首轮（没有上一轮）的实质修改照常应用
const firstRound = output({
  verdict: 'changes',
  positive: 'silver hair, blue eyes, smile, upper body',
  changes: [{ scope: 'positive', text: '+ upper body', basis: 'doc', evidence: 'Skill' }],
})
assert.equal(stabilizeResult(base, firstRound).positive, firstRound.positive)

// 4. 已全部采纳上一轮且无新要求
const converging = { ...base, previous }
assert.equal(adoptedPreviousRound(converging), true)
assert.equal(adoptedPreviousRound({ ...converging, instruction: '改成短发' }), false)
// 4a. 只调换顺序：不应用
result = stabilizeResult(
  converging,
  output({ verdict: 'changes', positive: 'blue eyes, silver hair, smile' }),
)
assert.equal(result.positive, base.prompt)
assert.equal(result.verdict, 'converged')
// 4b. 只有经验类再调整：转为可选，提示词不变
result = stabilizeResult(converging, firstRound)
assert.equal(result.positive, base.prompt)
assert.equal(result.verdict, 'converged')
assert.ok(result.changes.every((change) => change.scope === 'optional'))
// 4c. 规则级硬错误仍然修正
const hardFix = output({
  verdict: 'changes',
  positive: 'silver hair, blue eyes, smiling',
  changes: [{ scope: 'positive', text: 'smile → smiling', basis: 'rule', evidence: '别名' }],
})
assert.equal(stabilizeResult(converging, hardFix).positive, hardFix.positive)

// 5. 部分采纳（当前提示词与上一轮输出不同）不触发收敛收紧
const partial = { ...base, prompt: 'silver hair, green eyes, smile', previous }
assert.equal(adoptedPreviousRound(partial), false)

// 6. A repeat review requires the exact adopted text AND the same Skill/model/evidence context.
const context = 'enabled skills and provider settings A'
const reviewed = { ...previous, reviewKey: reviewKey(base, previous, context) }
const repeat = { ...base, previous: reviewed }
assert.equal(canReuseReview(repeat, context), true)
assert.equal(canReuseReview(repeat, context + ' changed'), false)
assert.equal(canReuseReview({ ...repeat, version: 'v5' }, context), false)
assert.equal(
  canReuseReview({ ...repeat, promptPresets: { qualityTags: true, ucPreset: 'heavy' } }, context),
  false,
)
assert.equal(canReuseReview({ ...repeat, instruction: 'Change the pose' }, context), false)
assert.equal(canReuseReview({ ...repeat, prompt: base.prompt + ', sitting' }, context), false)
assert.equal(canReuseReview({ ...base, previous }, context), false)

// 7. Lettering whitespace and case are content, not normalization-only changes.
const lettered = { ...base, prompt: 'text, Text: GOOD  DAY\n\nMAP', characters: [] }
const letteringPrevious = { ...previous, positive: lettered.prompt, characters: [] }
assert.equal(adoptedPreviousRound({ ...lettered, previous: letteringPrevious }), true)
assert.equal(
  adoptedPreviousRound({
    ...lettered,
    prompt: 'text, Text: GOOD DAY MAP',
    previous: letteringPrevious,
  }),
  false,
)
const changedLettering = stabilizeResult(
  { ...lettered, previous: letteringPrevious },
  output({
    positive: 'text, Text: good  day\n\nMAP',
    characters: [],
    verdict: 'changes',
    changes: [{ scope: 'positive', basis: 'rule', text: 'case change', evidence: 'fixture' }],
  }),
)
assert.equal(changedLettering.verdict, 'changes')
assert.equal(changedLettering.stabilized, undefined)

console.log('PASS optimize convergence: converged verdicts, reorder-only, adopted-round tightening')
