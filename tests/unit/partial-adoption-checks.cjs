const assert = require('node:assert/strict')
const { adoptionPlan } = require('../../src/renderer/src/features/prompts/partial-adoption.ts')
module.exports = function checkPartialAdoption() {
  const before = {
    base: 'red hair, blue eyes',
    negative: 'lowres',
    characters: [{ prompt: 'girl', negative: '', position: '0.3,0.5' }],
  }
  const after = {
    base: 'silver hair, green eyes',
    negative: '',
    characters: [
      { prompt: 'girl, smiling', negative: '', position: '0.8,0.5' },
      { prompt: 'boy', negative: '', position: '' },
    ],
  }
  const plan = adoptionPlan(before, after)
  const hair = plan.changes.find((c) => c.after.trim() === 'silver hair,')
  const eyes = plan.changes.find((c) => c.after === 'green eyes')
  assert.ok(hair && eyes)
  const selected = new Set([hair.id])
  assert.equal(plan.render(selected).base, 'silver hair, blue eyes')
  const manual = { ...plan.render(selected), negative: 'manually edited negative' }
  const undone = plan.transition(manual, selected, new Set())
  assert.equal(undone.draft.base, before.base)
  assert.equal(undone.draft.negative, manual.negative)
  assert.ok(plan.transition({ ...manual, base: 'manual rewrite' }, selected, new Set()).error)
  const all = new Set(plan.changes.map((c) => c.id))
  assert.deepEqual(plan.render(all), after)
  assert.deepEqual(plan.transition(after, all, new Set()).draft, before)
  const removed = adoptionPlan(after, before)
  assert.deepEqual(removed.render(new Set(removed.changes.map((c) => c.id))), before)
  for (const [base, target] of [
    ['a, a, b', 'a, b, a'],
    ['她望着窗外，光线很柔和。', '她望着窗外，光线很明亮。'],
    ['Text: "hello, world!"', 'Text: "goodbye, world!"'],
    ['', '1.2::red hair, blue eyes::'],
    ['a,\n b', 'b, a'],
    ['🌸 red', '🌸 blue'],
    ['a, b', ''],
  ]) {
    const original = { base, negative: '', characters: [] }
    const expected = { ...original, base: target }
    const candidate = adoptionPlan(original, expected)
    let active = new Set()
    let draft = original
    for (const change of [...candidate.changes].reverse()) {
      const next = new Set([...active, change.id])
      draft = candidate.transition(draft, active, next).draft
      active = next
    }
    assert.deepEqual(draft, expected)
    assert.deepEqual(candidate.transition(draft, active, new Set()).draft, original)
  }
  const safe = adoptionPlan(
    { base: 'a, 1.2::red hair, blue eyes::, c', negative: '', characters: [] },
    { base: 'a, 1.4::silver hair, green eyes::, c', negative: '', characters: [] },
  )
  assert.equal(safe.changes.length, 1, 'a weighted group cannot be partially broken')
  // Prose: a single inserted / rewritten sentence is its own adoptable change.
  const { granularChanges } = require('../../src/renderer/src/features/prompts/partial-adoption.ts')
  const proseOld =
    '1girl, A quiet garden lies behind the house. Soft light falls on the path. The girl waits by the window.'
  const proseNew =
    '1girl, A quiet garden lies behind the house. Warm sunset light falls on the path. The girl waits by the window. A cat sleeps on the sill.'
  const prose = adoptionPlan(
    { base: proseOld, negative: '', characters: [] },
    { base: proseNew, negative: '', characters: [] },
  )
  assert.equal(prose.changes.length, 2, 'one rewritten sentence and one added sentence')
  assert.equal(granularChanges(prose.changes).length, 2, 'single-sentence changes are granular')
  const sentence = prose.changes.find((c) => c.after.includes('A cat'))
  assert.equal(
    prose.render(new Set([sentence.id])).base,
    `${proseOld} A cat sleeps on the sill.`,
    'adopting only the new sentence keeps the rest untouched',
  )
  const rewrite = adoptionPlan(
    { base: '1girl, One. Two. Three.', negative: '', characters: [] },
    { base: '1girl, Uno. Dos. Tres.', negative: '', characters: [] },
  )
  assert.equal(rewrite.changes.length, 1, 'consecutive rewritten sentences stay one passage')
  assert.equal(granularChanges(rewrite.changes).length, 0)
  const zh = adoptionPlan(
    { base: '她站在窗边。窗外下着雨。', negative: '', characters: [] },
    { base: '她站在窗边。窗外下着雪。', negative: '', characters: [] },
  )
  assert.equal(zh.changes.length, 1)
  assert.equal(zh.changes[0].before, '窗外下着雨。')
  for (const [base, target] of [
    ['a, b, c', 'a, c'],
    ['a, b', 'a, b, c'],
    ['"hello, world", a', '"goodbye, world", b'],
  ]) {
    const plan = adoptionPlan(
      { base, negative: '', characters: [] },
      { base: target, negative: '', characters: [] },
    )
    for (let mask = 0; mask < 2 ** plan.changes.length; mask++) {
      const selected = new Set(plan.changes.filter((_, i) => mask & (1 << i)).map((c) => c.id))
      const text = plan.render(selected).base
      assert.ok(!/^\s*,|,\s*,|,\s*$/.test(text), text)
    }
  }
  const nested = adoptionPlan(
    { base: '1.2::red hair, 0.8::blue eyes, smiling::, c', negative: '', characters: [] },
    { base: '1.4::silver hair, 0.9::green eyes, happy::, c', negative: '', characters: [] },
  )
  assert.equal(nested.changes.length, 1)
  // Inserting before a paragraph changes the previous tag's comma/newline, not its meaning.
  const paragraph = 'Panel 1 at the top. The small yellow creature stands on the image right.'
  for (const [originalText, proposedText, addedText] of [
    [
      `standing,\n${paragraph}`,
      `standing, target#pointing at another,\n${paragraph}`,
      'target#pointing at another',
    ],
    ['standing', 'standing, smiling', 'smiling'],
    ['standing,\n', 'standing, smiling,\n', 'smiling'],
    ['standing, Text: Hello,', 'standing, smiling, Text: Hello,', 'smiling'],
  ]) {
    const original = { base: originalText, negative: '', characters: [] }
    const proposal = { ...original, base: proposedText }
    const plan = adoptionPlan(original, proposal)
    assert.equal(plan.changes.length, 1)
    assert.deepEqual(plan.changes[0].description, {
      before: '',
      after: addedText,
      operation: 'add',
    })
    const selected = new Set([plan.changes[0].id])
    assert.deepEqual(plan.render(selected), proposal)
    assert.deepEqual(plan.transition(proposal, selected, new Set()).draft, original)
    const reverse = adoptionPlan(proposal, original)
    assert.deepEqual(reverse.changes[0].description, {
      before: addedText,
      after: '',
      operation: 'remove',
    })
  }
  const { describeTextChange } = require('../../src/renderer/src/features/prompts/adoption-text.ts')
  assert.deepEqual(describeTextChange('pointing at another, ', 'source#pointing at another, '), {
    before: 'pointing at another',
    after: 'source#pointing at another',
    operation: 'replace',
  })
  assert.deepEqual(describeTextChange('standing,\n', 'standing, '), {
    before: '',
    after: '',
    operation: 'format',
  })
  assert.deepEqual(describeTextChange('standing, standing', 'standing'), {
    before: 'standing',
    after: '',
    operation: 'remove',
  })
  assert.equal(describeTextChange('a, b', 'b, a').operation, 'reorder')
  assert.deepEqual(describeTextChange('Text: Hello,', 'Text: Hello!'), {
    before: 'Text: Hello,',
    after: 'Text: Hello!',
    operation: 'replace',
  })
  const role = (prompt) => ({ prompt, negative: '', position: '' })
  const draft = (characters) => ({ base: 'scene', negative: '', characters })
  const a = role('girl, red hair')
  const b = role('boy, blue hair')
  const c = role('cat')
  for (const [oldRoles, newRoles, kind] of [
    [[a, b], [a, c, b], 'add'],
    [[a, c, b], [a, b], 'remove'],
    [[a, b], [b, a], 'structure'],
    [[a, b], [role('new person'), c, role('rewritten person')], 'structure'],
    [[a, a], [a, a, a], 'structure'],
  ]) {
    const original = draft(oldRoles)
    const proposal = draft(newRoles)
    const plan = adoptionPlan(original, proposal)
    assert.equal(plan.changes.length, 1)
    assert.equal(plan.changes[0].kind, kind)
    const selected = new Set([plan.changes[0].id])
    assert.deepEqual(plan.render(selected), proposal)
    assert.deepEqual(plan.transition(proposal, selected, new Set()).draft, original)
    assert.ok(plan.transition(draft([...newRoles, role('manual')]), selected, new Set()).error)
  }
  // A middle deletion must not shift the text patch for a later edited character.
  const mixed = adoptionPlan(draft([a, c, b]), draft([a, role('boy, green hair')]))
  const deleted = mixed.changes.find((c) => c.kind === 'remove')
  // No exact anchor for the edited tail: retain the entire structure as one safe operation.
  assert.ok(!deleted && mixed.changes.some((c) => c.kind === 'structure'))
  const anchored = adoptionPlan(draft([a, c, b]), draft([role('girl, silver hair'), b]))
  assert.ok(anchored.changes.some((c) => c.kind === 'structure'))
  console.log(
    'PASS exact partial adoption, independent toggles, structural changes, text preservation and manual-edit conflict protection',
  )
}
