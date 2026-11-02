const assert = require('node:assert/strict')
const { adoptionPlan } = require('../../src/renderer/src/features/prompts/partial-adoption.ts')
const {
  reviewExplanations,
} = require('../../src/renderer/src/features/prompts/review-explanations.ts')

module.exports = function checkReviewExplanations() {
  const girl = { prompt: 'girl', negative: '', position: '' }
  const boy = { prompt: 'boy', negative: '', position: '' }
  const cat = { prompt: 'cat', negative: 'dog', position: '0.5,0.5' }
  const before = { base: 'red hair', negative: 'lowres', characters: [girl, boy] }
  const after = { base: 'silver hair', negative: 'bad anatomy', characters: [girl, cat, boy] }
  const reason = (scope, text, extra = {}) => ({
    scope,
    text,
    basis: 'rule',
    evidence: '',
    ...extra,
  })
  const added = reason('character', 'Add a cat', {
    characterIndex: 1,
    characterSide: 'after',
    characterField: 'prompt',
  })
  const negative = reason('character', 'Keep cat distinct', {
    characterIndex: 1,
    characterSide: 'after',
    characterField: 'negative',
  })
  const legacy = reason('character', 'Unaddressed legacy explanation')
  const optional = reason('optional', 'General suggestion')
  const plan = adoptionPlan(before, after)
  const catGroup = plan.review.find((g) => g.afterIndex === 1)
  assert.ok(catGroup)
  const routed = reviewExplanations(plan.review, [
    added,
    negative,
    legacy,
    optional,
    reason('positive', 'Hair'),
    reason('negative', 'Global negative'),
  ])
  assert.deepEqual(routed.byField.get(`${catGroup.key}/prompt`), [added])
  assert.deepEqual(routed.byField.get(`${catGroup.key}/negative`), [negative])
  assert.deepEqual(routed.remaining, [legacy, optional])
  assert.equal(routed.byField.get('global/base')[0].text, 'Hair')
  assert.equal(routed.byField.get('global/negative')[0].text, 'Global negative')

  const removed = reason('character', 'Remove the cat', {
    characterIndex: 1,
    characterSide: 'before',
    characterField: 'prompt',
  })
  const removal = adoptionPlan(after, before)
  const removedGroup = removal.review.find((g) => g.beforeIndex === 1)
  assert.deepEqual(
    reviewExplanations(removal.review, [removed]).byField.get(`${removedGroup.key}/prompt`),
    [removed],
  )
  const reorganized = adoptionPlan(before, { ...before, characters: [boy, girl] })
  assert.equal(reorganized.review[0].key, 'characters')
  assert.deepEqual(
    reviewExplanations(reorganized.review, [added]).byField.get('characters/role-1-prompt'),
    [added],
  )
  const outOfRange = { ...added, characterIndex: 99 }
  assert.deepEqual(reviewExplanations(plan.review, [outOfRange]).remaining, [outOfRange])
  console.log(
    'PASS explanations follow exact prompt fields, inserted/deleted roles and reorders; ambiguous legacy explanations stay general',
  )
}
