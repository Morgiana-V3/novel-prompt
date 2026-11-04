require('../support/register-typescript.cjs')
const assert = require('node:assert/strict')
const {
  estimateGeneration,
  estimateUpscale,
  anlasOutcomeText,
} = require('../../src/shared/generation/pricing.ts')
const request = { version: 'v4.5', params: { width: 832, height: 1216, steps: 23, count: 1 } }
const paid = { active: true, tier: 1 }
const opus = { active: true, tier: 3, usagePercent: 90, usageNegative: false }
// Reference values from the official web calculator, including both rounding stages.
assert.equal(estimateGeneration(request, paid).perImage, 17)
assert.equal(estimateGeneration({ ...request, version: 'v5' }, paid).perImage, 26)
assert.equal(
  estimateGeneration({ ...request, version: 'v5', img2img: { strength: 0.5 } }, paid).perImage,
  13,
)
assert.equal(estimateGeneration({ ...request, inpaint: { strength: 0.5 } }, paid).perImage, 9)
assert.equal(estimateGeneration({ ...request, img2img: { strength: 0.01 } }, paid).perImage, 2)
const large = { ...request, params: { ...request.params, width: 1024, height: 1536, count: 4 } }
assert.equal(estimateGeneration(large, opus).maximum, 104)
assert.equal(estimateGeneration({ ...large, version: 'v5' }, opus).maximum, 156)
assert.equal(
  estimateGeneration({ ...request, params: { ...request.params, count: 4 } }, opus).maximum,
  0,
)
const v5batch = estimateGeneration(
  { ...request, version: 'v5', params: { ...request.params, count: 4 } },
  opus,
)
assert.deepEqual([v5batch.minimum, v5batch.maximum], [0, 78])
assert.equal(
  estimateGeneration({ ...request, version: 'v5' }, { ...opus, usageNegative: true }).perImage,
  26,
)
assert.equal(estimateGeneration(request).perImage, undefined)
assert.equal(
  estimateGeneration({ ...request, version: 'v5' }, { active: true, tier: 3 }).perImage,
  undefined,
)
assert.equal(
  estimateGeneration({ ...request, params: { ...request.params, steps: 29 } }, opus).perImage,
  20,
)
assert.equal(
  estimateGeneration({ ...request, version: 'v5' }, { ...opus, usagePercent: 1 }).perImage,
  0,
  'the 2% safety threshold is not a pricing rule',
)
for (const [pixels, cost] of [
  [1048576, 1],
  [1048577, 2],
  [1747627, 2],
  [1747628, 3],
  [2446678, 3],
  [2446679, 4],
  [3145728, 4],
  [3145729, undefined],
  [0, undefined],
  [-1, undefined],
]) {
  assert.equal(estimateUpscale(pixels, 1), cost)
}
for (const width of [0, NaN, Infinity, -1, 0.5, 999999]) {
  assert.equal(estimateGeneration({ ...request, params: { ...request.params, width } }), undefined)
}
assert.match(anlasOutcomeText({}), /未知/)
assert.match(anlasOutcomeText({ anlasDelta: 0, usageDelta: -1.5 }), /0 Anlas.*减少 1.5 个百分点/)
assert.match(anlasOutcomeText({ anlasDelta: 5 }), /增加 5 Anlas/)
assert.match(
  anlasOutcomeText({ anlasDelta: -26, subscription: { anlasFixed: 74, anlasPurchased: 10 } }),
  /减少 26 Anlas.*剩余 84/,
)
console.log(
  'PASS NovelAI official pricing vectors, sequential batches, allowance, upscale boundaries and observed spending',
)
