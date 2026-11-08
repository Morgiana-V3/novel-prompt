const assert = require('node:assert/strict')
const {
  estimateArtistMix,
  mixString,
  mixVariants,
} = require('../../src/shared/reverse/candidates.ts')

/** 画风组成估算是纯计算：概率融合、单一 / 混合判断、权重映射与变体生成。 */
function checkArtistMix() {
  const group = (model, tags) => ({ model, tags: tags.map(([name, score]) => ({ name, score })) })

  // 第一名明显领先 → 单一画风，权重为 1
  const single = estimateArtistMix({
    artists: [
      group('Kaloscope 2', [
        ['alpha_one', 0.82],
        ['beta', 0.05],
      ]),
      group('Kaloscope 3', [
        ['alpha one', 0.7],
        ['gamma', 0.06],
      ]),
    ],
  })
  assert.equal(single.kind, 'single')
  assert.deepEqual(
    single.parts.map((part) => [part.name, part.weight, part.share]),
    [['alpha one', 1, 100]],
  )

  // 分数接近 → 混合画风：两个模型一致的候选排在前面，第一名权重 1.2，占比合计约 100
  const mix = estimateArtistMix({
    artists: [
      group('Kaloscope 2', [
        ['a', 0.3],
        ['b', 0.25],
        ['c', 0.04],
        ['d', 0.2],
      ]),
      group('Kaloscope 3', [
        ['a', 0.28],
        ['b', 0.3],
        ['e', 0.25],
      ]),
    ],
  })
  assert.equal(mix.kind, 'mix')
  assert.deepEqual(
    mix.parts.map((part) => part.name),
    ['a', 'b', 'e', 'd'],
  )
  assert.equal(mix.parts[0].weight, 1.2)
  assert.ok(mix.parts.every((part) => part.weight >= 0.8 && part.weight <= 1.2))
  const shares = mix.parts.reduce((sum, part) => sum + part.share, 0)
  assert.ok(shares >= 98 && shares <= 102, `shares ${shares}`)
  // 低于第一名 25% 的候选不进入组合
  assert.ok(!mix.parts.some((part) => part.name === 'c'))

  assert.equal(estimateArtistMix({ artists: [] }), null)

  // 画师串：权重 1 不加语法
  assert.equal(
    mixString([
      { name: 'a', weight: 1.2 },
      { name: 'b', weight: 1 },
    ]),
    '1.2::artist:a ::, artist:b',
  )

  // 真机回归：m0311 紧贴 :: 会被供应商当成数字权重，导致后续内容生成噪声。
  const numericName = mixString([{ name: 'anderson m0311', weight: 0.9 }])
  assert.equal(numericName, '0.9::artist:anderson m0311 ::')
  assert.deepEqual(numericName.match(/-?\d+(?:\.\d+)?::/g), ['0.9::'])

  // 变体：逐位加强、去掉最弱、逐位减弱；去重、不含原组合、限制在 0.3～1.6
  const base = [
    { name: 'a', weight: 1.5 },
    { name: 'b', weight: 0.9 },
    { name: 'c', weight: 0.8 },
  ]
  const variants = mixVariants(base, 0.15, 10)
  const strings = variants.map(mixString)
  assert.ok(!strings.includes(mixString(base)))
  assert.equal(new Set(strings).size, strings.length)
  assert.equal(strings[0], '1.6::artist:a ::, 0.9::artist:b ::, 0.8::artist:c ::')
  assert.ok(strings.includes('1.5::artist:a ::, 0.9::artist:b ::'))
  assert.ok(variants.flat().every((part) => part.weight >= 0.3 && part.weight <= 1.6))
  assert.equal(mixVariants(base, 0.15).length, 3)
  console.log('PASS artist mix estimation')
}

module.exports = checkArtistMix
if (require.main === module) {
  checkArtistMix()
}
