const assert = require('node:assert/strict')
const { parsePrompt } = require('../../src/shared/prompts/parser.ts')
const { removePromptTokens } = require('../../src/shared/prompts/remove-tokens.ts')
module.exports = function checkTokenRemoval() {
  const cases = [
    ['a{bogus}b', 'a, b'],
    ['a{1.2::bogus::}b', 'a, b'],
    ['a, bogus', 'a'],
    ['bogus, a', 'a'],
    ['a, bogus, b', 'a, b'],
    ['a, {bogus}, b', 'a, b'],
    ['a, [[bogus]], b', 'a, b'],
    ['a, 1.2::bogus::, b', 'a, b'],
    ['a, {1.2::bogus::}, b', 'a, b'],
    ['{good, bogus}', '{good}'],
    ['[bogus, good]', '[good]'],
    ['a, 1.2::{bogus}, good::, z', 'a, 1.2::good::, z'],
    ['{good, {{bogus}}, best}', '{good, best}'],
    ['a,\n{bogus},\nb', 'a,\n\nb'],
    ['{{bogus}}', ''],
    ['-1::bogus::', ''],
    ['a, {bogus, bogus}, b', 'a, b'],
    ['a, {bogus', 'a'],
    ['a, artist:bogus, b', 'a, b'],
    ['a, source#bogus, b', 'a, b'],
    [
      'bogus, "x, {bogus}", Text: Hi, [bogus] 1.2::hello::',
      '"x, {bogus}", Text: Hi, [bogus] 1.2::hello::',
    ],
    ['a \\{b\\}, bogus, c', 'a \\{b\\}, c'],
    ['🌸, bogus, 光', '🌸, 光'],
  ]
  for (const [before, expected] of cases) {
    const targets = parsePrompt(before).filter((t) => t.core === 'bogus')
    const actual = removePromptTokens(before, targets)
    assert.equal(actual, expected, before)
    const remaining = parsePrompt(before)
      .filter((t) => t.core !== 'bogus')
      .map((t) => [t.raw, t.weight, t.section])
    assert.deepEqual(
      parsePrompt(actual).map((t) => [t.raw, t.weight, t.section]),
      remaining,
      `surviving content/weights: ${before}`,
    )
  }
  const duplicate = 'good, bogus, good'
  for (const input of [
    '{a, 1.2::b::, c}',
    '1.2::{a, b}::, c',
    '[a, {b}], c',
    'a, b | {c}',
    '1.5::[a], {b}, c::',
  ]) {
    const tokens = parsePrompt(input)
    for (let mask = 1; mask < 1 << tokens.length; mask++) {
      const targets = tokens.filter((_, index) => mask & (1 << index))
      const expected = tokens
        .filter((t) => !targets.includes(t))
        .map((t) => [t.raw, t.weight, t.section])
      const actual = parsePrompt(removePromptTokens(input, targets)).map((t) => [
        t.raw,
        t.weight,
        t.section,
      ])
      assert.deepEqual(actual, expected, `${input}: ${mask}`)
    }
  }
  assert.equal(removePromptTokens(duplicate, [parsePrompt(duplicate)[2]]), 'good, bogus')
  assert.equal(removePromptTokens('good, bogus', [{ start: 99, end: 100 }]), 'good, bogus')
  console.log(
    'PASS structural deletion removes empty weights/separators, preserves group weights, quotes, Text blocks, escapes and exact duplicate occurrences',
  )
}
